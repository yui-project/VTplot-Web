'use strict';
// アプリ全体の状態（データセット・系列・グラフウィンドウ）とセッションの保存形式
(function (VT) {
  const P = VT.parser, U = VT.util;

  const TAB10 = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
                 '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'];
  // データセットごとの線種（Y1 / Y2）
  const DASH1 = ['solid', 'dash', 'dot', 'dashdot', 'longdash', 'longdashdot'];
  const DASH2 = ['dot', 'dashdot', 'longdashdot', 'dash', 'longdash', 'solid'];

  // 加振プロファイルはランダム（PSD）と正弦波掃引（Spectrum）で別々に持つ。許容幅の既定は ±3 dB / ±1 dB
  const PROFILE_KINDS = ['PSD', 'SPEC'];
  const DEFAULT_TOL = {PSD: 3, SPEC: 1};
  const defaultProfiles = () => Object.fromEntries(PROFILE_KINDS.map(k =>
    [k, {points: [], tolPlus: DEFAULT_TOL[k], tolMinus: DEFAULT_TOL[k], name: '加振プロファイル'}]));

  const S = VT.state = {
    datasets: [],      // [{id, name}]
    series: [],        // [{id, datasetId, file, path, channel, kind, meta, x, y, name, color}]
    windows: [],       // グラフウィンドウ（下の makeWindow 参照）
    channelAlias: {},  // チャンネル → 表示名
    channelColors: {}, // 色キー（CH9 など）→ 色
    profiles: defaultProfiles(),   // 種類（PSD / SPEC）→ {points, tolPlus, tolMinus, name}
    peaks: null,       // ピーク解析結果
    cursor: {x: null, locked: false, winId: null, unit: null},
    link: {cursor: true, x: true},
    activeWinId: null,
    zTop: 10,
    _extraColors: {},
  };
  S.TAB10 = TAB10;
  S.DASH1 = DASH1;
  S.DASH2 = DASH2;
  S.PROFILE_KINDS = PROFILE_KINDS;

  // プロファイルを持てない種類は null
  S.profileOf = kind => S.profiles[kind] || null;
  // 保存されていたプロファイルを既定値に重ねる（legacy: 1 つだけ持っていた頃の PSD 用）
  S.mergeProfiles = function (saved, legacy) {
    const out = defaultProfiles();
    if (legacy && Array.isArray(legacy.points)) Object.assign(out.PSD, legacy);
    for (const k of PROFILE_KINDS) if (saved && saved[k] && Array.isArray(saved[k].points)) Object.assign(out[k], saved[k]);
    return out;
  };

  S.dataset = id => S.datasets.find(d => d.id === id);
  S.seriesById = id => S.series.find(s => s.id === id);
  S.win = id => S.windows.find(w => w.id === id);
  S.activeWin = () => S.win(S.activeWinId);

  S.kinds = function () {
    const set = new Set(S.series.map(s => s.kind));
    const known = P.KIND_ORDER.filter(k => set.has(k));
    return known.concat([...set].filter(k => !P.KIND_ORDER.includes(k)).sort());
  };
  S.kindCount = kind => S.series.filter(s => s.kind === kind).length;
  S.sampleOf = kind => S.series.find(s => s.kind === kind);

  // ── 名前と色 ────────────────────────────────────────────────────────────────
  S.autoColor = function (key) {
    const m = /^CH(\d+)$/.exec(key);
    if (m) return TAB10[((+m[1] - 1) % 10 + 10) % 10];
    if (!S._extraColors[key]) S._extraColors[key] = TAB10[Object.keys(S._extraColors).length % 10];
    return S._extraColors[key];
  };
  S.keyColor = key => S.channelColors[key] || S.autoColor(key);
  S.colorOf = s => s.color || S.keyColor(P.colorKey(s.channel));
  S.channelName = ch => S.channelAlias[ch] || ch;
  S.seriesName = (s, withDataset) => s.name ||
    (S.channelName(s.channel) + (withDataset ? ` (${(S.dataset(s.datasetId) || {}).name || ''})` : ''));

  // ── データセット / 系列 ────────────────────────────────────────────────────────
  S.uniqueDatasetName = function (name) {
    const base = name || `データ ${S.datasets.length + 1}`;
    let n = base, i = 2;
    while (S.datasets.some(d => d.name === n)) n = `${base} (${i++})`;
    return n;
  };
  S.addDataset = function (name) {
    const ds = {id: U.uid('d'), name: S.uniqueDatasetName(name)};
    S.datasets.push(ds);
    return ds;
  };
  S.addSeries = function (ds, parsed, file, path) {
    const s = {
      id: U.uid('s'), datasetId: ds.id, file, path: path || file,
      channel: parsed.meta.channel || file.replace(/\.[^.]+$/, ''),
      kind: P.classify(parsed.meta), meta: parsed.meta,
      x: parsed.x, y: parsed.y, name: null, color: null,
    };
    S.series.push(s);
    return s;
  };
  S.removeDataset = function (id) {
    S.datasets = S.datasets.filter(d => d.id !== id);
    S.series = S.series.filter(s => s.datasetId !== id);
    for (const w of S.windows) if (w.datasets) w.datasets = w.datasets.filter(d => d !== id);
    if (S.peaks) S.peaks = S.peaks.filter(p => p.datasetId !== id);
  };

  // ウィンドウに属する系列（データセット絞り込み済み・非表示含む）
  S.windowSeries = function (win) {
    const allowed = win.datasets ? new Set(win.datasets) : null;
    const order = new Map(S.datasets.map((d, i) => [d.id, i]));
    const pick = kind => !kind ? [] : S.series
      .filter(s => s.kind === kind && (!allowed || allowed.has(s.datasetId)))
      .sort((a, b) => (order.get(a.datasetId) - order.get(b.datasetId)) || U.naturalCompare(a.channel, b.channel));
    return {y1: pick(win.y1Kind), y2: pick(win.y2Kind)};
  };
  S.windowDatasetIds = function (win) {
    const {y1, y2} = S.windowSeries(win);
    const present = new Set(y1.concat(y2).map(s => s.datasetId));
    return S.datasets.filter(d => present.has(d.id)).map(d => d.id);
  };
  S.dashOf = (win, s, axis) => {
    const ids = S.windowDatasetIds(win);
    const i = Math.max(0, ids.indexOf(s.datasetId));
    return (axis === 2 ? DASH2 : DASH1)[i % DASH1.length];
  };
  S.xUnitOf = function (win) {
    const s = S.sampleOf(win.y1Kind);
    return (s && s.meta.xUnit) || 'Hz';
  };

  // ── グラフウィンドウ ──────────────────────────────────────────────────────────
  function defaultYScale(kind) {
    const s = S.sampleOf(kind);
    if (s && s.meta.yDb) return 'linear';
    const info = P.KIND_INFO[kind];
    return (info && info.yScale) || (s && s.meta.yScale) || 'linear';
  }
  function defaultXScale(kind) {
    const s = S.sampleOf(kind);
    if (s && s.meta.xScale) return s.meta.xScale;
    return /^hz$/i.test((s && s.meta.xUnit) || 'Hz') ? 'log' : 'linear';
  }
  S.makeWindow = function (opts = {}) {
    const kind = opts.y1Kind;
    return {
      id: U.uid('w'),
      title: null, showTitle: true,
      xLabel: null, yLabel: null, y2Label: null,
      y1Kind: kind, y2Kind: opts.y2Kind || null,
      datasets: opts.datasets || null,   // null = すべてのデータセット（後から読み込んだものも含む）
      hidden: {},                        // 系列 ID → 非表示
      x: {scale: defaultXScale(kind), min: null, max: null},
      y: {scale: defaultYScale(kind), min: null, max: null},
      y2: {scale: opts.y2Kind ? defaultYScale(opts.y2Kind) : 'linear', min: null, max: null},
      legend: {pos: 'auto', custom: null},
      lineWidth: 1.5,
      showProfile: true, showPeaks: true,
      showPanel: opts.showPanel !== false,
      exportSize: 'screen',
      dragmode: 'zoom',
      rect: opts.rect || {x: 0.02, y: 0.03, w: 0.5, h: 0.5},
      z: ++S.zTop,
      maximized: false,
      rt: {},   // 実行時の DOM 参照など（保存しない）
    };
  };
  S.setWindowKind = function (win, axis, kind) {
    if (axis === 1) { win.y1Kind = kind; win.y = {scale: defaultYScale(kind), min: null, max: null}; win.yLabel = null; }
    else { win.y2Kind = kind || null; win.y2 = {scale: kind ? defaultYScale(kind) : 'linear', min: null, max: null}; win.y2Label = null; }
    win.hidden = {};
  };

  S.autoTitle = function (win) {
    let t = P.kindLabel(win.y1Kind);
    if (win.y2Kind) t += ' / ' + P.kindLabel(win.y2Kind);
    const ds = S.windowDatasetIds(win);
    if (ds.length === 1 && S.datasets.length > 1) t += ' — ' + S.dataset(ds[0]).name;
    return t;
  };
  S.titleOf = win => (win.title != null && win.title !== '') ? win.title : S.autoTitle(win);
  S.autoXLabel = win => P.defaultXLabel((S.sampleOf(win.y1Kind) || {}).meta);
  S.autoYLabel = (win, axis) => {
    const k = axis === 2 ? win.y2Kind : win.y1Kind;
    return P.defaultYLabel(k, (S.sampleOf(k) || {}).meta);
  };
  S.labelOf = (win, which) => {
    const v = win[which];
    if (v != null && v !== '') return v;
    return which === 'xLabel' ? S.autoXLabel(win) : S.autoYLabel(win, which === 'y2Label' ? 2 : 1);
  };

  // ── セッション（JSON） ───────────────────────────────────────────────────────
  S.serialize = function () {
    return {
      app: 'VTplot Web', version: 1, savedAt: new Date().toISOString(),
      datasets: S.datasets,
      series: S.series,
      channelAlias: S.channelAlias,
      channelColors: S.channelColors,
      profiles: S.profiles,
      link: S.link,
      activeWinId: S.activeWinId,
      windows: S.windows.map(w => { const o = Object.assign({}, w); delete o.rt; return o; }),
    };
  };
  S.restore = function (obj) {
    if (!obj || obj.app !== 'VTplot Web' || !Array.isArray(obj.series)) throw new Error('非対応のファイル');
    S.datasets = obj.datasets || [];
    S.series = obj.series;
    S.channelAlias = obj.channelAlias || {};
    S.channelColors = obj.channelColors || {};
    S.profiles = S.mergeProfiles(obj.profiles, obj.profile);
    S.link = Object.assign({cursor: true, x: true}, obj.link || {});
    S.peaks = null;
    S.cursor = {x: null, locked: false, winId: null, unit: null};
    S._extraColors = {};
    S.windows = (obj.windows || []).filter(w => w && w.y1Kind).map(w => {
      const base = S.makeWindow({y1Kind: w.y1Kind});
      return Object.assign(base, w, {
        x: Object.assign(base.x, w.x), y: Object.assign(base.y, w.y), y2: Object.assign(base.y2, w.y2),
        legend: Object.assign(base.legend, w.legend), hidden: w.hidden || {}, rt: {},
      });
    });
    S.zTop = Math.max(10, ...S.windows.map(w => w.z || 0));
    S.activeWinId = S.win(obj.activeWinId) ? obj.activeWinId : (S.windows[0] || {}).id || null;
  };
  S.reset = function () {
    S.datasets = [];
    S.series = [];
    S.windows = [];
    S.channelAlias = {};
    S.channelColors = {};
    S.peaks = null;
    S.cursor = {x: null, locked: false, winId: null, unit: null};
    S.activeWinId = null;
    S._extraColors = {};
  };
})(globalThis.VT = globalThis.VT || {});
