'use strict';

const T = {"bg": "#FFFFFF", "axis": "#DDDDDD", "grid": "#F2F2F2", "label": "#8A8A8A", "strong": "#1F1F1F", "pointer": "#AAAAAA", "pointerBg": "#1F1F1F", "hollow": "#FFFFFF", "slider": "#E5E5E5", "sliderFill": "rgba(226,68,92,0.10)", "handle": "#E2445C", "title": "#1F1F1F", "muted": "#AAAAAA", "hol": "#F2A900", "mark": "#1F1F1F", "mv1": "#F2A900", "mv2": "#7E57C2", "sliderLine": "#CCCCCC", "sliderArea": "#F5F5F5", "zero": "#CCCCCC", "tipBorder": "#E5E5E5", "tipCss": "border-radius:6px;", "corrPos": "226,68,92", "corrNeg": "31,158,137", "corrAlpha": 0.55};
const UP = '#E2445C';
const DOWN = '#1F9E89';
const MA_DEFS = [[5, "#1F1F1F"], [10, "#F2A900"], [20, "#EC6FA0"], [30, "#3BA55C"], [60, "#B5B5B5"], [120, "#3D7FE0"], [250, "#9B6BD6"]];
const OVERLAY_COLORS = ["#E2445C", "#3D7FE0", "#F2A900", "#1F9E89", "#9B6BD6"];
const PRESETS = [['1M', '1个月'], ['3M', '3个月'], ['6M', '6个月'], ['YTD', '今年'], ['1Y', '1年'], ['2Y', '2年']];
const MAX_COMPARE = 5;
const WEEK = '日一二三四五六';

const RICH = {
  name: { color: T.title, fontSize: 14, fontWeight: 'bold' },
  code: { color: T.muted, fontSize: 12 },
  lab: { color: T.label, fontSize: 12 },
  up: { color: UP, fontSize: 12 },
  dn: { color: DOWN, fontSize: 12 },
  eq: { color: T.strong, fontSize: 12 },
  hol: { color: '#fff', backgroundColor: T.hol, padding: [2, 6], borderRadius: 8, fontSize: 12 },
  vol: { color: T.strong, fontSize: 12 },
  mv1: { color: T.mv1, fontSize: 12 },
  mv2: { color: T.mv2, fontSize: 12 },
};
MA_DEFS.forEach(([, c], j) => { RICH['m' + j] = { color: c, fontSize: 12 }; });

let DATA;
const IDX = {};
const ORDER = [];
const state = { mode: 'single', single: 'sh', selected: ['sh', 'ixic', 'n225', 'ks11', 'hsi'], view: 'grid', preset: '1Y', from: null, to: null };
let ctrls = [];
let syncing = false;
let cursor = null;

const $ = (s) => document.querySelector(s);
const f2 = (v) => (v == null ? '-' : v.toFixed(2));

function fmtVol(v, digits = 3) {
  if (v == null) return '-';
  if (v >= 1e8) return (v / 1e8).toFixed(digits) + '亿';
  if (v >= 1e4) return (v / 1e4).toFixed(Math.min(digits, 2)) + '万';
  return String(Math.round(v));
}

function sma(arr, n) {
  const out = new Array(arr.length).fill(null);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= n) sum -= arr[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

function prepare(ix) {
  const all = ix.rows;
  const closes = all.map((r) => r[4]);
  const vols = all.map((r) => r[5]);
  const mas = MA_DEFS.map(([n]) => sma(closes, n));
  const mv5 = sma(vols, 5), mv10 = sma(vols, 10);
  const s = Math.max(0, all.findIndex((r) => r[0] >= DATA.displayStart));
  const rows = all.slice(s);
  ix.d = {
    rows,
    dates: rows.map((r) => r[0]),
    prev: rows.map((r, k) => (all[s + k - 1] ? all[s + k - 1][4] : r[1])),
    ma: mas.map((a) => a.slice(s)),
    mv5: mv5.slice(s), mv10: mv10.slice(s),
    pos: new Map(rows.map((r, k) => [r[0], k])),
  };
}

function addMonths(dateStr, m) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + m);
  return d.toISOString().slice(0, 10);
}

