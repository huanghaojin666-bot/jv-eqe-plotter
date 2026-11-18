"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createSaver } = require("../file-save.js");

function folder(name) {
  const files = new Map();
  return {
    name, files,
    queryPermission: async () => "granted",
    async getFileHandle(filename, options = {}) {
      if (!files.has(filename) && !options.create) throw new DOMException("Missing", "NotFoundError");
      if (!files.has(filename)) files.set(filename, null);
      return { name: filename, async createWritable() {
        let pending;
        return { async write(blob) { pending = new Uint8Array(await blob.arrayBuffer()); }, async close() { files.set(filename, pending); } };
      } };
    }
  };
}

test("one chosen folder is reused for every export type without automatic downloads", async () => {
  const chosen = folder("我的结果");
  let picks = 0;
  const notices = [];
  const saver = createSaver({ host: { showDirectoryPicker: async () => { picks++; return chosen; } }, download: () => assert.fail("Unexpected download"), onSaved: notice => notices.push(notice) });
  for (const extension of ["png", "svg", "txt", "xlsx", "zip", "csv", "json"]) {
    const blob = new Blob([new Uint8Array([0, 1, 255]), `测量结果.${extension}`]);
    await saver.save(blob, `结果.${extension}`);
    assert.deepEqual(chosen.files.get(`结果.${extension}`), new Uint8Array(await blob.arrayBuffer()));
  }
  assert.equal(picks, 1);
  assert.equal(saver.directoryName(), "我的结果");
  assert.ok(notices.every(notice => notice.kind === "directory" && notice.directory === "我的结果"));
});

test("cancelling a picker writes nothing and never falls back to desktop or download", async () => {
  const saver = createSaver({ host: { showDirectoryPicker: async () => { throw new DOMException("Cancelled", "AbortError"); } }, download: () => assert.fail("Unexpected download") });
  await assert.rejects(saver.save(new Blob(["data"]), "result.txt"), { name: "AbortError" });
  assert.equal(saver.directoryName(), "");
});

test("existing files and concurrent exports are preserved with numbered filenames", async () => {
  const chosen = folder("results");
  chosen.files.set("plot.svg", new TextEncoder().encode("original"));
  const saver = createSaver({ host: { showDirectoryPicker: async () => chosen }, download: () => assert.fail() });
  const target = await saver.prepare("plot.svg");
  await Promise.all([saver.save(new Blob(["first"]), "plot.svg", target), saver.save(new Blob(["second"]), "plot.svg", target)]);
  const read = name => new TextDecoder().decode(chosen.files.get(name));
  assert.equal(read("plot.svg"), "original");
  assert.equal(read("plot (1).svg"), "first");
  assert.equal(read("plot (2).svg"), "second");
});

test("changing folders cannot redirect an export already prepared for another folder", async () => {
  const first = folder("A"), second = folder("B");
  const selections = [first, second];
  const saver = createSaver({ host: { showDirectoryPicker: async () => selections.shift() }, download: () => assert.fail() });
  const prepared = await saver.prepare("image.png");
  await saver.chooseDirectory();
  await saver.save(new Blob(["old job"]), "image.png", prepared);
  await saver.save(new Blob(["new job"]), "data.csv");
  assert.ok(first.files.has("image.png"));
  assert.ok(second.files.has("data.csv"));
  assert.equal(second.files.has("image.png"), false);
});

test("save-file-only browsers choose the destination before generation", async () => {
  const events = [];
  const handle = { name: "chosen.txt", createWritable: async () => ({ write: async () => events.push("write"), close: async () => events.push("close") }) };
  const saver = createSaver({ host: { showSaveFilePicker: async options => { events.push("picker"); assert.equal(options.suggestedName, "result.txt"); return handle; } }, download: () => assert.fail() });
  const prepared = await saver.prepare("result.txt");
  events.push("generate");
  await saver.save(new Blob(["data"]), "result.txt", prepared);
  assert.deepEqual(events, ["picker", "generate", "write", "close"]);
});

test("permission and write failures are reported rather than saving elsewhere", async () => {
  const chosen = folder("locked");
  chosen.queryPermission = async () => "prompt";
  chosen.requestPermission = async () => "denied";
  const saver = createSaver({ host: { showDirectoryPicker: async () => chosen }, download: () => assert.fail() });
  await assert.rejects(saver.save(new Blob(["data"]), "data.csv"), /写入权限/);
  assert.equal(chosen.files.size, 0);
  const writable = { write: async () => { throw new Error("Disk full"); }, abort: async () => {} };
  const target = { kind: "file", handle: { name: "chosen.txt", createWritable: async () => writable } };
  await assert.rejects(saver.save(new Blob(["data"]), "data.csv", target), /Disk full/);
});
