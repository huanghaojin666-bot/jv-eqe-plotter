"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const parser = require("../parser.js");
const exporter = require("../exporter.js");

const names = [
  "5 1-5", "5 1-2", "5 2-2", "5 2-5",
  "10 1-3", "10 2-3", "10 2-5", "10 2-2",
  "20 1-5", "20 2-2", "20 2-1", "20 2-4"
];
const devices = [
  "5 1", "5 1", "5 2", "5 2",
  "10 1", "10 2", "10 2", "10 2",
  "20 1", "20 2", "20 2", "20 2"
];

// Instrument-shaped synthetic data; no measured research data is bundled.
function eqeText(raw = false) {
  return [
    names.flatMap((name) => ["AM1.5D", "0", "", "", "Name", name]),
    names.flatMap(() => [raw ? "Wavelength (nm)" : "Lambda(nm)", "EQE (%)", "SR (A/W)", "Jsc (mA/cm^2)", "", ""]),
    names.flatMap((_, index) => [400, index + 1, 0, 0, "", ""]),
    names.flatMap((_, index) => [410, index + 2, 0, 0, "", ""])
  ].map((row) => row.join("\t")).join("\n");
}

test("device identity keeps the entire numeric prefix before the point separator", () => {
  names.forEach((name, index) => {
    const meta = parser.metadataFromName(name, "EQE.txt", "O1/EQE.txt");
    assert.equal(meta.device, devices[index]);
    assert.equal(meta.label, name);
  });
  assert.equal(parser.metadataFromName(" 10   2 - 3 dark ").device, "10 2");
  assert.equal(parser.metadataFromName("20 2_4").device, "20 2");
  assert.equal(parser.metadataFromName("处理组 1-2").device, "处理组 1");
  assert.notEqual(parser.metadataFromName("5 1-2").device, parser.metadataFromName("51-2").device);
});

test("existing letter names, numeric point names and folder hints remain compatible", () => {
  for (const [name, device, point] of [
    ["O 1-6", "O1", "1-6"], ["P2-3", "P2", "2-3"],
    ["f 1-4", "F1", "1-4"], ["DMF 2-5", "DMF2", "2-5"],
    ["2-3", "器件2", "2-3"]
  ]) {
    const meta = parser.metadataFromName(name);
    assert.equal(meta.device, device);
    assert.equal(meta.point, point);
  }
  assert.equal(parser.metadataFromName("1-6", "EQE.txt", "orange/O1/EQE.txt").device, "O1");
});

test("multi-curve EQE imports all six numeric devices without losing data", () => {
  const result = parser.parseFile(eqeText(), { name: "EQE_device_names.txt" });
  assert.equal(result.type, "EQE");
  assert.deepEqual(result.datasets.map((dataset) => dataset.device), devices);
  assert.deepEqual(result.datasets.map((dataset) => dataset.label), names);
  assert.equal(new Set(result.datasets.map((dataset) => dataset.device)).size, 6);
  result.datasets.forEach((dataset, index) => {
    assert.deepEqual(dataset.x, [400, 410]);
    assert.deepEqual(dataset.y, [index + 1, index + 2]);
  });
  const raw = parser.parseFile(eqeText(true), { name: "EQE_device_names_Raw.txt" });
  assert.deepEqual(raw.datasets.map((dataset) => dataset.device), devices);
  assert.deepEqual(parser.mergeDatasets(raw.datasets, result.datasets), result.datasets);
  const roundTrip = parser.parseFile(exporter.buildInstrumentText("EQE", result.datasets), { name: "EQE_export.txt" });
  const values = (datasets) => datasets.map(({ label, device, point, x, y }) => ({ label, device, point, x, y }));
  assert.deepEqual(values(roundTrip.datasets), values(result.datasets));
});

test("JV uses the same device-prefix rule", () => {
  const text = [
    ["Name", ...names.flatMap((name) => [name, ""])],
    ["[Result]", ...names.flatMap(() => ["Volt. (V)", "J (A/cm^2)"])],
    ["[Raw Data]", ...names.flatMap((_, index) => [0, index + 1])]
  ].map((row) => row.join("\t")).join("\n");
  const result = parser.parseFile(text, { name: "JV_device_names.txt" });
  assert.equal(result.type, "JV");
  assert.deepEqual(result.datasets.map((dataset) => dataset.device), devices);
});
