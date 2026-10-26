"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const parser = require("../parser.js");
const exporter = require("../exporter.js");

function eqeText(names, raw = false) {
  return [
    names.flatMap(name => ["AM1.5D", "0", "", "", "Name", name]),
    names.flatMap(() => [raw ? "Wavelength (nm)" : "Lambda(nm)", "EQE (%)", "SR (A/W)", "Jsc (mA/cm^2)", "", ""]),
    names.flatMap((_, index) => [400, index + 1, 0, 0, "", ""]),
    names.flatMap((_, index) => [410, index + 2, 0, 0, "", ""])
  ].map(row => row.join("\t")).join("\n");
}

function chartHarness(datasets) {
  const elements = new Map();
  const context = {
    window: { JVEQEParser: parser },
    document: {
      createElement: () => ({ getContext: () => ({ measureText: text => ({ width: text.length * 9 }) }) }),
      getElementById: id => {
        if (!elements.has(id)) elements.set(id, { value: "all", checked: false, clientWidth: 1000 });
        return elements.get(id);
      }
    }
  };
  const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const builders = source.slice(0, source.indexOf('  elements.chooseFilesButton.addEventListener'));
  vm.runInNewContext(`${builders}\nwindow.chart = { state, sortDatasets, deviceGradientRatio, buildTraces, buildOriginRecipe, plotLayout }; }());`, context);
  const chart = context.window.chart;
  chart.state.view = "EQE";
  chart.state.deviceGradient.enabled = true;
  chart.state.datasets = datasets;
  return chart;
}

test("name cleaning preserves negative signs, including with illumination and punctuation", () => {
  for (const [name, label] of [
    ["-0.50", "-0.50"], ["-1", "-1"], ["-.5", "-.5"], ["−0.5 V", "-0.5 V"],
    ["-0.50 dark", "-0.50"], ["( -0.50 ) light", "-0.50"], ["- O 1-6 - dark", "O 1-6"],
    ["+0.50", "+0.50"], ["0.00", "0.00"], ["0 2", "0 2"], ["0 3", "0 3"]
  ]) assert.equal(parser.metadataFromName(name).label, label, name);
  assert.equal(parser.metadataFromName("-0.50 dark").illumination, "dark");
  assert.equal(parser.metadataFromName("-0.50").point, "-0.50");
});

test("positive/negative files and Raw pairs merge without losing signs, repeats or measurements", () => {
  let datasets = [];
  const groups = [["0.00", "0.20", "0.50"], ["0.00", "-0.10", "-0.50", "0 2", "0 3"]];
  groups.forEach((names, index) => {
    const raw = parser.parseFile(eqeText(names, true), { name: `sweep${index}_Raw.txt` }).datasets;
    const processed = parser.parseFile(eqeText(names), { name: `sweep${index}.txt` }).datasets;
    datasets = parser.mergeDatasets(datasets, raw);
    datasets = parser.mergeDatasets(datasets, processed);
  });
  assert.equal(datasets.length, 8);
  assert.equal(datasets.filter(item => item.label === "0.00").length, 2);
  assert.equal(datasets.filter(item => item.label.startsWith("-")).length, 2);
  const restored = parser.parseFile(exporter.buildInstrumentText("EQE", datasets), { name: "roundtrip.txt" }).datasets;
  const values = list => list.map(({ label, point, device, x, y }) => ({ label, point, device, x, y }));
  assert.deepEqual(values(restored), values(datasets));
});

test("Raw markers before a dot inside the basename still pair with processed data", () => {
  const names = ["0.00", "0.02", "0.50"];
  const raw = parser.parseFile(eqeText(["1", "2", "3"], true), {
    name: "10_Raw.19_2026_10_19-17_23.txt", relativePath: "positive/10_Raw.19_2026_10_19-17_23.txt"
  }).datasets;
  const processed = parser.parseFile(eqeText(names), {
    name: "10.19_2026_10_19-17_23.txt", relativePath: "positive/10.19_2026_10_19-17_23.txt"
  }).datasets;
  assert.deepEqual(parser.mergeDatasets(raw, processed), processed);
  assert.deepEqual(parser.mergeDatasets(processed, raw), processed);
  const otherFolder = parser.parseFile(eqeText(names), {
    name: "10.19_2026_10_19-17_23.txt", relativePath: "negative/10.19_2026_10_19-17_23.txt"
  }).datasets;
  assert.equal(parser.mergeDatasets(processed, otherFolder).length, 6);
});

test("device gradient is one signed numeric scale across files, with equal colors for equal voltage", () => {
  const names = ["0.00", "0.20", "0.50", "0.00", "-0.10", "-0.50", "0 2", "0 3"];
  const datasets = parser.parseFile(eqeText(names), { name: "sweep.txt" }).datasets;
  const before = new Map(datasets.map(item => [item.id, JSON.stringify({ x: item.x, y: item.y })]));
  const chart = chartHarness(datasets);
  chart.sortDatasets();
  assert.deepEqual(Array.from(chart.state.datasets, item => item.label), ["-0.50", "-0.10", "0.00", "0.00", "0.20", "0.50", "0 2", "0 3"]);
  for (const item of datasets) {
    const expected = item.label.includes(" ") ? null : Number(item.label) + 0.5;
    assert.equal(chart.deviceGradientRatio(item), expected);
    assert.equal(JSON.stringify({ x: item.x, y: item.y }), before.get(item.id));
  }
  for (const exportMode of [false, true]) {
    const traces = chart.buildTraces(datasets, exportMode);
    const zero = traces.filter(trace => trace.name === "0.00");
    assert.equal(zero[0].line.color, zero[1].line.color);
    const layout = chart.plotLayout(datasets, exportMode);
    assert.equal(layout.images.length, 1);
    assert.deepEqual(Array.from(layout.annotations, item => item.text), ["未识别", "-0.50", "0.50"]);
    const colors = [...decodeURIComponent(layout.images[0].source.split(",")[1]).matchAll(/stop-color="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(colors, [traces.find(trace => trace.name === "-0.50").line.color, traces.find(trace => trace.name === "0.50").line.color]);
  }
  assert.deepEqual(Array.from(chart.buildOriginRecipe(datasets).curves, item => item.name), Array.from(chart.buildTraces(datasets, true), item => item.name));
  const negative = datasets.find(item => item.label === "-0.10");
  const color = chart.buildTraces([negative], false)[0].line.color;
  datasets.find(item => item.label === "-0.50").visible = false;
  assert.equal(chart.buildTraces([negative], false)[0].line.color, color);
});
