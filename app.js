(function () {
  "use strict";

  const parser = window.JVEQEParser;
  const exporter = window.JVEQEExporter;
  const palette = [
    "#1F77B4",
    "#FF7F0E",
    "#D62728",
    "#2CA02C",
    "#9467BD",
    "#17BECF",
    "#E377C2",
    "#8C564B",
    "#1B9E77",
    "#D95F02",
    "#7570B3",
    "#E7298A"
  ];
  const markerGlyphs = ["●", "■", "◆", "▲", "▼", "✚", "×", "★", "⬢", "⬟"];
  const exportChartSize = { width: 1800, height: 1100 };
  const textMeasureContext = document.createElement("canvas").getContext("2d");

  const state = {
    datasets: [],
    filesSeen: new Set(),
    messages: [],
    view: "JV",
    plotReady: false,
    plotClickBound: false,
    plotRelayoutBound: false,
    plotRestyleBound: false,
    suppressRelayout: false,
    deviceStyles: {},
    curveStyles: {},
    deviceGradient: {
      enabled: false
    },
    lightDarkSameColor: false,
    coordinateMarks: [],
    gradient: {
      enabled: false,
      color: "#009E73",
      label: "",
      start: "",
      end: ""
    }
  };

  const elements = {
    dropZone: document.getElementById("dropZone"),
    chooseFilesButton: document.getElementById("chooseFilesButton"),
    chooseFolderButton: document.getElementById("chooseFolderButton"),
    fileInput: document.getElementById("fileInput"),
    folderInput: document.getElementById("folderInput"),
    clearButton: document.getElementById("clearButton"),
    fileCount: document.getElementById("fileCount"),
    jvCount: document.getElementById("jvCount"),
    eqeCount: document.getElementById("eqeCount"),
    jvTabCount: document.getElementById("jvTabCount"),
    eqeTabCount: document.getElementById("eqeTabCount"),
    deviceStyleList: document.getElementById("deviceStyleList"),
    toggleDevicesButton: document.getElementById("toggleDevicesButton"),
    pointFilter: document.getElementById("pointFilter"),
    illuminationFilter: document.getElementById("illuminationFilter"),
    curveList: document.getElementById("curveList"),
    toggleAllButton: document.getElementById("toggleAllButton"),
    recognitionBody: document.getElementById("recognitionBody"),
    scaleControl: document.getElementById("scaleControl"),
    scaleSelect: document.getElementById("scaleSelect"),
    downloadTxtButton: document.getElementById("downloadTxtButton"),
    downloadExcelButton: document.getElementById("downloadExcelButton"),
    openOriginButton: document.getElementById("openOriginButton"),
    downloadOriginBundleButton: document.getElementById("downloadOriginBundleButton"),
    downloadPngButton: document.getElementById("downloadPngButton"),
    exportDialog: document.getElementById("exportDialog"),
    exportForm: document.getElementById("exportForm"),
    exportDialogTitle: document.getElementById("exportDialogTitle"),
    exportFileName: document.getElementById("exportFileName"),
    exportFormatField: document.getElementById("exportFormatField"),
    exportHint: document.getElementById("exportHint"),
    cancelExportButton: document.getElementById("cancelExportButton"),
    confirmExportButton: document.getElementById("confirmExportButton"),
    chartEyebrow: document.getElementById("chartEyebrow"),
    chartTitle: document.getElementById("chartTitle"),
    chartMeta: document.getElementById("chartMeta"),
    gradientToggle: document.getElementById("gradientToggle"),
    deviceGradientToggle: document.getElementById("deviceGradientToggle"),
    lightDarkColorToggle: document.getElementById("lightDarkColorToggle"),
    gradientControls: document.getElementById("gradientControls"),
    gradientColor: document.getElementById("gradientColor"),
    gradientLabel: document.getElementById("gradientLabel"),
    gradientStart: document.getElementById("gradientStart"),
    gradientEnd: document.getElementById("gradientEnd"),
    coordinateToggle: document.getElementById("coordinateToggle"),
    coordinateX: document.getElementById("coordinateX"),
    coordinateXLabel: document.getElementById("coordinateXLabel"),
    coordinateSize: document.getElementById("coordinateSize"),
    coordinateSizeValue: document.getElementById("coordinateSizeValue"),
    markAllCoordinatesButton: document.getElementById("markAllCoordinatesButton"),
    clearCoordinatesButton: document.getElementById("clearCoordinatesButton"),
    resetCoordinatePositionsButton: document.getElementById("resetCoordinatePositionsButton"),
    plot: document.getElementById("plot"),
    chartEmpty: document.getElementById("chartEmpty"),
    workspace: document.getElementById("workspace"),
    messagePanel: document.getElementById("messagePanel"),
    toast: document.getElementById("toast")
  };

  let toastTimer = null;
  let pendingExportKind = null;

  function syncGradientControlsVisibility() {
    const expanded = elements.deviceGradientToggle.checked;
    elements.gradientControls.hidden = !expanded;
    elements.deviceGradientToggle.setAttribute("aria-expanded", String(expanded));
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function uniqueSorted(values) {
    return Array.from(new Set(values.filter(Boolean))).sort((a, b) => (
      a.localeCompare(b, "zh-CN", { numeric: true })
    ));
  }

  function illuminationLabel(value) {
    if (value === "light") return "Light（光电流）";
    if (value === "dark") return "Dark（暗电流）";
    return "未识别";
  }

  function datasetDisplayLabel(dataset) {
    const customName = String(dataset && dataset.legendName || "").trim();
    if (customName) return customName;
    if (!dataset || dataset.illumination === "unknown" || !dataset.illumination) {
      return dataset ? dataset.label : "";
    }
    return `${dataset.label} · ${dataset.illumination}`;
  }

  function sortDatasets() {
    state.datasets.sort((left, right) => {
      const typeOrder = left.type.localeCompare(right.type);
      if (typeOrder) return typeOrder;
      const deviceOrder = left.device.localeCompare(right.device, "zh-CN", { numeric: true });
      if (deviceOrder) return deviceOrder;
      const pointOrder = left.point.localeCompare(right.point, "zh-CN", { numeric: true });
      if (pointOrder) return pointOrder;
      const illuminationOrder = String(left.illumination).localeCompare(String(right.illumination));
      if (illuminationOrder) return illuminationOrder;
      return left.label.localeCompare(right.label, "zh-CN", { numeric: true });
    });
  }

  function deviceStyleKey(_type, device) {
    return device;
  }

  function ensureDeviceStyles() {
    ["JV", "EQE"].forEach((type) => {
      const devices = uniqueSorted(
        state.datasets
          .filter((dataset) => dataset.type === type)
          .map((dataset) => dataset.device)
      );
      devices.forEach((device, index) => {
        const key = deviceStyleKey(type, device);
        if (!state.deviceStyles[key]) {
          state.deviceStyles[key] = {
            color: palette[index % palette.length],
            visible: true
          };
        }
      });
    });
  }

  function getDeviceStyle(dataset) {
    const key = deviceStyleKey(dataset.type, dataset.device);
    if (!state.deviceStyles[key]) {
      ensureDeviceStyles();
    }
    return state.deviceStyles[key] || { color: palette[0], visible: true };
  }

  function hexToRgb(hex) {
    const match = String(hex || "").trim().match(/^#?([0-9a-f]{6})$/i);
    if (!match) return { r: 0, g: 158, b: 115 };
    const value = Number.parseInt(match[1], 16);
    return {
      r: (value >> 16) & 255,
      g: (value >> 8) & 255,
      b: value & 255
    };
  }

  function rgbToCss(color) {
    return `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`;
  }

  function mixColor(left, right, amount) {
    const ratio = Math.max(0, Math.min(1, amount));
    return {
      r: left.r + ((right.r - left.r) * ratio),
      g: left.g + ((right.g - left.g) * ratio),
      b: left.b + ((right.b - left.b) * ratio)
    };
  }

  function curveColorForIndex(index) {
    return palette[index % palette.length];
  }

  function defaultCurveColor(dataset) {
    const index = state.datasets.findIndex((item) => item.id === dataset.id);
    return curveColorForIndex(index < 0 ? 0 : index);
  }

  function curveDisplayColor(dataset) {
    const customStyle = state.curveStyles[dataset.id];
    return customStyle && customStyle.color ? customStyle.color : defaultCurveColor(dataset);
  }

  function sameDeviceDatasets(dataset) {
    return state.datasets.filter((item) => (
      item.type === dataset.type && item.device === dataset.device
    ));
  }

  function deviceGradientColor(dataset) {
    const sameDevice = sameDeviceDatasets(dataset);
    if (sameDevice.length <= 1) return getDeviceStyle(dataset).color;
    const index = Math.max(0, sameDevice.findIndex((item) => item.id === dataset.id));
    const ratio = sameDevice.length <= 1 ? 0.5 : index / (sameDevice.length - 1);
    const base = hexToRgb(getDeviceStyle(dataset).color);
    const light = mixColor(base, { r: 255, g: 255, b: 255 }, 0.18);
    const dark = mixColor(base, { r: 18, g: 18, b: 18 }, 0.12);
    return rgbToCss(mixColor(light, dark, ratio));
  }

  function gradientEligible(datasets) {
    return state.gradient.enabled && datasets.length >= 2;
  }

  function gradientColorAt(index, total) {
    const base = hexToRgb(state.gradient.color);
    const light = mixColor(base, { r: 255, g: 255, b: 255 }, 0.72);
    const dark = mixColor(base, { r: 18, g: 18, b: 18 }, 0.18);
    const ratio = total <= 1 ? 1 : index / (total - 1);
    return rgbToCss(mixColor(light, dark, ratio));
  }

  function median(values) {
    const numbers = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    if (!numbers.length) return 0;
    const middle = Math.floor(numbers.length / 2);
    return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
  }

  function gradientScore(dataset) {
    if (state.view === "JV" && elements.scaleSelect.value === "log") {
      return median(dataset.y.map((value) => Math.abs(value)).filter((value) => value > 0));
    }
    return median(dataset.y);
  }

  function gradientOrderedDatasets(datasets) {
    return datasets.slice().sort((left, right) => {
      const scoreOrder = gradientScore(left) - gradientScore(right);
      if (scoreOrder) return scoreOrder;
      return left.label.localeCompare(right.label, "zh-CN", { numeric: true });
    });
  }

  function plottedDatasets(datasets) {
    return gradientEligible(datasets) ? gradientOrderedDatasets(datasets) : datasets;
  }

  function curveColor(dataset) {
    return curveStyle(dataset).color;
  }

  function curveStyle(dataset) {
    const sameDevice = sameDeviceDatasets(dataset);
    const visibleDatasets = currentDatasets(false);
    const gradientDatasets = gradientOrderedDatasets(visibleDatasets);
    const gradientIndex = gradientDatasets.findIndex((item) => item.id === dataset.id);
    const index = state.datasets.findIndex((item) => item.id === dataset.id);
    const sameDeviceIndex = sameDevice.findIndex((item) => item.id === dataset.id);
    const safeIndex = index >= 0 ? index : Math.max(0, sameDeviceIndex);
    const useGradient = gradientEligible(visibleDatasets);
    const safeGradientIndex = gradientIndex < 0 ? safeIndex : gradientIndex;
    const gradientTotal = gradientDatasets.length || sameDevice.length;
    let normalColor = curveDisplayColor(dataset);
    if (state.deviceGradient.enabled) normalColor = deviceGradientColor(dataset);
    if (state.lightDarkSameColor) normalColor = getDeviceStyle(dataset).color;
    return {
      color: useGradient ? gradientColorAt(safeGradientIndex, gradientTotal) : normalColor,
      dash: "solid",
      glyph: markerGlyphs[safeIndex % markerGlyphs.length],
      cssDash: "solid"
    };
  }

  function currentDatasets(includeHidden) {
    const point = elements.pointFilter.value;
    const illumination = elements.illuminationFilter.value;
    return state.datasets.filter((dataset) => (
      dataset.type === state.view &&
      (includeHidden || dataset.visible) &&
      getDeviceStyle(dataset).visible &&
      (point === "all" || dataset.point === point) &&
      (illumination === "all" || dataset.illumination === illumination)
    ));
  }

  function setSelectOptions(select, values, allLabel) {
    const previous = select.value;
    select.innerHTML = `<option value="all">${escapeHtml(allLabel)}</option>` +
      values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
    select.value = values.includes(previous) ? previous : "all";
  }

  function renderFilters() {
    const typeDatasets = state.datasets.filter((dataset) => dataset.type === state.view);
    setSelectOptions(
      elements.pointFilter,
      uniqueSorted(typeDatasets.map((dataset) => dataset.point)),
      "全部点位"
    );
    const previousIllumination = elements.illuminationFilter.value;
    const illuminationValues = ["light", "dark", "unknown"]
      .filter((value) => typeDatasets.some((dataset) => dataset.illumination === value));
    elements.illuminationFilter.innerHTML = `<option value="all">全部状态</option>` +
      illuminationValues.map((value) => (
        `<option value="${value}">${illuminationLabel(value)}</option>`
      )).join("");
    elements.illuminationFilter.value = illuminationValues.includes(previousIllumination)
      ? previousIllumination
      : "all";
  }

  function renderDeviceStyles() {
    ensureDeviceStyles();
    const devices = uniqueSorted(
      state.datasets
        .filter((dataset) => dataset.type === state.view)
        .map((dataset) => dataset.device)
    );

    if (!devices.length) {
      elements.deviceStyleList.innerHTML = `<p class="empty-list">当前分类下还没有器件。</p>`;
      elements.toggleDevicesButton.textContent = "全部隐藏";
      return;
    }

    elements.deviceStyleList.innerHTML = devices.map((device) => {
      const key = deviceStyleKey(state.view, device);
      const style = state.deviceStyles[key];
      return `
        <label class="device-style-item">
          <input type="checkbox" data-device-visible="${escapeHtml(key)}" ${style.visible ? "checked" : ""}>
          <input class="device-name-input" type="text" data-device-name="${escapeHtml(device)}"
            value="${escapeHtml(device)}" aria-label="修改器件名称" title="修改器件名称">
          <input class="device-color" type="color" data-device-color="${escapeHtml(key)}"
            value="${escapeHtml(style.color)}" title="选择 ${escapeHtml(device)} 的颜色">
        </label>
      `;
    }).join("");

    const allVisible = devices.every((device) => (
      state.deviceStyles[deviceStyleKey(state.view, device)].visible
    ));
    elements.toggleDevicesButton.textContent = allVisible ? "全部隐藏" : "全部显示";
  }

  function autoLabelForDevice(label, oldDevice, point) {
    return (
      label === point ||
      label === oldDevice ||
      label === `${oldDevice} ${point}` ||
      label === `${oldDevice} · ${point}`
    );
  }

  function renameDevice(oldDevice, newDevice) {
    const cleanName = newDevice.trim() || "未识别";
    if (!oldDevice || cleanName === oldDevice) return;

    const oldKey = deviceStyleKey(state.view, oldDevice);
    const newKey = deviceStyleKey(state.view, cleanName);
    if (state.deviceStyles[oldKey] && !state.deviceStyles[newKey]) {
      state.deviceStyles[newKey] = state.deviceStyles[oldKey];
    }

    state.datasets
      .filter((dataset) => dataset.type === state.view && dataset.device === oldDevice)
      .forEach((dataset) => {
        if (autoLabelForDevice(dataset.label, oldDevice, dataset.point)) {
          dataset.label = `${cleanName} · ${dataset.point}`;
        }
        dataset.device = cleanName;
      });

    if (!state.datasets.some((dataset) => dataset.device === oldDevice)) {
      delete state.deviceStyles[oldKey];
    }

    sortDatasets();
    renderAll();
    showToast(`器件名称已改为：${cleanName}`);
  }

  function renderCounts() {
    const jv = state.datasets.filter((dataset) => dataset.type === "JV").length;
    const eqe = state.datasets.filter((dataset) => dataset.type === "EQE").length;
    elements.fileCount.textContent = state.filesSeen.size;
    elements.jvCount.textContent = jv;
    elements.eqeCount.textContent = eqe;
    elements.jvTabCount.textContent = jv;
    elements.eqeTabCount.textContent = eqe;
    elements.workspace.classList.toggle("is-empty", state.datasets.length === 0);
  }

  function renderCurveList() {
    const datasets = currentDatasets(true);
    if (!datasets.length) {
      elements.curveList.innerHTML = `<p class="empty-list">当前分类下还没有曲线。</p>`;
      elements.toggleAllButton.textContent = "全部隐藏";
      return;
    }

    elements.curveList.innerHTML = datasets.map((dataset) => {
      const style = curveStyle(dataset);
      const displayColor = curveDisplayColor(dataset);
      const displayLabel = datasetDisplayLabel(dataset);
      const colorLocked = state.gradient.enabled || state.deviceGradient.enabled || state.lightDarkSameColor;
      return `
      <div class="curve-item">
        <input type="checkbox" data-curve-toggle="${dataset.id}" ${dataset.visible ? "checked" : ""}>
        <span class="curve-editor">
          <span class="legend-name-editor">
            <span class="curve-key" style="--curve-color:${style.color};--curve-dash:${style.cssDash}" aria-hidden="true">
              <span class="curve-key-line"></span>
            </span>
            <input class="curve-name-input" type="text" data-curve-name="${dataset.id}"
              value="${escapeHtml(displayLabel)}" aria-label="图例名称" title="输入图例中显示的名称">
          </span>
          <small>${escapeHtml(dataset.device)} · 点位 ${escapeHtml(dataset.point)} · ${escapeHtml(illuminationLabel(dataset.illumination))}</small>
        </span>
        <input class="curve-color" type="color" data-curve-color="${dataset.id}"
          value="${escapeHtml(displayColor)}" ${colorLocked ? "disabled" : ""} title="曲线颜色" aria-label="曲线颜色">
      </div>
    `;
    }).join("");

    const allVisible = datasets.every((dataset) => dataset.visible);
    elements.toggleAllButton.textContent = allVisible ? "全部隐藏" : "全部显示";
  }

  function renderRecognitionTable() {
    if (!state.datasets.length) {
      elements.recognitionBody.innerHTML = `
        <tr class="empty-row"><td colspan="8">还没有识别到数据。</td></tr>
      `;
      return;
    }

    elements.recognitionBody.innerHTML = state.datasets.map((dataset) => `
      <tr data-row-id="${dataset.id}">
        <td><span class="type-badge ${dataset.type === "EQE" ? "eqe" : ""}">${dataset.type}</span></td>
        <td><input data-edit-field="device" value="${escapeHtml(dataset.device)}" aria-label="器件"></td>
        <td><input data-edit-field="point" value="${escapeHtml(dataset.point)}" aria-label="点位"></td>
        <td>
          <select data-edit-field="illumination" aria-label="测量状态">
            <option value="light" ${dataset.illumination === "light" ? "selected" : ""}>Light（光电流）</option>
            <option value="dark" ${dataset.illumination === "dark" ? "selected" : ""}>Dark（暗电流）</option>
            <option value="unknown" ${dataset.illumination === "unknown" ? "selected" : ""}>未识别</option>
          </select>
        </td>
        <td><input data-edit-field="label" value="${escapeHtml(dataset.label)}" aria-label="曲线名称"></td>
        <td>${dataset.x.length}</td>
        <td class="source-cell" title="${escapeHtml(dataset.relativePath)}">${escapeHtml(dataset.source)}${dataset.raw ? "（原始）" : ""}</td>
        <td><button class="delete-button" type="button" data-delete-id="${dataset.id}" title="删除曲线">×</button></td>
      </tr>
    `).join("");
  }

  function renderMessages() {
    if (!state.messages.length) {
      elements.messagePanel.classList.remove("has-messages");
      elements.messagePanel.innerHTML = "";
      return;
    }
    elements.messagePanel.classList.add("has-messages");
    elements.messagePanel.innerHTML = `<strong>导入提示</strong><br>${state.messages.map(escapeHtml).join("<br>")}`;
  }

  function finiteValues(datasets, accessor) {
    return datasets.flatMap((dataset) => accessor(dataset))
      .filter((value) => Number.isFinite(value));
  }

  function paddedLinearRange(values, includeZero) {
    if (!values.length) return undefined;
    let minimum = Math.min(...values);
    let maximum = Math.max(...values);
    if (includeZero) minimum = Math.min(0, minimum);
    if (includeZero) maximum = Math.max(0, maximum);
    const span = maximum - minimum || Math.max(Math.abs(maximum), 1);
    const padding = span * 0.06;
    return [minimum - padding, maximum + padding];
  }

  function wavelengthStep(minimum, maximum) {
    const span = maximum - minimum;
    if (span <= 300) return 50;
    if (span <= 700) return 100;
    return 200;
  }

  function coordinateSizeScale() {
    const percentage = Number(elements.coordinateSize.value);
    return Math.min(2, Math.max(0.6, percentage / 100));
  }

  function xAxisSettings(datasets, isJV, exportMode) {
    const values = finiteValues(datasets, (dataset) => dataset.x);
    const minimum = values.length ? Math.min(...values) : (isJV ? -1 : 400);
    const maximum = values.length ? Math.max(...values) : (isJV ? 1 : 1600);
    const span = maximum - minimum || 1;
    const padding = isJV ? Math.max(0.02, span * 0.015) : 0;
    return {
      title: {
        text: isJV ? "<b>Voltage, V (V)</b>" : "<b>Wavelength, λ (nm)</b>",
        standoff: exportMode ? 22 : 18,
        font: { size: exportMode ? 25 : 18, color: "#111111" }
      },
      range: [minimum - padding, maximum + padding],
      dtick: isJV ? (span <= 1 ? 0.2 : 0.5) : wavelengthStep(minimum, maximum),
      tickformat: isJV ? ".1f" : ".0f",
      showline: true,
      mirror: true,
      linecolor: "#111111",
      linewidth: exportMode ? 2.5 : 1.8,
      ticks: "outside",
      tickcolor: "#111111",
      tickwidth: exportMode ? 2.5 : 1.6,
      ticklen: exportMode ? 10 : 7,
      tickfont: { size: exportMode ? 21 : 14, color: "#111111" },
      showgrid: true,
      gridcolor: "rgba(17,17,17,0.10)",
      gridwidth: 1,
      zeroline: isJV,
      zerolinecolor: "rgba(17,17,17,0.48)",
      zerolinewidth: 1.3,
      automargin: true
    };
  }

  function yAxisSettings(datasets, isJV, useLog, exportMode) {
    const rawValues = finiteValues(datasets, (dataset) => dataset.y);
    const common = {
      showline: true,
      mirror: true,
      linecolor: "#111111",
      linewidth: exportMode ? 2.5 : 1.8,
      ticks: "outside",
      tickcolor: "#111111",
      tickwidth: exportMode ? 2.5 : 1.6,
      ticklen: exportMode ? 10 : 7,
      tickfont: { size: exportMode ? 21 : 14, color: "#111111" },
      showgrid: true,
      gridcolor: "rgba(17,17,17,0.10)",
      gridwidth: 1,
      automargin: true
    };

    if (isJV && useLog) {
      const positive = rawValues.map(Math.abs).filter((value) => value > 0);
      const minimum = positive.length ? Math.min(...positive) : 1e-12;
      const maximum = positive.length ? Math.max(...positive) : 1;
      return {
        ...common,
        title: {
          text: "<b>Current density, |J| (A cm<sup>−2</sup>)</b>",
          standoff: exportMode ? 24 : 18,
          font: { size: exportMode ? 25 : 18, color: "#111111" }
        },
        type: "log",
        range: [Math.floor(Math.log10(minimum)), Math.ceil(Math.log10(maximum))],
        exponentformat: "power",
        showexponent: "all",
        dtick: 1,
        minor: {
          ticks: "outside",
          ticklen: exportMode ? 5 : 3,
          tickcolor: "#666666",
          showgrid: false
        }
      };
    }

    if (isJV) {
      return {
        ...common,
        title: {
          text: "<b>Current density, J (A cm<sup>−2</sup>)</b>",
          standoff: exportMode ? 24 : 18,
          font: { size: exportMode ? 25 : 18, color: "#111111" }
        },
        type: "linear",
        range: paddedLinearRange(rawValues, true),
        tickformat: ".2e",
        exponentformat: "power",
        zeroline: true,
        zerolinecolor: "rgba(17,17,17,0.55)",
        zerolinewidth: 1.3
      };
    }

    const maximum = rawValues.length ? Math.max(...rawValues) : 100;
    const upper = Math.max(10, Math.ceil((maximum * 1.08) / 10) * 10);
    return {
      ...common,
      title: {
        text: "<b>External quantum efficiency, EQE (%)</b>",
        standoff: exportMode ? 24 : 18,
        font: { size: exportMode ? 25 : 18, color: "#111111" }
      },
      type: "linear",
      range: [0, upper],
      rangemode: "tozero",
      dtick: upper <= 60 ? 10 : 20,
      tickformat: ".0f",
      zeroline: true,
      zerolinecolor: "#111111",
      zerolinewidth: 1.3
    };
  }

  function gradientLegendAnnotations(datasets, exportMode) {
    if (!gradientEligible(datasets)) return [];
    const fontSize = exportMode ? 15 : 11;
    const common = {
      showarrow: false,
      xref: "paper",
      yref: "paper",
      font: { family: "Arial, Microsoft YaHei UI, sans-serif", size: fontSize, color: "#444444" }
    };
    return [
      {
        ...common,
        x: 0.12,
        y: 0.032,
        xanchor: "right",
        text: escapeHtml(state.gradient.label || "变化条件")
      },
      {
        ...common,
        x: 0.18,
        y: -0.018,
        xanchor: "center",
        text: escapeHtml(state.gradient.start || "起点")
      },
      {
        ...common,
        x: 0.82,
        y: -0.018,
        xanchor: "center",
        text: escapeHtml(state.gradient.end || "终点")
      }
    ];
  }

  function gradientLegendAxisLayout(datasets) {
    if (!gradientEligible(datasets)) return {};
    return {
      yaxis: {
        ...yAxisSettings(datasets, state.view === "JV", state.view === "JV" && elements.scaleSelect.value === "log", false),
        domain: [0.16, 1]
      },
      xaxis2: {
        domain: [0.18, 0.82],
        range: [0, 1],
        fixedrange: true,
        showgrid: false,
        showline: false,
        zeroline: false,
        showticklabels: false,
        ticks: ""
      },
      yaxis2: {
        domain: [0.02, 0.065],
        range: [0, 1],
        fixedrange: true,
        showgrid: false,
        showline: false,
        zeroline: false,
        showticklabels: false,
        ticks: ""
      }
    };
  }

  function plotMargins(datasets, exportMode) {
    const gradientMode = gradientEligible(datasets);
    return exportMode
      ? { l: 155, r: 95, t: 115, b: gradientMode ? 185 : 130 }
      : { l: 112, r: 42, t: 40, b: gradientMode ? 145 : 95 };
  }

  function plotLayout(datasets, exportMode) {
    const isJV = state.view === "JV";
    const useLog = isJV && elements.scaleSelect.value === "log";
    const title = elements.chartTitle.value.trim() || (isJV ? "JV characteristics" : "EQE spectrum");
    const manyCurves = datasets.length > 10;
    const gradientMode = gradientEligible(datasets);
    const gradientAxes = gradientLegendAxisLayout(datasets);
    const coordinateAnnotationsList = datasets.length ? coordinateAnnotations(datasets, exportMode) : [{
      text: "当前筛选条件下没有可见曲线",
      showarrow: false,
      xref: "paper",
      yref: "paper",
      x: 0.5,
      y: 0.5,
      font: { color: "#66736e", size: 14 }
    }];
    return {
      title: {
        text: exportMode ? `<b>${title}</b>` : "",
        x: 0.06,
        xanchor: "left",
        y: 0.97,
        font: {
          family: "Arial, Microsoft YaHei UI, sans-serif",
          size: exportMode ? 32 : 18,
          color: "#111111"
        }
      },
      margin: plotMargins(datasets, exportMode),
      paper_bgcolor: "#ffffff",
      plot_bgcolor: "#ffffff",
      hovermode: "closest",
      hoverlabel: {
        bgcolor: "#ffffff",
        bordercolor: "#111111",
        font: { family: "Arial, Microsoft YaHei UI, sans-serif", size: 13, color: "#111111" }
      },
      showlegend: !gradientMode,
      legend: {
        orientation: "v",
        x: isJV ? 0.98 : 0.02,
        xanchor: isJV ? "right" : "left",
        y: 0.03,
        yanchor: "bottom",
        bgcolor: "rgba(255,255,255,0)",
        borderwidth: 0,
        itemwidth: exportMode ? 54 : 42,
        itemsizing: "constant",
        tracegroupgap: 3,
        font: {
          family: "Arial, Microsoft YaHei UI, sans-serif",
          size: exportMode ? (manyCurves ? 15 : 19) : (manyCurves ? 10 : 13),
          color: "#111111"
        }
      },
      xaxis: xAxisSettings(datasets, isJV, exportMode),
      yaxis: yAxisSettings(datasets, isJV, useLog, exportMode),
      ...gradientAxes,
      font: {
        family: "Arial, Microsoft YaHei UI, sans-serif",
        size: exportMode ? 20 : 14,
        color: "#111111"
      },
      annotations: coordinateAnnotationsList.concat(gradientLegendAnnotations(datasets, exportMode))
    };
  }

  function formattedCoordinateMark(dataset, index) {
    const x = dataset.x[index];
    const y = dataset.y[index];
    if (dataset.type === "JV") {
      return `${datasetDisplayLabel(dataset)}<br>V=${Number(x).toFixed(3)} V<br>J=${Number(y).toExponential(2)} A cm⁻²`;
    }
    return `${datasetDisplayLabel(dataset)}<br>λ=${Number(x).toFixed(0)} nm<br>EQE=${Number(y).toFixed(2)}%`;
  }

  function visibleCoordinateMarks(datasets) {
    if (!elements.coordinateToggle.checked) return [];
    const datasetIds = new Set(datasets.map((dataset) => dataset.id));
    return state.coordinateMarks
      .filter((mark) => datasetIds.has(mark.datasetId))
      .map((mark) => ({
        ...mark,
        dataset: state.datasets.find((item) => item.id === mark.datasetId)
      }))
      .filter((mark) => (
        mark.dataset &&
        mark.dataset.x[mark.index] != null &&
        mark.dataset.y[mark.index] != null
      ));
  }

  function coordinateAnnotationMetrics(datasets, exportMode) {
    const isJV = state.view === "JV";
    const useLog = isJV && elements.scaleSelect.value === "log";
    const margins = plotMargins(datasets, exportMode);
    const width = exportMode
      ? exportChartSize.width
      : Math.max(elements.plot.clientWidth || 960, 640);
    const height = exportMode ? exportChartSize.height : 650;
    const xAxis = xAxisSettings(datasets, isJV, exportMode);
    const yAxis = yAxisSettings(datasets, isJV, useLog, exportMode);
    const innerWidth = Math.max(1, width - margins.l - margins.r);
    const innerHeight = Math.max(1, height - margins.t - margins.b);
    const yDomainStart = gradientEligible(datasets) ? 0.16 : 0;

    return {
      width,
      height,
      left: margins.l,
      right: width - margins.r,
      top: margins.t,
      bottom: margins.t + innerHeight * (1 - yDomainStart),
      innerWidth,
      innerHeight: innerHeight * (1 - yDomainStart),
      xRange: xAxis.range,
      yRange: yAxis.range,
      useLog
    };
  }

  function annotationAnchor(mark, metrics) {
    const rawX = Number(mark.dataset.x[mark.index]);
    const rawY = Number(mark.dataset.y[mark.index]);
    const yValue = metrics.useLog ? Math.log10(Math.abs(rawY)) : rawY;
    const xSpan = metrics.xRange[1] - metrics.xRange[0] || 1;
    const ySpan = metrics.yRange[1] - metrics.yRange[0] || 1;
    const xFraction = Math.min(1, Math.max(0, (rawX - metrics.xRange[0]) / xSpan));
    const yFraction = Math.min(1, Math.max(0, (yValue - metrics.yRange[0]) / ySpan));
    return {
      x: metrics.left + xFraction * metrics.innerWidth,
      y: metrics.bottom - yFraction * metrics.innerHeight
    };
  }

  function annotationBoxSize(mark, exportMode, sizeScale) {
    const fontSize = Math.round((exportMode ? 17 : 11) * sizeScale);
    const borderPad = Math.round((exportMode ? 7 : 5) * sizeScale);
    const lines = formattedCoordinateMark(mark.dataset, mark.index).split("<br>");
    textMeasureContext.font = `${fontSize}px Arial, Microsoft YaHei UI, sans-serif`;
    const longestLine = lines.reduce((maximum, line) => Math.max(
      maximum,
      textMeasureContext.measureText(line.replace(/<[^>]*>/g, "")).width
    ), 0);
    return {
      width: Math.min(exportMode ? 560 : 380, Math.max(
        exportMode ? 180 : 125,
        longestLine + borderPad * 2 + 4
      )),
      height: fontSize * (1 + Math.max(0, lines.length - 1) * 1.3) + borderPad * 2 + 4
    };
  }

  function overlapArea(left, right) {
    const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
    const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
    return width * height;
  }

  function annotationRectangle(anchor, offset, box) {
    const centerX = anchor.x + offset.ax;
    const centerY = anchor.y + offset.ay;
    return {
      left: centerX - box.width / 2,
      right: centerX + box.width / 2,
      top: centerY - box.height / 2,
      bottom: centerY + box.height / 2
    };
  }

  function fitAnnotationOffset(anchor, offset, box, metrics) {
    const halfWidth = box.width / 2;
    const halfHeight = box.height / 2;
    const centerX = Math.min(
      metrics.right - halfWidth,
      Math.max(metrics.left + halfWidth, anchor.x + offset.ax)
    );
    const centerY = Math.min(
      metrics.bottom - halfHeight,
      Math.max(metrics.top + halfHeight, anchor.y + offset.ay)
    );
    return { ax: centerX - anchor.x, ay: centerY - anchor.y };
  }

  function coordinateAnnotationOffsets(marks, datasets, exportMode, sizeScale) {
    const metrics = coordinateAnnotationMetrics(datasets, exportMode);
    const offsets = new Map();
    const occupied = [];
    const exportOffsetScale = exportMode ? 17 / 11 : 1;
    const positioned = marks.map((mark, index) => ({
      mark,
      index,
      key: `${mark.datasetId}:${mark.index}`,
      anchor: annotationAnchor(mark, metrics),
      box: annotationBoxSize(mark, exportMode, sizeScale)
    }));

    positioned.filter(({ mark }) => Number.isFinite(mark.ax) && Number.isFinite(mark.ay))
      .forEach((item) => {
        const offset = {
          ax: item.mark.ax * exportOffsetScale,
          ay: item.mark.ay * exportOffsetScale
        };
        offsets.set(item.key, offset);
        occupied.push(annotationRectangle(item.anchor, offset, item.box));
      });

    const automaticItems = positioned.filter(({ mark }) => (
      !(Number.isFinite(mark.ax) && Number.isFinite(mark.ay))
    ));

    if (sizeScale >= 1.5 && automaticItems.length > 6) {
      const maximumBoxWidth = Math.max(...automaticItems.map((item) => item.box.width));
      const maximumBoxHeight = Math.max(...automaticItems.map((item) => item.box.height));
      const usableWidth = metrics.right - metrics.left;
      const usableHeight = metrics.bottom - metrics.top;
      const maximumColumns = Math.max(1, Math.floor(usableWidth / maximumBoxWidth));
      const maximumRows = Math.max(1, Math.floor(usableHeight / maximumBoxHeight));
      const columns = Math.min(maximumColumns, Math.max(1, Math.ceil(automaticItems.length / maximumRows)));
      const rows = Math.ceil(automaticItems.length / columns);
      const slots = [];

      for (let row = 0; row < rows; row += 1) {
        const centerY = rows === 1
          ? metrics.top + usableHeight / 2
          : metrics.top + maximumBoxHeight / 2 + row * ((usableHeight - maximumBoxHeight) / (rows - 1));
        for (let column = 0; column < columns; column += 1) {
          const centerX = columns === 1
            ? metrics.left + usableWidth / 2
            : metrics.left + maximumBoxWidth / 2 + column * ((usableWidth - maximumBoxWidth) / (columns - 1));
          slots.push({ x: centerX, y: centerY });
        }
      }

      automaticItems.sort((left, right) => left.anchor.y - right.anchor.y || left.anchor.x - right.anchor.x)
        .forEach((item) => {
          let bestSlotIndex = 0;
          let bestScore = Infinity;
          slots.forEach((slot, slotIndex) => {
            const offset = { ax: slot.x - item.anchor.x, ay: slot.y - item.anchor.y };
            const rectangle = annotationRectangle(item.anchor, offset, item.box);
            const manualOverlap = occupied.reduce((sum, other) => sum + overlapArea(rectangle, other), 0);
            const distance = Math.hypot(offset.ax, offset.ay);
            const score = manualOverlap * 1000 + distance;
            if (score < bestScore) {
              bestScore = score;
              bestSlotIndex = slotIndex;
            }
          });
          const slot = slots.splice(bestSlotIndex, 1)[0];
          const offset = { ax: slot.x - item.anchor.x, ay: slot.y - item.anchor.y };
          offsets.set(item.key, offset);
          occupied.push(annotationRectangle(item.anchor, offset, item.box));
        });

      return offsets;
    }

    automaticItems
      .sort((left, right) => left.anchor.y - right.anchor.y || left.anchor.x - right.anchor.x)
      .forEach((item, sortedIndex) => {
        const horizontalGap = (exportMode ? 48 : 32) * sizeScale;
        const verticalGap = (exportMode ? 18 : 12) * sizeScale;
        const horizontalOffset = item.box.width / 2 + horizontalGap;
        const verticalStep = item.box.height + verticalGap;
        const preferredSide = sortedIndex % 2 === 0 ? 1 : -1;
        const candidates = [];

        for (let level = 0; level <= Math.max(6, marks.length); level += 1) {
          const verticalOffsets = level === 0
            ? [-item.box.height * 0.72]
            : [-item.box.height * 0.72 - level * verticalStep, item.box.height * 0.72 + (level - 1) * verticalStep];
          verticalOffsets.forEach((ay) => {
            [
              preferredSide * horizontalOffset,
              -preferredSide * horizontalOffset,
              0,
              preferredSide * (horizontalOffset + item.box.width + horizontalGap),
              -preferredSide * (horizontalOffset + item.box.width + horizontalGap)
            ].forEach((ax) => {
              candidates.push({ ax, ay });
            });
          });
        }

        const usableWidth = metrics.right - metrics.left;
        const usableHeight = metrics.bottom - metrics.top;
        const gridHorizontalGap = Math.max(2, 2 * sizeScale);
        const gridVerticalGap = Math.max(4, 4 * sizeScale);
        const columns = Math.max(1, Math.floor((usableWidth + gridHorizontalGap) / (item.box.width + gridHorizontalGap)));
        const rows = Math.max(1, Math.floor((usableHeight + gridVerticalGap) / (item.box.height + gridVerticalGap)));
        for (let row = 0; row < rows; row += 1) {
          const centerY = rows === 1
            ? metrics.top + usableHeight / 2
            : metrics.top + item.box.height / 2 + row * ((usableHeight - item.box.height) / (rows - 1));
          for (let column = 0; column < columns; column += 1) {
            const centerX = columns === 1
              ? metrics.left + usableWidth / 2
              : metrics.left + item.box.width / 2 + column * ((usableWidth - item.box.width) / (columns - 1));
            candidates.push({ ax: centerX - item.anchor.x, ay: centerY - item.anchor.y });
          }
        }

        let best = null;
        candidates.forEach((candidate, candidateIndex) => {
          const offset = fitAnnotationOffset(item.anchor, candidate, item.box, metrics);
          const rectangle = annotationRectangle(item.anchor, offset, item.box);
          const overlap = occupied.reduce((sum, other) => sum + overlapArea(rectangle, other), 0);
          const score = overlap * 1000 + candidateIndex + Math.abs(offset.ay) * 0.001;
          if (!best || score < best.score) best = { offset, rectangle, score };
        });

        offsets.set(item.key, best.offset);
        occupied.push(best.rectangle);
      });

    return offsets;
  }

  function coordinateAnnotations(datasets, exportMode) {
    const marks = visibleCoordinateMarks(datasets);
    if (!marks.length) return [];
    const useLog = state.view === "JV" && elements.scaleSelect.value === "log";
    const sizeScale = coordinateSizeScale();
    const offsets = coordinateAnnotationOffsets(marks, datasets, exportMode, sizeScale);

    return marks.map((mark) => {
        const dataset = mark.dataset;
        const style = curveStyle(dataset);
        const rawY = dataset.y[mark.index];
        // Plotly annotations on a logarithmic axis use exponent coordinates,
        // unlike scatter traces, which receive the original positive value.
        const plottedY = useLog ? Math.log10(Math.abs(rawY)) : rawY;
        const offset = offsets.get(`${mark.datasetId}:${mark.index}`);
        return {
          name: `coordinate:${mark.datasetId}:${mark.index}`,
          x: dataset.x[mark.index],
          y: plottedY,
          xref: "x",
          yref: "y",
          text: formattedCoordinateMark(dataset, mark.index),
          showarrow: true,
          arrowcolor: style.color,
          arrowwidth: (exportMode ? 2 : 1.5) * sizeScale,
          arrowhead: 2,
          ax: offset.ax,
          ay: offset.ay,
          bgcolor: "rgba(255,255,255,0.94)",
          bordercolor: style.color,
          borderwidth: (exportMode ? 2 : 1.3) * sizeScale,
          borderpad: Math.round((exportMode ? 7 : 5) * sizeScale),
          font: {
            family: "Arial, Microsoft YaHei UI, sans-serif",
            size: Math.round((exportMode ? 17 : 11) * sizeScale),
            color: "#111111"
          },
          align: "left"
        };
      })
      .filter(Boolean);
  }

  function gradientLegendTraces(datasets, exportMode) {
    if (!gradientEligible(datasets)) return [];
    const steps = 72;
    const lineWidth = exportMode ? 24 : 18;
    return Array.from({ length: steps }, (_unused, index) => ({
      x: [index / steps, (index + 1) / steps],
      y: [0.5, 0.5],
      xaxis: "x2",
      yaxis: "y2",
      type: "scatter",
      mode: "lines",
      showlegend: false,
      hoverinfo: "skip",
      line: {
        color: gradientColorAt(index, steps),
        width: lineWidth,
        shape: "linear"
      }
    }));
  }

  function addCoordinateMark(datasetId, index) {
    if (!datasetId || !Number.isInteger(index)) return;
    const duplicate = state.coordinateMarks.some((mark) => (
      mark.datasetId === datasetId && mark.index === index
    ));
    if (!duplicate) {
      state.coordinateMarks.push({ datasetId, index });
    }
    elements.coordinateToggle.checked = true;
    renderPlot();
  }

  function nearestPointIndex(dataset, targetX) {
    let bestIndex = -1;
    let bestDistance = Infinity;
    dataset.x.forEach((value, index) => {
      const distance = Math.abs(value - targetX);
      if (Number.isFinite(distance) && distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    return bestIndex;
  }

  function resetCoordinatePositions() {
    state.coordinateMarks.forEach((mark) => {
      delete mark.ax;
      delete mark.ay;
      delete mark.paperX;
      delete mark.paperY;
    });
    renderPlot();
    showToast("坐标位置已恢复为自动排版。");
  }

  function saveAnnotationPositions(eventData) {
    if (state.suppressRelayout || !eventData) return;

    const marks = visibleCoordinateMarks(currentDatasets(false));
    if (!marks.length) return;

    let changed = false;

    Object.entries(eventData).forEach(([key, value]) => {
      const match = key.match(/^annotations\[(\d+)\]\.(ax|ay|x|y)$/);
      const numericValue = Number(value);
      if (!match || !Number.isFinite(numericValue)) return;

      const visibleMark = marks[Number(match[1])];
      if (!visibleMark) return;

      const storedMark = state.coordinateMarks.find((mark) => (
        mark.datasetId === visibleMark.datasetId && mark.index === visibleMark.index
      ));
      if (!storedMark) return;

      const property = match[2];
      if (property === "ax" || property === "ay") {
        storedMark[property] = numericValue;
        changed = true;
      }
    });

    if (changed) {
      showToast("坐标位置已调整，导出图片会保留。");
    }
  }

  function interactivePlotConfig() {
    return {
      responsive: true,
      displaylogo: false,
      scrollZoom: true,
      editable: true,
      edits: {
        annotationPosition: true,
        annotationTail: true,
        annotationText: false,
        axisTitleText: false,
        colorbarPosition: false,
        colorbarTitleText: false,
        legendPosition: false,
        legendText: false,
        shapePosition: false,
        titleText: false
      },
      modeBarButtonsToRemove: ["toImage", "lasso2d", "select2d"]
    };
  }

  function bindPlotClick() {
    if (typeof elements.plot.on !== "function") return;

    if (!state.plotClickBound) {
      elements.plot.on("plotly_click", (event) => {
        const point = event && event.points && event.points[0];
        if (!point) return;
        const dataset = state.datasets.find((item) => item.id === point.data?.meta?.datasetId);
        if (!dataset || !dataset.visible) return;
        addCoordinateMark(dataset.id, point.pointIndex);
      });
      state.plotClickBound = true;
    }

    if (!state.plotRelayoutBound) {
      elements.plot.on("plotly_relayout", saveAnnotationPositions);
      state.plotRelayoutBound = true;
    }
    if (!state.plotRestyleBound) {
      elements.plot.on("plotly_restyle", (event) => {
        const [changes, indices] = event || [];
        if (!changes || !("visible" in changes)) return;
        (indices || []).forEach((traceIndex, index) => {
          const trace = elements.plot.data[traceIndex];
          const dataset = state.datasets.find((item) => item.id === trace?.meta?.datasetId);
          if (!dataset) return;
          const values = changes.visible;
          const visible = Array.isArray(values) ? values[index % values.length] : values;
          dataset.visible = visible !== false && visible !== "legendonly";
        });
        renderCurveList();
        renderPlot();
      });
      state.plotRestyleBound = true;
    }
  }

  function buildTraces(datasets, exportMode) {
    const isJV = state.view === "JV";
    const useLog = isJV && elements.scaleSelect.value === "log";
    const useGradient = gradientEligible(datasets);
    const traces = plottedDatasets(datasets).map((dataset) => {
      const style = curveStyle(dataset);
      return {
        uid: dataset.id,
        meta: { datasetId: dataset.id },
        visible: dataset.visible ? true : "legendonly",
        x: dataset.x,
        y: isJV && useLog
          ? dataset.y.map((value) => Math.abs(value) > 0 ? Math.abs(value) : null)
          : dataset.y,
        customdata: dataset.y,
        name: datasetDisplayLabel(dataset),
        type: "scatter",
        mode: "lines",
        connectgaps: false,
        opacity: 0.74,
        line: {
          color: style.color,
          width: exportMode ? 2.35 : 1.95,
          dash: style.dash,
          shape: "spline",
          smoothing: 0.85
        },
        hovertemplate: isJV
          ? "<b>%{fullData.name}</b><br>Device: " + escapeHtml(dataset.device) +
            "<br>Point: " + escapeHtml(dataset.point) +
            "<br>V = %{x:.3f} V<br>J = %{customdata:.4e} A cm⁻²<extra></extra>"
          : "<b>%{fullData.name}</b><br>Device: " + escapeHtml(dataset.device) +
            "<br>Point: " + escapeHtml(dataset.point) +
            "<br>λ = %{x:.0f} nm<br>EQE = %{y:.2f}%<extra></extra>"
      };
    });
    return traces.concat(
      gradientLegendTraces(datasets.filter((item) => item.visible), Boolean(exportMode))
    );
  }

  function renderPlot() {
    const datasets = currentDatasets(false);
    const traces = buildTraces(currentDatasets(true));
    elements.plot.style.height = "650px";

    elements.chartEmpty.hidden = state.datasets.length > 0;
    elements.plot.hidden = state.datasets.length === 0;
    elements.chartMeta.textContent = datasets.length
      ? `${datasets.length} 条可见曲线 · ${datasets.reduce((sum, item) => sum + item.x.length, 0)} 个数据点`
      : (state.datasets.length ? "当前筛选下没有可见曲线" : "尚未导入数据");

    if (!state.datasets.length) {
      if (state.plotReady && window.Plotly) {
        window.Plotly.purge(elements.plot);
        state.plotReady = false;
        state.plotClickBound = false;
        state.plotRelayoutBound = false;
        state.plotRestyleBound = false;
      }
      return;
    }

    window.Plotly.react(
      elements.plot,
      traces,
      plotLayout(datasets, false),
      interactivePlotConfig()
    );
    state.plotReady = true;
    bindPlotClick();
  }

  function updateViewCopy() {
    const isJV = state.view === "JV";
    elements.chartEyebrow.textContent = isJV ? "CURRENT DENSITY" : "EXTERNAL QUANTUM EFFICIENCY";
    elements.chartTitle.value = isJV ? "JV 曲线" : "EQE 光谱";
    elements.scaleControl.hidden = !isJV;
    elements.coordinateXLabel.textContent = isJV ? "横坐标 V" : "波长 λ (nm)";
    elements.coordinateX.placeholder = isJV ? "例如 0.5" : "例如 1200";
  }

  function renderAll(options) {
    const preserveFilters = options && options.preserveFilters;
    renderCounts();
    if (!preserveFilters) renderFilters();
    renderDeviceStyles();
    renderCurveList();
    renderRecognitionTable();
    renderMessages();
    renderPlot();
  }

  async function readFile(file) {
    try {
      const text = await file.text();
      const relativePath = fileRelativePath(file);
      const result = parser.parseFile(text, { name: file.name, relativePath });
      state.filesSeen.add(relativePath);
      if (!result.datasets.length) {
        state.messages.push(`${relativePath}：未识别到可绘制的 JV 或 EQE 数据。`);
        return { type: result.type, count: 0 };
      }
      state.datasets = parser.mergeDatasets(state.datasets, result.datasets);
      return { type: result.type, count: result.datasets.length };
    } catch (error) {
      state.messages.push(`${file.name}：读取失败（${error.message || "未知错误"}）。`);
      return { type: "UNKNOWN", count: 0 };
    }
  }

  function fileRelativePath(file) {
    if (file.webkitRelativePath) return file.webkitRelativePath;
    return `${file.name}#${file.size || 0}#${file.lastModified || 0}`;
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter((file) => /\.txt$/i.test(file.name));
    if (!files.length) {
      state.messages = ["请选择扩展名为 .txt 的测试数据文件。"];
      renderMessages();
      return;
    }

    state.messages = [];
    const results = await Promise.all(files.map(readFile));
    const importedTypes = uniqueSorted(
      results
        .filter((result) => result && result.count > 0)
        .map((result) => result.type)
    );
    if (importedTypes.length === 1) {
      state.view = importedTypes[0];
      document.querySelectorAll(".tab").forEach((tab) => {
        tab.classList.toggle("is-active", tab.dataset.view === state.view);
        tab.setAttribute("aria-selected", tab.dataset.view === state.view ? "true" : "false");
      });
      updateViewCopy();
    }
    sortDatasets();
    ensureDeviceStyles();
    renderAll();
    if (importedTypes.length) {
      const curveCount = results.reduce((sum, result) => sum + (result ? result.count : 0), 0);
      showToast(`已导入 ${curveCount} 条 ${importedTypes.join(" / ")} 曲线。`);
    }
    document.getElementById("workspace").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function setView(view) {
    state.view = view;
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.classList.toggle("is-active", tab.dataset.view === view);
      tab.setAttribute("aria-selected", tab.dataset.view === view ? "true" : "false");
    });
    updateViewCopy();
    renderFilters();
    renderDeviceStyles();
    renderCurveList();
    renderPlot();
  }

  function exportBaseName(value, fallback) {
    const cleanName = String(value || "")
      .trim()
      .replace(/\.(txt|xlsx|zip|png|svg)$/i, "")
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .replace(/[. ]+$/g, "")
      .slice(0, 120);
    return cleanName || fallback;
  }

  function openExportDialog(kind) {
    const datasets = currentDatasets(false);
    if (!datasets.length || (kind === "image" && !state.plotReady)) {
      showToast(kind === "image" ? "当前图里没有可导出的可见曲线。" : "当前没有可导出的数据。", true);
      return;
    }
    pendingExportKind = kind;
    const date = new Date().toISOString().slice(0, 10);
    const chartTitle = elements.chartTitle.value.trim() || `${state.view}_曲线`;
    elements.exportDialogTitle.textContent = kind === "image"
      ? "导出图片"
      : (kind === "xlsx"
        ? "导出 Excel（Origin）"
        : (kind === "origin-bundle" ? "导出 Origin 数据包（ZIP）" : "导出可回导 TXT"));
    elements.exportFormatField.hidden = kind !== "image";
    elements.exportHint.hidden = kind !== "origin-bundle";
    elements.exportHint.textContent = kind === "origin-bundle"
      ? "这是交给 Origin Skill 的数据与作图配方，不是图片。Skill 会据此生成含图页的 .opju；如需 PNG/SVG，请点击“导出图片”。"
      : "";
    elements.exportFileName.value = kind === "image"
      ? chartTitle
      : (kind === "origin-bundle" ? `${state.view}_Origin作图_${date}` : `${state.view}_数据_${date}`);
    elements.exportDialog.showModal();
    window.setTimeout(() => {
      elements.exportFileName.focus();
      elements.exportFileName.select();
    }, 0);
  }

  function showToast(message, isError) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.toggle("is-error", Boolean(isError));
    elements.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => {
      elements.toast.classList.remove("is-visible");
    }, 5000);
  }

  function browserDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function saveBlob(blob, fileName) {
    const isLocalServer = (
      location.protocol === "http:" &&
      (location.hostname === "127.0.0.1" || location.hostname === "localhost")
    );

    if (isLocalServer) {
      try {
        const response = await fetch(`/api/save?filename=${encodeURIComponent(fileName)}`, {
          method: "POST",
          headers: { "Content-Type": blob.type || "application/octet-stream" },
          body: blob
        });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || "保存失败");
        }
        if (result.location === "project") {
          showToast(`桌面直存不可用，已保存到项目 exports：${result.filename}`);
        } else {
          showToast(`已保存到桌面：${result.filename}`);
        }
        return;
      } catch (_error) {
        browserDownload(blob, fileName);
        showToast(`桌面直存不可用，已改为浏览器下载：${fileName}`);
        return;
      }
    }

    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({ suggestedName: fileName });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      showToast(`已保存：${fileName}`);
      return;
    }

    browserDownload(blob, fileName);
    showToast("文件已下载。若 Windows 仍拦截，请关闭本页并从桌面快捷方式重新打开网站。");
  }

  async function downloadTxt(fileName) {
    const datasets = currentDatasets(false);
    if (!datasets.length) return;
    const text = exporter.buildInstrumentText(state.view, datasets);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    try {
      await saveBlob(blob, fileName);
    } catch (error) {
      if (error && error.name !== "AbortError") {
        showToast(`TXT 保存失败：${error.message || "未知错误"}`, true);
      }
    }
  }

  async function downloadExcel(fileName) {
    const datasets = currentDatasets(false);
    if (!datasets.length) return;
    try {
      const blob = exporter.buildWorkbookBlob(state.view, datasets, {
        chartTitle: elements.chartTitle.value.trim() || `${state.view} 曲线`
      });
      await saveBlob(blob, fileName);
    } catch (error) {
      if (error && error.name !== "AbortError") {
        showToast(`Excel 保存失败：${error.message || "未知错误"}`, true);
      }
    }
  }

  function buildOriginRecipe(datasets) {
    const isJV = state.view === "JV";
    const useLog = isJV && elements.scaleSelect.value === "log";
    const xAxis = xAxisSettings(datasets, isJV, true);
    const yAxis = yAxisSettings(datasets, isJV, useLog, true);
    const ordered = plottedDatasets(datasets);
    return {
      title: elements.chartTitle.value.trim() || `${state.view} 曲线`,
      axes: {
        x: {
          title: isJV ? "Voltage (V)" : "Wavelength (nm)",
          range: xAxis.range || null,
          majorStep: xAxis.dtick || null
        },
        y: {
          title: isJV
            ? "Current density (A/cm²)"
            : "EQE (%)",
          scale: useLog ? "log" : "linear",
          range: useLog && Array.isArray(yAxis.range)
            ? yAxis.range.map((value) => 10 ** value)
            : (yAxis.range || null),
          majorStep: yAxis.dtick || null
        }
      },
      plot: {
        legend: !gradientEligible(datasets),
        paperStyle: {
          preset: "wiley-jv-eqe",
          font: "Arial",
          axisTitleSize: 18,
          tickLabelSize: 14,
          legendSize: 12,
          axisLineWidth: 1.5,
          tickDirection: "in",
          grid: false,
          boxFrame: true,
          legendCorner: isJV ? "bottom-right" : "bottom-left",
          pageWidth: 5000,
          pageHeight: 4200
        },
        gradient: gradientEligible(datasets) ? {
          enabled: true,
          color: state.gradient.color,
          label: state.gradient.label,
          start: state.gradient.start,
          end: state.gradient.end
        } : null
      },
      curves: ordered.map((dataset) => {
        const style = curveStyle(dataset);
        return {
          name: datasetDisplayLabel(dataset),
          color: style.color,
          lineStyle: style.dash,
          lineWidth: 3,
          interpolation: "straight",
          symbol: "none"
        };
      })
    };
  }

  async function downloadOriginBundle(fileName) {
    const datasets = plottedDatasets(currentDatasets(false));
    if (!datasets.length) return;
    try {
      const blob = exporter.buildOriginSkillBundle(
        state.view,
        datasets,
        buildOriginRecipe(datasets),
        { chartTitle: elements.chartTitle.value.trim() || `${state.view} 曲线` }
      );
      await saveBlob(blob, fileName);
    } catch (error) {
      if (error && error.name !== "AbortError") {
        showToast(`Origin 作图包保存失败：${error.message || "未知错误"}`, true);
      }
    }
  }

  async function openCurrentViewInOrigin() {
    const datasets = plottedDatasets(currentDatasets(false));
    if (!datasets.length) {
      showToast("当前没有可交给 Origin 的可见曲线。", true);
      return;
    }
    const originalText = elements.openOriginButton.textContent;
    try {
      elements.openOriginButton.disabled = true;
      elements.openOriginButton.textContent = "正在生成 Origin 工程...";
      showToast("正在校验作图包并生成可编辑 Origin 工程，请稍等。");
      const blob = exporter.buildOriginSkillBundle(
        state.view,
        datasets,
        buildOriginRecipe(datasets),
        { chartTitle: elements.chartTitle.value.trim() || `${state.view} 曲线` }
      );
      const date = new Date().toISOString().slice(0, 10);
      const baseName = exportBaseName(
        elements.chartTitle.value,
        `${state.view}_Origin作图_${date}`
      );
      const response = await fetch(
        `/api/open-origin?filename=${encodeURIComponent(`${baseName}.zip`)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/zip" },
          body: blob
        }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Origin 工程创建失败");
      const warningText = result.warnings && result.warnings.length
        ? `（${result.warnings.length} 项样式提示）`
        : "";
      if (result.opened) {
        showToast(`已生成并打开 Origin：${result.filename}${warningText}`);
      } else {
        showToast(`工程已生成：${result.filename}；请从保存目录双击打开。${warningText}`, true);
      }
    } catch (error) {
      const detail = error && error.name === "TypeError"
        ? "本地服务未连接，请双击“启动网站.bat”后重试"
        : (error.message || "未知错误");
      showToast(`Origin 一键打开失败：${detail}`, true);
    } finally {
      elements.openOriginButton.disabled = false;
      elements.openOriginButton.textContent = originalText;
    }
  }

  async function downloadImage(fileName, format) {
    const datasets = currentDatasets(false);
    if (!state.plotReady || !datasets.length) {
      showToast("当前图里没有可导出的可见曲线。", true);
      return;
    }
    const { width, height } = exportChartSize;
    const exportPlot = document.createElement("div");
    exportPlot.style.position = "fixed";
    exportPlot.style.left = "-10000px";
    exportPlot.style.top = "0";
    exportPlot.style.width = `${width}px`;
    exportPlot.style.height = `${height}px`;
    document.body.appendChild(exportPlot);
    try {
      state.suppressRelayout = true;
      elements.downloadPngButton.disabled = true;
      elements.downloadPngButton.textContent = "正在导出...";
      showToast(format === "svg" ? "正在生成 SVG 矢量图片。" : "正在生成高清 PNG，请稍等。");
      await window.Plotly.newPlot(
        exportPlot,
        buildTraces(datasets, true),
        { ...plotLayout(datasets, true), width, height },
        { staticPlot: true, displayModeBar: false, responsive: false }
      );
      const dataUrl = await window.Plotly.toImage(exportPlot, {
        format,
        width,
        height,
        scale: format === "png" ? 3 : 1
      });
      const blob = await (await fetch(dataUrl)).blob();
      await saveBlob(blob, fileName);
    } catch (error) {
      if (error && error.name !== "AbortError") {
        showToast(`图片保存失败：${error.message || "未知错误"}`, true);
      }
    } finally {
      window.Plotly.purge(exportPlot);
      exportPlot.remove();
      elements.downloadPngButton.disabled = false;
      elements.downloadPngButton.textContent = "导出图片";
      state.suppressRelayout = false;
    }
  }

  elements.chooseFilesButton.addEventListener("click", (event) => {
    event.stopPropagation();
    elements.fileInput.click();
  });

  elements.chooseFolderButton.addEventListener("click", (event) => {
    event.stopPropagation();
    elements.folderInput.click();
  });

  elements.dropZone.addEventListener("click", (event) => {
    if (!event.target.closest("button")) elements.fileInput.click();
  });

  elements.dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      elements.fileInput.click();
    }
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.add("is-dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.remove("is-dragging");
    });
  });

  elements.dropZone.addEventListener("drop", (event) => handleFiles(event.dataTransfer.files));
  elements.fileInput.addEventListener("change", async (event) => {
    await handleFiles(event.target.files);
    event.target.value = "";
  });
  elements.folderInput.addEventListener("change", async (event) => {
    await handleFiles(event.target.files);
    event.target.value = "";
  });

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => setView(tab.dataset.view));
  });

  elements.pointFilter.addEventListener("change", () => {
    renderCurveList();
    renderPlot();
  });
  elements.illuminationFilter.addEventListener("change", () => {
    renderCurveList();
    renderPlot();
  });
  elements.scaleSelect.addEventListener("change", renderPlot);
  elements.chartTitle.addEventListener("change", renderPlot);
  elements.downloadTxtButton.addEventListener("click", () => openExportDialog("txt"));
  elements.downloadExcelButton.addEventListener("click", () => openExportDialog("xlsx"));
  elements.openOriginButton.addEventListener("click", openCurrentViewInOrigin);
  elements.downloadOriginBundleButton.addEventListener("click", () => openExportDialog("origin-bundle"));
  elements.downloadPngButton.addEventListener("click", () => openExportDialog("image"));
  elements.cancelExportButton.addEventListener("click", () => elements.exportDialog.close());
  elements.exportDialog.addEventListener("close", () => {
    pendingExportKind = null;
  });

  if (window.location.protocol === "https:") {
    elements.openOriginButton.disabled = true;
    elements.openOriginButton.textContent = "网页版请导出 Origin ZIP";
    elements.openOriginButton.title = "GitHub Pages 无法直接启动本机 Origin，请使用右侧的“导出 Origin ZIP”";
  }
  elements.exportForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const kind = pendingExportKind;
    if (!kind) return;
    const formatInput = elements.exportForm.querySelector('input[name="exportFormat"]:checked');
    const format = kind === "image" && formatInput
      ? formatInput.value
      : (kind === "origin-bundle" ? "zip" : kind);
    const fallback = kind === "image" ? `${state.view}_曲线` : `${state.view}_数据`;
    const fileName = `${exportBaseName(elements.exportFileName.value, fallback)}.${format}`;
    elements.exportDialog.close();
    if (kind === "image") {
      await downloadImage(fileName, format);
    } else if (kind === "xlsx") {
      await downloadExcel(fileName);
    } else if (kind === "origin-bundle") {
      await downloadOriginBundle(fileName);
    } else {
      await downloadTxt(fileName);
    }
  });
  elements.gradientToggle.addEventListener("change", () => {
    state.gradient.enabled = elements.gradientToggle.checked;
    if (state.gradient.enabled) {
      state.deviceGradient.enabled = false;
      state.lightDarkSameColor = false;
      elements.deviceGradientToggle.checked = false;
      elements.lightDarkColorToggle.checked = false;
    }
    syncGradientControlsVisibility();
    if (state.gradient.enabled && currentDatasets(false).length < 2) {
      showToast("请先在左侧勾选至少两条属于同一器件的曲线。", true);
    }
    renderCurveList();
    renderPlot();
  });
  elements.deviceGradientToggle.addEventListener("change", () => {
    state.deviceGradient.enabled = elements.deviceGradientToggle.checked;
    if (state.deviceGradient.enabled) {
      state.gradient.enabled = false;
      state.lightDarkSameColor = false;
      elements.gradientToggle.checked = false;
      elements.lightDarkColorToggle.checked = false;
    }
    syncGradientControlsVisibility();
    renderCurveList();
    renderPlot();
  });
  elements.lightDarkColorToggle.addEventListener("change", () => {
    state.lightDarkSameColor = elements.lightDarkColorToggle.checked;
    if (state.lightDarkSameColor) {
      state.gradient.enabled = false;
      state.deviceGradient.enabled = false;
      elements.gradientToggle.checked = false;
      elements.deviceGradientToggle.checked = false;
    }
    syncGradientControlsVisibility();
    renderCurveList();
    renderPlot();
  });
  elements.gradientColor.addEventListener("input", () => {
    state.gradient.color = elements.gradientColor.value;
    renderCurveList();
    renderPlot();
  });
  [elements.gradientLabel, elements.gradientStart, elements.gradientEnd].forEach((input) => {
    input.addEventListener("input", () => {
      state.gradient.label = elements.gradientLabel.value.trim();
      state.gradient.start = elements.gradientStart.value.trim();
      state.gradient.end = elements.gradientEnd.value.trim();
      renderPlot();
    });
  });
  elements.coordinateToggle.addEventListener("change", renderPlot);
  elements.coordinateSize.addEventListener("input", () => {
    elements.coordinateSizeValue.value = `${elements.coordinateSize.value}%`;
    renderPlot();
  });
  elements.clearCoordinatesButton.addEventListener("click", () => {
    const currentTypeIds = new Set(
      state.datasets.filter((dataset) => dataset.type === state.view).map((dataset) => dataset.id)
    );
    state.coordinateMarks = state.coordinateMarks.filter((mark) => !currentTypeIds.has(mark.datasetId));
    renderPlot();
  });
  elements.resetCoordinatePositionsButton.addEventListener("click", resetCoordinatePositions);
  elements.markAllCoordinatesButton.addEventListener("click", () => {
    const targetX = Number(elements.coordinateX.value);
    if (!Number.isFinite(targetX)) {
      showToast("请先输入要标注的横坐标。", true);
      return;
    }
    const datasets = currentDatasets(false);
    datasets.forEach((dataset) => {
      const index = nearestPointIndex(dataset, targetX);
      if (index >= 0 && !state.coordinateMarks.some((mark) => (
        mark.datasetId === dataset.id && mark.index === index
      ))) {
        state.coordinateMarks.push({ datasetId: dataset.id, index });
      }
    });
    elements.coordinateToggle.checked = true;
    renderPlot();
  });

  elements.deviceStyleList.addEventListener("change", (event) => {
    const visibleKey = event.target.dataset.deviceVisible;
    const colorKey = event.target.dataset.deviceColor;
    const deviceName = event.target.dataset.deviceName;
    if (deviceName != null) {
      renameDevice(deviceName, event.target.value);
      return;
    }
    if (visibleKey && state.deviceStyles[visibleKey]) {
      state.deviceStyles[visibleKey].visible = event.target.checked;
      renderDeviceStyles();
      renderCurveList();
      renderPlot();
    }
    if (colorKey && state.deviceStyles[colorKey]) {
      state.deviceStyles[colorKey].color = event.target.value;
      renderDeviceStyles();
      renderCurveList();
      renderPlot();
    }
  });

  elements.deviceStyleList.addEventListener("keydown", (event) => {
    if (event.target.dataset.deviceName != null && event.key === "Enter") {
      event.preventDefault();
      event.target.blur();
    }
  });

  elements.toggleDevicesButton.addEventListener("click", () => {
    const keys = uniqueSorted(
      state.datasets
        .filter((dataset) => dataset.type === state.view)
        .map((dataset) => deviceStyleKey(dataset.type, dataset.device))
    );
    const allVisible = keys.length && keys.every((key) => state.deviceStyles[key].visible);
    keys.forEach((key) => {
      state.deviceStyles[key].visible = !allVisible;
    });
    renderDeviceStyles();
    renderCurveList();
    renderPlot();
  });

  elements.curveList.addEventListener("change", (event) => {
    const nameId = event.target.dataset.curveName;
    if (nameId) {
      const dataset = state.datasets.find((item) => item.id === nameId);
      if (dataset) {
        dataset.legendName = event.target.value.trim();
        renderCurveList();
        renderPlot();
      }
      return;
    }

    const colorId = event.target.dataset.curveColor;
    if (colorId) {
      state.curveStyles[colorId] = {
        color: event.target.value
      };
      renderCurveList();
      renderPlot();
      return;
    }

    const id = event.target.dataset.curveToggle;
    if (!id) return;
    const dataset = state.datasets.find((item) => item.id === id);
    if (dataset) dataset.visible = event.target.checked;
    renderCurveList();
    renderPlot();
  });

  elements.curveList.addEventListener("input", (event) => {
    const nameId = event.target.dataset.curveName;
    if (!nameId) return;
    const dataset = state.datasets.find((item) => item.id === nameId);
    if (!dataset) return;
    dataset.legendName = event.target.value;
    renderPlot();
  });

  elements.curveList.addEventListener("keydown", (event) => {
    if (event.target.dataset.curveName != null && event.key === "Enter") {
      event.preventDefault();
      event.target.blur();
    }
  });

  elements.toggleAllButton.addEventListener("click", () => {
    const datasets = currentDatasets(true);
    const allVisible = datasets.length && datasets.every((dataset) => dataset.visible);
    datasets.forEach((dataset) => {
      dataset.visible = !allVisible;
    });
    renderCurveList();
    renderPlot();
  });

  elements.recognitionBody.addEventListener("change", (event) => {
    const field = event.target.dataset.editField;
    const row = event.target.closest("[data-row-id]");
    if (!field || !row) return;
    const dataset = state.datasets.find((item) => item.id === row.dataset.rowId);
    if (!dataset) return;
    dataset[field] = event.target.value.trim() || "未识别";
    ensureDeviceStyles();
    renderFilters();
    renderDeviceStyles();
    renderCurveList();
    renderPlot();
  });

  elements.recognitionBody.addEventListener("click", (event) => {
    const id = event.target.dataset.deleteId;
    if (!id) return;
    state.datasets = state.datasets.filter((dataset) => dataset.id !== id);
    state.coordinateMarks = state.coordinateMarks.filter((mark) => mark.datasetId !== id);
    delete state.curveStyles[id];
    renderAll();
  });

  elements.clearButton.addEventListener("click", () => {
    state.datasets = [];
    state.filesSeen.clear();
    state.messages = [];
    state.deviceStyles = {};
    state.curveStyles = {};
    state.lightDarkSameColor = false;
    state.coordinateMarks = [];
    elements.lightDarkColorToggle.checked = false;
    elements.fileInput.value = "";
    elements.folderInput.value = "";
    renderAll();
  });

  function removeCoordinateAnnotation(event) {
    const annotation = event.target.closest?.(".annotation");
    if (!annotation) return;
    const annotationIndex = Number(annotation.getAttribute("data-index"));
    const name = elements.plot.layout?.annotations?.[annotationIndex]?.name;
    if (!name || !name.startsWith("coordinate:")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    state.coordinateMarks = state.coordinateMarks.filter((mark) => (
      `coordinate:${mark.datasetId}:${mark.index}` !== name
    ));
    renderPlot();
  }

  // Plotly's editable annotation drag layer consumes native double-clicks.
  // Catch the second press before that layer starts another drag operation.
  elements.plot.addEventListener("mousedown", (event) => {
    if (event.button === 0 && event.detail === 2) removeCoordinateAnnotation(event);
  }, true);
  elements.plot.addEventListener("dblclick", removeCoordinateAnnotation, true);

  syncGradientControlsVisibility();
  updateViewCopy();
  renderAll();
}());