function presetRange(key) {
  const L = DATA.updated;
  const start = {
    '1M': () => addMonths(L, -1), '3M': () => addMonths(L, -3), '6M': () => addMonths(L, -6),
    YTD: () => L.slice(0, 4) + '-01-01', '1Y': () => addMonths(L, -12), '2Y': () => DATA.displayStart,
  }[key]();
  return [start < DATA.displayStart ? DATA.displayStart : start, L];
}

function toIdxRange(axis, from, to) {
  let s = axis.findIndex((d) => d >= from);
  if (s < 0) s = 0;
  let e = axis.length - 1;
  while (e > 0 && axis[e] > to) e--;
  return [s, Math.max(s, e)];
}

function unionDates(list) {
  const set = new Set();
  list.forEach((ix) => ix.d.dates.forEach((d) => set.add(d)));
  return [...set].sort();
}

function visibleRange(chart) {
  const ext = chart.getModel().getComponent('xAxis', 0).axis.scale.getExtent();
  return [Math.round(ext[0]), Math.round(ext[1])];
}

function weekday(d) { return WEEK[new Date(d + 'T00:00:00Z').getUTCDay()]; }

function cls(v, base) { return v > base ? 'up' : v < base ? 'dn' : 'eq'; }

function arrow(cur, prev) { return cur == null || prev == null ? '' : cur >= prev ? '↑' : '↓'; }

