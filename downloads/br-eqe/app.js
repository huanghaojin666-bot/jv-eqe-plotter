(function () {
  'use strict';
  const data = window.EQE_DATA;
  const model = window.EQEModel;
  const $ = id => document.getElementById(id);
  const colors = { f: '#D62728', '5': '#FF7F0E', '10': '#2CA02C', '20': '#1F77B4', DMF: '#9467BD', n: '#343434' };
  const dateColors = { '9.15': '#D62728', '9.20': '#1F77B4', '10.12': '#2CA02C', '10.17': '#9467BD' };
  const dashes = ['solid', 'dash', 'dot', 'dashdot'];
  const state = { type: 'cell', key: '9.15_f', version: 'selected', view: 'original',
    normalized: true, fullRange: false, individual: true, peaks: false, pooled: false, hidden: new Set() };
  let generation = 0;
  let ready = Promise.resolve();
  let toastTimer;
  function esc(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
  function fmt(value) { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
  function icons() { window.lucide.createIcons(); }
  function selectedCells() { return model.selection(data, state.type, state.key); }
  function resolved() { return selectedCells().map(cell => model.resolve(cell, state.version)); }
  function colorFor(cell) { return state.type === 'group' ? dateColors[cell.date] : colors[cell.group]; }
  function dashFor(cell) { return state.type === 'all' ? dashes[data.dates.findIndex(d => d.label === cell.date)] : 'solid'; }
  function versionLabel(entry) { return entry.ownAll ? 'all' : entry.fallback ? '同筛选' : '筛选'; }
  function title() {
    if (state.type === 'date') return state.key + ' · 各变量对比';
    if (state.type === 'group') return state.key + ' · 跨日期对比';
    if (state.type === 'all') return '全部日期 · 集总对比';
    const cell = selectedCells()[0];
    return cell.date + ' · ' + cell.group;
  }
  function setPressed(id, value) { $(id).setAttribute('aria-pressed', String(value)); }
  function notify(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3600);
  }
  function syncHash() {
    const params = new URLSearchParams({ type: state.type, key: state.key, version: state.version, view: state.view });
    history.replaceState(null, '', '#' + params.toString());
  }
  function restoreHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    const type = params.get('type');
    const key = params.get('key');
    if (['cell', 'date', 'group', 'all'].includes(type) && model.selection(data, type, key).length) {
      state.type = type; state.key = key;
      state.version = params.get('version') === 'all' ? 'all' : 'selected';
      state.view = type === 'cell' && params.get('view') !== 'comparison' ? 'original' : 'comparison';
    }
  }
  function renderMatrix() {
    const chosen = new Set(selectedCells().map(c => c.id));
    let html = '<thead><tr><th>变量 / 日期</th>';
    for (const date of data.dates) {
      const active = state.type === 'date' && state.key === date.label;
      html += `<th><button type="button" data-date="${date.label}" class="${active ? 'is-active' : ''}" aria-label="${date.label}，各变量对比"><span>${date.label}</span><small>实验 ${date.experiment}</small></button></th>`;
    }
    html += '</tr></thead><tbody>';
    for (const group of data.groups) {
      if (group === 'n') {
        html += `<tr><th class="reference-th">n</th><td colspan="${data.dates.length}" class="reference-cell">1300 <small>nm · 参考值，无关联曲线</small></td></tr>`;
        continue;
      }
      html += `<tr><th><button type="button" data-group="${group}" class="${state.type === 'group' && state.key === group ? 'is-active' : ''}" aria-label="${group}，跨日期对比">${group}</button></th>`;
      for (const date of data.dates) {
        const cell = data.cells.find(c => c.date === date.label && c.group === group);
        if (!cell) { html += '<td class="is-blank" aria-label="无数据">—</td>'; continue; }
        const entry = model.resolve(cell, state.version);
        const stats = model.stats(entry.record.curves, data.peakRange);
        const unitLabel = entry.ownAll ? ' · all' : entry.fallback ? ' · 同筛选' : '';
        html += `<td><button type="button" data-cell="${esc(cell.id)}" class="cell ${chosen.has(cell.id) ? 'is-active' : ''}" aria-pressed="${chosen.has(cell.id)}" title="${date.label} ${group} · ${stats.n} 条 · ${versionLabel(entry)}"><span class="peak-value">${fmt(stats.mean)}<em>nm</em></span><span class="cell-detail">${stats.n} 条${unitLabel}</span>${cell.all ? '<b class="all-marker" aria-hidden="true"></b>' : ''}</button></td>`;
      }
      html += '</tr>';
    }
    $('matrix').innerHTML = html + '</tbody>';
  }
  function buildSeries() {
    const entries = resolved();
    return entries.map(entry => {
      const curves = entry.record.curves.map(c => model.prepared(c, state.normalized, data.peakRange));
      const mean = model.average(curves);
      return { ...entry, curves, mean, stats: model.stats(entry.record.curves, data.peakRange),
        meanPeak: model.peak(mean, data.peakRange), color: colorFor(entry.cell), dash: dashFor(entry.cell) };
    });
  }
  function traceData(series) {
    const traces = [];
    for (const entry of series) {
      if (state.hidden.has(entry.cell.id)) continue;
      let name = state.type === 'date' ? entry.cell.group : state.type === 'group' ? entry.cell.date : `${entry.cell.date} ${entry.cell.group}`;
      if (state.version === 'all') name += entry.ownAll ? ' [all]' : ' [同筛选]';
      name += ` (n=${entry.stats.n})`;
      if (state.individual) {
        for (const curve of entry.curves) {
          traces.push({ x: curve.x, y: curve.y, type: 'scatter', mode: 'lines',
            name: curve.name, legendgroup: entry.cell.id, showlegend: false,
            line: { color: entry.color, width: 1, dash: entry.dash, simplify: false }, opacity: .23,
            hovertemplate: `${esc(entry.cell.date)} ${esc(entry.cell.group)} · ${esc(curve.name)}<br>%{x:.0f} nm<br>%{y:.4f}<extra></extra>`,
            meta: { kind: 'individual', cellId: entry.cell.id, version: entry.record.version } });
        }
      }
      traces.push({ x: entry.mean.x, y: entry.mean.y, type: 'scatter', mode: 'lines',
        name, legendgroup: entry.cell.id, line: { color: entry.color, width: 2.5, dash: entry.dash, simplify: false },
        hovertemplate: `${esc(entry.cell.date)} ${esc(entry.cell.group)} · 均值<br>%{x:.0f} nm<br>%{y:.4f}<extra></extra>`,
        meta: { kind: 'mean', cellId: entry.cell.id, version: entry.record.version, meanIndividualPeakNm: entry.stats.mean } });
      if (state.peaks) {
        const index = entry.mean.x.findIndex(x => x >= entry.stats.mean);
        const i = Math.max(0, index);
        traces.push({ x: [entry.stats.mean], y: [entry.mean.y[i]], mode: 'markers+text',
          type: 'scatter', showlegend: false, marker: { color: entry.color, size: 6, symbol: 'diamond-open' },
          text: [fmt(entry.stats.mean)+' nm'], textposition: 'top center', textfont: { size: 11, color: entry.color },
          hovertemplate: '各曲线峰位均值：%{x:.1f} nm<extra></extra>', meta: { kind: 'mean-peak-position' } });
      }
    }
    if (state.pooled) {
      const visible = series.filter(e => !state.hidden.has(e.cell.id));
      if (visible.length) {
        const allCurves = visible.flatMap(e => e.curves);
        const pooled = model.average(allCurves);
        traces.push({ ...pooled, mode: 'lines', type: 'scatter', name: `集总均值 (n=${allCurves.length})`,
          line: { color: '#161616', width: 3.2, simplify: false }, meta: { kind: 'pooled', sampleCount: allCurves.length } });
      }
    }
    return traces;
  }
  function layout(traces, exportMode = false) {
    const mobile = window.innerWidth < 600;
    const range = state.fullRange
      ? [Math.min(...traces.flatMap(t => t.x)), Math.max(...traces.flatMap(t => t.x))] : data.peakRange.slice();
    if (!range.every(Number.isFinite)) { range[0] = 980; range[1] = 1450; }
    const values = traces.flatMap(t => t.y.filter((y, i) => t.x[i] >= range[0] && t.x[i] <= range[1]));
    const low = values.length ? Math.min(0, ...values) : 0;
    const high = values.length ? Math.max(...values) : 1;
    const axis = { showline: true, mirror: true, linecolor: '#111111', linewidth: exportMode ? 2.5 : 1.8,
      ticks: 'outside', tickcolor: '#111111', tickwidth: exportMode ? 2.5 : 1.6, ticklen: exportMode ? 10 : 6,
      tickfont: { size: exportMode ? 21 : mobile ? 10 : 12, color: '#111111' }, showgrid: true,
      gridcolor: 'rgba(17,17,17,0.10)', gridwidth: 1, zeroline: false, automargin: true };
    return { autosize: false,
      width: exportMode ? 1800 : $('plot-surface').clientWidth,
      height: exportMode ? 1100 : $('plot').clientHeight,
      margin: exportMode ? { l: 155, r: 95, t: 115, b: 130 } : { l: mobile ? 56 : 77, r: mobile ? 18 : 28, t: 25, b: 70 },
      paper_bgcolor: '#ffffff', plot_bgcolor: '#ffffff',
      font: { family: 'Arial, Microsoft YaHei UI, sans-serif', size: 13, color: '#111111' },
      title: exportMode ? { text: '<b>'+esc(title())+'</b>', x: .06, y: .97,
        font: { size: 32, family: 'Arial, Microsoft YaHei UI, sans-serif', color: '#111111' } } : undefined,
      xaxis: { ...axis, range, dtick: state.fullRange ? 200 : 100,
        title: { text: '<b>Wavelength, λ (nm)</b>', standoff: 18, font: { size: exportMode ? 25 : mobile ? 12 : 15 } } },
      yaxis: { ...axis, range: [low - (low < 0 ? .03*(high-low) : 0), high*1.12],
        title: { text: state.normalized ? '<b>Normalized EQE</b>' : '<b>EQE (%)</b>', standoff: 12, font: { size: exportMode ? 25 : mobile ? 12 : 15 } } },
      showlegend: true, legend: { x: .98, y: .98, xanchor: 'right', yanchor: 'top', bgcolor: 'rgba(255,255,255,0.85)', borderwidth: 0,
        itemwidth: exportMode ? 54 : 32, font: { size: exportMode ? traces.filter(t => t.meta?.kind === 'mean').length > 8 ? 15 : 19 : mobile ? 9 : 11 },
        tracegroupgap: 1 }, hovermode: 'closest', uirevision: JSON.stringify([state.type, state.key, state.version, state.normalized, state.fullRange]) };
  }
  function sourceList(entries) {
    $('source-list').innerHTML = entries.map(e => `<div class="source-item"><b>${esc(e.cell.date)} · ${esc(e.cell.group)} · ${versionLabel(e)}</b><a href="${e.record.assetSvg}" target="_blank" rel="noopener">SVG</a><a href="${e.record.assetTxt}" download>TXT</a><div class="source-path">${esc(e.record.source)}</div></div>`).join('');
  }
  function renderStats(series) {
    $('stats-body').innerHTML = series.map(entry => `<tr><td><label><input type="checkbox" data-series="${entry.cell.id}" ${state.hidden.has(entry.cell.id) ? '' : 'checked'} ${state.view === 'original' ? 'disabled' : ''} aria-label="显示 ${entry.cell.date} ${entry.cell.group}"><span class="swatch" style="background:${entry.color}"></span>${entry.cell.date} · ${entry.cell.group}</label></td><td><span class="version-tag ${entry.ownAll ? 'is-all' : ''}">${versionLabel(entry)}</span></td><td>${entry.stats.n}</td><td title="手记：${entry.cell.handwrittenNm ?? '—'} nm">${fmt(entry.stats.mean)}${entry.stats.sd === null ? '' : ' ± '+fmt(entry.stats.sd)}</td><td>${fmt(entry.meanPeak.x)}</td></tr>`).join('');
  }
  async function render() {
    const token = ++generation;
    let entries = resolved();
    const allCount = entries.filter(e => !!e.cell.all).length;
    if (state.version === 'all' && !allCount) { state.version = 'selected'; entries = resolved(); }
    if (state.type !== 'cell') state.view = 'comparison';
    const series = buildSeries();
    const n = series.reduce((s, e) => s+e.stats.n, 0);
    renderMatrix();
    setPressed('version-selected', state.version === 'selected');
    setPressed('version-all', state.version === 'all');
    $('version-all').disabled = !allCount;
    $('version-all').title = allCount ? `${allCount} 组另有 all 版本` : '当前选择没有另存 all 文件';
    $('show-original').disabled = state.type !== 'cell';
    setPressed('show-original', state.view === 'original');
    setPressed('show-comparison', state.view === 'comparison');
    const original = state.view === 'original';
    $('scale-mode').disabled = original;
    $('range-mode').disabled = original;
    $('show-individual').disabled = original;
    $('show-peaks').disabled = original;
    $('show-pooled').disabled = original;
    $('reset-axes').disabled = original;
    $('selection-label').textContent = title();
    $('selection-meta').textContent = `${series.length} 组 · ${n} 条曲线 · ${state.version === 'all' ? 'all 对比版本' : '筛选数据'}`;
    $('viewer-title').textContent = title();
    $('view-category').textContent = state.type === 'cell' ? '单组数据' : state.type === 'date' ? '同日变量对比' : state.type === 'group' ? '同变量跨日期对比' : '集总曲线';
    $('all-groups').classList.toggle('is-active', state.type === 'all');
    $('original-surface').hidden = !original;
    $('plot').hidden = original;
    $('chart-error').hidden = true;
    const notice = $('version-notice');
    notice.hidden = state.version !== 'all';
    if (!notice.hidden) {
      const fallback = series.filter(e => e.fallback).map(e => `${e.cell.date} ${e.cell.group}`);
      notice.textContent = `all：${allCount} 组使用独立 all 文件` + (fallback.length ? `；${fallback.join('、')} 未另存 all，沿用筛选数据。` : '。');
    }
    renderStats(series);
    sourceList(series);
    $('source-download').hidden = series.length !== 1;
    if (series.length === 1) { $('source-download').href = series[0].record.assetTxt; }
    if (original) {
      $('original-image').src = series[0].record.assetSvg;
      $('original-image').alt = `${title()} · ${versionLabel(series[0])} · 保存的 SVG 原图`;
      $('plot-caption').textContent = series[0].record.relativePath;
    } else {
      $('plot-caption').textContent = state.normalized
        ? `浅线：单条 EQE / 自身近红外最大值；粗线：逐波长均值。峰位区间 980–1450 nm。${state.pooled ? '黑线：当前单条曲线等权集总均值。' : ''}`
        : '浅线：单条原始 EQE；粗线：逐波长均值。峰位区间 980–1450 nm。';
      const traces = traceData(series);
      if (token !== generation) return;
      await Plotly.react($('plot'), traces, layout(traces), { responsive: true, displayModeBar: false, scrollZoom: false });
    }
    syncHash();
    const jvLink = document.querySelector('[data-jv-link]');
    if (jvLink) jvLink.href = 'jv.html#'+new URLSearchParams({ type: state.type, key: state.key });
    const contextCell = selectedCells()[0];
    for (const link of document.querySelectorAll('[data-metric-link]')) {
      link.href = link.dataset.metricLink+'.html#'+new URLSearchParams({ date: contextCell.date, group: contextCell.group });
    }
    icons();
    window.EQEApp.snapshot = { ...state, hidden: Array.from(state.hidden), series, traces: original ? [] : traceData(series) };
  }
  function schedule() {
    ready = ready.then(render).catch(error => {
      $('chart-error').hidden = false;
      $('chart-error').textContent = error.message;
      console.error(error);
    });
    window.EQEApp.ready = ready;
    return ready;
  }
  function select(type, key) {
    state.type = type; state.key = key; state.view = type === 'cell' ? 'original' : 'comparison';
    state.hidden.clear();
    return schedule();
  }
  function downloadUrl(url, filename) {
    const link = document.createElement('a'); link.href = url; link.download = filename;
    document.body.append(link); link.click(); link.remove();
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob); downloadUrl(url, filename); setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function filename() { return `EQE_${state.type}_${state.key.replaceAll('.', '-')}_${state.version}`; }
  function csvCell(value) { return '"'+String(value ?? '').replaceAll('"', '""')+'"'; }
  function csvData(series) {
    const rows = [['date', 'group', 'version', 'series', 'curve', 'wavelength_nm', 'EQE_percent', 'display_y', 'individual_peak_nm', 'mean_individual_peak_nm', 'mean_curve_peak_nm']];
    for (const entry of series) {
      if (state.hidden.has(entry.cell.id)) continue;
      for (let n = 0; n < entry.record.curves.length; n++) {
        const raw = entry.record.curves[n]; const prepared = entry.curves[n];
        raw.x.forEach((x, i) => rows.push([entry.cell.date, entry.cell.group, entry.record.version, 'individual', raw.name, x, raw.y[i], prepared.y[i], entry.stats.peaks[n].x, entry.stats.mean, entry.meanPeak.x]));
      }
      entry.mean.x.forEach((x, i) => rows.push([entry.cell.date, entry.cell.group, entry.record.version, 'group_mean', '', x, '', entry.mean.y[i], '', entry.stats.mean, entry.meanPeak.x]));
    }
    return '\ufeff'+rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  }
  async function exportFigure(format) {
    const series = buildSeries();
    const base = filename();
    if (format === 'csv') { downloadBlob(new Blob([csvData(series)], { type: 'text/csv;charset=utf-8' }), base+'.csv'); return; }
    if (state.view === 'original') {
      const svg = series[0].record.svgText;
      if (format === 'svg') { downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), base+'_原图.svg'); return; }
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
      await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = 1800; canvas.height = 1100;
      const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, 1800, 1100);
      const scale = Math.min(1800 / img.naturalWidth, 1100 / img.naturalHeight);
      const w = img.naturalWidth*scale; const h = img.naturalHeight*scale;
      context.drawImage(img, (1800-w)/2, (1100-h)/2, w, h);
      downloadBlob(await new Promise(resolve => canvas.toBlob(resolve, 'image/png')), base+'_原图.png');
      return;
    }
    const traces = traceData(series);
    if (!traces.length) throw new Error('请至少保留一组可见曲线');
    const container = document.createElement('div');
    Object.assign(container.style, { position: 'fixed', left: '-10000px', top: '0', width: '1800px', height: '1100px' });
    document.body.append(container);
    try {
      await Plotly.newPlot(container, traces, layout(traces, true), { staticPlot: true });
      const url = await Plotly.toImage(container, { format, width: 1800, height: 1100 });
      downloadUrl(url, base+'.'+format);
    } finally { Plotly.purge(container); container.remove(); }
  }
  $('matrix').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.cell) select('cell', button.dataset.cell);
    if (button.dataset.date) select('date', button.dataset.date);
    if (button.dataset.group) select('group', button.dataset.group);
  });
  $('all-groups').addEventListener('click', () => select('all', 'all'));
  $('version-selected').addEventListener('click', () => { state.version = 'selected'; state.hidden.clear(); schedule(); });
  $('version-all').addEventListener('click', () => { state.version = 'all'; state.hidden.clear(); schedule(); });
  $('show-original').addEventListener('click', () => { state.view = 'original'; schedule(); });
  $('show-comparison').addEventListener('click', () => { state.view = 'comparison'; schedule(); });
  $('scale-mode').addEventListener('change', event => { state.normalized = event.target.value === 'normalized'; schedule(); });
  $('range-mode').addEventListener('change', event => { state.fullRange = event.target.value === 'full'; schedule(); });
  for (const [id, key] of [['show-individual', 'individual'], ['show-peaks', 'peaks'], ['show-pooled', 'pooled']]) {
    $(id).addEventListener('change', event => { state[key] = event.target.checked; schedule(); });
  }
  $('stats-body').addEventListener('change', event => {
    const id = event.target.dataset.series;
    if (!id) return;
    if (event.target.checked) state.hidden.delete(id); else state.hidden.add(id);
    schedule();
  });
  $('reset-axes').addEventListener('click', () => {
    const traces = traceData(buildSeries());
    Plotly.relayout($('plot'), { 'xaxis.range': layout(traces).xaxis.range, 'yaxis.range': layout(traces).yaxis.range });
  });
  $('method-button').addEventListener('click', () => $('method-dialog').showModal());
  $('close-method').addEventListener('click', () => $('method-dialog').close());
  $('method-dialog').addEventListener('click', event => { if (event.target === $('method-dialog')) $('method-dialog').close(); });
  document.addEventListener('click', event => {
    if (!event.target.closest('.menu')) document.querySelectorAll('.menu[open]').forEach(menu => { menu.open = false; });
  });
  document.querySelectorAll('[data-export]').forEach(button => button.addEventListener('click', async () => {
    $('export-menu').open = false;
    try { await ready; await exportFigure(button.dataset.export); }
    catch (error) { notify('导出失败：'+error.message); }
  }));
  $('original-image').addEventListener('error', () => { $('chart-error').hidden = false; $('chart-error').textContent = '原图无法读取，请保留 assets 文件夹与页面在同一目录。'; });
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.view === 'comparison') schedule(); }, 120);
  });
  $('inventory').textContent = `${data.dates.length} 个日期 · ${data.counts.cells} 组 · ${data.counts.selectedCurves} 条筛选曲线`;
  window.EQEApp = { state, data, model, select, exportFigure, buildSeries, traceData, layout, ready, snapshot: null };
  restoreHash();
  icons();
  schedule();
})();
