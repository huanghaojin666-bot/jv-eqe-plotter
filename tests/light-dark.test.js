"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const parser = require("../parser.js");

const fixturePath = path.join(__dirname, "fixtures", "light-dark-jv.txt");
const text = fs.readFileSync(fixturePath, "utf8");

const parsed = parser.parseFile(text, {
  name: "JV_light_dark.txt",
  relativePath: "O1/JV_light_dark.txt"
});

assert.strictEqual(parsed.type, "JV");
assert.strictEqual(parsed.datasets.length, 2);
assert.deepStrictEqual(parsed.datasets.map((dataset) => dataset.illumination), ["light", "dark"]);
assert.deepStrictEqual(parsed.datasets.map((dataset) => dataset.device), ["O1", "O1"]);
assert.deepStrictEqual(parsed.datasets.map((dataset) => dataset.point), ["1-1", "1-1"]);
assert.deepStrictEqual(parsed.datasets.map((dataset) => dataset.label), ["O 1-1", "O 1-1"]);

const fromFileName = parser.metadataFromName("P 2-6", "JV_P2-6_DARK.txt", "P2/JV_P2-6_DARK.txt");
assert.strictEqual(fromFileName.illumination, "dark");

const chinese = parser.metadataFromName("P 2-6 光电流", "JV.txt", "P2/JV.txt");
assert.strictEqual(chinese.illumination, "light");
assert.strictEqual(chinese.label, "P 2-6");

const ambiguousFile = parser.metadataFromName("P 2-6", "JV_light_dark.txt", "P2/JV_light_dark.txt");
assert.strictEqual(ambiguousFile.illumination, "unknown");

console.log("Light/dark parser tests passed");
