(function () {
  'use strict';
  const kind = document.body.dataset.metric;
  const data = window.METRICS_DATA[kind];
  const $ = id => document.getElementById(id);
  const categoryLabels = { individual: '单器件', comparison: '组内对比', detail: '高频放大' };
  const dates = [{ label: '9.15', experiment: 'a' }, { label: '9.20', experiment: 'b' },
    { label: '10.12', experiment: 'c' }, { label: '10.17', experiment: 'e' }];
  const groups = ['f', '5', '10', '20', 'DMF'];
  const state = { type: 'cell', key: data.records[0].id, id: data.records[0].id, format: 'svg', zoom: 1 };
  let ready = Promise.resolve();
  let drag = null;
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
  function current() { return data.records.find(r => r.id === state.id); }
  function selected() {
    if (state.type === 'all') return data.records.filter(r => r.category === 'comparison');
    if (state.type === 'group') return data.records.filter(r => r.category === 'individual' && r.group === state.key);
    return [current()];
  }
  function metricLabel(record) {
    if (record.category !== 'individual') return `${record.members.length} 个器件`;
    if (kind === 'bandwidth') return record.metadata.bandwidthKHz.toFixed(1)+' kHz';
    return '80 dB span';
  }
  function fullTitle(record) { return `${record.experiment} · ${record.date} · ${record.title}`; }
  function title() {
    if (state.type === 'all') return data.label+' · 全部实验对比';
    if (state.type === 'group') return state.key+' · '+data.label+' · 跨日期对比';
    return fullTitle(current());
  }
  function renderMatrix() {
    const active = new Set(selected().flatMap(r => r.category === 'individual' ? [r.id]
      : data.records.filter(s => s.category === 'individual' && s.date === r.date).map(s => s.id)));
    let html = '<thead><tr><th>变量 / 日期</th>';
    for (const date of dates) {
      const comparison = data.records.find(r => r.date === date.label && r.category === 'comparison');
      html += `<th><button data-metric-date="${date.label}" ${comparison ? '' : 'disabled'} class="${state.type === 'date' && state.key === date.label ? 'is-active' : ''}" aria-label="${date.label} ${data.label}组内对比"><span>${date.label}</span><small>实验 ${date.experiment}</small></button></th>`;
    }
    html += '</tr></thead><tbody>';
    for (const group of groups) {
      html += `<tr><th scope="row"><button data-metric-group="${group}" class="${state.type === 'group' && state.key === group ? 'is-active' : ''}" aria-label="${group} ${data.label}跨日期对比">${group}</button></th>`;
      for (const date of dates) {
        const record = data.records.find(r => r.date === date.label && r.group === group && r.category === 'individual');
        if (!record) { html += '<td class="is-blank" aria-label="无数据">—</td>'; continue; }
        const value = kind === 'bandwidth' ? record.metadata.bandwidthKHz.toFixed(1) : esc(record.point);
        const detail = kind === 'bandwidth' ? esc(record.point) : 'OD1–OD5';
        html += `<td><button data-metric-cell="${record.id}" class="cell ${active.has(record.id) ? 'is-active' : ''}" aria-pressed="${active.has(record.id)}" title="${fullTitle(record)} · ${metricLabel(record)}"><span class="peak-value">${value}</span><span class="cell-detail"><b class="color-chip" style="background:${record.color}"></b>${detail}</span></button></td>`;
      }
      html += '</tr>';
    }
    $('matrix').innerHTML = html+'</tbody>';
    $('metric-all').setAttribute('aria-pressed', String(state.type === 'all'));
    const detail = data.records.some(r => r.category === 'detail' && r.date === current().date);
    $('metric-date-views').hidden = state.type !== 'date' || !detail;
    document.querySelectorAll('[data-date-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.dateView === current().category)));
  }
  function metadata(record) {
    if (record.category === 'individual') {
      const facts = kind === 'bandwidth'
        ? [['−3 dB 带宽', record.metadata.bandwidthKHz.toFixed(1)+' kHz'], ['归一化参考', 'A(0.1 Hz) = 1']]
        : [['比较区间', 'OD1–OD5'], ['光功率跨度', '80 dB（span）'], ['偏压', '0 V'], ['幂律斜率 α', record.metadata.slope.toFixed(4)]];
      $('gallery-metadata').innerHTML = '<dl class="gallery-facts">'+facts.map(([name, value]) => `<div><dt>${name}</dt><dd>${value}</dd></div>`).join('')+`<div><dt>EQE / JV 器件颜色</dt><dd><span class="color-chip" style="background:${record.color}"></span>${record.color}</dd></div></dl>`;
    } else {
      $('gallery-metadata').innerHTML = '<table class="gallery-members"><thead><tr><th>器件</th><th>'+(kind === 'bandwidth' ? '带宽 / kHz' : 'OD1–OD5 斜率 α')+'</th></tr></thead><tbody>'
        +record.members.map(member => `<tr><td>${esc(member.deviceLabel)}</td><td>${kind === 'bandwidth' ? member.metadata.bandwidthKHz.toFixed(1) : member.metadata.slope.toFixed(4)}</td></tr>`).join('')+'</tbody></table>';
    }
  }
  function zoom(value) {
    state.zoom = Math.max(.5, Math.min(3, value));
    $('zoom-label').textContent = Math.round(state.zoom*100)+'%';
    const image = $('gallery-image');
    const frame = $('gallery-image-frame');
    const width = image.naturalWidth || current().width;
    const height = image.naturalHeight || current().height;
    const fit = Math.min(frame.clientWidth/width, frame.clientHeight/height);
    const renderedWidth = width*fit*state.zoom;
    const renderedHeight = height*fit*state.zoom;
    image.style.width = renderedWidth+'px';
    image.style.height = renderedHeight+'px';
    image.style.maxWidth = 'none';
    $('gallery-image-stage').style.width = Math.max(frame.clientWidth, renderedWidth)+'px';
    $('gallery-image-stage').style.height = Math.max(frame.clientHeight, renderedHeight)+'px';
    $('zoom-out').disabled = state.zoom <= .5;
    $('zoom-in').disabled = state.zoom >= 3;
    if (state.zoom === 1) { $('gallery-image-frame').scrollLeft = 0; $('gallery-image-frame').scrollTop = 0; }
  }
  async function render() {
    const record = current();
    const records = selected();
    const multiple = records.length > 1;
    renderMatrix();
    if (multiple) {
      $('gallery-metadata').innerHTML = '<table class="gallery-members"><thead><tr><th>日期 / 器件</th><th>'+(kind === 'bandwidth' ? '带宽 / kHz' : 'OD1–OD5 斜率 α')+'</th></tr></thead><tbody>'
        +records.flatMap(r => r.category === 'individual' ? [r] : r.members.map(m => ({ ...m, date: r.date })))
          .map(r => `<tr><td>${esc(r.date)} · ${esc(r.deviceLabel)}</td><td>${kind === 'bandwidth' ? r.metadata.bandwidthKHz.toFixed(1) : r.metadata.slope.toFixed(4)}</td></tr>`).join('')+'</tbody></table>';
    } else metadata(records[0]);
    $('gallery-selection').textContent = title();
    $('gallery-selection-meta').textContent = state.type === 'all' || state.type === 'group'
      ? `${records.length} 张原图 · ${state.type === 'group' ? '与 EQE / JV 器件同色' : '原组内对比图'}`
      : `${categoryLabels[record.category]} · ${metricLabel(record)} · ${record.recolored ? '与 EQE / JV 器件同色' : '原对比配色'}`;
    $('gallery-viewer-title').textContent = title();
    $('gallery-category').textContent = data.label+' · '+(state.type === 'all' ? '集总对比' : state.type === 'group' ? '变量对比' : categoryLabels[record.category]);
    $('gallery-source').textContent = records.map(r => r.sourceSvg).join('\n');
    $('gallery-caption').textContent = multiple ? '各图为本次提供的 Origin 图片，未合并拟合或重算。' : record.recolored
      ? 'Origin 图片仅统一器件颜色；曲线路径、坐标、数值及标注未重算。'
      : 'Origin 组内对比图，保留你这次更新的原始配色与标注。';
    $('format-svg').setAttribute('aria-pressed', String(state.format === 'svg'));
    $('format-png').setAttribute('aria-pressed', String(state.format === 'png'));
    $('gallery-download-png').href = records[0].assetPng;
    $('gallery-download-svg').href = records[0].assetSvg;
    $('gallery-download-png').hidden = multiple;
    $('gallery-download-svg').hidden = multiple;
    const reference = new URLSearchParams({ type: state.type, key: state.type === 'cell' ? record.date+'_'+record.group : state.key });
    document.querySelector('[data-eqe-gallery-link]').href = 'index.html#'+reference.toString();
    document.querySelector('[data-jv-gallery-link]').href = 'jv.html#'+reference.toString();
    document.querySelector('[data-other-metric]').href = document.querySelector('[data-other-metric]').dataset.otherMetric+'.html#'
      +new URLSearchParams(state.type === 'group' || state.type === 'all' ? { type: state.type, key: state.key }
        : { date: record.date, group: record.group || '', category: record.category === 'individual' ? 'individual' : 'comparison' });
    const image = $('gallery-image');
    $('gallery-error').hidden = true;
    $('gallery-image-frame').hidden = multiple;
    $('metric-comparison').hidden = !multiple;
    document.querySelector('.gallery-tools').hidden = multiple;
    if (multiple) {
      $('metric-comparison').innerHTML = records.map(r => `<section class="metric-comparison-item"><header><h3>${esc(fullTitle(r))}</h3><a class="icon-button" href="${state.format === 'svg' ? r.assetSvg : r.assetPng}" download title="下载${state.format.toUpperCase()}图片" aria-label="下载${esc(fullTitle(r))}"><i data-lucide="download"></i></a></header><img src="${state.format === 'svg' ? r.assetSvg : r.assetPng}" alt="${esc(fullTitle(r))}"></section>`).join('');
      await Promise.all(Array.from($('metric-comparison').querySelectorAll('img'), img => img.decode()));
    } else {
      $('metric-comparison').replaceChildren();
      image.alt = fullTitle(records[0])+' · '+data.label+' · '+(records[0].recolored ? 'EQE/JV 同器件颜色' : '组内对比');
      image.src = state.format === 'svg' ? records[0].assetSvg : records[0].assetPng;
      await image.decode();
      zoom(state.zoom);
    }
    history.replaceState(null, '', '#'+new URLSearchParams({ type: state.type, key: state.key, asset: record.id, format: state.format }));
    window.lucide.createIcons();
    window.MetricGallery.snapshot = { ...state, record: records[0], visibleRecords: records };
  }
  function schedule() {
    ready = ready.then(render).catch(error => { $('gallery-error').hidden = false; $('gallery-error').textContent = '图片无法载入：'+error.message; console.error(error); });
    window.MetricGallery.ready = ready; return ready;
  }
  function select(id) {
    const record = data.records.find(r => r.id === id); if (!record) return;
    state.id = id; state.type = record.category === 'individual' ? 'cell' : 'date';
    state.key = state.type === 'cell' ? id : record.date; state.zoom = 1;
    return schedule();
  }
  function selectScope(type, key) {
    const rows = data.records.filter(r => type === 'all' ? r.category === 'comparison'
      : r.category === 'individual' && r.group === key);
    if (!rows.length) return;
    state.type = type; state.key = key || ''; state.id = rows[0].id; state.zoom = 1;
    return schedule();
  }
  $('gallery-title').textContent = data.label;
  $('gallery-version').textContent = data.version;
  $('gallery-inventory').textContent = `${data.records.filter(r => r.category === 'individual').length} 个器件 · ${data.records.length} 张图`;
  $('gallery-bundle').href = data.bundle;
  $('gallery-download-bundle').href = data.bundle;
  if (kind === 'ldr') { $('gallery-notice').hidden = false; $('gallery-notice').textContent = data.spanNote; }
  $('gallery-method-content').innerHTML = `<dl><dt>当前数据版本</dt><dd>${esc(data.sourceFolder)}。直接使用你此次提供的 Origin 图片，不重新拟合，也不把旧数据拼入。</dd><dt>单器件配色</dt><dd>按实验日期、变量及器件编号匹配 EQE/JV 的实际颜色，只修改曲线、数据标记和同色标注的颜色。坐标、路径、文本和数值保持不变；PNG 从同色 SVG 渲染，二者颜色一致。</dd><dt>组内对比</dt><dd>保留你更新后对比图的原配色；${kind === 'bandwidth' ? '同时保留 A、C 组高频放大图。带宽数值读取原图标注，不在本页重新计算。' : '只有 c 组（10.12）有 LDR，未生成其他实验的 LDR。'}</dd>${kind === 'ldr' ? '<dt>LDR 标注含义</dt><dd>OD1–OD5 的 80 dB 是比较用的光功率跨度，并非已验证的线性动态范围。页面未沿用旧版自选判据给出的最终 LDR 说法。</dd>' : ''}<dt>源文件</dt><dd>原始 Origin 工程、Excel、PNG 和 SVG 保持不变，网页使用单独的配色副本。</dd></dl>`;
  $('matrix').addEventListener('click', event => {
    const cell = event.target.closest('[data-metric-cell]');
    const date = event.target.closest('[data-metric-date]');
    const group = event.target.closest('[data-metric-group]');
    if (cell) select(cell.dataset.metricCell);
    else if (date && !date.disabled) select(data.records.find(r => r.category === 'comparison' && r.date === date.dataset.metricDate).id);
    else if (group) selectScope('group', group.dataset.metricGroup);
  });
  $('metric-all').addEventListener('click', () => selectScope('all', ''));
  document.querySelectorAll('[data-date-view]').forEach(button => button.addEventListener('click', () => {
    const record = data.records.find(r => r.date === current().date && r.category === button.dataset.dateView);
    if (record) select(record.id);
  }));
  $('format-svg').addEventListener('click', () => { state.format = 'svg'; schedule(); });
  $('format-png').addEventListener('click', () => { state.format = 'png'; schedule(); });
  $('zoom-in').addEventListener('click', () => zoom(state.zoom+.25));
  $('zoom-out').addEventListener('click', () => zoom(state.zoom-.25));
  $('zoom-fit').addEventListener('click', () => zoom(1));
  $('gallery-fullscreen').addEventListener('click', async () => {
    if (document.fullscreenElement) await document.exitFullscreen(); else await $('gallery-image-frame').requestFullscreen();
  });
  $('gallery-image-frame').addEventListener('pointerdown', event => {
    if (state.zoom <= 1) return;
    drag = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
    event.currentTarget.setPointerCapture(event.pointerId);
  });
  $('gallery-image-frame').addEventListener('pointermove', event => {
    if (!drag) return;
    event.currentTarget.scrollLeft = drag.left+drag.x-event.clientX;
    event.currentTarget.scrollTop = drag.top+drag.y-event.clientY;
  });
  for (const name of ['pointerup', 'pointercancel']) $('gallery-image-frame').addEventListener(name, () => { drag = null; });
  $('gallery-method').addEventListener('click', () => $('gallery-dialog').showModal());
  $('gallery-close-dialog').addEventListener('click', () => $('gallery-dialog').close());
  document.addEventListener('click', event => { if (!event.target.closest('.menu')) document.querySelectorAll('.menu[open]').forEach(menu => { menu.open = false; }); });
  const params = new URLSearchParams(location.hash.slice(1));
  const exact = data.records.find(r => r.id === params.get('asset'));
  if (exact) { state.id = exact.id; state.type = exact.category === 'individual' ? 'cell' : 'date'; state.key = state.type === 'cell' ? exact.id : exact.date; }
  else {
    const category = ['comparison', 'detail'].includes(params.get('category')) && data.records.some(r => r.category === params.get('category')) ? params.get('category') : 'individual';
    const candidate = data.records.find(r => r.category === category && r.date === params.get('date') && (!params.get('group') || r.group === params.get('group')))
      || data.records.find(r => r.category === category && (!params.get('group') || r.group === params.get('group')));
    if (candidate) { state.id = candidate.id; state.type = candidate.category === 'individual' ? 'cell' : 'date'; state.key = state.type === 'cell' ? candidate.id : candidate.date; }
  }
  if (params.get('type') === 'group' && groups.includes(params.get('key'))) {
    state.type = 'group'; state.key = params.get('key');
    state.id = data.records.find(r => r.category === 'individual' && r.group === state.key).id;
  } else if (params.get('type') === 'all') {
    state.type = 'all'; state.key = ''; state.id = data.records.find(r => r.category === 'comparison').id;
  }
  if (params.get('format') === 'png') state.format = 'png';
  window.MetricGallery = { data, state, ready, select, selectScope, zoom, snapshot: null };
  const resizeObserver = new ResizeObserver(() => {
    if (!$('gallery-image-frame').hidden && $('gallery-image').complete && $('gallery-image').naturalWidth) zoom(state.zoom);
  });
  resizeObserver.observe($('gallery-image-frame'));
  window.lucide.createIcons(); schedule();
})();
