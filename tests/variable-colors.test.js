"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const parser = require("../parser.js");

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
  vm.runInNewContext(`${builders}\nwindow.chart = { state, deviceVariablePrefix, variableColor, buildTraces, buildOriginRecipe, plotLayout, renderDeviceStyles, renderCurveList }; }());`, context);
  const chart = context.window.chart;
  chart.state.view = "EQE";
  chart.state.datasets = ["DMF1-1", "DMF2-2", "10 1-1", "10 2-2", "20 1-1", "20 2-2"]
    .map((label, index) => ({
      ...parser.metadataFromName(label), id: `curve-${index}`, type: "EQE", visible: true,
      x: [400, 800, 1200], y: [0, 30 + index, 10 + index]
    }));
  return { ...chart, elements };
}

test("variable prefixes recognize letter and numeric device groups without confusing 1/10/100", () => {
  const chart = harness();
  for (const [device, expected] of [
    ["DMF1", "DMF"], ["dmf2", "DMF"], ["DMF 3", "DMF"],
    ["DMF-4", "DMF"], ["DMF_5", "DMF"], ["ＤＭＦ６", "DMF"],
    ["10 1", "10"], ["10 2", "10"], ["20 1", "20"], ["20 2", "20"],
    ["1 1", "1"], ["100 1", "100"], ["10", "10"], ["器件10", "10"],
    ["0.5 1", "0.5"], ["对照组1", "对照组"], ["DMF-treated 2", "DMF-TREATED"]
  ]) assert.equal(chart.deviceVariablePrefix(device), expected, device);
});

test("same variable uses identical colors in preview, image export and Origin recipe", () => {
  const chart = harness();
  const originalData = JSON.stringify(chart.state.datasets);
  chart.state.variableSameColor = true;
  const preview = chart.buildTraces(chart.state.datasets, false);
  const colors = Array.from(preview, (trace) => trace.line.color);
  assert.equal(colors[0], colors[1]);
  assert.equal(colors[2], colors[3]);
  assert.equal(colors[4], colors[5]);
  assert.equal(new Set(colors).size, 3);
  assert.deepEqual(Array.from(chart.buildTraces(chart.state.datasets, true), (trace) => trace.line.color), colors);
  assert.deepEqual(Array.from(chart.buildOriginRecipe(chart.state.datasets).curves, (curve) => curve.color), colors);
  assert.equal(chart.plotLayout(chart.state.datasets, false).images.length, 0);
  assert.equal(JSON.stringify(chart.state.datasets), originalData);
});

test("group color changes propagate to swatches and do not overwrite ordinary curve colors", () => {
  const chart = harness();
  chart.state.curveStyles["curve-0"] = { color: "#123456" };
  chart.state.variableSameColor = true;
  chart.buildTraces(chart.state.datasets, false);
  chart.state.variableColors.set("DMF", "#9900aa");
  const traces = chart.buildTraces(chart.state.datasets, false);
  assert.equal(traces[0].line.color, "#9900aa");
  assert.equal(traces[1].line.color, "#9900aa");
  chart.renderDeviceStyles();
  chart.renderCurveList();
  assert.equal((chart.elements.get("deviceStyleList").innerHTML.match(/value="#9900aa"/g) || []).length, 2);
  assert.equal((chart.elements.get("curveList").innerHTML.match(/value="#9900aa" disabled/g) || []).length, 2);
  chart.state.variableSameColor = false;
  assert.equal(chart.buildTraces(chart.state.datasets, false)[0].line.color, "#123456");
});

test("variable colors stay stable through filtering, added variables, JV/EQE switches and renaming", () => {
  const chart = harness();
  chart.state.variableSameColor = true;
  const initial = chart.buildTraces(chart.state.datasets, false).map((trace) => trace.line.color);
  chart.state.datasets[0].visible = false;
  assert.equal(chart.buildTraces(chart.state.datasets.slice(1), false)[0].line.color, initial[1]);
  const added = { ...chart.state.datasets[0], id: "new", device: "1 1", type: "JV", visible: true };
  chart.state.datasets.push(added);
  chart.variableColor(added.device);
  assert.equal(chart.variableColor("DMF1"), initial[0]);
  chart.state.view = "JV";
  const sameVariable = { ...added, id: "jv-dmf", device: "DMF3" };
  chart.state.datasets.push(sameVariable);
  assert.equal(chart.buildTraces([sameVariable], true)[0].line.color, initial[0]);
  chart.state.datasets[1].device = "20 3";
  chart.state.view = "EQE";
  assert.equal(chart.buildTraces([chart.state.datasets[1]], false)[0].line.color, initial[4]);
});
