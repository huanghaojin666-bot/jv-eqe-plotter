"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function harness() {
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
  const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const builders = source.slice(0, source.indexOf('  elements.chooseFilesButton.addEventListener'));
  vm.runInNewContext(`${builders}\nwindow.chart = { state, yAxisSettings, plotLayout, buildOriginRecipe }; }());`, context);
  return { ...context.window.chart, elements };
}

function dataset(maximum) {
  return { id: "curve-1", type: "EQE", label: "10 1-1", device: "10 1", point: "1", visible: true, x: [400, 800, 1200], y: [0, maximum, maximum / 2] };
}

test("large EQE ranges have at most seven major labels without changing the range or data", () => {
  const chart = harness();
  for (const maximum of [0, 10, 40, 55, 100, 120, 150, 300, 500, 1000, 3400, 4000, 10000, 1e6]) {
    const datasets = [dataset(maximum)];
    const before = JSON.stringify(datasets);
    for (const exportMode of [false, true]) {
      const axis = chart.yAxisSettings(datasets, false, false, exportMode);
      assert.equal(axis.tick0, 0);
      assert.ok(Math.floor(axis.range[1] / axis.dtick) + 1 <= 7, `maximum ${maximum}`);
      assert.equal(axis.range[1], Math.max(10, Math.ceil((maximum * 1.08) / 10) * 10));
      assert.ok(Number.isFinite(axis.dtick) && axis.dtick > 0);
      assert.equal(axis.tickformat, ".0f");
    }
    assert.equal(JSON.stringify(datasets), before);
  }
});

test("ordinary EQE intervals stay familiar and large values get larger steps", () => {
  const chart = harness();
  assert.equal(chart.yAxisSettings([dataset(40)], false, false, false).dtick, 10);
  assert.equal(chart.yAxisSettings([dataset(100)], false, false, false).dtick, 20);
  assert.equal(chart.yAxisSettings([dataset(3400)], false, false, false).dtick, 1000);
});

test("preview, image export, gradient mode and Origin recipe agree on the EQE tick spacing", () => {
  const chart = harness();
  chart.state.view = "EQE";
  chart.state.datasets = [dataset(3400)];
  for (const mode of ["ordinary", "device-gradient", "manual-gradient", "variable-color"]) {
    chart.state.deviceGradient.enabled = mode === "device-gradient";
    chart.state.gradient.enabled = mode === "manual-gradient";
    chart.state.variableSameColor = mode === "variable-color";
    if (mode === "manual-gradient") chart.state.datasets.push({ ...dataset(1000), id: "curve-2" });
    const preview = chart.plotLayout(chart.state.datasets, false).yaxis;
    const exported = chart.plotLayout(chart.state.datasets, true).yaxis;
    const origin = chart.buildOriginRecipe(chart.state.datasets).axes.y;
    assert.equal(preview.dtick, 1000);
    assert.equal(exported.dtick, preview.dtick);
    assert.equal(origin.majorStep, preview.dtick);
    assert.deepEqual(Array.from(origin.range), Array.from(preview.range));
  }
});

test("wide JV log ranges reduce tick density while short ranges keep decade ticks", () => {
  const chart = harness();
  for (const [minimum, step] of [[1e-4, 1], [1e-8, 1], [1e-12, 2], [1e-20, 3]]) {
    const data = [{ ...dataset(1), type: "JV", y: [-minimum, 0, 1] }];
    const axis = chart.yAxisSettings(data, true, true, false);
    assert.equal(axis.type, "log");
    assert.equal(axis.dtick, step);
    assert.equal(axis.minor.ticks, step > 1 ? "" : "outside");
    assert.ok((axis.range[1] - axis.range[0]) / step <= 8);
  }
  assert.ok(Number.isFinite(chart.yAxisSettings([], false, false, false).dtick));
});
