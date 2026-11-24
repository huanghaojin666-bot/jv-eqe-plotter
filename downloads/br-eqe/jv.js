(function () {
  'use strict';
  const data = window.JV_DATA;
  const model = window.JVModel;
  const $ = id => document.getElementById(id);
  const state = { type: 'cell', key: '9.15_f', source: 'original', view: 'plot', mode: 'both', scale: 'log', normalized: false, hidden: new Set() };
  const allRecords = model.sourceRecords(data, 'combined');
  const curveIds = new Set(allRecords.flatMap(r => r.curves.map(c => c.id)));
  const meanColors = ['#1f77b4', '#d26b17', '#2a8c48', '#c43e49', '#8461a3', '#916351', '#b84887', '#62696e', '#88851a', '#198b97', '#354b9a', '#24292c'];
  let ready = Promise.resolve();
  let resizeTimer;
  let pickerKey;
  function esc(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
  function icons() { window.lucide.createIcons(); }
  function selected() { return model.selection(data, state.type, state.key, state.source); }
  function visible() { return model.visible(selected(), state.view === 'svg' ? { mode: 'both', hidden: new Set() } : state); }
  function available() { return model.visible(selected(), { ...state, hidden: new Set() }); }
  function batchLabel(record) { return record.measuredOn ? record.measuredOn : '原 JV'; }
  function recordLabel(record) { return record.group === 'n' ? 'n' : record.date+' · '+record.group+(record.measuredOn ? ' · 11.24' : ''); }
  function canUseSvg() { return state.type === 'cell' && state.source === 'original'; }
  function title() {
    if (state.key === 'n' || state.key === '7.21') return 'n';
    if (state.type === 'date') return state.key+' · JV 各变量对比';
    if (state.type === 'group') return state.key+' · JV 跨日期对比';
    if (state.type === 'all') return '全部日期 · JV 集总';
    const record = selected()[0]; return record?.group === 'n' ? 'n' : record ? recordLabel(record)+' · JV' : 'JV';
  }
  function toast(message) {
    $('toast').textContent = message; $('toast').hidden = false;
    setTimeout(() => { $('toast').hidden = true; }, 3500);
  }
  function selectedTitle() {
    const records = selected();
    const dark = records.reduce((s, r) => s+r.darkCount, 0);
    const light = records.reduce((s, r) => s+r.lightCount, 0);
    return `${records.length} 组 · ${dark+light} 条曲线 · Dark ${dark} / Light ${light}`;
  }
  function renderMatrix() {
    const selectedIds = new Set(selected().map(r => r.id));
    const pool = model.sourceRecords(data, state.source);
    const experimentDates = data.dates.filter(date => !date.standalone);
    let html = '<thead><tr><th>变量 / 日期</th>';
    for (const date of experimentDates) {
      html += `<th><button data-jv-date="${date.label}" ${pool.some(r => r.date === date.label) ? '' : 'disabled'} class="${state.type === 'date' && state.key === date.label ? 'is-active' : ''}" aria-label="${date.label} JV 各变量对比"><span>${date.label}</span><small>实验 ${date.experiment}</small></button></th>`;
    }
    html += '</tr></thead><tbody>';
    for (const group of data.groups) {
      html += `<tr><th><button data-jv-group="${group}" ${pool.some(r => r.group === group) ? '' : 'disabled'} class="${state.type === 'group' && state.key === group ? 'is-active' : ''}" aria-label="${group} JV 跨日期对比">${group}</button></th>`;
      const standalone = group === 'n';
      for (const date of standalone ? data.dates.filter(d => d.standalone) : experimentDates) {
        const records = pool.filter(r => r.date === date.label && r.group === group);
        const span = standalone ? ' colspan="'+experimentDates.length+'"' : '';
        if (!records.length) { html += `<td${span} class="is-blank" aria-label="无JV数据">—</td>`; continue; }
        const curves = records.flatMap(r => r.curves);
        const points = new Set(curves.map(c => c.pointLabel)).size;
        const dark = curves.filter(c => c.mode === 'dark').length;
        const active = records.some(r => selectedIds.has(r.id));
        html += `<td${span}><button data-jv-cell="${date.label}_${group}" class="cell ${active ? 'is-active' : ''}" aria-pressed="${active}"><span class="jv-cell-number">${points}<small>点位</small></span><span class="cell-detail">暗 ${dark} · 光 ${curves.length-dark}</span></button></td>`;
      }
      html += '</tr>';
    }
    $('jv-matrix').innerHTML = html+'</tbody>';
  }
  function renderPicker() {
    const entries = available();
    const count = entries.filter(({ curve }) => !state.hidden.has(curve.id)).length;
    $('jv-curve-picker').hidden = state.view === 'svg';
    $('jv-picker-count').textContent = `${count} / ${entries.length}`;
    $('jv-show-curves').disabled = count === entries.length;
    $('jv-hide-curves').disabled = count === 0;
    const key = entries.map(({ curve }) => curve.id).join(',');
    const list = $('jv-picker-list');
    if (key !== pickerKey) {
      pickerKey = key;
      list.innerHTML = entries.map(({ record, curve }) => {
        const sample = (record.group === 'n' ? '' : record.experiment+' · ')+curve.label;
        return `<label><input type="checkbox" data-jv-curve="${curve.id}"><b class="swatch line-${curve.mode}" style="--curve-color:${curve.color}"></b><span>${esc(sample)}<small>${esc(record.measuredOn ? curve.measuredAt.replace('_', ' ') : batchLabel(record))}</small></span></label>`;
      }).join('') || '<span class="subtle">没有可选曲线</span>';
    }
    for (const checkbox of list.querySelectorAll('input')) checkbox.checked = !state.hidden.has(checkbox.dataset.jvCurve);
  }
  function traceData() {
    const normalized = state.normalized && state.view !== 'svg';
    const unit = normalized ? '（无量纲）' : ' A/cm²';
    if (state.view === 'mean') return model.means(visible(), normalized).map(row => ({
      x: row.x, y: model.displayY(row, state.scale), customdata: row.y,
      type: 'scatter', mode: 'lines', showlegend: true,
      name: recordLabel(row.record)+' '+capitalize(row.mode)+' (n='+row.deviceCount+')',
      line: { color: meanColors[allRecords.indexOf(row.record) % meanColors.length], dash: row.mode === 'light' ? 'dash' : 'solid', width: 2.2, simplify: false },
      hovertemplate: 'V = %{x:.3f} V<br>平均 '+(normalized ? '归一化 J' : 'J')+' = %{customdata:.5e}'+unit+'<extra>%{fullData.name}</extra>',
      meta: { record: row.record.id, measuredOn: row.record.measuredOn, mode: row.mode, deviceCount: row.deviceCount, pointCount: row.pointCount }
    }));
    const entries = visible();
    const buckets = new Map();
    for (const entry of entries) {
      const key = entry.record.id+'|'+entry.curve.deviceKey+'|'+entry.curve.mode;
      buckets.set(key, (buckets.get(key) || 0)+1);
    }
    const shown = new Set();
    return entries.map(({ record, curve }) => {
      const key = record.id+'|'+curve.deviceKey+'|'+curve.mode;
      const showlegend = !shown.has(key); shown.add(key);
      const name = (record.group !== 'n' && (state.type === 'all' || state.type === 'group') ? record.date+' ' : '')
        +curve.deviceLabel+' '+curve.modeLabel+(record.measuredOn ? ' · 11.24' : '')+' (n='+buckets.get(key)+')';
      const prepared = normalized ? model.normalizedCurve(curve) : curve;
      return { x: curve.x, y: model.displayY(prepared, state.scale), mode: 'lines', type: 'scatter', name,
        showlegend, legendgroup: key, line: { color: curve.color, dash: curve.mode === 'light' ? 'dash' : 'solid', width: 1.7, simplify: false },
        customdata: prepared.y,
        hovertemplate: `${record.group === 'n' ? '' : esc(record.date)+' · '}${esc(curve.label)}<br>${esc(curve.measuredAt)}<br>V = %{x:.3f} V<br>${normalized ? '归一化 J' : 'J'} = %{customdata:.5e}${unit}<extra></extra>`,
        meta: { record: record.id, curve: curve.id, measuredAt: curve.measuredAt, mode: curve.mode, device: curve.deviceKey, color: curve.color, sourcePoints: curve.x.length } };
    });
  }
  function layout(traces, exporting = false) {
    const mobile = innerWidth < 600;
    const many = traces.filter(t => t.showlegend).length > 12;
    const rawX = traces.flatMap(t => t.x);
    const rawY = traces.flatMap(t => t.y).filter(v => v !== null && Number.isFinite(v));
    const xRange = rawX.length ? [Math.min(...rawX), Math.max(...rawX)] : [-1, 1];
    const span = xRange[1]-xRange[0] || 1;
    xRange[0] -= span*.015; xRange[1] += span*.015;
    let yRange;
    if (state.scale === 'log') {
      const positive = rawY.filter(v => v > 0);
      yRange = positive.length ? [Math.floor(Math.log10(Math.min(...positive))), Math.ceil(Math.log10(Math.max(...positive)))] : [-12, -3];
    } else {
      const low = rawY.length ? Math.min(...rawY) : -1;
      const high = rawY.length ? Math.max(...rawY) : 1;
      const d = high-low || Math.max(Math.abs(high), 1e-6);
      yRange = [low-.06*d, high+.06*d];
    }
    const axis = { showline: true, mirror: true, linecolor: '#111111', linewidth: exporting ? 2.5 : 1.8,
      ticks: 'outside', tickcolor: '#111111', tickwidth: exporting ? 2.5 : 1.6, ticklen: exporting ? 10 : 6,
      tickfont: { size: exporting ? 21 : mobile ? 10 : 12, color: '#111111' },
      showgrid: true, gridcolor: 'rgba(17,17,17,0.10)', gridwidth: 1, automargin: true,
      zerolinecolor: 'rgba(17,17,17,0.45)', zerolinewidth: 1.2 };
    const legend = many ? { orientation: 'h', x: 0, y: -.24, xanchor: 'left', yanchor: 'top',
      font: { size: exporting ? 16 : mobile ? 8 : 10 }, entrywidth: exporting ? 380 : mobile ? 145 : 190 }
      : { x: .98, y: .03, xanchor: 'right', yanchor: 'bottom', bgcolor: 'rgba(255,255,255,0.85)', font: { size: exporting ? 19 : mobile ? 9 : 11 } };
    return { autosize: false, width: exporting ? 1800 : $('jv-plot-surface').clientWidth,
      height: exporting ? many ? 1320 : 1100 : $('jv-plot').clientHeight,
      margin: exporting ? { l: 155, r: 95, t: 115, b: many ? 300 : 130 }
        : { l: mobile ? 64 : 90, r: mobile ? 17 : 30, t: 25, b: many ? mobile ? 240 : 155 : 70 },
      paper_bgcolor: '#fff', plot_bgcolor: '#fff', hovermode: 'closest',
      font: { family: 'Arial, Microsoft YaHei UI, sans-serif', size: 13, color: '#111111' },
      title: exporting ? { text: '<b>'+esc(title()+(state.view === 'mean' ? ' · 平均值' : ''))+'</b>', x: .06, y: .97, font: { size: 32 } } : undefined,
      xaxis: { ...axis, range: xRange, dtick: .5, tickformat: '.1f', zeroline: true,
        title: { text: '<b>Voltage, V (V)</b>', standoff: 18, font: { size: exporting ? 25 : mobile ? 12 : 15 } } },
      yaxis: { ...axis, type: state.scale === 'log' ? 'log' : 'linear', range: yRange,
        dtick: state.scale === 'log' ? Math.max(1, Math.ceil((yRange[1]-yRange[0])/8)) : undefined,
        tickformat: state.scale === 'linear' ? '.1e' : undefined, exponentformat: 'power', zeroline: state.scale === 'linear',
        title: { text: state.normalized ? (state.scale === 'log' ? '<b>|J| / |J(−0.5 V)|</b>' : '<b>J / |J(−0.5 V)|</b>')
          : state.scale === 'log' ? '<b>|J| (A/cm²)</b>' : '<b>J (A/cm²)</b>', standoff: 12, font: { size: exporting ? 25 : mobile ? 12 : 15 } } },
      legend: { ...legend, borderwidth: 0, tracegroupgap: 1, itemwidth: exporting ? 54 : 32, itemclick: false, itemdoubleclick: false },
      annotations: traces.length ? [] : [{ x: .5, y: .5, xref: 'paper', yref: 'paper', showarrow: false,
        text: available().length ? '没有勾选曲线' : state.mode === 'light' ? '当前选择未提供 Light 曲线' : state.mode === 'dark' ? '当前选择未提供 Dark 曲线' : '没有可见曲线',
        font: { size: 14, color: '#697c81' } }],
      uirevision: JSON.stringify([state.type, state.key, state.source, state.view, state.scale, state.mode, state.normalized]) };
  }
  function number(value) { return value === null ? '—' : Math.abs(value).toExponential(2); }
  function renderStats() {
    $('jv-stats-title').textContent = state.view === 'mean' ? '分组平均' : '当前曲线';
    $('jv-stats-device').textContent = state.view === 'mean' ? '器件 / 点位数' : '器件';
    $('jv-unit-note').textContent = state.view === 'mean' ? '表格显示指定偏压下有符号平均 J 的绝对值（A/cm²）。' : '电流密度单位 A/cm²；表格仅列指定偏压，不对不同器件求均值。';
    if (state.view === 'mean') {
      const rows = model.means(visible());
      $('jv-stats').innerHTML = rows.map(row => `<tr><td>${esc(recordLabel(row.record))}</td><td class="jv-mode-${row.mode}">${capitalize(row.mode)}</td><td>${row.deviceCount} / ${row.pointCount}</td><td>${number(model.atVoltage(row, -.5))}</td><td>${number(model.atVoltage(row, .5))}</td></tr>`).join('')
        || '<tr><td colspan="5" class="subtle">没有可计算的曲线</td></tr>';
      $('jv-visible-count').textContent = rows.length+' 条组平均曲线';
      return;
    }
    const rows = visible();
    $('jv-stats').innerHTML = rows.length ? rows.map(({ record, curve }) => `<tr><td><span class="swatch" style="background:${curve.color}"></span>${esc(recordLabel(record))} ${esc(curve.pointLabel)}</td><td class="jv-mode-${curve.mode}">${curve.modeLabel}</td><td>${esc(curve.deviceLabel)}</td><td>${number(model.atVoltage(curve, -.5))}</td><td>${number(model.atVoltage(curve, .5))}</td></tr>`).join('')
      : '<tr><td colspan="5" class="subtle">没有可见曲线</td></tr>';
    $('jv-visible-count').textContent = `${rows.length} 条可见曲线`;
  }
  function sources() {
    $('jv-sources').innerHTML = selected().map(record => `<div class="source-item"><b>${esc(recordLabel(record))}</b>${record.assetSvg ? `<a href="${record.assetSvg}" download>同色 SVG</a><a href="${record.assetTxt}" download>TXT</a>` : ''}<div class="source-path">${esc(record.source)}</div></div>`).join('');
  }
  async function render() {
    const records = selected();
    if (state.view === 'svg' && !canUseSvg()) state.view = 'plot';
    renderMatrix(); sources(); renderPicker(); renderStats();
    for (const button of $('jv-batch').querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.jvBatch === state.source));
    }
    $('jv-original-data-status').textContent = state.source === 'original' ? '新建文件夹 (2)' : state.source === 'new' ? '2026-11-24 · Dark / Light' : '原 JV + 11.24 光暗 JV';
    $('jv-selection-title').textContent = title();
    $('jv-selection-meta').textContent = selectedTitle();
    $('jv-viewer-title').textContent = title();
    $('jv-category').textContent = state.type === 'cell' ? '单组 JV' : state.type === 'date' ? '同日变量对比' : state.type === 'group' ? '同变量跨日期对比' : '全部筛选 JV';
    const original = state.view === 'svg';
    const mean = state.view === 'mean';
    $('jv-view-mean').setAttribute('aria-pressed', String(mean));
    $('jv-export-csv-label').textContent = mean ? 'CSV 分组平均' : 'CSV 原始有符号数据';
    $('jv-view-svg').disabled = !canUseSvg();
    $('jv-view-svg').setAttribute('aria-pressed', String(original));
    $('jv-view-plot').setAttribute('aria-pressed', String(state.view === 'plot'));
    $('jv-mode').value = original ? 'both' : state.mode;
    $('jv-scale').value = state.scale;
    $('jv-normalization').value = state.normalized && !original ? 'normalized' : 'raw';
    $('jv-normalization').disabled = original;
    $('jv-mode').disabled = original; $('jv-scale').disabled = original; $('jv-reset').disabled = original;
    $('jv-original-surface').hidden = !original;
    $('jv-plot').hidden = original;
    $('jv-plot').classList.toggle('is-global', state.type === 'all');
    $('jv-error').hidden = true;
    const hasA = records.some(r => r.date === '9.15');
    $('jv-date-note').hidden = !hasA;
    $('jv-date-note').textContent = 'a 组源文件名为 9.20，已按你的确认归入 9.15；测量时间与源 TXT 不变。';
    const litScopes = new Set(records.filter(r => r.lightCount > 0).map(r => r.scopeId || r.id));
    const noLight = records.filter(r => !litScopes.has(r.scopeId || r.id));
    $('jv-notice').hidden = !noLight.length;
    if (noLight.length) $('jv-notice').textContent = noLight.length === records.length
      ? '当前选择只提供了 Dark 数据，没有对应 Light 曲线。'
      : `未提供 Light：${noLight.map(recordLabel).join('、')}。`;
    let traces = [];
    if (original) {
      $('jv-original-image').src = records[0].assetSvg;
      $('jv-original-image').alt = title()+' · 与 EQE 器件同色的 SVG';
      $('jv-caption').textContent = records[0].relativePath+' · 配色及线型已调整';
    } else {
      traces = traceData();
      await Plotly.react($('jv-plot'), traces, layout(traces), { responsive: true, displayModeBar: false });
      $('jv-caption').textContent = mean
        ? '仅用已勾选的实测曲线，按测量批次、实验日期、变量和光暗分组。同器件点位先平均，再对器件等权平均；只在共有电压范围内插值，先平均有符号 J。图例 n 为器件数。'
        : `全部采样点保留；Dark 实线、Light 虚线。${state.scale === 'log' ? '对数轴显示 |J|，零值留在原始数据中。' : '线性轴保留电流正负号。'}同色对应同日期的同一器件，不对光暗求平均。`;
      if (state.normalized) $('jv-caption').textContent += ' 每条曲线先除以自身 |J(−0.5 V)|；表格仍显示实测量纲。';
      if (state.type === 'date' && records.some(r => r.group === 'n')) {
        $('jv-caption').textContent += state.mode === 'light'
          ? ' n 仅有暗态数据，在 Light 筛选下不显示。' : ' n 为独立对照，仅有暗态数据，单独显示。';
      }
    }
    const hash = new URLSearchParams({ type: state.type, key: state.key, view: state.view, mode: state.mode, scale: state.scale });
    if (state.source !== 'original') hash.set('source', state.source);
    if (state.hidden.size) hash.set('hidden', [...state.hidden].join(','));
    if (state.normalized) hash.set('norm', 'ref');
    history.replaceState(null, '', '#'+hash.toString());
    document.querySelector('[data-eqe-link]').href = window.ReportNavigation.href('index.html', new URLSearchParams({ type: state.type, key: state.key, version: 'selected', view: state.type === 'cell' ? 'original' : 'comparison' }));
    for (const link of document.querySelectorAll('[data-metric-link]')) {
      link.href = window.ReportNavigation.href(link.dataset.metricLink+'.html', new URLSearchParams({ date: records[0].date, group: records[0].group }));
    }
    icons();
    window.JVApp.snapshot = { ...state, hidden: Array.from(state.hidden), records, traces };
  }
  function schedule() {
    ready = ready.then(render).catch(error => { $('jv-error').hidden = false; $('jv-error').textContent = error.message; console.error(error); });
    window.JVApp.ready = ready; return ready;
  }
  function select(type, key) {
    state.type = type;
    state.key = key;
    state.view = 'plot';
    return schedule();
  }
  function selectSource(source) {
    state.source = source;
    if (source === 'new') state.mode = 'both';
    if (!selected().length) {
      state.type = 'date';
      state.key = model.sourceRecords(data, source)[0].date;
    }
    return schedule();
  }
  function downloadUrl(url, filename) {
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  }
  function downloadBlob(blob, filename) { const url = URL.createObjectURL(blob); downloadUrl(url, filename); setTimeout(() => URL.revokeObjectURL(url), 60000); }
  async function exportFigure(format) {
    const normalized = state.normalized && state.view !== 'svg';
    const file = `JV_${state.type}_${state.key.replaceAll('.', '-')}_${state.source === 'original' ? '' : state.source+'_'}${state.mode}_${state.scale}`+(state.view === 'mean' ? '_mean' : '')+(normalized ? '_norm_m0p5V' : '');
    if (format === 'csv') {
      const mean = state.view === 'mean';
      const rows = mean ? [['date', 'group', 'mode', 'devices', 'point_curves', 'voltage_V', 'J_mean_A_cm2_signed', 'measurement_batch']]
        : [['date', 'group', 'native_label', 'display_label', 'device', 'point', 'mode', 'color_EQE', 'voltage_V', 'J_A_cm2_signed', 'display_y', 'source', 'measurement_batch', 'measured_at']];
      if (normalized) rows[0].push(...(mean ? ['J_normalized_mean_signed'] : ['normalization_abs_J_m0p5V_A_cm2', 'J_normalized_signed']));
      const scaledMeans = mean && normalized ? model.means(visible(), true) : [];
      if (mean) for (const [index, row] of model.means(visible()).entries()) {
        const scaled = scaledMeans[index];
        row.x.forEach((v, i) => rows.push([row.record.date, row.record.group, row.mode, row.deviceCount, row.pointCount, v, row.y[i], batchLabel(row.record), ...(scaled ? [scaled.y[i]] : [])]));
      }
      else for (const { record, curve } of visible()) {
        const scaled = normalized ? model.normalizedCurve(curve) : null;
        const y = model.displayY(scaled || curve, state.scale);
        curve.x.forEach((v, i) => rows.push([record.date, record.group, curve.nativeLabel, curve.label, curve.deviceLabel, curve.pointLabel, curve.mode, curve.eqeColorReference?.color, v, curve.y[i], y[i], record.relativePath, batchLabel(record), curve.measuredAt, ...(scaled ? [scaled.divisor, scaled.y[i]] : [])]));
      }
      const text = '\ufeff'+rows.map(row => row.map(v => '"'+String(v ?? '').replaceAll('"', '""')+'"').join(',')).join('\r\n');
      downloadBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }), file+'.csv'); return;
    }
    if (state.view === 'svg') {
      const svg = selected()[0].svgText;
      if (format === 'svg') { downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), file+'_同EQE配色.svg'); return; }
      const image = new Image(); image.src = 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg); await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 1800; canvas.height = 1100;
      const context = canvas.getContext('2d'); context.fillStyle = 'white'; context.fillRect(0, 0, 1800, 1100);
      const scale = Math.min(1800/image.naturalWidth, 1100/image.naturalHeight);
      context.drawImage(image, (1800-image.naturalWidth*scale)/2, (1100-image.naturalHeight*scale)/2, image.naturalWidth*scale, image.naturalHeight*scale);
      downloadBlob(await new Promise(resolve => canvas.toBlob(resolve, 'image/png')), file+'.png'); return;
    }
    const traces = traceData(); if (!traces.length) throw new Error('没有可导出的可见曲线');
    const div = document.createElement('div'); Object.assign(div.style, { position: 'fixed', left: '-10000px', top: '0', width: '1800px', height: '1100px' }); document.body.append(div);
    try {
      const settings = layout(traces, true);
      await Plotly.newPlot(div, traces, settings, { staticPlot: true });
      downloadUrl(await Plotly.toImage(div, { format, width: settings.width, height: settings.height }), file+'.'+format);
    } finally { Plotly.purge(div); div.remove(); }
  }
  // Capitalization is local to mode labels, without modifying built-in prototypes.
  const capitalize = mode => mode[0].toUpperCase()+mode.slice(1);
  function installLabels() {
    for (const record of allRecords) for (const curve of record.curves) curve.modeLabel = capitalize(curve.mode);
  }
  $('jv-matrix').addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    if (button.dataset.jvCell) select('cell', button.dataset.jvCell);
    if (button.dataset.jvDate) select('date', button.dataset.jvDate);
    if (button.dataset.jvGroup) select('group', button.dataset.jvGroup);
  });
  $('jv-batch').addEventListener('click', event => {
    const source = event.target.closest('button')?.dataset.jvBatch;
    if (source && source !== state.source) selectSource(source);
  });
  $('jv-all').addEventListener('click', () => select('all', 'all'));
  $('jv-view-plot').addEventListener('click', () => { state.view = 'plot'; schedule(); });
  $('jv-view-mean').addEventListener('click', () => { state.view = 'mean'; schedule(); });
  $('jv-view-svg').addEventListener('click', () => { state.view = 'svg'; schedule(); });
  $('jv-mode').addEventListener('change', event => { state.mode = event.target.value; schedule(); });
  $('jv-scale').addEventListener('change', event => { state.scale = event.target.value; schedule(); });
  $('jv-normalization').addEventListener('change', event => { state.normalized = event.target.value === 'normalized'; schedule(); });
  $('jv-picker-list').addEventListener('change', event => { const id = event.target.dataset.jvCurve; if (!id) return; if (event.target.checked) state.hidden.delete(id); else state.hidden.add(id); schedule(); });
  for (const [id, show] of [['jv-show-curves', true], ['jv-hide-curves', false]]) {
    $(id).addEventListener('click', () => {
      for (const { curve } of available()) show ? state.hidden.delete(curve.id) : state.hidden.add(curve.id);
      schedule();
    });
  }
  $('jv-reset').addEventListener('click', () => { const settings = layout(traceData()); Plotly.relayout($('jv-plot'), { 'xaxis.range': settings.xaxis.range, 'yaxis.range': settings.yaxis.range }); });
  $('jv-method').addEventListener('click', () => $('jv-method-dialog').showModal());
  $('jv-close-method').addEventListener('click', () => $('jv-method-dialog').close());
  $('jv-method-dialog').addEventListener('click', event => { if (event.target === $('jv-method-dialog')) $('jv-method-dialog').close(); });
  document.addEventListener('click', event => { if (!event.target.closest('.menu')) document.querySelectorAll('.menu[open]').forEach(menu => { menu.open = false; }); });
  document.querySelectorAll('[data-jv-export]').forEach(button => button.addEventListener('click', async () => {
    $('jv-export-menu').open = false; try { await ready; await exportFigure(button.dataset.jvExport); } catch (error) { toast(error.message); }
  }));
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (['plot', 'mean'].includes(state.view)) schedule(); }, 120); });
  $('jv-original-image').addEventListener('error', () => { $('jv-error').hidden = false; $('jv-error').textContent = 'SVG 无法读取。'; });
  const newCurveCount = data.newBatch.records.reduce((sum, r) => sum+r.curves.length, 0);
  $('jv-inventory').textContent = `原 JV ${data.counts.curves} 条 · 11.24 光暗 JV ${newCurveCount} 条`;
  $('jv-method-dialog').querySelector('dl').insertAdjacentHTML('beforeend', '<dt>11.24 光暗 JV</dt><dd>独立收录 c（10.12）和 e（10.17）在 2026-11-24 测量的 Dark 和 Light。相同点位光暗同色，分别用实线和虚线。实验日期与测量时间分别保留；已有对应的器件沿用 EQE 颜色，无对应时使用独立颜色。合看只叠加显示，原 JV 与新批次不混合求均值。交互图、平均图和导出均按逐条勾选结果处理；保存 SVG 只适用于原 JV。</dd>');
  const hash = new URLSearchParams(location.hash.slice(1));
  const source = hash.get('source');
  if (source === 'light' || source === 'new') state.source = 'new';
  else if (source === 'combined') state.source = source;
  if (['cell', 'date', 'group', 'all'].includes(hash.get('type')) && model.selection(data, hash.get('type'), hash.get('key'), state.source).length) {
    state.type = hash.get('type'); state.key = hash.get('key');
    const view = hash.get('view');
    state.view = state.type === 'cell' && view === 'svg' || view === 'mean' ? view : 'plot';
    state.mode = ['dark', 'light'].includes(hash.get('mode')) ? hash.get('mode') : 'both';
    state.scale = hash.get('scale') === 'linear' ? 'linear' : 'log';
    state.normalized = hash.get('norm') === 'ref';
  }
  if (!selected().length) { state.type = 'date'; state.key = data.newBatch.records[0].date; }
  for (const id of (hash.get('hidden') || '').split(',')) if (curveIds.has(id)) state.hidden.add(id);
  window.JVApp = { state, data, model, ready, select, traceData, layout, exportFigure, snapshot: null };
  installLabels(); icons(); schedule();
})();
