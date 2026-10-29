'use strict';
// Plotly の図の組み立て・描画・画像出力
(function (VT) {
  const S = VT.state, P = VT.parser, A = VT.analysis, U = VT.util;
  const PL = VT.plot = {};

  PL.FONT = 'Arial, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif';
  PL.MONO = 'Consolas, Menlo, monospace';
  PL.INK = '#1c1b18';
  PL.SIGNAL = '#c54a1c';
  PL.PROFILE_COLOR = PL.INK;
  const LINE = '#3a3833', GRID = '#e5e3dd', MINOR = '#f2f1ed';

  const LEGEND_POS = {
    tr: {x: 0.99, y: 0.99, xanchor: 'right', yanchor: 'top'},
    tl: {x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top'},
    br: {x: 0.99, y: 0.01, xanchor: 'right', yanchor: 'bottom'},
    bl: {x: 0.01, y: 0.01, xanchor: 'left', yanchor: 'bottom'},
    out: {x: 1.02, y: 1, xanchor: 'left', yanchor: 'top'},
  };
  PL.LEGEND_LABEL = {auto: '自動', none: 'なし', tr: '右上', tl: '左上', br: '右下', bl: '左下', out: '外側（右）'};
  PL.EXPORT_SIZES = {screen: '画面サイズ', '640x400': '640 × 400', '800x500': '800 × 500', '1000x600': '1000 × 600', '1200x800': '1200 × 800'};

  const DICT = {
    'Zoom': 'ズーム', 'Pan': 'パン', 'Zoom in': '拡大', 'Zoom out': '縮小',
    'Click to enter Plot title': 'タイトル',
    'Click to enter X axis title': 'X 軸ラベル',
    'Click to enter Y axis title': 'Y 軸ラベル',
    'Click to enter Plot subtitle': ' ',   // サブタイトルは使わないので案内文を出さない
    'Double-click to zoom back out': 'ダブルクリックで全体表示',
  };

  // ── 範囲の計算 ──────────────────────────────────────────────────────────────
  function xExtent(list, positiveOnly) {
    let lo = Infinity, hi = -Infinity;
    for (const s of list) for (const v of s.x) {
      if (positiveOnly && !(v > 0)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return lo < hi ? [lo, hi] : null;
  }
  function yExtent(list, xr, xLog, positiveOnly) {
    let lo = Infinity, hi = -Infinity;
    for (const s of list) {
      for (let i = 0; i < s.x.length; i++) {
        const xv = s.x[i], v = s.y[i];
        if (xLog && !(xv > 0)) continue;
        if (xr && (xv < xr[0] || xv > xr[1])) continue;
        if (!Number.isFinite(v) || (positiveOnly && !(v > 0))) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    return lo <= hi ? [lo, hi] : null;
  }
  function xRangeOf(win, list) {
    const log = win.x.scale === 'log';
    let lo = win.x.min, hi = win.x.max;
    if (log && lo != null && !(lo > 0)) lo = null;
    if (log && hi != null && !(hi > 0)) hi = null;
    if (lo == null || hi == null) {
      const e = xExtent(list, log);
      if (!e) return null;
      if (lo == null) lo = e[0];
      if (hi == null) hi = e[1];
    }
    return hi > lo ? [lo, hi] : null;
  }

  function axisStyle(log, title) {
    const ax = {
      title: {text: title, standoff: 6},
      showline: true, linecolor: LINE, linewidth: 1, mirror: true,
      ticks: 'outside', ticklen: 4, tickcolor: LINE,
      showgrid: true, gridcolor: GRID, zeroline: false, automargin: true,
    };
    if (log) ax.minor = {showgrid: true, gridcolor: MINOR, ticks: '', dtick: 'D1'};
    return ax;
  }

  // Y 軸（Log 指定でも負値があれば疑似対数に切り替える）
  function yAxisSpec(win, key, list, xr, kind) {
    const st = win[key];
    const log = st.scale === 'log';
    const xLog = win.x.scale === 'log';
    const hasNeg = log && list.some(s => s.y.some((v, i) => v < 0 && (!xLog || s.x[i] > 0)));
    if (hasNeg) {
      const e = yExtent(list, null, xLog, false) || [-1, 1];
      const sym = A.symlog(Math.max(Math.abs(e[0]), Math.abs(e[1])));
      let lo = st.min != null ? st.min : e[0], hi = st.max != null ? st.max : e[1];
      if (!(hi > lo)) { lo = e[0]; hi = e[1]; }
      const pad = (sym.f(hi) - sym.f(lo)) * 0.04;
      const t = A.symlogTicks(sym, lo, hi);
      return {sym, axis: {type: 'linear', range: [sym.f(lo) - pad, sym.f(hi) + pad], tickmode: 'array', tickvals: t.tickvals, ticktext: t.ticktext}};
    }
    const ax = {type: log ? 'log' : 'linear'};
    if (log) ax.exponentformat = 'power';
    let lo = st.min, hi = st.max;
    if (log && lo != null && !(lo > 0)) lo = null;
    if (log && hi != null && !(hi > 0)) hi = null;
    const toAx = v => log ? Math.log10(v) : v;
    if (lo != null && hi != null && hi > lo) {
      ax.range = [toAx(lo), toAx(hi)];
    } else if (lo != null || hi != null) {
      const e = yExtent(list, xr, xLog, log);
      const a = lo != null ? lo : e && e[0], b = hi != null ? hi : e && e[1];
      if (a != null && b != null && b > a) ax.range = [toAx(a), toAx(b)]; else ax.autorange = true;
    } else {
      const info = P.KIND_INFO[kind];
      const def = !log && info && info.yRange;
      const e = def ? yExtent(list, null, xLog, false) : null;
      if (def && e && e[0] >= def[0] && e[1] <= def[1]) {
        ax.range = def.slice();
        if (info.dtick) { ax.dtick = info.dtick; ax.tick0 = 0; }
      } else ax.autorange = true;
    }
    return {sym: null, axis: ax};
  }

  // プロファイル値（線形量）を、そのグラフの Y1 の値に合わせる（dB で記録された種類なら dB に直す）
  PL.profileValue = function (win, v) {
    if (v == null) return null;
    const s = S.sampleOf(win.y1Kind);
    return s && s.meta.yDb ? A.dbScale(win.y1Kind) * Math.log10(v) : v;
  };

  // ── 図の組み立て ────────────────────────────────────────────────────────────
  PL.build = function (win) {
    const {y1, y2} = S.windowSeries(win);
    const dsIds = S.windowDatasetIds(win);
    const multi = dsIds.length > 1;
    const vis1 = y1.filter(s => !win.hidden[s.id]);
    const vis2 = y2.filter(s => !win.hidden[s.id]);
    const xLog = win.x.scale === 'log';
    const visAll = vis1.concat(vis2);
    const xr = xRangeOf(win, visAll.length ? visAll : y1.concat(y2));
    const hasY2 = !!win.y2Kind;
    const Y1 = yAxisSpec(win, 'y', vis1, xr, win.y1Kind);
    const Y2 = hasY2 ? yAxisSpec(win, 'y2', vis2, xr, win.y2Kind) : null;

    const traces = [], ids = [];
    const addSeries = (s, axis, sym) => {
      const di = Math.max(0, dsIds.indexOf(s.datasetId));
      traces.push({
        type: 'scatter', mode: 'lines', x: s.x, y: sym ? s.y.map(sym.f) : s.y,
        name: S.seriesName(s, multi), yaxis: axis === 2 ? 'y2' : 'y',
        line: {color: S.colorOf(s), width: win.lineWidth, dash: (axis === 2 ? S.DASH2 : S.DASH1)[di % 6]},
        hoverinfo: 'skip',
      });
      ids.push(s.id);
    };
    vis1.forEach(s => addSeries(s, 1, Y1.sym));
    vis2.forEach(s => addSeries(s, 2, Y2 && Y2.sym));

    // 加振プロファイルと許容帯（PSD・Spectrum）
    const prof = S.profileOf(win.y1Kind), pts = prof ? prof.points : [];
    if (win.showProfile && pts.length >= 2) {
      const tf = v => { const u = PL.profileValue(win, v); return Y1.sym ? Y1.sym.f(u) : u; };
      const k = A.dbScale(win.y1Kind);
      const up = Math.pow(10, prof.tolPlus / k), dn = Math.pow(10, -prof.tolMinus / k);
      // 点の間は両対数で直線。Y 軸が線形・dB でも形が合うよう細かく刻む（角の点も含める）
      const f0 = pts[0].f, f1 = pts[pts.length - 1].f, N = 240;
      const fs = U.unique(pts.map(p => p.f).concat(Array.from({length: N + 1}, (_, i) => U.clamp(f0 * Math.pow(f1 / f0, i / N), f0, f1))))
        .sort((a, b) => a - b);
      const vs = fs.map(f => A.profileAt(pts, f));
      traces.push({type: 'scatter', mode: 'lines', x: fs.concat(fs.slice().reverse()),
        y: vs.map(v => tf(v * up)).concat(vs.map(v => tf(v * dn)).reverse()),
        fill: 'toself', fillcolor: 'rgba(28,27,24,0.06)', line: {color: 'rgba(28,27,24,0.4)', width: 1, dash: 'dot'},
        hoverinfo: 'skip', showlegend: false, name: 'tolerance'});
      ids.push(null);
      traces.push({type: 'scatter', mode: 'lines', x: fs, y: vs.map(tf),
        name: prof.name, line: {color: PL.PROFILE_COLOR, width: 2}, hoverinfo: 'skip'});
      ids.push('__profile__');
    }

    // 自動: 系列が多いと凡例がデータを覆うので隠す（画面上は系列パネルが凡例を兼ねる）
    const nNamed = ids.filter(Boolean).length;
    // コヒーレンスは上端（≈1）にデータが集まるので右下に置く
    const legendPos = win.legend.pos === 'auto' ? (nNamed > 8 ? 'none' : win.y1Kind === 'COH' ? 'br' : 'tr') : win.legend.pos;
    const legendBase = Object.assign({}, LEGEND_POS[legendPos] || LEGEND_POS.tr);
    if (legendPos === 'out' && hasY2) legendBase.x = 1.12;
    const layout = {
      font: {family: PL.FONT, size: 12, color: PL.INK},
      paper_bgcolor: '#ffffff', plot_bgcolor: '#ffffff',
      // 上の余白はタイトルと、枠の上に付けるカーソル値の分
      margin: {l: 62, r: hasY2 ? 58 : 16, t: win.showTitle ? 44 : 22, b: 44, pad: 0},
      // タイトルはプロット領域の左端にそろえる
      title: win.showTitle ? {text: S.titleOf(win), font: {size: 13, weight: 700},
        x: 0, xref: 'paper', xanchor: 'left', y: 1, yref: 'container', yanchor: 'top', pad: {t: 10}} : {text: ''},
      showlegend: legendPos !== 'none' && nNamed > 0,
      legend: Object.assign({bgcolor: 'rgba(255,255,255,0.92)', bordercolor: '#bdb9af', borderwidth: 1,
        font: {size: 11}, itemclick: false, itemdoubleclick: false, tracegroupgap: 2}, legendBase, win.legend.custom || {}),
      modebar: {bgcolor: 'rgba(255,255,255,0.92)', color: '#8a867c', activecolor: PL.INK},
      xaxis: Object.assign(axisStyle(xLog, S.labelOf(win, 'xLabel')), {type: xLog ? 'log' : 'linear'}),
      yaxis: Object.assign(axisStyle(Y1.axis.type === 'log', S.labelOf(win, 'yLabel')), Y1.axis, hasY2 ? {mirror: false} : {}),
      hovermode: false,
      dragmode: win.dragmode || 'zoom',
      shapes: [], annotations: [],
    };
    if (xr) layout.xaxis.range = xLog ? [Math.log10(xr[0]), Math.log10(xr[1])] : xr.slice();
    else layout.xaxis.autorange = true;
    if (hasY2) {
      layout.yaxis2 = Object.assign(axisStyle(Y2.axis.type === 'log', S.labelOf(win, 'y2Label')), Y2.axis,
        {overlaying: 'y', side: 'right', showgrid: false, mirror: false});
      delete layout.yaxis2.minor;
    }

    // ピーク注釈（このグラフに表示中のチャンネルのみ）
    if (win.showPeaks && S.peaks && S.peaks.length) {
      const keys = new Set(visAll.map(s => s.datasetId + '|' + P.colorKey(s.channel)));
      S.peaks.forEach((pk, i) => {
        if (!keys.has(pk.datasetId + '|' + pk.colorKey)) return;
        if (xr && (pk.freq < xr[0] || pk.freq > xr[1])) return;
        layout.shapes.push({type: 'line', xref: 'x', yref: 'paper', x0: pk.freq, x1: pk.freq, y0: 0, y1: 1,
          line: {color: pk.color, width: 1, dash: 'dot'}, opacity: 0.75});
        // 注釈の x は対数軸では log10 値で指定する（Plotly の仕様）。凡例と重ならないよう下端に置く
        layout.annotations.push({xref: 'x', yref: 'paper', x: xLog ? Math.log10(pk.freq) : pk.freq, y: 0,
          yanchor: 'bottom', xanchor: 'center', yshift: 3, textangle: -90, showarrow: false,
          text: `[${i + 1}] ${U.fmtF(pk.freq)} Hz`, font: {size: 10, color: pk.color},
          bgcolor: 'rgba(255,255,255,0.8)', borderpad: 1, captureevents: false});
      });
    }

    // 固定したカーソルは図の一部として描く（画像出力にも残る）
    const cx = VT.win.cursorXFor(win);
    if (S.cursor.locked && cx != null && (!xr || (cx >= xr[0] && cx <= xr[1])) && (!xLog || cx > 0)) {
      layout.shapes.push({type: 'line', xref: 'x', yref: 'paper', x0: cx, x1: cx, y0: 0, y1: 1,
        line: {color: PL.SIGNAL, width: 1.5, dash: 'dash'}});
      // 値は枠の上に付ける（凡例やデータに重ならない）。右半分では線の左側に出す
      const ax = v => xLog ? Math.log10(v) : v;
      const right = !!xr && (ax(cx) - ax(xr[0])) / (ax(xr[1]) - ax(xr[0])) > 0.5;
      layout.annotations.push({xref: 'x', yref: 'paper', x: ax(cx), y: 1,
        xanchor: right ? 'right' : 'left', yanchor: 'bottom', showarrow: false,
        text: `${U.fmtX(cx)} ${S.xUnitOf(win)}`, font: {family: PL.MONO, size: 10.5, color: '#ffffff'},
        bgcolor: PL.SIGNAL, borderpad: 2, captureevents: false});
    }
    return {traces, layout, meta: {ids, sym1: Y1.sym, sym2: Y2 && Y2.sym, xr, multi}};
  };

  PL.config = function (win) {
    return {
      displaylogo: false, responsive: false, scrollZoom: true, doubleClick: false, showTips: true,
      displayModeBar: 'hover',
      modeBarButtons: [['zoom2d', 'pan2d'], ['zoomIn2d', 'zoomOut2d', {
        name: 'vt-reset', title: '全体表示', icon: Plotly.Icons.home,
        click: () => VT.app.resetAxes(win),
      }]],
      edits: {titleText: !!win.showTitle, axisTitleText: true, legendText: true, legendPosition: true},
      locale: 'ja', locales: {ja: {dictionary: DICT}},
    };
  };

  // ── 描画とイベント ──────────────────────────────────────────────────────────
  PL.render = function (win) {
    const gd = win.rt.gd;
    if (!gd || !gd.isConnected) return Promise.resolve();
    const b = PL.build(win);
    win.rt.meta = b.meta;
    let p;
    try { p = Plotly.react(gd, b.traces, b.layout, PL.config(win)); } catch (e) { console.error(e); return Promise.resolve(); }
    if (!win.rt.bound) {
      win.rt.bound = true;
      gd.on('plotly_relayout', ev => onRelayout(win, ev));
      gd.on('plotly_restyle', ev => onRestyle(win, ev));
    }
    return Promise.resolve(p).then(() => VT.win.afterRender(win)).catch(e => console.error(e));
  };
  PL.renderAll = () => Promise.all(S.windows.map(PL.render));

  function readRange(win, axName, sym) {
    const ax = win.rt.gd._fullLayout && win.rt.gd._fullLayout[axName];
    if (!ax || !ax.range) return null;
    let a = ax.range[0], b = ax.range[1];
    if (sym) { a = sym.inv(a); b = sym.inv(b); } else if (ax.type === 'log') { a = Math.pow(10, a); b = Math.pow(10, b); }
    return [+(+a).toPrecision(6), +(+b).toPrecision(6)];
  }

  function onRelayout(win, ev) {
    if (!ev) return;
    let labels = false;
    const changed = [];
    for (const [k, v] of Object.entries(ev)) {
      if (k === 'title.text') { win.title = String(v).trim() || null; labels = true; }
      else if (k === 'xaxis.title.text') { win.xLabel = String(v).trim() ? v : null; labels = true; }
      else if (k === 'yaxis.title.text') { win.yLabel = String(v).trim() ? v : null; labels = true; }
      else if (k === 'yaxis2.title.text') { win.y2Label = String(v).trim() ? v : null; labels = true; }
      else if (k.startsWith('legend.')) { win.legend.custom = Object.assign({}, win.legend.custom, {[k.slice(7)]: v}); }
      else if (k === 'dragmode') win.dragmode = v;
    }
    const meta = win.rt.meta || {};
    for (const [axName, key, sym] of [['xaxis', 'x', null], ['yaxis', 'y', meta.sym1], ['yaxis2', 'y2', meta.sym2]]) {
      if (ev[axName + '.autorange'] === true) { win[key].min = null; win[key].max = null; changed.push(key); }
      else if ((axName + '.range[0]') in ev || (axName + '.range[1]') in ev || (axName + '.range') in ev) {
        const r = readRange(win, axName, sym);
        if (r) { win[key].min = r[0]; win[key].max = r[1]; changed.push(key); }
      }
    }
    if (!labels && !changed.length) return;
    setTimeout(() => {
      if (labels) VT.app.onLabelsChanged(win);
      if (changed.length) VT.app.onRangesChanged(win, changed);
    }, 0);
  }

  // 凡例テキストの直接編集 → 系列名に反映
  function onRestyle(win, ev) {
    if (!Array.isArray(ev) || !ev[0] || !('name' in ev[0])) return;
    const names = [].concat(ev[0].name), idx = [].concat(ev[1] == null ? [] : ev[1]);
    const ids = (win.rt.meta && win.rt.meta.ids) || [];
    let profile = false;
    idx.forEach((ti, k) => {
      const id = ids[ti];
      const v = String(names[k] != null ? names[k] : names[0] || '').trim();
      const pr = id === '__profile__' && S.profileOf(win.y1Kind);
      if (pr) { pr.name = v || '加振プロファイル'; profile = true; }
      else if (id) { const s = S.seriesById(id); if (s) s.name = v || null; }
    });
    // プロファイル名は保存もする
    setTimeout(() => (profile ? VT.app.onProfileChanged() : VT.app.onSeriesRenamed()), 0);
  }

  // ── 座標変換（カーソル表示用） ──────────────────────────────────────────────────
  PL.geom = function (win) {
    const gd = win.rt.gd, fl = gd && gd._fullLayout;
    if (!fl || !fl._size || !fl.xaxis || !fl.xaxis.range) return null;
    const s = fl._size, xa = fl.xaxis;
    return {l: s.l, t: s.t, w: s.w, h: s.h, r0: xa.range[0], r1: xa.range[1], log: xa.type === 'log'};
  };
  PL.xToPx = (g, x) => {
    const v = g.log ? (x > 0 ? Math.log10(x) : NaN) : x;
    return g.l + (v - g.r0) / (g.r1 - g.r0) * g.w;
  };
  PL.pxToX = (g, px) => {
    const v = g.r0 + (px - g.l) / g.w * (g.r1 - g.r0);
    return g.log ? Math.pow(10, v) : v;
  };

  // ── 画像出力 ────────────────────────────────────────────────────────────────
  PL.exportDims = function (win) {
    const gd = win.rt.gd;
    if (win.exportSize && win.exportSize !== 'screen') {
      const [w, h] = win.exportSize.split('x').map(Number);
      return {width: w, height: h, scale: 2};
    }
    return {width: Math.max(200, gd.clientWidth), height: Math.max(150, gd.clientHeight), scale: 2};
  };
  PL.fileBase = win => U.safeName(S.titleOf(win)) || 'graph';
  PL.download = async function (win, format) {
    const d = PL.exportDims(win);
    await Plotly.downloadImage(win.rt.gd, {format, width: d.width, height: d.height, scale: format === 'svg' ? 1 : d.scale, filename: PL.fileBase(win)});
  };
  PL.copy = async function (win) {
    const d = PL.exportDims(win);
    const url = await Plotly.toImage(win.rt.gd, Object.assign({format: 'png'}, d));
    if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) throw new Error('このブラウザは画像コピー非対応');
    const blob = await (await fetch(url)).blob();
    await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
  };
  // 配置どおりに全グラフを 1 枚の PNG にまとめる（各グラフはウィンドウ本体の大きさで描き直す）
  PL.exportWorkspace = async function () {
    let wins = S.windows.filter(w => w.rt.gd && w.rt.gd.clientWidth > 0);
    const maxed = wins.find(w => w.maximized);
    if (maxed) wins = [maxed];
    if (!wins.length) throw new Error('グラフなし');
    const boxes = wins.sort((a, b) => a.z - b.z).map(w => ({w, r: w.rt.el.querySelector('.win-body').getBoundingClientRect()}));
    const pad = 8, scale = 2;
    const x0 = Math.min(...boxes.map(b => b.r.left)) - pad, y0 = Math.min(...boxes.map(b => b.r.top)) - pad;
    const x1 = Math.max(...boxes.map(b => b.r.right)) + pad, y1 = Math.max(...boxes.map(b => b.r.bottom)) + pad;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round((x1 - x0) * scale);
    canvas.height = Math.round((y1 - y0) * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const {w, r} of boxes) {
      const url = await Plotly.toImage(w.rt.gd, {format: 'png', width: Math.round(r.width), height: Math.round(r.height), scale});
      const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
      ctx.drawImage(img, Math.round((r.left - x0) * scale), Math.round((r.top - y0) * scale));
      ctx.strokeStyle = '#bdb9af';
      ctx.lineWidth = scale;
      ctx.strokeRect(Math.round((r.left - x0) * scale), Math.round((r.top - y0) * scale), Math.round(r.width * scale), Math.round(r.height * scale));
    }
    U.download(canvas.toDataURL('image/png'), `VTplot_workspace_${U.stamp()}.png`);
  };
})(globalThis.VT = globalThis.VT || {});
