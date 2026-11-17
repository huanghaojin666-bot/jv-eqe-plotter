(function () {
  "use strict";
  const scriptURL = document.currentScript.src;
  const $ = id => document.getElementById(id);
  const html = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const scientific = value => Number.isFinite(Number(value)) && value !== null ? Number(value).toExponential(4) : "—";
  const percent = value => Number.isFinite(Number(value)) && value !== null ? `${Number(value).toFixed(2)}%` : "—";
  const state = { datasets: [], fingerprint: "", visible: false, onClose: null, saveBlob: null, worker: null, sequence: 0, pending: null, busy: false, automatic: null, display: null, manual: null, input: null };

  function createPanel() {
    if ($("darkFitPanel")) return;
    const panel = document.createElement("section");
    panel.id = "darkFitPanel";
    panel.className = "dark-fit-inline";
    panel.setAttribute("aria-label", "暗电流拟合图与设置");
    panel.hidden = true;
    panel.innerHTML = `
      <div class="df-grid">
        <div class="df-controls">
          <label>拟合曲线<select id="dfDataset"></select></label>
          <label>拟合方式<select id="dfMode"><option value="fast_fit">快速拟合</option><option value="diagnostic_fit">诊断拟合（多策略 / n、m 扫描 / 模型比较）</option></select></label>
          <div class="df-actions"><button type="button" id="dfRun" class="button button-primary">开始拟合</button><button type="button" id="dfStop" class="button button-secondary" disabled>停止</button></div>
          <label class="df-check"><input type="checkbox" id="dfUnknown">包含状态未识别的 JV（我确认是暗电流）</label>
          <p id="dfSource" class="df-muted"></p>
          <details class="df-settings"><summary>拟合设置：电压范围、温度、n / m</summary><div class="df-setting-grid">
          <div class="df-pair"><label>电压下限 (V)<input id="dfMinimum" type="number" step="any" placeholder="全部数据"></label><label>电压上限 (V)<input id="dfMaximum" type="number" step="any" placeholder="全部数据"></label></div>
          <label>温度 (K)<input id="dfTemperature" type="number" min="1" max="1500" value="300" step="any"></label>
          <div class="df-pair"><label>n<input id="dfN" type="number" min="0.1" max="20" value="1.4" step="any"></label><label>m<input id="dfM" type="number" min="1" max="20" value="2.4" step="any"></label></div>
          <p class="df-muted">快速模式固定 n、m；诊断模式沿用原程序的 n/m 网格与细化流程。</p>
          <details class="df-model"><summary>模型与单位</summary><p>u = V − J·Rs</p><p>J = J₀[exp(q·u/nkBT) − 1] + u/Rsh + k·|u|ᵐ·sign(u)</p><p>使用有符号的 J (A/cm²) 拟合；对数图仅显示 |J|。Rs、Rsh 为 Ω·cm²；k 的单位随 m 变化。分量和诊断解释沿用原程序；模型有效参数不能单凭一条曲线确定微观机制。</p></details>
          </div></details>
          <p id="dfStatus" role="status" aria-live="polite">请选择一条暗电流曲线。</p>
        </div>
        <section class="df-results">
          <div class="df-view-controls"><label>显示<select id="dfScale"><option value="log">对数 |J|</option><option value="linear">线性 J</option></select></label><label class="df-check"><input id="dfComponents" type="checkbox" checked>显示分量</label><span id="dfResultLabel">待拟合</span></div>
          <div id="dfPlot" class="df-plot"></div>
          <div id="dfResidual" class="df-residual"></div>
          <div id="dfResultDetails" hidden>
            <div class="df-summary"><span>平均相对误差 <strong id="dfMean">—</strong></span><span>最大相对误差 <strong id="dfMax">—</strong></span><span>有效指数 <strong id="dfExponents">—</strong></span></div>
            <p class="df-muted">误差统计沿用源程序的零点与噪声剔除规则；逐点残差保留在下图及导出数据中。</p>
            <label>查看结果 / 候选<select id="dfCandidate"></select></label>
            <div class="df-table-wrap"><table class="df-parameters"><thead><tr><th>参数</th><th>当前值</th><th>单位</th></tr></thead><tbody id="dfParameters"></tbody></table></div>
            <details class="df-diagnostics"><summary>诊断与原始结果</summary><div id="dfAdvice"></div><pre id="dfDiagnostics"></pre></details>
            <details id="dfManual" class="df-manual"><summary>手动调参预览</summary><p id="dfManualHint" class="df-muted"></p><div class="df-manual-inputs" id="dfManualInputs"></div><div class="df-actions"><button type="button" id="dfEvaluate" class="button button-secondary">预览手动参数</button><button type="button" id="dfRestore" class="button button-secondary">恢复自动拟合</button></div></details>
            <div class="df-actions df-export"><button type="button" id="dfCSV" class="button button-secondary">导出分量 CSV</button><button type="button" id="dfJSON" class="button button-secondary">保存完整拟合 JSON</button><button type="button" id="dfPNG" class="button button-dark">导出 PNG</button><button type="button" id="dfSVG" class="button button-secondary">导出 SVG</button></div>
          </div>
        </section>
      </div>`;
    $("darkFitMount").appendChild(panel);
    $("dfUnknown").addEventListener("change", refreshDatasets);
    $("dfDataset").addEventListener("change", () => { clearResult(); showSource(); renderPlot(); });
    $("dfRun").addEventListener("click", runFit);
    $("dfStop").addEventListener("click", stop);
    ["dfScale", "dfComponents"].forEach(id => $(id).addEventListener("change", renderPlot));
    $("dfCandidate").addEventListener("change", () => {
      const choice = $("dfCandidate").value;
      state.manual = null;
      state.display = choice === "primary" ? state.automatic : state.automatic.candidates[Number(choice)];
      renderResult(); busy(false);
    });
    $("dfEvaluate").addEventListener("click", evaluate);
    $("dfRestore").addEventListener("click", () => { state.manual = null; state.display = state.automatic; $("dfCandidate").value = "primary"; renderResult(); status("已恢复自动拟合结果。"); });
    $("dfCSV").addEventListener("click", () => exportCSV().catch(exportError));
    $("dfJSON").addEventListener("click", () => download(new Blob([JSON.stringify({ automatic: state.automatic, displayed: state.display, manual_preview: state.manual, input: state.input }, null, 2)], { type: "application/json" }), "json").catch(exportError));
    $("dfPNG").addEventListener("click", () => exportImage("png"));
    $("dfSVG").addEventListener("click", () => exportImage("svg"));
  }

  function selectedDataset() { return state.datasets.find(dataset => dataset.id === $("dfDataset").value); }
  function status(message, error = false) { $("dfStatus").textContent = message; $("dfStatus").classList.toggle("is-error", error); }
  function clearResult() { state.automatic = state.display = state.manual = state.input = null; $("dfResultDetails").hidden = true; $("dfResultLabel").textContent = "待拟合"; }
  function refreshDatasets() {
    const selected = $("dfDataset").value;
    const eligible = state.datasets.filter(dataset => dataset.illumination === "dark" || ($("dfUnknown").checked && dataset.illumination !== "light"));
    $("dfDataset").innerHTML = eligible.map(dataset => `<option value="${html(dataset.id)}">${html(dataset.label)} · ${html(dataset.device)}</option>`).join("");
    if (eligible.some(dataset => dataset.id === selected)) $("dfDataset").value = selected;
    clearResult(); showSource(); renderPlot();
    status(eligible.length ? "已选择曲线，可开始拟合。" : "当前筛选下没有暗态 JV。请返回作图选择暗态曲线，或确认未识别状态的数据。");
    $("dfRun").disabled = !eligible.length;
  }
  function showSource() {
    const dataset = selectedDataset();
    $("dfSource").textContent = dataset ? `${dataset.x.length} 个数据点 · ${dataset.source || ""} · V / A·cm⁻²` : "尚未选择曲线";
  }
  function busy(value) {
    state.busy = value;
    $("dfStop").disabled = !value;
    ["dfRun", "dfEvaluate", "dfRestore", "dfDataset", "dfUnknown", "dfCandidate", "dfMode", "dfTemperature", "dfN", "dfM", "dfMinimum", "dfMaximum"].forEach(id => { $(id).disabled = value; });
    if (!value) { $("dfRun").disabled = !selectedDataset(); $("dfEvaluate").disabled = !state.display?.manual_capability?.can_evaluate; }
  }
  function stop() {
    if (!state.busy) return;
    state.worker?.terminate(); state.worker = null;
    state.pending?.reject(new Error("已停止拟合。")); state.pending = null;
    busy(false); status("已停止拟合，已有结果保留。");
  }
  function requestWorker(request) {
    if (!state.worker) {
      state.worker = new Worker(new URL("fit-worker.js?v=20261117-1", scriptURL));
      state.worker.onmessage = ({ data }) => {
        if (data.type === "progress") { status(data.message); return; }
        if (!state.pending || state.pending.id !== data.id) return;
        const pending = state.pending; state.pending = null;
        if (data.type === "result") pending.resolve(data.result);
        else pending.reject(new Error(data.message));
      };
      state.worker.onerror = event => {
        state.pending?.reject(new Error(event.message || "拟合引擎加载失败，请用“启动网站.bat”打开本地网站，或刷新网页版后重试。"));
        state.pending = null; state.worker?.terminate(); state.worker = null;
      };
    }
    return new Promise((resolve, reject) => { const id = ++state.sequence; state.pending = { id, resolve, reject }; state.worker.postMessage({ id, request }); });
  }
  function number(id, optional = false) {
    const input = $(id);
    if (optional && !input.value.trim()) return null;
    if (!input.value.trim() || !input.checkValidity()) throw new Error(`请检查“${input.closest("label").firstChild.textContent}”的输入。`);
    return Number(input.value);
  }
  function buildRequest() {
    const dataset = selectedDataset();
    if (!dataset) throw new Error("请先选择一条暗电流曲线。");
    return {
      action: "fit", dataset, allow_unknown: $("dfUnknown").checked,
      product_fit_mode: $("dfMode").value, temperature_k: number("dfTemperature"),
      voltage_min: number("dfMinimum", true), voltage_max: number("dfMaximum", true), n: number("dfN"), m: number("dfM")
    };
  }
  async function runFit() {
    if (state.busy) return;
    try {
      const request = buildRequest();
      if (request.voltage_min !== null && request.voltage_max !== null && request.voltage_min >= request.voltage_max) throw new Error("电压下限须小于上限。");
      busy(true); status("正在准备拟合…");
      const result = await requestWorker(request);
      state.automatic = state.display = result; state.manual = null; state.input = request;
      $("dfCandidate").innerHTML = '<option value="primary">自动拟合结果</option>' + (result.candidates || []).filter(candidate => candidate.series?.fitted || candidate.fit?.series?.fitted).map(candidate => {
        const index = result.candidates.indexOf(candidate);
        return `<option value="${index}">候选 ${candidate.rank || index + 1} · ${html(candidate.label || candidate.source)}${candidate.diagnostic_only ? "（响应诊断）" : ""}</option>`;
      }).join("");
      renderResult(); status("拟合完成。可查看参数、分量、诊断或导出结果。");
    } catch (error) { status(error.message, !error.message.startsWith("已停止")); }
    finally { busy(false); }
  }
  async function evaluate() {
    if (state.busy || !state.display?.manual_capability?.can_evaluate) return;
    try {
      const current = state.display;
      const fit = current.fit || current;
      const request = { ...state.input, action: "evaluate", evaluator_kind: current.evaluator_kind, params: ["J0", "Rs", "Rsh", "k"].map((_, index) => number(`dfParam${index}`)), n: fit.n, m: fit.m };
      busy(true);
      state.manual = await requestWorker(request);
      state.display = state.manual;
      renderResult(); status("手动参数预览完成；自动拟合结果已保留。");
    } catch (error) { status(error.message, true); }
    finally { busy(false); }
  }
  function currentSeries() { return state.display?.series || state.display?.fit?.series; }
  function plotLayout(residual = false) {
    return {
      height: residual ? 210 : 520, margin: { l: 88, r: 25, t: 24, b: residual ? 55 : 95 },
      paper_bgcolor: "#fff", plot_bgcolor: "#fff", hovermode: "closest",
      font: { family: "Arial, Microsoft YaHei UI, sans-serif", color: "#172d4b", size: 12 },
      xaxis: { title: { text: "Voltage (V)" }, showline: true, mirror: true, ticks: "outside", zeroline: true, gridcolor: "#e8edf4" },
      yaxis: { title: { text: residual ? "有符号残差 (A/cm²)" : $("dfScale").value === "log" ? "|J| (A/cm²)" : "J (A/cm²)" }, type: !residual && $("dfScale").value === "log" ? "log" : "linear", nticks: 7, showline: true, mirror: true, ticks: "outside", zeroline: true, gridcolor: "#e8edf4", exponentformat: "power" },
      legend: { orientation: "h", x: 0, y: -0.22, font: { size: 11 } },
      showlegend: !residual, annotations: []
    };
  }
  function plotTraces() {
    const series = currentSeries();
    const dataset = selectedDataset();
    if (!series && !dataset) return [];
    const x = series?.voltage || dataset.x;
    const values = series?.measured || dataset.y;
    const view = y => $("dfScale").value === "log" ? y.map(value => Math.abs(value) || null) : y;
    const traces = [{ x, y: view(values), name: "实测", type: "scatter", mode: "markers", marker: { color: "#7d8b9d", size: 4 }, hovertemplate: "V=%{x:.4g} V<br>|J|/J=%{y:.4e}<extra>实测</extra>" }];
    if (series) {
      traces.push({ x, y: view(series.fitted), name: state.manual ? "手动预览" : "拟合", mode: "lines", line: { color: "#164b9b", width: 2.5 } });
      if ($("dfComponents").checked) {
        [["diode", "二极管分量", "#d66a39"], ["ohmic", "欧姆分量", "#2e986d"], ["nonohmic", "非欧姆分量", "#8d62b0"], ["recombination", "复合分量", "#b7983c"], ["diffusion", "扩散分量", "#478ba1"], ["extra_current", "扩展分量", "#bb5a86"]].forEach(([key, name, color]) => {
          if (Array.isArray(series[key])) traces.push({ x, y: view(series[key]), name, mode: "lines", line: { color, width: 1.5, dash: "dash" } });
        });
      }
    }
    return traces;
  }
  function renderPlot() {
    if (!state.visible) return;
    window.Plotly.react($("dfPlot"), plotTraces(), plotLayout(), { responsive: true, displaylogo: false, modeBarButtonsToRemove: ["toImage", "lasso2d", "select2d"] });
    const series = currentSeries();
    $("dfResidual").hidden = !series;
    if (series) window.Plotly.react($("dfResidual"), [{ x: series.voltage, y: series.fitted.map((value, index) => value - series.measured[index]), name: "拟合 − 实测", mode: "lines+markers", line: { color: "#9a4c39", width: 1 }, marker: { size: 3 } }], plotLayout(true), { responsive: true, displaylogo: false });
  }
  function renderResult() {
    const result = state.display;
    if (!result) { renderPlot(); return; }
    const fit = result.fit || result;
    const parameters = result.parameter_schema?.parameters || fit.params.map((value, index) => ({ name: ["J0", "Rs", "Rsh", "k"][index] || `p${index}`, value }));
    $("dfResultDetails").hidden = false;
    $("dfMean").textContent = percent(fit.stats?.mean);
    $("dfMax").textContent = percent(fit.stats?.max);
    $("dfExponents").textContent = `n = ${Number(fit.n).toPrecision(4)} / m = ${Number(fit.m).toPrecision(4)}`;
    $("dfResultLabel").textContent = `${state.manual ? "手动预览" : "拟合结果"} · ${state.input.dataset.label}`;
    const units = { J0: "A/cm²", Rs: "Ω·cm²", Rsh: "Ω·cm²", k: "A·cm⁻²·V⁻ᵐ" };
    $("dfParameters").innerHTML = parameters.map((parameter, index) => `<tr><td>${html(parameter.name)}</td><td>${scientific(fit.params[index])}</td><td>${html(units[parameter.name] || "按候选模型定义")}</td></tr>`).join("");
    $("dfDiagnostics").textContent = JSON.stringify({ model_context: result.model_context, diagnostics: result.diagnostics || fit.diagnostics, notes: result.notes, reason: result.reason }, null, 2);
    $("dfAdvice").textContent = (result.advice || []).map(item => typeof item === "string" ? item : item.message || item.detail || item.title || JSON.stringify(item)).join("\n");
    const canEvaluate = Boolean(result.manual_capability?.can_evaluate);
    $("dfManualInputs").hidden = !canEvaluate;
    $("dfManualHint").textContent = canEvaluate ? "预览单独保存，不覆盖自动拟合。n/m 使用当前结果值。" : "该候选模型不适用基础 J0/Rs/Rsh/k 手动求值，请切回兼容的自动拟合结果。";
    $("dfManualInputs").innerHTML = canEvaluate ? ["J0", "Rs", "Rsh", "k"].map((name, index) => `<label>${name}<input id="dfParam${index}" type="number" step="any" min="1e-300" value="${fit.params[index]}"></label>`).join("") : "";
    $("dfEvaluate").disabled = !canEvaluate || state.busy;
    renderPlot();
  }
  function exportTitle() {
    const name = state.input?.dataset?.label || "暗电流";
    return `${name.replace(/[<>:"/\\|?*]/g, "_")}_暗电流${state.manual ? "_手动预览" : "_拟合"}`;
  }
  function exportError(error) { if (error?.name !== "AbortError") status(`导出失败：${error.message}`, true); }
  async function download(blob, extension, fileName) {
    const destination = fileName || `${exportTitle()}.${extension}`;
    if (state.saveBlob) { await state.saveBlob(blob, destination); return; }
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url; link.download = destination;
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function exportCSV(fileName) {
    const series = currentSeries();
    if (!series) return;
    const keys = Object.keys(series).filter(key => Array.isArray(series[key]) && series[key].length === series.voltage.length);
    const labels = { voltage: "Voltage (V)", v_drop: "Internal voltage (V)", measured: "Measured J (A/cm2)", fitted: "Fitted J (A/cm2)", relative_error: "Relative error (%)" };
    const rows = [keys.map(key => labels[key] || `${key} (A/cm2)`).concat("Residual (A/cm2)").join(",")];
    series.voltage.forEach((_, index) => rows.push(keys.map(key => series[key][index] ?? "").concat(series.fitted[index] - series.measured[index]).join(",")));
    await download(new Blob(["\uFEFF" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" }), "csv", fileName);
  }
  async function exportImage(format, fileName) {
    if (!state.display) return;
    const target = document.createElement("div");
    target.style.cssText = "position:fixed;left:-10000px;width:1600px;height:1000px";
    document.body.appendChild(target);
    try {
      const layout = { ...plotLayout(), height: 1000, width: 1600, margin: { l: 130, r: 60, t: 90, b: 170 }, title: { text: html(`${state.input.dataset.label} · 暗电流${state.manual ? "手动预览" : "拟合"}`), font: { size: 25 } }, font: { size: 18 }, legend: { orientation: "h", y: -0.18, font: { size: 17 } } };
      await window.Plotly.newPlot(target, plotTraces(), layout, { staticPlot: true });
      const source = await window.Plotly.toImage(target, { format, width: 1600, height: 1000, scale: format === "png" ? 2 : 1 });
      await download(await (await fetch(source)).blob(), format, fileName);
    } catch (error) { status(`图片导出失败：${error.message}`, true); }
    finally { window.Plotly.purge(target); target.remove(); }
  }
  function updateDatasets(datasets) {
    const filtered = datasets.filter(dataset => dataset.type === "JV");
    const fingerprint = JSON.stringify(filtered);
    if (fingerprint === state.fingerprint) return;
    stop();
    state.fingerprint = fingerprint;
    state.datasets = JSON.parse(fingerprint);
    refreshDatasets();
  }
  window.JVEQEDarkFit = {
    open({ datasets, onClose, saveBlob, autoRun = true }) {
      createPanel();
      state.visible = true; state.onClose = onClose; state.saveBlob = saveBlob;
      $("darkFitPanel").hidden = false;
      updateDatasets(datasets);
      renderResult();
      if (location.protocol === "file:") status("请使用“启动网站.bat”打开本地网站后拟合，或访问 GitHub 网页版。", true);
      else if (autoRun && !state.display && !state.busy && selectedDataset()) runFit();
    },
    update({ datasets }) { if (state.visible) updateDatasets(datasets); },
    close() {
      if (!state.visible) return;
      state.visible = false;
      stop();
      $("darkFitPanel").hidden = true;
      state.onClose?.();
    },
    hasResult() { return Boolean(state.display) && !state.busy; },
    exportTitle,
    exportData: exportCSV,
    exportImage
  };
}());
