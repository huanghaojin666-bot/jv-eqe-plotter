(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JVModel = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  'use strict';
  function sourceRecords(data, source) {
    const light = data.lightBatch?.records || [];
    return source === 'light' ? light : source === 'combined' ? [...data.records, ...light] : data.records;
  }
  function selection(data, type, key, source) {
    const pool = sourceRecords(data, source);
    const rows = pool.filter(r => type === 'all' || (type === 'date' ? r.date === key : type === 'group' ? r.group === key : (r.scopeId || r.id) === key))
      .sort((a, b) => data.dates.findIndex(d => d.label === a.date) - data.dates.findIndex(d => d.label === b.date)
        || data.groups.indexOf(a.group) - data.groups.indexOf(b.group));
    if (type === 'date' && rows.length && data.dates.some(d => d.label === key && !d.standalone)) {
      const controls = new Set(data.dates.filter(d => d.standalone).map(d => d.label));
      rows.push(...pool.filter(r => controls.has(r.date)));
    }
    return rows;
  }
  function atVoltage(curve, value) {
    if (value < curve.x[0] || value > curve.x[curve.x.length-1]) return null;
    for (let i = 0; i < curve.x.length; i++) {
      if (curve.x[i] === value) return curve.y[i];
      if (i && curve.x[i] > value) {
        const w = (value-curve.x[i-1])/(curve.x[i]-curve.x[i-1]);
        return curve.y[i-1]*(1-w)+curve.y[i]*w;
      }
    }
    return curve.y[curve.y.length-1];
  }
  function displayY(curve, scale) {
    return scale === 'log' ? curve.y.map(v => v === 0 ? null : Math.abs(v)) : curve.y.slice();
  }
  const normalizationVoltage = -.5;
  function normalizedCurve(curve) {
    const divisor = Math.abs(atVoltage(curve, normalizationVoltage) ?? 0);
    if (!Number.isFinite(divisor) || divisor <= 0) throw new Error('没有可用的 −0.5 V 归一化基准');
    return { ...curve, y: curve.y.map(value => value/divisor), divisor };
  }
  function visible(records, state) {
    return records.flatMap(record => record.curves.map(curve => ({ record, curve })))
      .filter(({ curve }) => (state.mode === 'both' || state.mode === curve.mode) && !state.hidden.has(curve.id));
  }
  function means(entries, normalized = false) {
    const buckets = new Map();
    for (const { record, curve } of entries) {
      const key = record.id+'|'+curve.mode;
      if (!buckets.has(key)) buckets.set(key, { record, mode: curve.mode, devices: new Map() });
      const devices = buckets.get(key).devices;
      if (!devices.has(curve.deviceKey)) devices.set(curve.deviceKey, []);
      devices.get(curve.deviceKey).push(normalized ? normalizedCurve(curve) : curve);
    }
    const average = values => values.reduce((sum, value) => sum+value, 0)/values.length;
    const results = [];
    for (const [id, { record, mode, devices }] of buckets) {
      const deviceCurves = [...devices.values()];
      const curves = deviceCurves.flat();
      const low = Math.max(...curves.map(c => c.x[0]));
      const high = Math.min(...curves.map(c => c.x.at(-1)));
      if (low >= high) continue;
      const x = [...new Set(curves.flatMap(c => c.x.filter(v => v >= low && v <= high)))].sort((a, b) => a-b);
      const y = x.map(voltage => average(deviceCurves.map(points => average(points.map(c => atVoltage(c, voltage))))));
      results.push({ id, record, mode, x, y, deviceCount: devices.size, pointCount: curves.length });
    }
    return results;
  }
  return { sourceRecords, selection, atVoltage, displayY, visible, means, normalizedCurve, normalizationVoltage };
});