// ---------- 日K线图 ----------
function createKChart(el, ix, axis, opt) {
  const chart = echarts.init(el);
  const D = ix.d;
  const at = axis.map((d) => (D.pos.has(d) ? D.pos.get(d) : -1));
  const unit = ix.volUnit;

  const candle = at.map((k) => (k < 0 ? '-' : [D.rows[k][1], D.rows[k][4], D.rows[k][3], D.rows[k][2]]));
  const vol = at.map((k) => {
    if (k < 0) return '-';
    const r = D.rows[k];
    const up = r[4] >= r[1];
    return { value: r[5], itemStyle: up ? { color: T.hollow, borderColor: UP, borderWidth: 1 } : { color: DOWN, borderColor: DOWN } };
  });
  const pick = (arr) => at.map((k) => (k < 0 || arr[k] == null ? null : +arr[k].toFixed(2)));

  function priceText(i) {
    const date = axis[i], k = at[i];
    let t = `{name|${ix.name}} {code|${ix.code}}  {lab|${date} 周${weekday(date)}}`;
    if (k < 0) return t + '  {hol|休市}\n ';
    const r = D.rows[k], p = D.prev[k], chg = r[4] - p;
    const c = cls(r[4], p), sign = chg >= 0 ? '+' : '';
    t += `  {lab|开}{${cls(r[1], p)}|${f2(r[1])}}  {lab|高}{${cls(r[2], p)}|${f2(r[2])}}  {lab|低}{${cls(r[3], p)}|${f2(r[3])}}`
      + `  {lab|收}{${c}|${f2(r[4])}}  {${c}|${sign}${f2(chg)}  ${sign}${(chg / p * 100).toFixed(2)}%}`;
    const ma = MA_DEFS.map(([n], j) => `{m${j}|MA${n}:${f2(D.ma[j][k])}}`).join('  ');
    return t + '\n' + ma;
  }

  function volText(i) {
    const k = at[i];
    const u = unit ? `(${unit})` : '';
    if (k < 0) return `{lab|VOLUME${u}:} {hol|休市}`;
    const r = D.rows[k], pk = k - 1;
    const v = r[5], pv = pk >= 0 ? D.rows[pk][5] : null;
    return `{${r[4] >= r[1] ? 'up' : 'dn'}|VOLUME${u}:${fmtVol(v)}${arrow(v, pv)}}  `
      + `{mv1|MAVOL1:${fmtVol(D.mv5[k])}${arrow(D.mv5[k], pk >= 0 ? D.mv5[pk] : null)}}  `
      + `{mv2|MAVOL2:${fmtVol(D.mv10[k])}${arrow(D.mv10[k], pk >= 0 ? D.mv10[pk] : null)}}`;
  }

  function lastReal(e) { let i = e; while (i > 0 && at[i] < 0) i--; return i; }

  function marks(s, e) {
    let hi = -1, lo = -1;
    for (let i = s; i <= e; i++) {
      const k = at[i];
      if (k < 0) continue;
      if (hi < 0 || D.rows[k][2] > D.rows[at[hi]][2]) hi = i;
      if (lo < 0 || D.rows[k][3] < D.rows[at[lo]][3]) lo = i;
    }
    if (hi < 0) return [];
    const nearRight = (i) => (i - s) / Math.max(1, e - s) > 0.82;
    const mk = (i, v, isHigh) => {
      const right = nearRight(i);
      return {
        coord: [i, v], symbol: 'circle', symbolSize: 1,
        label: {
          show: true, color: T.mark, fontSize: 12, fontWeight: 'bold',
          position: right ? 'left' : 'right', distance: 2,
          offset: [0, isHigh ? -2 : 2],
          formatter: right ? `${f2(v)} →` : `← ${f2(v)}`,
        },
      };
    };
    return [mk(hi, D.rows[at[hi]][2], true), mk(lo, D.rows[at[lo]][3], false)];
  }

  const [s0, e0] = opt.range;
  const bottom = opt.slider ? 44 : 22;
  const axisLine = { lineStyle: { color: T.axis } };
  const split = { show: true, lineStyle: { color: T.grid, type: 'dashed' } };

  chart.setOption({
    backgroundColor: T.bg,
    animation: false,
    title: [
      { id: 'pinfo', left: 8, top: 4, text: priceText(lastReal(e0)), textStyle: { rich: RICH, lineHeight: 18 } },
      { id: 'vinfo', left: 8, top: '67%', text: volText(lastReal(e0)), textStyle: { rich: RICH } },
    ],
    axisPointer: { link: [{ xAxisIndex: 'all' }], label: { backgroundColor: T.pointerBg, color: '#fff', borderRadius: 6 } },
    tooltip: {
      trigger: 'axis', showContent: false,
      axisPointer: { type: 'cross', lineStyle: { color: T.pointer, type: 'dashed' }, crossStyle: { color: T.pointer, type: 'dashed' } },
    },
    grid: [
      { left: 8, right: 64, top: 46, bottom: '34%' },
      { left: 8, right: 64, top: '71%', bottom },
    ],
    xAxis: [
      { type: 'category', data: axis, gridIndex: 0, axisLine, axisTick: { show: false }, axisLabel: { show: false }, axisPointer: { label: { show: false } } },
      { type: 'category', data: axis, gridIndex: 1, axisLine, axisTick: { show: false }, axisLabel: { color: T.label } },
    ],
    yAxis: [
      { scale: true, gridIndex: 0, position: 'right', splitNumber: 6, axisLine: { show: true, ...axisLine }, axisLabel: { color: T.strong }, splitLine: split },
      { gridIndex: 1, position: 'right', splitNumber: 2, axisLine: { show: true, ...axisLine }, axisLabel: { color: T.label, formatter: (v) => fmtVol(v, 1) }, splitLine: split },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], startValue: s0, endValue: e0, minValueSpan: 10 },
      ...(opt.slider ? [{
        type: 'slider', xAxisIndex: [0, 1], startValue: s0, endValue: e0, bottom: 6, height: 20,
        borderColor: T.slider, fillerColor: T.sliderFill, textStyle: { color: T.label },
        dataBackground: { lineStyle: { color: T.sliderLine }, areaStyle: { color: T.sliderArea } },
        handleStyle: { color: T.handle, borderColor: T.handle }, moveHandleStyle: { color: T.handle },
      }] : []),
    ],
    series: [
      {
        id: 'k', name: ix.name, type: 'candlestick', data: candle, barMaxWidth: 14,
        itemStyle: { color: T.hollow, color0: DOWN, borderColor: UP, borderColor0: DOWN, borderWidth: 1 },
        markPoint: { data: marks(s0, e0), animation: false },
      },
      ...MA_DEFS.map(([n, c], j) => ({
        name: 'MA' + n, type: 'line', data: pick(D.ma[j]), symbol: 'none', connectNulls: true,
        lineStyle: { width: 1, color: c }, itemStyle: { color: c }, silent: true,
      })),
      { name: 'VOL', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: vol, barMaxWidth: 14 },
      { name: 'MAVOL1', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: pick(D.mv5), symbol: 'none', connectNulls: true, lineStyle: { width: 1, color: T.mv1 }, silent: true },
      { name: 'MAVOL2', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: pick(D.mv10), symbol: 'none', connectNulls: true, lineStyle: { width: 1, color: T.mv2 }, silent: true },
      // 每天都有值的隐藏序列，用来在休市日也能定位十字光标
      { id: 'cursor', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: axis.map(() => 0), symbol: 'none', silent: true, lineStyle: { opacity: 0 } },
    ],
  });
  const cursorSeries = 1 + MA_DEFS.length + 3;

  const ctrl = {
    chart, axis,
    range: [s0, e0],
    applyRange(s, e, dispatch) {
      ctrl.range = [s, e];
      if (dispatch) chart.dispatchAction({ type: 'dataZoom', startValue: s, endValue: e });
      chart.setOption({ series: [{ id: 'k', markPoint: { data: marks(s, e) } }] });
      if (cursor == null) ctrl.setInfo(null);
    },
    setInfo(i) {
      const j = i == null ? lastReal(ctrl.range[1]) : i;
      chart.setOption({ title: [{ id: 'pinfo', text: priceText(j) }, { id: 'vinfo', text: volText(j) }] });
    },
    showCursor(i) {
      if (i == null) chart.dispatchAction({ type: 'hideTip' });
      else chart.dispatchAction({ type: 'showTip', seriesIndex: cursorSeries, dataIndex: i });
    },
  };

  chart.on('datazoom', () => {
    if (syncing) return;
    const [s, e] = visibleRange(chart);
    onZoom(ctrl, s, e);
  });
  chart.on('updateAxisPointer', (ev) => {
    const ax = (ev.axesInfo || []).find((a) => a.axisDim === 'x');
    const i = ax ? Math.round(ax.value) : null;
    ctrl.setInfo(i);
    onCursor(ctrl, i);
  });
  return ctrl;
}

