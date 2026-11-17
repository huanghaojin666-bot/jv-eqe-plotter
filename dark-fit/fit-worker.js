"use strict";

let runtimePromise;
let running = false;

function progress(message) {
  self.postMessage({ type: "progress", message });
}

async function initialize() {
  const runtimeURL = new URL("../vendor/pyodide/", self.location.href).href;
  progress("正在加载本机拟合引擎，首次使用需要稍等…");
  importScripts(`${runtimeURL}pyodide.js`);
  const runtime = await loadPyodide({ indexURL: runtimeURL, stdout: () => {}, stderr: () => {} });
  progress("正在加载数值计算库…");
  await runtime.loadPackage(["numpy", "scipy"]);
  const engineURL = new URL("engine/", self.location.href);
  const manifestResponse = await fetch(new URL("manifest.json", engineURL));
  if (!manifestResponse.ok) throw new Error("无法读取拟合引擎清单，请刷新网站。");
  const manifest = await manifestResponse.json();
  const paths = manifest.files.map(file => file.path).concat([
    "app/__init__.py", "ml/__init__.py", "app_services/__init__.py", "web_bridge.py"
  ]);
  await Promise.all(paths.map(async path => {
    const response = await fetch(new URL(path, engineURL));
    if (!response.ok) throw new Error(`拟合引擎文件加载失败：${path}`);
    const content = await response.text();
    const target = `/dark_fit_engine/${path}`;
    runtime.FS.mkdirTree(target.slice(0, target.lastIndexOf("/")));
    runtime.FS.writeFile(target, content);
  }));
  await runtime.runPythonAsync("import sys\nsys.path.insert(0, '/dark_fit_engine')\nfrom web_bridge import execute_json");
  return runtime;
}

self.onmessage = async ({ data }) => {
  if (running) return;
  running = true;
  try {
    runtimePromise ||= initialize().catch(error => { runtimePromise = null; throw error; });
    const runtime = await runtimePromise;
    progress(data.request.action === "evaluate" ? "正在计算手动参数曲线…" :
      data.request.product_fit_mode === "diagnostic_fit" ? "正在执行诊断拟合：多策略、n/m 扫描和模型比较，可能需要几分钟…" : "正在执行快速拟合…");
    runtime.globals.set("web_request_json", JSON.stringify(data.request));
    try {
      const result = JSON.parse(await runtime.runPythonAsync("execute_json(web_request_json)"));
      self.postMessage({ type: "result", id: data.id, result });
    } finally {
      runtime.globals.delete("web_request_json");
    }
  } catch (error) {
    self.postMessage({ type: "error", id: data.id, message: error.message || String(error) });
  } finally { running = false; }
};
