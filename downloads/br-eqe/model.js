(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EQEModel = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  'use strict';
  function peak(curve, range = [980, 1450]) {
    let best = -1;
    for (let i = 0; i < curve.x.length; i++) {
      if (curve.x[i] < range[0] || curve.x[i] > range[1]) continue;
      if (best < 0 || curve.y[i] > curve.y[best]) best = i;
    }
    if (best < 0) throw new Error('峰位区间没有数据');
    return { x: curve.x[best], y: curve.y[best] };
  }
  function stats(curves, range = [980, 1450]) {
    const peaks = curves.map(c => peak(c, range));
    const mean = peaks.reduce((s, p) => s + p.x, 0) / peaks.length;
    const sd = peaks.length > 1 ? Math.sqrt(peaks.reduce((s, p) => s + (p.x - mean) ** 2, 0) / (peaks.length - 1)) : null;
    return { n: curves.length, peaks, mean, sd };
  }
  function prepared(curve, normalized, range = [980, 1450]) {
    const scale = normalized ? peak(curve, range).y : 1;
    if (scale <= 0) throw new Error('归一化峰值必须大于零');
    return { ...curve, x: curve.x.slice(), y: curve.y.map(y => y / scale), scale };
  }
  function average(curves) {
    if (!curves.length) throw new Error('没有可平均的曲线');
    const maps = curves.map(c => new Map(c.x.map((x, i) => [x, c.y[i]])));
    const x = curves[0].x.filter(x => maps.every(m => m.has(x)));
    if (!x.length) throw new Error('曲线没有共同波长点');
    return { x, y: x.map(x => maps.reduce((s, m) => s + m.get(x), 0) / maps.length) };
  }
  function resolve(cell, version) {
    const ownAll = version === 'all' && !!cell.all;
    return { cell, record: ownAll ? cell.all : cell.selected,
      ownAll, fallback: version === 'all' && !cell.all };
  }
  function selection(data, type, key) {
    const rows = data.cells.filter(c => type === 'all' || (type === 'date' ? c.date === key : type === 'group' ? c.group === key : c.id === key))
      .sort((a, b) => data.dates.findIndex(d => d.label === a.date) - data.dates.findIndex(d => d.label === b.date)
        || data.groups.indexOf(a.group) - data.groups.indexOf(b.group));
    if (type === 'date' && rows.length && data.dates.some(d => d.label === key && !d.standalone)) {
      const controls = new Set(data.dates.filter(d => d.standalone).map(d => d.label));
      rows.push(...data.cells.filter(c => controls.has(c.date)));
    }
    return rows;
  }
  return { peak, stats, prepared, average, resolve, selection };
});
