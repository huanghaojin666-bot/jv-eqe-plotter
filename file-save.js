(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JVEQEFileSave = factory();
}(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function safeName(value) {
    return String(value || "导出文件").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "").slice(0, 180) || "导出文件";
  }

  function createSaver({ host, download, onDirectoryChanged = () => {}, onSaved = () => {} }) {
    let directory = null;
    let writes = Promise.resolve();
    const mode = () => typeof host.showDirectoryPicker === "function" ? "directory" : typeof host.showSaveFilePicker === "function" ? "file" : "download";

    async function chooseDirectory() {
      if (mode() !== "directory") throw new Error("当前浏览器不支持选择文件夹。");
      const selected = await host.showDirectoryPicker({ id: "jv-eqe-exports", mode: "readwrite" });
      directory = selected;
      onDirectoryChanged(selected.name);
      return selected;
    }

    async function prepare(fileName) {
      if (mode() === "directory") {
        const handle = directory || await chooseDirectory();
        if (typeof handle.queryPermission === "function" && await handle.queryPermission({ mode: "readwrite" }) !== "granted") {
          if (await handle.requestPermission({ mode: "readwrite" }) !== "granted") throw new Error("未获得所选文件夹的写入权限，请重新选择文件夹。");
        }
        return { kind: "directory", handle };
      }
      if (mode() === "file") {
        return { kind: "file", handle: await host.showSaveFilePicker({ id: "jv-eqe-exports", suggestedName: safeName(fileName) }) };
      }
      return { kind: "download" };
    }

    async function newFile(handle, name) {
      const dot = name.lastIndexOf(".");
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const extension = dot > 0 ? name.slice(dot) : "";
      for (let index = 0; ; index++) {
        const candidate = index ? `${stem} (${index})${extension}` : name;
        try { await handle.getFileHandle(candidate); }
        catch (error) {
          if (error.name === "NotFoundError") return { file: await handle.getFileHandle(candidate, { create: true }), name: candidate };
          if (error.name !== "TypeMismatchError") throw error;
        }
      }
    }

    async function save(blob, fileName, destination) {
      const target = destination || await prepare(fileName);
      const name = safeName(fileName);
      if (target.kind === "download") {
        download(blob, name);
        onSaved({ name, kind: "download" });
        return;
      }
      // Serialize writes so concurrent exports cannot reuse the same filename.
      const operation = writes.catch(() => {}).then(async () => {
        const selected = target.kind === "directory" ? await newFile(target.handle, name) : { file: target.handle, name: target.handle.name || name };
        const writable = await selected.file.createWritable();
        try { await writable.write(blob); await writable.close(); }
        catch (error) { if (writable.abort) await writable.abort().catch(() => {}); throw error; }
        onSaved({ name: selected.name, kind: target.kind, directory: target.kind === "directory" ? target.handle.name : null });
      });
      writes = operation;
      await operation;
    }

    return { mode, chooseDirectory, prepare, save, directoryName: () => directory?.name || "" };
  }
  return { createSaver };
}));
