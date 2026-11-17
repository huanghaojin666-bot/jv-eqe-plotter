"use strict";

// Run with Playwright available in NODE_PATH: node tests/fit-view.browser.cjs
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const exporter = require("../exporter.js");
const root = path.resolve(__dirname, "..");

// Independent implicit-equation evaluator for a known signed dark-current curve.
function current(voltage) {
  if (voltage === 0) return 0;
  const branch = u => 1e-9 * Math.expm1(1.602176634e-19 * u / (1.4 * 1.380649e-23 * 300)) + u / 5e7 + 2e-8 * Math.sign(u) * Math.abs(u) ** 2.4;
  let low = -Math.abs(voltage) - 1, high = Math.abs(voltage) + 1;
  for (let iteration = 0; iteration < 120; iteration++) {
    const u = (low + high) / 2;
    if (branch(u) + (u - voltage) / 800 > 0) high = u;
    else low = u;
  }
  return branch((low + high) / 2);
}

(async () => {
  const saved = new Map();
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/api/save" && request.method === "POST") {
      const chunks = [];
      request.on("data", chunk => chunks.push(chunk));
      request.on("end", () => {
        const filename = url.searchParams.get("filename");
        saved.set(filename, Buffer.concat(chunks));
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true, filename, location: "project" }));
      });
      return;
    }
    const pathname = decodeURIComponent(url.pathname);
    const file = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
    response.setHeader("Content-Type", ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".svg": "image/svg+xml", ".py": "text/plain; charset=utf-8" })[path.extname(file)] || "application/octet-stream");
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(await page.locator(".toolbar-actions #darkFitButton").count(), 0);
    assert.equal(await page.locator("#jvChartModes #darkFitButton").isVisible(), true);
    assert.equal(await page.locator("#jvChartModes #restoreJVButton").isVisible(), true);
    assert.equal(await page.locator("#restoreJVButton").getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#darkFitButton").getAttribute("aria-pressed"), "false");
    const x = Array.from({ length: 81 }, (_, index) => Number((-0.5 + index * 0.01).toFixed(2)));
    const datasets = [
      { type: "JV", device: "DMF1", point: "1", label: "DMF1-1", illumination: "dark", x, y: x.map(current) },
      { type: "JV", device: "DMF2", point: "2", label: "DMF2-2", illumination: "light", x, y: x.map(voltage => current(voltage) + 1e-5) }
    ];
    await page.locator("#fileInput").setInputFiles({ name: "JV_synthetic.txt", mimeType: "text/plain", buffer: Buffer.from(exporter.buildInstrumentText("JV", datasets)) });
    await page.locator("#chartTitleEditor summary").click();
    await page.locator("#chartTitle").fill("我的 JV 原图");
    await page.locator("#chartTitle").press("Tab");
    await page.locator("#plot").evaluate(plot => Plotly.relayout(plot, { "xaxis.range": [-0.3, 0.2] }));
    const rawSnapshot = await page.locator("#plot").evaluate(plot => JSON.stringify({ data: plot.data.map(({ name, x, y, line, visible }) => ({ name, x, y, line, visible })), range: plot.layout.xaxis.range }));

    await page.locator("#darkFitButton").click();
    assert.equal(await page.locator("#restoreJVButton").getAttribute("aria-pressed"), "false");
    assert.equal(await page.locator("#darkFitButton").getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("dialog[open]").count(), 0, "fitting is inline, not a dialog");
    assert.equal(await page.locator("#darkFitPanel").isVisible(), true);
    assert.equal(await page.locator("#plot").isVisible(), false);
    assert.equal(await page.locator(".gradient-panel").isVisible(), false);
    assert.equal(await page.locator("#restoreJVButton").textContent(), "JV 曲线");
    assert.equal(await page.locator("#dfDataset option").count(), 1, "light curves excluded");
    await page.waitForFunction(() => document.querySelector("#dfStatus").textContent.startsWith("拟合完成"), {}, { timeout: 120000 });
    assert.ok(parseFloat(await page.locator("#dfMean").textContent()) < 0.1);
    await page.locator("#darkFitButton").click();
    assert.equal(await page.locator("#darkFitPanel").isVisible(), true, "clicking the selected heading keeps its view");
    const fitY = await page.locator("#dfPlot").evaluate(plot => plot.data.find(trace => trace.name === "拟合").y);

    async function saveFromToolbar(button, basename, extension) {
      await page.locator(button).click();
      await page.locator("#exportFileName").fill(basename);
      if (extension === "svg" || extension === "png") await page.locator(".export-format-options label").filter({ has: page.locator(`input[value="${extension}"]`) }).click();
      const completion = page.waitForResponse(response => response.url().includes(`/api/save?filename=${encodeURIComponent(basename + "." + extension)}`));
      await page.locator("#confirmExportButton").click();
      await completion;
      assert.ok(saved.has(`${basename}.${extension}`));
      return saved.get(`${basename}.${extension}`);
    }
    const csv = (await saveFromToolbar("#downloadTxtButton", "fit-series", "csv")).toString("utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/);
    assert.equal(csv.length, 82);
    const header = csv[0].split(",");
    assert.ok(header.includes("Fitted J (A/cm2)"));
    assert.ok(header.includes("Residual (A/cm2)"));
    const measured = header.indexOf("Measured J (A/cm2)");
    assert.equal(Number(csv[1].split(",")[measured]), datasets[0].y[0], "export retains signed measured data");
    const svg = await saveFromToolbar("#downloadPngButton", "fit-chart", "svg");
    assert.match(svg.toString("utf8"), /拟合/);
    assert.match(svg.toString("utf8"), /欧姆分量/);
    assert.match(svg.toString("utf8"), /Voltage \(V\)/);
    assert.match(svg.toString("utf8"), /\|J\| \(A\/cm²\)/);
    const png = await saveFromToolbar("#downloadPngButton", "fit-chart", "png");
    assert.equal(png.readUInt32BE(16), 3200);

    await page.locator("#chartPanel").screenshot({ path: path.join(root, "tmp/fit-inline-desktop.png") });
    await page.locator("#restoreJVButton").click();
    assert.equal(await page.locator("#restoreJVButton").isVisible(), true);
    assert.equal(await page.locator("#darkFitButton").isVisible(), true);
    assert.equal(await page.locator("#restoreJVButton").getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#darkFitButton").getAttribute("aria-pressed"), "false");
    assert.equal(await page.locator("#plot").isVisible(), true);
    assert.equal(await page.locator("#darkFitPanel").isVisible(), false);
    assert.equal(await page.locator("#chartTitle").inputValue(), "我的 JV 原图");
    const restoredSnapshot = await page.locator("#plot").evaluate(plot => ({ data: plot.data.map(({ name, x, y, line, visible }) => ({ name, x, y, line, visible })), range: plot.layout.xaxis.range }));
    assert.deepEqual(restoredSnapshot.range, JSON.parse(rawSnapshot).range, "restored zoom matches original");
    assert.deepEqual(restoredSnapshot.data, JSON.parse(rawSnapshot).data, "restored curves and colors match original");
    assert.equal(await page.locator("#downloadTxtButton").textContent(), "导出 TXT");
    const raw = await saveFromToolbar("#downloadTxtButton", "raw-series", "txt");
    assert.match(raw.toString("utf8"), /\[Raw Data\]/);

    await page.locator("#darkFitButton").click();
    assert.equal(await page.locator("#dfRun").isEnabled(), true, "reopening reuses the completed fit");
    assert.deepEqual(await page.locator("#dfPlot").evaluate(plot => plot.data.find(trace => trace.name === "拟合").y), fitY);
    await page.locator("#dfManual").evaluate(element => { element.open = true; });
    await page.locator("#dfParam0").fill("2e-9");
    await page.locator("#dfEvaluate").click();
    await page.waitForFunction(() => document.querySelector("#dfStatus").textContent.startsWith("手动参数预览完成"), {}, { timeout: 60000 });
    const manual = (await saveFromToolbar("#downloadTxtButton", "manual-series", "csv")).toString("utf8");
    assert.notEqual(manual, csv.join("\r\n"));
    await page.locator("#dfRestore").click();

    await page.locator('.tab[data-view="JV"]').click();
    assert.equal(await page.locator("#plot").isVisible(), true);
    assert.equal(await page.locator("#chartTitle").inputValue(), "我的 JV 原图");
    await page.locator("#darkFitButton").click();
    await page.locator('.tab[data-view="EQE"]').click();
    assert.equal(await page.locator("#darkFitPanel").isVisible(), false);
    assert.equal(await page.locator("#darkFitButton").isVisible(), false);
    await page.locator('.tab[data-view="JV"]').click();
    await page.locator("#darkFitButton").click();
    await page.locator("#illuminationFilter").selectOption("light");
    assert.equal(await page.locator("#dfDataset option").count(), 0);
    await page.locator("#downloadTxtButton").click();
    assert.equal(await page.locator("#exportDialog").isVisible(), false, "stale fit cannot be exported after filtering");
    await page.locator("#restoreJVButton").click();
    assert.equal(await page.locator("#plot").evaluate(plot => plot.data.filter(trace => trace.visible === true).length), 1);
    await page.locator("#illuminationFilter").selectOption("all");
    await page.locator("#darkFitButton").click();
    await page.locator("#restoreJVButton").click();
    assert.equal(await page.locator("#plot").isVisible(), true, "can leave during a fit");
    await page.locator("#darkFitButton").click();
    await page.waitForFunction(() => !document.querySelector("#dfRun").disabled, {}, { timeout: 120000 });
    await page.setViewportSize({ width: 440, height: 950 });
    await page.waitForFunction(() => document.querySelector("#dfPlot .main-svg").getBoundingClientRect().width <= document.querySelector("#chartPanel").clientWidth);
    await page.locator("#chartPanel").screenshot({ path: path.join(root, "tmp/fit-inline-mobile.png") });
    assert.deepEqual(errors, []);
    console.log("Inline fit checks passed: auto-fit, header/title/tab toggles, preserved original plot/title/zoom, current-result CSV/SVG/PNG, manual export, filter invalidation, cancellation, mobile.");
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
