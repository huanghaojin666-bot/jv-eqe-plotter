(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JVModel = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  'use strict';
  function selection(data, type, key) {
    return data.records.filter(r => type === 'all' || (type === 'date' ? r.date === key : type === 'group' ? r.group === key : r.id === key))
      .sort((a, b) => data.dates.findIndex(d => d.label === a.date) - data.dates.findIndex(d => d.label === b.date)
        || data.groups.indexOf(a.group) - data.groups.indexOf(b.group));
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
  function visible(records, state) {
    return records.flatMap(record => record.curves.map(curve => ({ record, curve })))
      .filter(({ curve }) => (state.mode === 'both' || state.mode === curve.mode) && !state.hidden.has(curve.id));
  }
  return { selection, atVoltage, displayY, visible };
});
