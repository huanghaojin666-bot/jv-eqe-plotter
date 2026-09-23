"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const parser = require("../parser.js");
const exporter = require("../exporter.js");

function storedZipEntry(buffer, targetName) {
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034B50) {
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    if (name === targetName) return buffer.subarray(dataStart, dataStart + size);
    offset = dataStart + size;
  }
  throw new Error(`ZIP entry not found: ${targetName}`);
}

async function main() {
  const fixturePath = path.join(__dirname, "fixtures", "light-dark-jv.txt");
  const source = parser.parseFile(fs.readFileSync(fixturePath, "utf8"), {
    name: "JV_light_dark.txt",
    relativePath: "O1/JV_light_dark.txt"
  });
  const exportedJV = exporter.buildInstrumentText("JV", source.datasets);
  const roundTripJV = parser.parseFile(exportedJV, {
    name: "JV_导出测试.txt",
    relativePath: "O1/JV_导出测试.txt"
  });
  assert.strictEqual(roundTripJV.type, "JV");
  assert.strictEqual(roundTripJV.datasets.length, 2);
  assert.deepStrictEqual(roundTripJV.datasets.map((item) => item.illumination), ["light", "dark"]);
  assert.deepStrictEqual(roundTripJV.datasets.map((item) => item.x), source.datasets.map((item) => item.x));
  assert.deepStrictEqual(roundTripJV.datasets.map((item) => item.y), source.datasets.map((item) => item.y));

  const renamedJV = source.datasets.map((dataset) => ({
    ...dataset,
    device: "老化组-A",
    point: "位置-07"
  }));
  const renamedRoundTrip = parser.parseFile(exporter.buildInstrumentText("JV", renamedJV), {
    name: "JV_重命名导出.txt",
    relativePath: "JV_重命名导出.txt"
  });
  assert.deepStrictEqual(renamedRoundTrip.datasets.map((item) => item.device), ["老化组-A", "老化组-A"]);
  assert.deepStrictEqual(renamedRoundTrip.datasets.map((item) => item.point), ["位置-07", "位置-07"]);

  const eqeDatasets = [{
    type: "EQE",
    label: "O 1-6",
    device: "O1",
    point: "1-6",
    illumination: "light",
    date: "2026-09-23 10:30",
    source: "EQE_original.txt",
    x: [400, 500, 600],
    y: [12.5, 75.25, 86.75]
  }, {
    type: "EQE",
    label: "P 2-3",
    device: "P2",
    point: "2-3",
    illumination: "dark",
    date: "2026-09-23 10:35",
    source: "EQE_original.txt",
    x: [410, 510],
    y: [2.5, 4.25]
  }];
  const exportedEQE = exporter.buildInstrumentText("EQE", eqeDatasets);
  const roundTripEQE = parser.parseFile(exportedEQE, {
    name: "EQE_导出测试.txt",
    relativePath: "EQE_导出测试.txt"
  });
  assert.strictEqual(roundTripEQE.type, "EQE");
  assert.strictEqual(roundTripEQE.datasets.length, 2);
  assert.deepStrictEqual(roundTripEQE.datasets.map((item) => item.label), ["O 1-6", "P 2-3"]);
  assert.deepStrictEqual(roundTripEQE.datasets.map((item) => item.illumination), ["light", "dark"]);
  assert.deepStrictEqual(roundTripEQE.datasets.map((item) => item.x), eqeDatasets.map((item) => item.x));
  assert.deepStrictEqual(roundTripEQE.datasets.map((item) => item.y), eqeDatasets.map((item) => item.y));
  assert.deepStrictEqual(roundTripEQE.datasets.map((item) => item.device), ["O1", "P2"]);

  const workbook = exporter.buildWorkbookBlob("JV", source.datasets, {
    chartTitle: "JV 导出验证",
    exportedAt: new Date("2026-09-23T10:00:00+08:00")
  });
  assert.strictEqual(
    workbook.type,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  const workbookBytes = Buffer.from(await workbook.arrayBuffer());
  assert.strictEqual(workbookBytes.subarray(0, 2).toString("ascii"), "PK");
  assert.ok(workbookBytes.includes(Buffer.from("xl/worksheets/sheet1.xml")));
  assert.ok(workbookBytes.includes(Buffer.from("xl/worksheets/sheet2.xml")));
  assert.ok(workbookBytes.includes(Buffer.from("xl/worksheets/sheet3.xml")));
  assert.ok(workbookBytes.includes(Buffer.from("Origin作图")));
  assert.ok(workbookBytes.includes(Buffer.from("概览")));
  assert.ok(workbookBytes.includes(Buffer.from("原始数据")));

  const eqeWorkbook = exporter.buildWorkbookBlob("EQE", eqeDatasets, {
    chartTitle: "EQE 波长完整性验证",
    exportedAt: new Date("2026-09-23T10:00:00+08:00")
  });
  const eqeWorkbookBytes = Buffer.from(await eqeWorkbook.arrayBuffer());
  const originSheetXml = storedZipEntry(eqeWorkbookBytes, "xl/worksheets/sheet1.xml").toString("utf8");
  assert.match(originSheetXml, /<dimension ref="A1:D4"\/>/);
  assert.match(originSheetXml, /O 1-6 · light \| X: 波长 \(nm\)/);
  assert.match(originSheetXml, /P 2-3 · dark \| Y: EQE \(%\)/);
  assert.match(originSheetXml, /<c r="A2" s="6"><v>400<\/v><\/c>/);
  assert.match(originSheetXml, /<c r="A4" s="6"><v>600<\/v><\/c>/);
  assert.match(originSheetXml, /<c r="B4" s="6"><v>86\.75<\/v><\/c>/);
  assert.match(originSheetXml, /<c r="C3" s="6"><v>510<\/v><\/c>/);
  assert.match(originSheetXml, /<c r="C4" s="6"\/>/);

  console.log("Export tests passed:", {
    jvCurves: roundTripJV.datasets.length,
    eqeCurves: roundTripEQE.datasets.length,
    workbookBytes: workbookBytes.length,
    originColumns: eqeDatasets.length * 2,
    originRows: Math.max(...eqeDatasets.map((dataset) => dataset.x.length))
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
