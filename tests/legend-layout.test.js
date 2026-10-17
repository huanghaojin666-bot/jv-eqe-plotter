"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function chartHarness(count = 50) {
  const elements = new Map();
  const context = {
    window: {},
    document: {
      createElement: () => ({ getContext: () => ({ measureText: (text) => ({ width: text.length * 9 }) }) }),
      getElementById: (id) => {
        if (!elements.has(id)) elements.set(id, { value: "all", checked: false, clientWidth: 1000 });
        return elements.get(id);
      }
    }
  };
  // Expose pure chart builders in an isolated DOM stub, before event binding.
  const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const builders = source.slice(0, source.indexOf('  elements.chooseFilesButton.addEventListener'));
  vm.runInNewContext(`${builders}\nwindow.chart = { state, plotLayout, plotGeometry, coordinateAnnotationMetrics, buildTraces, currentDatasets }; }());`, context);
  const chart = context.window.chart;
  chart.state.view = "EQE";
  chart.state.datasets = Array.from({ length: count }, (_, index) => ({
    id: `curve-${index}`, type: "EQE", device: "5 1", point: String(index),
    label: (index * 0.02).toFixed(2), visible: true, x: [400, 800, 1200], y: [0, 20, 80]
  }));
  return { ...chart, elements };
}

function stripColors(layout, index = 0) {
  const svg = decodeURIComponent(layout.images[index].source.split(",")[1]);
  assert.match(svg, /<linearGradient/);
  return [...svg.matchAll(/stop-color="([^"]+)"/g)].map((match) => match[1]);
}

test("device gradient replaces individual legends with a continuous strip below the axes", () => {
  const chart = chartHarness();
  chart.state.deviceGradient.enabled = true;
  for (const exportMode of [false, true]) {
    const layout = chart.plotLayout(chart.state.datasets, exportMode);
    assert.equal(layout.showlegend, false);
    assert.equal(layout.images.length, 1);
    assert.ok(layout.images[0].y < 0);
    assert.notEqual(...stripColors(layout));
    assert.equal(layout.height, chart.plotGeometry(chart.state.datasets, exportMode).height);
    const traces = chart.buildTraces(chart.state.datasets, exportMode);
    assert.equal(traces.length, 50);
    assert.deepEqual(Array.from(traces, (trace) => trace.name), chart.state.datasets.map((dataset) => dataset.label));
    assert.deepEqual(stripColors(layout), [traces[0].line.color, traces.at(-1).line.color]);
    assert.equal(layout.images[0].opacity, traces[0].opacity);
    assert.deepEqual(Array.from(layout.annotations, (annotation) => annotation.text), ["5 1", "0.00", "0.98"]);
  }
});

test("a color strip reserves space without shrinking the data area or growing with curve count", () => {
  const chart = chartHarness();
  for (const exportMode of [false, true]) {
    chart.state.deviceGradient.enabled = false;
    const before = chart.plotGeometry(chart.state.datasets, exportMode);
    chart.state.deviceGradient.enabled = true;
    const after = chart.plotGeometry(chart.state.datasets, exportMode);
    assert.ok(after.height > before.height);
    assert.equal(after.height - after.margin.b, before.height - before.margin.b);
    assert.equal(chart.coordinateAnnotationMetrics(chart.state.datasets, exportMode).height, after.height);
  }
  const wide = chart.plotGeometry(chart.state.datasets, false);
  chart.elements.get("plot").clientWidth = 500;
  assert.equal(chart.plotGeometry(chart.state.datasets, false).height, wide.height);
  const small = chartHarness(2);
  small.state.deviceGradient.enabled = true;
  assert.equal(small.plotGeometry(small.state.datasets, false).height, wide.height);
});

test("filtering keeps curve colors and the strip endpoints match the selected range", () => {
  const chart = chartHarness();
  chart.state.deviceGradient.enabled = true;
  const before = chart.plotGeometry(chart.state.datasets, false);
  const originalColor = chart.buildTraces(chart.state.datasets, false)[0].line.color;
  chart.state.datasets.forEach((dataset, index) => { dataset.visible = index >= 10 && index <= 30; });
  const visible = chart.currentDatasets(false);
  assert.equal(chart.plotGeometry(visible, false).height, before.height);
  const traces = chart.buildTraces(chart.currentDatasets(true), false);
  assert.equal(traces[0].line.color, originalColor);
  assert.equal(traces[1].visible, "legendonly");
  const layout = chart.plotLayout(visible, false);
  assert.deepEqual(stripColors(layout), [traces[10].line.color, traces[30].line.color]);
  assert.deepEqual(Array.from(layout.annotations, (annotation) => annotation.text), ["5 1", "0.20", "0.60"]);
});

test("ordinary EQE/JV legends are unchanged and manual gradients also have a strip", () => {
  const chart = chartHarness(2);
  for (const view of ["EQE", "JV"]) {
    chart.state.view = view;
    const layout = chart.plotLayout(chart.state.datasets, false);
    assert.equal(layout.legend.orientation, "v");
    assert.equal(layout.legend.yanchor, "bottom");
    assert.equal(layout.legend.xanchor, view === "JV" ? "right" : "left");
    assert.equal(chart.plotGeometry(chart.state.datasets, false).height, 650);
  }
  chart.state.gradient.enabled = true;
  const layout = chart.plotLayout(chart.state.datasets, false);
  assert.equal(layout.showlegend, false);
  assert.equal(layout.images.length, 1);
  assert.equal(layout.yaxis.domain, undefined);
  assert.equal(layout.xaxis2, undefined);
  assert.deepEqual(Array.from(layout.annotations, (annotation) => annotation.text), ["变化条件", "起点", "终点"]);
});

test("each device has its own matching strip and editable labels", () => {
  const chart = chartHarness(4);
  chart.state.datasets[2].device = "10 2";
  chart.state.datasets[3].device = "10 2";
  chart.state.deviceGradient.enabled = true;
  chart.state.gradient.label = "时间";
  chart.state.gradient.start = "Day 1";
  chart.state.gradient.end = "Day 68";
  const layout = chart.plotLayout(chart.state.datasets, true);
  const traces = chart.buildTraces(chart.state.datasets, true);
  assert.equal(layout.images.length, 2);
  assert.deepEqual(stripColors(layout, 0), [traces[0].line.color, traces[1].line.color]);
  assert.deepEqual(stripColors(layout, 1), [traces[2].line.color, traces[3].line.color]);
  assert.notEqual(stripColors(layout, 0)[0], stripColors(layout, 1)[0]);
  assert.deepEqual(Array.from(layout.annotations, (annotation) => annotation.text), ["5 1 · 时间", "Day 1", "Day 68", "10 2 · 时间", "Day 1", "Day 68"]);
});

test("zero or one selected curve does not create a misleading gradient", () => {
  const chart = chartHarness(1);
  chart.state.deviceGradient.enabled = true;
  const layout = chart.plotLayout(chart.state.datasets, false);
  assert.equal(new Set(stripColors(layout)).size, 1);
  assert.equal(stripColors(layout)[0], chart.buildTraces(chart.state.datasets, false)[0].line.color);
  chart.state.datasets[0].visible = false;
  const empty = chart.plotLayout([], false);
  assert.equal(empty.images.length, 0);
  assert.equal(empty.showlegend, false);
});
