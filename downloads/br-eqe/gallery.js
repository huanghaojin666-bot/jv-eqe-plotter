(function () {
  'use strict';
  const kind = document.body.dataset.metric;
  const data = window.METRICS_DATA[kind];
  const $ = id => document.getElementById(id);
  const categoryLabels = { individual: kind === 'abs' ? '单样品' : '单器件', comparison: '组内对比' };
  const dates = [{ label: '9.15', experiment: 'a' }, { label: '9.20', experiment: 'b' },
    { label: '10.12', experiment: 'c' }, { label: '10.17', experiment: 'e' }];
  const groups = data.groups || ['f', '5', '10', '20', 'DMF'];
  const comparisonViews = data.comparisonViews || [];
  const state = { type: 'cell', key: data.records[0].id, id: data.records[0].id, format: 'svg', zoom: 1, variant: comparisonViews[0]?.id || '' };
  let ready = Promise.resolve();
  let drag = null;
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
  function current() { return data.records.find(r => r.id === state.id); }
  function inView(record) { return !record.view || record.view === state.variant; }
  function selected() {
    if (state.type === 'all') return data.records.filter(r => r.category === 'comparison' && inView(r));
    if (state.type === 'group') return data.records.filter(r => r.category === 'individual' && r.group === state.key);
    return [current()];
  }
  function metricLabel(record) {
    if (kind === 'abs') return record.category === 'individual' ? '原始吸收 · '+record.metadata.pointsPerCurve+' 点'
      : record.members.length+' 个样品 · '+record.title;
    if (kind === 'response') return record.category === 'individual'
      ? `Rise ${record.metadata.displayRiseUs.toFixed(2)} / Fall ${record.metadata.displayFallUs.toFixed(2)} μs`
      : `${record.members.length} 条记录 · 同帧 3 周期中位`;
    if (record.category !== 'individual') return `${record.members.length} 个器件`;
    if (kind === 'bandwidth') return record.metadata.bandwidthKHz.toFixed(1)+' kHz';
    if (kind === 'isd') return record.metadata.plottedRows+' 个正频率点';
    return '80 dB span';
  }
  function resultHeading() { return kind === 'abs' ? '1300–1400 nm 最大原始吸收' : kind === 'response' ? 'Rise / Fall / μs' : kind === 'bandwidth' ? '带宽 / kHz' : kind === 'isd' ? '正频率点数' : 'OD1–OD5 斜率 α'; }
  function resultValue(record) { return kind === 'bandwidth' ? record.metadata.bandwidthKHz.toFixed(1)
    : kind === 'abs' ? record.metadata.normalizationFactor == null ? '—' : record.metadata.normalizationFactor.toFixed(3)
    : kind === 'response' ? record.metadata.displayRiseUs.toFixed(2)+' / '+record.metadata.displayFallUs.toFixed(2)
    : kind === 'isd' ? record.metadata.plottedRows : record.metadata.slope.toFixed(4); }
  function colorLabel(record) { return record.recolored ? '与 EQE / JV 器件同色' : record.category === 'individual'
    ? kind === 'abs' ? '原薄膜样品配色' : kind === 'response' ? '原图配色 · EQE 无对应编号' : '原图配色 · 器件点位未标明' : '原对比配色'; }
  function fullTitle(record) { return `${record.experiment} · ${record.date} · ${record.title}`; }
  function title() {
    if (state.type === 'all') return data.label+' · 全部实验对比';
    if (state.type === 'group') return state.key+' · '+data.label+(kind === 'abs' ? ' · 样品对比' : ' · 跨日期对比');
    return fullTitle(current());
  }
  function renderMatrix() {
    const active = new Set(selected().flatMap(r => r.category === 'individual' ? [r.id]
      : r.members ? r.members.map(member => member.id)
        : data.records.filter(s => s.category === 'individual' && s.date === r.date).map(s => s.id)));
    let html = '<thead><tr><th>变量 / 日期</th>';
    for (const date of dates) {
      const comparison = data.records.find(r => r.date === date.label && r.category === 'comparison' && inView(r));
      html += `<th><button data-metric-date="${date.label}" ${comparison ? '' : 'disabled'} class="${state.type === 'date' && state.key === date.label ? 'is-active' : ''}" aria-label="${date.label} ${data.label}组内对比"><span>${date.label}</span><small>实验 ${date.experiment}</small></button></th>`;
    }
    html += '</tr></thead><tbody>';
    for (const group of groups) {
      html += `<tr><th scope="row"><button data-metric-group="${group}" class="${state.type === 'group' && state.key === group ? 'is-active' : ''}" aria-label="${group} ${data.label}跨日期对比">${group}</button></th>`;
      for (const date of dates) {
        const records = data.records.filter(r => r.date === date.label && r.group === group && r.category === 'individual');
        if (!records.length) { html += '<td class="is-blank" aria-label="无数据">—</td>'; continue; }
        html += '<td><div class="metric-cell-stack">'+records.map(record => {
          const value = kind === 'bandwidth' ? record.metadata.bandwidthKHz.toFixed(1) : esc(record.point || record.deviceLabel);
          const detail = kind === 'abs' ? record.metadata.pointsPerCurve+' 点' : kind === 'response' ? resultValue(record)
            : kind === 'bandwidth' ? esc(record.point) : kind === 'isd' ? record.metadata.plottedRows+' 点' : 'OD1–OD5';
          return `<button data-metric-cell="${record.id}" class="cell ${active.has(record.id) ? 'is-active' : ''}" aria-pressed="${active.has(record.id)}" title="${fullTitle(record)} · ${metricLabel(record)}"><span class="peak-value">${value}</span><span class="cell-detail"><b class="color-chip" style="background:${record.color}"></b>${detail}</span></button>`;
        }).join('')+'</div></td>';
      }
      html += '</tr>';
    }
    $('matrix').innerHTML = html+'</tbody>';
    $('metric-all').setAttribute('aria-pressed', String(state.type === 'all'));
    if ($('gallery-comparison-views')) {
      $('gallery-comparison-views').hidden = !['date', 'all'].includes(state.type);
      $('gallery-comparison-views').innerHTML = comparisonViews.map(view => `<button data-comparison-view="${view.id}" aria-pressed="${view.id === state.variant}">${esc(view.label)}</button>`).join('');
    }
  }
  function metadata(record) {
    if (record.category === 'individual') {
      const facts = kind === 'bandwidth'
        ? [['−3 dB 带宽', record.metadata.bandwidthKHz.toFixed(1)+' kHz'], ['归一化参考', 'A(0.1 Hz) = 1']]
        : kind === 'abs' ? [['薄膜样品', record.deviceLabel], ['原始波长范围', record.metadata.wavelengthMinNm+'–'+record.metadata.wavelengthMaxNm+' nm'],
          ['源数据采样点', record.metadata.pointsPerCurve], ['1300–1400 nm 最大吸收', resultValue(record)],
          ['归一化', record.deviceLabel === 'White' ? '不参与' : '按窗口最大原始吸收']]
        : kind === 'response' ? [['图示周期', '第 '+record.metadata.plotCycle+' 周期'],
          ['图示 Rise（10%–90%）', record.metadata.displayRiseUs.toFixed(2)+' μs'],
          ['图示 Fall（90%–10%）', record.metadata.displayFallUs.toFixed(2)+' μs'],
          ['同帧3周期中位 Rise', record.metadata.medianRiseUs.toFixed(2)+' μs'],
          ['同帧3周期中位 Fall', record.metadata.medianFallUs.toFixed(2)+' μs'],
          ['灵敏度 S', record.metadata.sensitivityUAperV+' μA/V'+(record.metadata.sensitivityAssumed ? '（暂定）' : '')]]
        : kind === 'isd' ? [['原始行数', record.metadata.rawRows], ['正频率有效点', record.metadata.plottedRows],
          ['偏压', record.metadata.biasV+' V'], ['原 SVG 顶点数', record.metadata.curvePointCount],
          ['频率轴范围', record.metadata.axisFrequencyMinHz+'–'+record.metadata.axisFrequencyMaxHz+' Hz'],
          ['零 / 负频率点', record.metadata.excluded.zero_frequency+' / '+record.metadata.excluded.negative_frequency]]
        : [['比较区间', 'OD1–OD5'], ['光功率跨度', '80 dB（span）'], ['偏压', '0 V'], ['幂律斜率 α', record.metadata.slope.toFixed(4)]];
      $('gallery-metadata').innerHTML = '<dl class="gallery-facts">'+facts.map(([name, value]) => `<div><dt>${name}</dt><dd>${value}</dd></div>`).join('')+`<div><dt>${record.recolored ? 'EQE / JV 器件颜色' : '原图颜色'}</dt><dd><span class="color-chip" style="background:${record.color}"></span>${record.color}</dd></div></dl>`;
    } else {
      $('gallery-metadata').innerHTML = '<table class="gallery-members"><thead><tr><th>'+(kind === 'abs' ? '样品' : '器件')+'</th><th>'+resultHeading()+'</th></tr></thead><tbody>'
        +record.members.map(member => `<tr><td>${esc(member.deviceLabel)}</td><td>${resultValue(member)}</td></tr>`).join('')+'</tbody></table>';
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
      $('gallery-metadata').innerHTML = '<table class="gallery-members"><thead><tr><th>日期 / 器件</th><th>'+resultHeading()+'</th></tr></thead><tbody>'
        +records.flatMap(r => r.category === 'individual' ? [r] : r.members.map(m => ({ ...m, date: r.date })))
          .map(r => `<tr><td>${esc(r.date)} · ${esc(r.deviceLabel)}</td><td>${resultValue(r)}</td></tr>`).join('')+'</tbody></table>';
    } else metadata(records[0]);
    $('gallery-selection').textContent = title();
    $('gallery-selection-meta').textContent = state.type === 'all' || state.type === 'group'
      ? `${records.length} 张原图 · ${state.type === 'group' ? ['isd', 'response', 'abs'].includes(kind) ? '按原样品标签归组' : '与 EQE / JV 器件同色' : '原组内对比图'}`
      : `${categoryLabels[record.category]} · ${metricLabel(record)} · ${colorLabel(record)}`;
    $('gallery-viewer-title').textContent = title();
    $('gallery-category').textContent = data.label+' · '+(state.type === 'all' ? '集总对比' : state.type === 'group' ? '变量对比' : categoryLabels[record.category]);
    $('gallery-source').textContent = records.map(r => r.sourceSvg).join('\n');
    $('gallery-caption').textContent = multiple ? '各图为本次提供的 Origin 图片，未合并拟合或重算。' : record.recolored
      ? 'Origin 图片仅统一器件颜色；曲线路径、坐标、数值及标注未重算。'
      : 'Origin '+(record.category === 'individual' ? '单器件图' : '组内对比图')+'，保留你这次更新的原始配色与标注。';
    if (kind === 'response') $('gallery-caption').textContent = records.every(r => r.category === 'comparison')
      ? '组内时间为同帧 3 周期中位估计，不是 3 个独立器件重复；保留原图，不重新计时。'
      : '单记录图保留原图示周期的 Rise / Fall 估计、10% / 90% 交点与原始标注，未重新计时。';
    $('format-svg').setAttribute('aria-pressed', String(state.format === 'svg'));
    $('format-png').setAttribute('aria-pressed', String(state.format === 'png'));
    $('gallery-download-png').href = records[0].assetPng;
    $('gallery-download-svg').href = records[0].assetSvg;
    $('gallery-download-png').hidden = multiple;
    $('gallery-download-svg').hidden = multiple;
    const reference = new URLSearchParams((record.group === 'n' || kind === 'abs' && record.group === 'White') && state.type !== 'all'
      ? { type: 'date', key: record.date } : { type: state.type, key: state.type === 'cell' ? record.date+'_'+record.group : state.key });
    document.querySelector('[data-eqe-gallery-link]').href = window.ReportNavigation.href('index.html', reference);
    document.querySelector('[data-jv-gallery-link]').href = window.ReportNavigation.href('jv.html', reference);
    for (const link of document.querySelectorAll('[data-other-metric]')) {
      link.href = window.ReportNavigation.href(link.dataset.otherMetric+'.html',
        new URLSearchParams(state.type === 'group' || state.type === 'all' ? { type: state.type, key: state.key }
          : { date: record.date, group: record.group || '', category: record.category === 'individual' ? 'individual' : 'comparison' }));
    }
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
      image.alt = fullTitle(records[0])+' · '+data.label+' · '+colorLabel(records[0]);
      image.src = state.format === 'svg' ? records[0].assetSvg : records[0].assetPng;
      await image.decode();
      zoom(state.zoom);
    }
    history.replaceState(null, '', '#'+new URLSearchParams({ type: state.type, key: state.key, asset: record.id, format: state.format,
      ...(comparisonViews.length ? { variant: state.variant } : {}) }));
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
    if (record.view) state.variant = record.view;
    state.key = state.type === 'cell' ? id : record.date; state.zoom = 1;
    return schedule();
  }
  function selectScope(type, key) {
    const rows = data.records.filter(r => type === 'all' ? r.category === 'comparison' && inView(r)
      : r.category === 'individual' && r.group === key);
    if (!rows.length) return;
    state.type = type; state.key = key || ''; state.id = rows[0].id; state.zoom = 1;
    return schedule();
  }
  $('gallery-title').textContent = data.label;
  $('gallery-version').textContent = data.version;
  $('gallery-inventory').textContent = `${data.records.filter(r => r.category === 'individual').length} ${kind === 'abs' ? '个样品' : kind === 'response' ? '条记录' : '个器件'} · ${data.records.length} 张图`;
  $('gallery-bundle').href = data.bundle;
  $('gallery-download-bundle').href = data.bundle;
  if (kind === 'ldr') { $('gallery-notice').hidden = false; $('gallery-notice').textContent = data.spanNote; }
  if (['bandwidth', 'response', 'abs'].includes(kind) && data.processingNote) { $('gallery-notice').hidden = false; $('gallery-notice').textContent = data.processingNote; }
  $('gallery-method-content').innerHTML = `<dl><dt>当前数据版本</dt><dd>${esc(data.sourceFolder)}。直接使用你此次提供的 Origin 图片，不重新拟合，也不把旧数据拼入。</dd><dt>单器件配色</dt><dd>按实验日期、变量及器件编号匹配 EQE/JV 的实际颜色，只修改曲线、数据标记和同色标注的颜色。坐标、路径、文本和数值保持不变；PNG 从同色 SVG 渲染，二者颜色一致。</dd><dt>组内对比</dt><dd>保留你更新后对比图的原配色；${kind === 'bandwidth' ? '仅展示完整单器件图和组内对比图。带宽数值读取原图标注，不在本页重新计算。' : '只有 c 组（10.12）有 LDR，未生成其他实验的 LDR。'}</dd>${kind === 'ldr' ? '<dt>LDR 标注含义</dt><dd>OD1–OD5 的 80 dB 是比较用的光功率跨度，并非已验证的线性动态范围。页面未沿用旧版自选判据给出的最终 LDR 说法。</dd>' : ''}<dt>源文件</dt><dd>原始 Origin 工程、Excel、PNG 和 SVG 保持不变，网页使用单独的配色副本。</dd></dl>`;
  if (kind === 'isd') {
    $('gallery-method-content').innerHTML = `<dl><dt>当前数据版本</dt><dd>${esc(data.sourceFolder)}。仅加入此次整理的 9 张单样品图及 2 张组内对比图，原始文件不改动。</dd><dt>点数</dt><dd>按导出记录，每条源曲线有 1024 行，绘制 511 个正频率有效点；对数频率轴排除 1 行零频率和 512 行负频率。网页直接载入已导出的图片，不额外抽点、平滑、拟合、归一化、平均或换算 PSD。原 SVG 顶点数为 505–511，不等同于源表采样点数；网页保留这些原始路径，未重新生成曲线。</dd><dt>器件配色</dt><dd>${esc(data.mappingNote)} F1、F2 保留为两个独立样品，不合并或平均。a 组的同色 PNG 从 SVG 渲染，曲线路径、坐标、文本与数值不变。组内对比图保留原图。</dd><dt>n 组</dt><dd>本页 N 是此次提供的真实噪声曲线，不改变 EQE 页仅作参考、无关联曲线的 n = 1300 nm。</dd></dl>`;
  }
  if (kind === 'bandwidth' && data.processingNote) {
    $('gallery-method-content').insertAdjacentHTML('beforeend', '<dl><dt>当前图片版本</dt><dd>完整单器件图和组内对比图均为 v7。'+esc(data.processingNote)+'</dd></dl>');
  }
  if (kind === 'response') {
    $('gallery-method-content').innerHTML = '<dl><dt>当前记录</dt><dd>采用此次提供的 10 张单脉冲及交点图、2 张组内对比图，不混入历史结果。原 SVG 曲线路径、标注、坐标和数值保持不变；网页未抽点、拟合或重新计算时间。</dd><dt>两种计时口径</dt><dd>单图与表格格子使用图示同一周期的 Rise / Fall 估计；组图及其下方汇总使用同帧 3 周期中位值。Rise 为 10%→90%，Fall 为 90%→10%，升降使用同一捕获脉冲、同一组高低平台。周期内波动不作为独立器件重复；这些估计未去除光源与电子学影响。</dd><dt>档位</dt><dd>灵敏度读取你提供的核验记录。f1 (001) 的 20 μA/V 为暂定值，已单独标出；灵敏度的线性换算不改变归一化 10%/90% 交点。不从 SOP 推断未记录的偏压。</dd><dt>配色</dt><dd>按日期、变量和器件编号匹配 EQE / JV 单器件颜色。C 10 1-3、C 20 1-5 没有对应 EQE 编号，保留原色。f1 (001) 按明确的 f1 器件标签匹配颜色，未推断点位，也不与旧重复标签合并。组内对比图保留原配色。</dd></dl>';
  }
  if (kind === 'abs') {
    $('gallery-method-content').innerHTML = '<dl><dt>当前版本</dt><dd>使用 Origin作图_20261118_最终版 的 8 张原始单图、1 张全部样品原始合图、2 张归一化图。只收录 c 组，不混入旧版变量子组图。PNG 与 SVG 逐字节保留原文件，未重新作图。</dd><dt>原始与归一化</dt><dd>原始吸收图保留测量值。归一化为 A_raw(λ) / max[A_raw(1300–1400 nm)]，包含窗口端点；不扣背景、不减最小值、不平滑、不去除负值。其他波段可能大于 1。峰区图为 1250–1450 nm，White 不参与归一化。</dd><dt>样品标签</dt><dd>F、F-2、5、10、20、DMF、N、White 保留原名与原色。薄膜样品没有对应器件点位，不将 F、F-2 擅自对应为 EQE 的具体器件；N 的真实 ABS 不改变 EQE 页的 n 参考值。每条原始曲线在 900–1715 nm 有 816 个采样点。</dd></dl>';
  }
  $('matrix').addEventListener('click', event => {
    const cell = event.target.closest('[data-metric-cell]');
    const date = event.target.closest('[data-metric-date]');
    const group = event.target.closest('[data-metric-group]');
    if (cell) select(cell.dataset.metricCell);
    else if (date && !date.disabled) select(data.records.find(r => r.category === 'comparison' && r.date === date.dataset.metricDate && inView(r)).id);
    else if (group) selectScope('group', group.dataset.metricGroup);
  });
  $('metric-all').addEventListener('click', () => selectScope('all', ''));
  if ($('gallery-comparison-views')) $('gallery-comparison-views').addEventListener('click', event => {
    const button = event.target.closest('[data-comparison-view]');
    if (!button) return;
    const record = data.records.find(r => r.category === 'comparison' && r.date === current().date && r.view === button.dataset.comparisonView);
    if (!record) return;
    state.variant = record.view; state.id = record.id; state.zoom = 1;
    schedule();
  });
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
  const requestedAsset = params.get('asset');
  const exact = data.records.find(r => r.id === requestedAsset)
    || (kind === 'bandwidth' && requestedAsset?.endsWith('_detail')
      ? data.records.find(r => r.id === requestedAsset.replace(/_detail$/, '_comparison')) : null);
  if (exact) { state.id = exact.id; state.type = exact.category === 'individual' ? 'cell' : 'date'; state.key = state.type === 'cell' ? exact.id : exact.date; if (exact.view) state.variant = exact.view; }
  else {
    const category = ['comparison', 'detail'].includes(params.get('category')) ? 'comparison' : 'individual';
    const candidate = data.records.find(r => r.category === category && r.date === params.get('date') && (!params.get('group') || r.group === params.get('group')) && inView(r))
      || data.records.find(r => r.category === category && (!params.get('group') || r.group === params.get('group')) && inView(r));
    if (candidate) { state.id = candidate.id; state.type = candidate.category === 'individual' ? 'cell' : 'date'; state.key = state.type === 'cell' ? candidate.id : candidate.date; }
  }
  if (comparisonViews.some(view => view.id === params.get('variant'))) {
    state.variant = params.get('variant');
    if (state.type === 'date') state.id = data.records.find(r => r.category === 'comparison' && r.date === current().date && inView(r)).id;
  }
  if (params.get('type') === 'group' && groups.includes(params.get('key'))) {
    state.type = 'group'; state.key = params.get('key');
    state.id = data.records.find(r => r.category === 'individual' && r.group === state.key).id;
  } else if (params.get('type') === 'all') {
    state.type = 'all'; state.key = ''; state.id = data.records.find(r => r.category === 'comparison' && inView(r)).id;
  }
  if (params.get('format') === 'png') state.format = 'png';
  window.MetricGallery = { data, state, ready, select, selectScope, zoom, snapshot: null };
  const resizeObserver = new ResizeObserver(() => {
    if (!$('gallery-image-frame').hidden && $('gallery-image').complete && $('gallery-image').naturalWidth) zoom(state.zoom);
  });
  resizeObserver.observe($('gallery-image-frame'));
  window.lucide.createIcons(); schedule();
})();