// ---------- 走势叠加图 ----------
function createOverlay(el, list, axis, opt) {
  const chart = echarts.init(el);
  const items = list.map((ix, j) => {
    const D = ix.d;
    const at = axis.map((d) => (D.pos.has(d) ? D.pos.get(d) : -1));
    let last = null;
    const ff = at.map((k) => { if (k >= 0) last = D.rows[k][4]; return last; });
    return { ix, at, ff, color: OVERLAY_COLORS[j] };
  });
  let pct = [], ratio = [];

  function compute(s, e) {
    pct = items.map(({ ff }) => {
      let b = s;
      while (b <= e && ff[b] == null) b++;
      const base = ff[b];
      return ff.map((v) => (v == null || base == null ? null : +((v / base - 1) * 100).toFixed(2)));
    });
    ratio = items.map(({ ix, at }) => {
      let sum = 0, n = 0;
      for (let i = s; i <= e; i++) if (at[i] >= 0) { sum += ix.d.rows[at[i]][5]; n++; }
      const mean = n ? sum / n : 1;
      return at.map((k) => (k < 0 || !mean ? null : +(ix.d.rows[k][5] / mean).toFixed(2)));
    });
  }

  function seriesData() {
    return [
      ...items.map((_, j) => ({ id: 'p' + j, data: pct[j] })),
      ...items.map((_, j) => ({ id: 'v' + j, data: ratio[j] })),
    ];
  }

  const [s0, e0] = opt.range;
  compute(s0, e0);
  const axisLine = { lineStyle: { color: T.axis } };
  const split = { show: true, lineStyle: { color: T.grid, type: 'dashed' } };

  chart.setOption({
    backgroundColor: T.bg,
    animation: false,
    legend: { top: 8, left: 8, textStyle: { color: T.strong }, itemWidth: 18, itemHeight: 4, data: items.map((it) => it.ix.name) },
    title: [
      { text: '区间累计涨跌幅（区间第一天 = 0%）', right: 72, top: 8, textStyle: { color: T.label, fontSize: 12, fontWeight: 'normal' } },
      { text: '成交量 ÷ 区间日均成交量（1.0 = 平均水平）', left: 8, top: '67%', textStyle: { color: T.label, fontSize: 12, fontWeight: 'normal' } },
    ],
    axisPointer: { link: [{ xAxisIndex: 'all' }], label: { backgroundColor: T.pointerBg, color: '#fff', borderRadius: 6 } },
    tooltip: {
      trigger: 'axis', backgroundColor: 'rgba(255,255,255,0.96)', borderColor: T.tipBorder, borderWidth: 1, extraCssText: T.tipCss, textStyle: { color: T.strong, fontSize: 12 },
      axisPointer: { type: 'cross', lineStyle: { color: T.pointer, type: 'dashed' }, crossStyle: { color: T.pointer, type: 'dashed' } },
      formatter(params) {
        const i = params[0].dataIndex;
        let h = `<b>${axis[i]} 周${weekday(axis[i])}</b><table style="margin-top:4px">`;
        items.forEach(({ ix, at, ff, color }, j) => {
          const p = pct[j][i];
          const c = p == null ? T.strong : p >= 0 ? UP : DOWN;
          const hol = at[i] < 0 ? ` <span style="color:${T.hol}">休市</span>` : '';
          h += `<tr><td><span style="color:${color}">●</span> ${ix.name}</td>`
            + `<td style="text-align:right;color:${c};padding-left:12px">${p == null ? '-' : (p >= 0 ? '+' : '') + p.toFixed(2) + '%'}</td>`
            + `<td style="text-align:right;padding-left:12px">${f2(ff[i])}${hol}</td>`
            + `<td style="text-align:right;padding-left:12px;color:${T.label}">量比 ${ratio[j][i] == null ? '-' : ratio[j][i].toFixed(2)}</td></tr>`;
        });
        return h + '</table>';
      },
    },
    grid: [
      { left: 8, right: 64, top: 40, bottom: '34%' },
      { left: 8, right: 64, top: '71%', bottom: 44 },
    ],
    xAxis: [
      { type: 'category', data: axis, gridIndex: 0, axisLine, axisTick: { show: false }, axisLabel: { show: false }, axisPointer: { label: { show: false } } },
      { type: 'category', data: axis, gridIndex: 1, axisLine, axisTick: { show: false }, axisLabel: { color: T.label } },
    ],
    yAxis: [
      { scale: true, gridIndex: 0, position: 'right', axisLine: { show: true, ...axisLine }, axisLabel: { color: T.strong, formatter: (v) => v + '%' }, splitLine: split },
      { gridIndex: 1, position: 'right', splitNumber: 2, axisLine: { show: true, ...axisLine }, axisLabel: { color: T.label }, splitLine: split },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], startValue: s0, endValue: e0, minValueSpan: 10 },
      {
        type: 'slider', xAxisIndex: [0, 1], startValue: s0, endValue: e0, bottom: 6, height: 20,
        borderColor: T.slider, fillerColor: T.sliderFill, textStyle: { color: T.label },
        dataBackground: { lineStyle: { color: T.sliderLine }, areaStyle: { color: T.sliderArea } },
        handleStyle: { color: T.handle, borderColor: T.handle }, moveHandleStyle: { color: T.handle },
      },
    ],
    series: [
      ...items.map(({ ix, color }, j) => ({
        id: 'p' + j, name: ix.name, type: 'line', data: pct[j], symbol: 'none', connectNulls: true,
        lineStyle: { width: 1.5, color }, itemStyle: { color },
        markLine: j === 0 ? { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: T.zero, type: 'solid' }, data: [{ yAxis: 0 }] } : undefined,
      })),
      ...items.map(({ ix, color }, j) => ({
        id: 'v' + j, name: ix.name, type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: ratio[j], symbol: 'none',
        lineStyle: { width: 1, color, opacity: 0.75 }, itemStyle: { color },
        markLine: j === 0 ? { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: T.zero, type: 'dashed' }, data: [{ yAxis: 1 }] } : undefined,
      })),
    ],
  });

  const ctrl = {
    chart, axis, range: [s0, e0],
    applyRange(s, e, dispatch) {
      ctrl.range = [s, e];
      compute(s, e);
      if (dispatch) chart.dispatchAction({ type: 'dataZoom', startValue: s, endValue: e });
      chart.setOption({ series: seriesData() });
    },
    setInfo() {},
    showCursor(i) {
      if (i == null) chart.dispatchAction({ type: 'hideTip' });
      else chart.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: i });
    },
  };
  chart.on('datazoom', () => {
    if (syncing) return;
    const [s, e] = visibleRange(chart);
    onZoom(ctrl, s, e);
  });
  chart.on('updateAxisPointer', (ev) => {
    const ax = (ev.axesInfo || []).find((a) => a.axisDim === 'x');
    cursor = ax ? Math.round(ax.value) : null;
  });
  return ctrl;
}

