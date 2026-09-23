"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const parser = require("../parser.js");

const jvPath = "D:\\高项\\JV-EQE\\26.6.11\\orange\\O1\\JV_2026_06_11-17_54.txt";
const eqePath = "D:\\高项\\JV-EQE\\26.6.11\\orange\\O1\\EQE 1-6_2026_06_11-17_55.txt";
const rawPath = "D:\\高项\\JV-EQE\\26.6.11\\orange\\O1\\EQE 1-6_2026_06_11-17_55_Raw.txt";
const multiEqePath = "D:\\高项\\JV-EQE\\3st\\all EQE\\Data Save_2026_07_17-17_31.txt";
const multiRawPath = "D:\\高项\\JV-EQE\\3st\\all EQE\\Data Save_2026_07_17-17_31_Raw.txt";

const jv = parser.parseFile(fs.readFileSync(jvPath, "utf8"), {
  name: path.basename(jvPath),
  relativePath: "orange/O1/" + path.basename(jvPath)
});
assert.strictEqual(jv.type, "JV");
assert.strictEqual(jv.datasets.length, 6);
assert.strictEqual(jv.datasets[0].device, "O1");
assert.strictEqual(jv.datasets[0].point, "1-1");
assert.strictEqual(jv.datasets[5].label, "O 1-6");
assert.strictEqual(jv.datasets[0].x.length, 201);
assert.strictEqual(jv.datasets[0].y.length, 201);

const eqe = parser.parseFile(fs.readFileSync(eqePath, "utf8"), {
  name: path.basename(eqePath),
  relativePath: "orange/O1/" + path.basename(eqePath)
});
assert.strictEqual(eqe.type, "EQE");
assert.strictEqual(eqe.datasets.length, 1);
assert.strictEqual(eqe.datasets[0].device, "O1");
assert.strictEqual(eqe.datasets[0].point, "1-6");
assert.strictEqual(eqe.datasets[0].x[0], 400);
assert.strictEqual(eqe.datasets[0].x.at(-1), 1600);
assert.strictEqual(eqe.datasets[0].raw, false);

const raw = parser.parseFile(fs.readFileSync(rawPath, "utf8"), {
  name: path.basename(rawPath),
  relativePath: "orange/O1/" + path.basename(rawPath)
});
assert.strictEqual(raw.datasets.length, 1);
assert.strictEqual(raw.datasets[0].raw, true);
assert.strictEqual(raw.datasets[0].quality, 1);

const merged = parser.mergeDatasets(raw.datasets, eqe.datasets);
assert.strictEqual(merged.length, 1);
assert.strictEqual(merged[0].raw, false);

const multiEqe = parser.parseFile(fs.readFileSync(multiEqePath, "utf8"), {
  name: path.basename(multiEqePath),
  relativePath: "all EQE/" + path.basename(multiEqePath)
});
assert.strictEqual(multiEqe.type, "EQE");
assert.strictEqual(multiEqe.datasets.length, 6);
assert.deepStrictEqual(
  multiEqe.datasets.map((dataset) => dataset.point),
  ["1-6", "2-1", "3-5", "4-3", "6-3", "7-6"]
);
assert.deepStrictEqual(
  multiEqe.datasets.map((dataset) => dataset.device),
  ["器件1", "器件2", "器件3", "器件4", "器件6", "器件7"]
);

const multiRaw = parser.parseFile(fs.readFileSync(multiRawPath, "utf8"), {
  name: path.basename(multiRawPath),
  relativePath: "all EQE/" + path.basename(multiRawPath)
});
assert.strictEqual(multiRaw.datasets.length, 6);
const multiMerged = parser.mergeDatasets(multiRaw.datasets, multiEqe.datasets);
assert.strictEqual(multiMerged.length, 6);
assert.strictEqual(multiMerged.filter((dataset) => dataset.raw).length, 0);

console.log("Parser tests passed:", {
  jvCurves: jv.datasets.length,
  jvPointsPerCurve: jv.datasets[0].x.length,
  eqePoints: eqe.datasets[0].x.length,
  multiEqeCurves: multiEqe.datasets.length,
  device: eqe.datasets[0].device,
  point: eqe.datasets[0].point
});
