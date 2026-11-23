(function () {
  'use strict';
  const data = window.GISAXS_DATA;
  const $ = id => document.getElementById(id);
  const sampleKeys = data.sampleOrder;
  const stageKeys = Object.keys(data.stages);
  const initial = new URLSearchParams(location.hash.slice(1));
  const requestedSample = initial.get('sample') || initial.get('group');
  let sample = Object.hasOwn(data.samples, requestedSample) ? requestedSample : '';
  let stage = initial.get('stage');
  if (!Object.hasOwn(data.stages, stage)) stage = sample ? '' : 'calibrated';

  function active(selected) {
    return selected ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"';
  }
  function render() {
    const header = stageKeys.map(key => `<th scope="col"><button type="button" data-gisaxs-stage="${key}"${active(!sample && stage === key)}>${data.stages[key]}</button></th>`).join('');
    const rows = sampleKeys.map(key => `<tr><th scope="row"><button type="button" data-gisaxs-sample="${key}"${active(sample === key && !stage)}>${data.samples[key]}</button></th>`
      +stageKeys.map(type => `<td><button type="button" data-gisaxs-cell="${key}_${type}" class="cell ${(!sample || key === sample) && (!stage || type === stage) ? 'is-active' : ''}" aria-pressed="${(!sample || key === sample) && (!stage || type === stage)}" aria-label="${data.samples[key]} ${data.stages[type]}"><i data-lucide="image"></i></button></td>`).join('')+'</tr>');
    $('matrix').innerHTML = '<thead><tr><th>样品</th>'+header+'</tr></thead><tbody>'+rows.join('')+'</tbody>';
    const records = sampleKeys.flatMap(key => stageKeys.map(type => data.records.find(r => r.sample === key && r.stage === type)))
      .filter(r => (!sample || sample === r.sample) && (!stage || stage === r.stage));
    $('gisaxs-viewer-title').textContent = [sample && data.samples[sample], stage && data.stages[stage]].filter(Boolean).join(' · ');
    $('gisaxs-figures').classList.toggle('gisaxs-single', records.length === 1);
    $('gisaxs-figures').innerHTML = records.map(r => {
      const label = data.samples[r.sample]+' · '+data.stages[r.stage];
      return `<figure><figcaption><span>${label}</span><a class="icon-button" href="${r.asset}" download title="下载原图" aria-label="下载 ${label}"><i data-lucide="download"></i></a></figcaption><img src="${r.asset}" width="${r.width}" height="${r.height}" alt="${label}"></figure>`;
    }).join('');
    const pages = [...new Set(records.map(r => r.page))].sort((a, b) => a-b);
    $('gisaxs-source').textContent = `${data.sourceTitle} · PDF 第 ${pages.join('、')} 页`;
    history.replaceState(null, '', '#'+new URLSearchParams({ sample, stage }));
    window.lucide.createIcons();
    window.GISAXSApp = { sample, stage, records };
  }
  $('matrix').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.gisaxsCell) [sample, stage] = button.dataset.gisaxsCell.split('_');
    else if (button.dataset.gisaxsStage) { sample = ''; stage = button.dataset.gisaxsStage; }
    else if (button.dataset.gisaxsSample) { sample = button.dataset.gisaxsSample; stage = ''; }
    else return;
    const clickedId = button.dataset.gisaxsCell || button.dataset.gisaxsStage || button.dataset.gisaxsSample;
    const clickedType = button.dataset.gisaxsCell ? 'cell' : button.dataset.gisaxsStage ? 'stage' : 'sample';
    render();
    document.querySelector(`[data-gisaxs-${clickedType}="${clickedId}"]`).focus({ preventScroll: true });
  });
  $('gisaxs-bundle').href = data.bundle;
  $('gisaxs-conditions').textContent = `StoD ${data.distanceMm} mm · ${data.exposureS} s/图 · ω ${data.angleDeg}°`;
  render();
})();