// ---------- 联动 ----------
function onZoom(src, s, e) {
  syncing = true;
  ctrls.forEach((c) => c.applyRange(s, e, c !== src));
  syncing = false;
  state.from = src.axis[s];
  state.to = src.axis[e];
  state.preset = null;
  syncRangeUI();
  renderStats();
  writeUrl();
}

function onCursor(src, i) {
  if (i === cursor) return;
  cursor = i;
  syncing = true;
  ctrls.forEach((c) => { if (c !== src) { c.showCursor(i); c.setInfo(i); } });
  syncing = false;
}

function moveCursor(step) {
  const c0 = ctrls[0];
  if (!c0) return;
  let [s, e] = c0.range;
  let i = cursor == null ? e : Math.min(c0.axis.length - 1, Math.max(0, cursor + step));
  if (i < s || i > e) {
    const shift = i < s ? i - s : i - e;
    s += shift; e += shift;
    syncing = true;
    ctrls.forEach((c) => c.applyRange(s, e, true));
    syncing = false;
    state.from = c0.axis[s]; state.to = c0.axis[e]; state.preset = null;
    syncRangeUI(); renderStats(); writeUrl();
  }
  cursor = i;
  syncing = true;
  ctrls.forEach((c) => { c.showCursor(i); c.setInfo(i); });
  syncing = false;
}

