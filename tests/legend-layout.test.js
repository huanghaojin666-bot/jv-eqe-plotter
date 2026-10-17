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

test("device gradient puts preview and export legends below the axes", () => {
  const chart = chartHarness();
  chart.state.deviceGradient.enabled = true;
  for (const exportMode of [false, true]) {
    const layout = chart.plotLayout(chart.state.datasets, exportMode);
    assert.equal(layout.showlegend, true);
    assert.equal(layout.legend.orientation, "h");
    assert.equal(layout.legend.yanchor, "top");
    assert.ok(layout.legend.y < 0);
    assert.equal(layout.legend.x, 0);
    assert.equal(layout.height, chart.plotGeometry(chart.state.datasets, exportMode).height);
    assert.equal(layout.legend.maxheight, layout.margin.b);
    const traces = chart.buildTraces(chart.state.datasets, exportMode);
    assert.equal(traces.length, 50);
    assert.deepEqual(Array.from(traces, (trace) => trace.name), chart.state.datasets.map((dataset) => dataset.label));
  }
});

test("wrapped legend grows the page without shrinking the data area", () => {
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
  assert.ok(chart.plotGeometry(chart.state.datasets, false).height > wide.height);
});

test("hidden legend entries still reserve space and retain curve colors", () => {
  const chart = chartHarness();
  chart.state.deviceGradient.enabled = true;
  const before = chart.plotGeometry(chart.state.datasets, false);
  const originalColor = chart.buildTraces(chart.state.datasets, false)[0].line.color;
  chart.state.datasets.slice(1).forEach((dataset) => { dataset.visible = false; });
  const visible = chart.currentDatasets(false);
  assert.ok(chart.plotGeometry(visible, false).height >= before.height);
  const traces = chart.buildTraces(chart.currentDatasets(true), false);
  assert.equal(traces[0].line.color, originalColor);
  assert.equal(traces[1].visible, "legendonly");
});

test("ordinary EQE/JV legends and manual gradient mode keep their layout", () => {
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
  assert.equal(chart.plotLayout(chart.state.datasets, false).showlegend, false);
  assert.equal(chart.plotGeometry(chart.state.datasets, false).height, 650);
});