function zoomKey(zoomIn) {
  const c0 = ctrls[0];
  if (!c0) return;
  const [s, e] = c0.range;
  const len = e - s + 1;
  const newLen = zoomIn ? Math.max(10, Math.round(len * 0.8)) : Math.min(c0.axis.length, Math.round(len * 1.25) + 1);
  const ns = Math.max(0, e - newLen + 1);
  syncing = true;
  ctrls.forEach((c) => c.applyRange(ns, e, true));
  syncing = false;
  state.from = c0.axis[ns]; state.to = c0.axis[e]; state.preset = null;
  syncRangeUI(); renderStats(); writeUrl();
}

function applyDateRange() {
  syncing = true;
  ctrls.forEach((c) => {
    const [s, e] = toIdxRange(c.axis, state.from, state.to);
    c.applyRange(s, e, true);
  });
  syncing = false;
  syncRangeUI(); renderStats(); writeUrl();
}

// ---------- 渲染 ----------
function activeList() {
  return state.mode === 'single' ? [IDX[state.single]] : state.selected.map((k) => IDX[k]);
}

function render() {
  ctrls.forEach((c) => c.chart.dispose());
  ctrls = [];
  cursor = null;
  const box = $('#charts');
  box.innerHTML = '';
  const list = activeList();
  if (!list.length) {
    box.innerHTML = '<p class="hint" style="padding:40px 14px">请至少选择 1 个指数</p>';
    renderUI(); renderStats();
    return;
  }

  if (state.mode === 'single') {
    const ix = list[0];
    const el = document.createElement('div');
    el.className = 'chart';
    box.appendChild(el);
    ctrls.push(createKChart(el, ix, ix.d.dates, { slider: true, range: toIdxRange(ix.d.dates, state.from, state.to) }));
  } else if (state.view === 'grid') {
    const axis = unionDates(list);
    const range = toIdxRange(axis, state.from, state.to);
    list.forEach((ix, j) => {
      const el = document.createElement('div');
      el.className = 'chart compact' + (j === list.length - 1 ? ' last' : '');
      box.appendChild(el);
      ctrls.push(createKChart(el, ix, axis, { slider: j === list.length - 1, range }));
    });
  } else {
    const axis = unionDates(list);
    const el = document.createElement('div');
    el.className = 'chart';
    box.appendChild(el);
    ctrls.push(createOverlay(el, list, axis, { range: toIdxRange(axis, state.from, state.to) }));
  }
  renderUI();
  renderStats();
  writeUrl();
}

function renderUI() {
  document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === state.mode));
  $('#viewSeg').hidden = state.mode !== 'compare';
  document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
  $('#pickHint').textContent = state.mode === 'compare' ? `已选 ${state.selected.length} / ${MAX_COMPARE}` : '';

  const chips = $('#chips');
  chips.innerHTML = '';
  const markets = [...new Set(ORDER.map((k) => IDX[k].market))];
  markets.forEach((m) => {
    const g = document.createElement('div');
    g.className = 'group';
    g.innerHTML = `<span>${m}</span>`;
    ORDER.filter((k) => IDX[k].market === m).forEach((k) => {
      const b = document.createElement('button');
      const on = state.mode === 'single' ? state.single === k : state.selected.includes(k);
      b.className = 'chip' + (on ? ' on' : '');
      const ci = state.selected.indexOf(k);
      const showDot = state.mode === 'compare' && state.view === 'overlay' && ci >= 0;
      b.innerHTML = `<i style="background:${showDot ? OVERLAY_COLORS[ci] : 'transparent'};display:${showDot ? 'inline-block' : 'none'}"></i>${IDX[k].name}`;
      b.onclick = () => pickIndex(k);
      g.appendChild(b);
    });
    chips.appendChild(g);
  });
  syncRangeUI();
}

function syncRangeUI() {
  document.querySelectorAll('#presetSeg button').forEach((b) => b.classList.toggle('on', b.dataset.p === state.preset));
  $('#from').value = state.from;
  $('#to').value = state.to;
}

function pickIndex(k) {
  if (state.mode === 'single') {
    state.single = k;
  } else {
    const at = state.selected.indexOf(k);
    if (at >= 0) state.selected.splice(at, 1);
    else if (state.selected.length >= MAX_COMPARE) return toast(`最多同时对比 ${MAX_COMPARE} 个指数，请先取消一个`);
    else state.selected.push(k);
  }
  render();
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- 统计 ----------
function rangeRows(ix) {
  return ix.d.rows.filter((r) => r[0] >= state.from && r[0] <= state.to);
}

function statsOf(ix) {
  const rows = rangeRows(ix);
  if (rows.length < 2) return null;
  const first = rows[0], last = rows[rows.length - 1];
  let hi = rows[0], lo = rows[0], peak = rows[0][4], mdd = 0, sumV = 0;
  const rets = [];
  rows.forEach((r, i) => {
    if (r[2] > hi[2]) hi = r;
    if (r[3] < lo[3]) lo = r;
    peak = Math.max(peak, r[4]);
    mdd = Math.min(mdd, r[4] / peak - 1);
    sumV += r[5];
    if (i) rets.push(Math.log(r[4] / rows[i - 1][4]));
  });
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1));
  return { first, last, days: rows.length, chg: last[4] / first[4] - 1, hi, lo, mdd, vol: sd * Math.sqrt(252), avgV: sumV / rows.length };
}

function dailyReturns(ix) {
  const all = ix.d.rows, m = new Map();
  all.forEach((r, i) => {
    const p = i ? all[i - 1][4] : ix.d.prev[0];
    if (r[0] >= state.from && r[0] <= state.to) m.set(r[0], r[4] / p - 1);
  });
  return m;
}

function corr(a, b) {
  const xs = [], ys = [];
  a.forEach((v, d) => { if (b.has(d)) { xs.push(v); ys.push(b.get(d)); } });
  const n = xs.length;
  if (n < 5) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}

function renderStats() {
  const list = activeList();
  $('#statsRange').textContent = state.from && state.to ? `${state.from} ~ ${state.to}` : '';
  const pctTd = (v) => `<td class="${v > 0 ? 'up' : v < 0 ? 'dn' : ''}">${v > 0 ? '+' : ''}${(v * 100).toFixed(2)}%</td>`;
  let h = '<tr><th>指数</th><th>市场</th><th>交易日</th><th>起始收盘</th><th>最新收盘</th><th>区间涨跌幅</th><th>最高</th><th></th><th>最低</th><th></th><th>最大回撤</th><th>年化波动率</th><th>日均成交量</th></tr>';
  list.forEach((ix) => {
    const s = statsOf(ix);
    if (!s) { h += `<tr><td>${ix.name}</td><td>${ix.market}</td><td colspan="11" class="date">区间内数据不足</td></tr>`; return; }
    h += `<tr><td>${ix.name}</td><td>${ix.market}</td><td>${s.days}</td><td>${f2(s.first[4])}</td><td>${f2(s.last[4])}</td>${pctTd(s.chg)}`
      + `<td>${f2(s.hi[2])}</td><td class="date">${s.hi[0]}</td><td>${f2(s.lo[3])}</td><td class="date">${s.lo[0]}</td>`
      + `<td class="dn">${(s.mdd * 100).toFixed(2)}%</td><td>${(s.vol * 100).toFixed(2)}%</td><td>${fmtVol(s.avgV, 2)}${ix.volUnit || ''}</td></tr>`;
  });
  $('#stats').innerHTML = h;

  const wrap = $('#corrWrap');
  if (list.length < 2) { wrap.hidden = true; return; }
  wrap.hidden = false;
  const rets = list.map(dailyReturns);
  let c = '<tr><th></th>' + list.map((ix) => `<th style="text-align:center">${ix.name}</th>`).join('') + '</tr>';
  list.forEach((a, i) => {
    c += `<tr><td>${a.name}</td>`;
    list.forEach((b, j) => {
      const v = i === j ? 1 : corr(rets[i], rets[j]);
      const bg = v == null ? 'transparent' : v >= 0 ? `rgba(${T.corrPos},${(v * T.corrAlpha).toFixed(2)})` : `rgba(${T.corrNeg},${(-v * T.corrAlpha).toFixed(2)})`;
      c += `<td style="background:${bg}">${v == null ? '-' : v.toFixed(2)}</td>`;
    });
    c += '</tr>';
  });
  $('#corr').innerHTML = c;
}

// ---------- 网址参数 ----------
function readUrl() {
  const q = new URLSearchParams(location.search);
  if (q.get('m') === 'compare') state.mode = 'compare';
  if (IDX[q.get('i')]) state.single = q.get('i');
  if (q.has('s')) state.selected = [...new Set(q.get('s').split(',').filter((k) => IDX[k]))].slice(0, MAX_COMPARE);
  if (q.get('v') === 'overlay') state.view = 'overlay';
  const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
  if (PRESETS.some(([k]) => k === q.get('p'))) state.preset = q.get('p');
  else if (ok(q.get('from')) && ok(q.get('to'))) { state.preset = null; state.from = q.get('from'); state.to = q.get('to'); }
  if (state.preset) [state.from, state.to] = presetRange(state.preset);
}

function writeUrl() {
  const q = new URLSearchParams();
  q.set('m', state.mode);
  if (state.mode === 'single') q.set('i', state.single);
  else { q.set('s', state.selected.join(',')); q.set('v', state.view); }
  if (state.preset) q.set('p', state.preset);
  else { q.set('from', state.from); q.set('to', state.to); }
  history.replaceState(null, '', '?' + q.toString());
}

// ---------- 启动 ----------
async function init() {
  DATA = await (await fetch('../../data.json')).json();
  DATA.indices.forEach((ix) => { IDX[ix.key] = ix; ORDER.push(ix.key); prepare(ix); });
  $('#updated').textContent = DATA.updated;
  $('#from').min = $('#to').min = DATA.displayStart;
  $('#from').max = $('#to').max = DATA.updated;

  const ps = $('#presetSeg');
  PRESETS.forEach(([k, label]) => {
    const b = document.createElement('button');
    b.dataset.p = k;
    b.textContent = label;
    b.onclick = () => { state.preset = k; [state.from, state.to] = presetRange(k); applyDateRange(); };
    ps.appendChild(b);
  });
  document.querySelectorAll('#modeSeg button').forEach((b) => { b.onclick = () => { state.mode = b.dataset.mode; render(); }; });
  document.querySelectorAll('#viewSeg button').forEach((b) => { b.onclick = () => { state.view = b.dataset.view; render(); }; });
  const onDate = () => {
    let f = $('#from').value, t = $('#to').value;
    if (!f || !t) return;
    if (f > t) [f, t] = [t, f];
    state.from = f; state.to = t; state.preset = null;
    applyDateRange();
  };
  $('#from').onchange = onDate;
  $('#to').onchange = onDate;

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const act = { ArrowLeft: () => moveCursor(-1), ArrowRight: () => moveCursor(1), ArrowUp: () => zoomKey(true), ArrowDown: () => zoomKey(false), Escape: () => moveCursorOff() }[e.key];
    if (act) { e.preventDefault(); act(); }
  });
  window.addEventListener('resize', () => ctrls.forEach((c) => c.chart.resize()));

  readUrl();
  render();
}

function moveCursorOff() {
  cursor = null;
  syncing = true;
  ctrls.forEach((c) => { c.showCursor(null); c.setInfo(null); });
  syncing = false;
}

init();
