'use strict';
// ONOSOKKI DS2000 / Graduo のテキスト出力の読み込みとグラフ種の判定
(function (VT) {
  const P = VT.parser = {};

  const NUM_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
  P.num = s => (s != null && NUM_RE.test(String(s).trim())) ? parseFloat(s) : NaN;

  // Graduo は Shift_JIS で出力する。UTF-8 として不正なら Shift_JIS で読み直す
  P.decode = function (buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); } catch (e) { /* not UTF-8 */ }
    try { return new TextDecoder('shift_jis').decode(bytes); } catch (e) { /* decoder unavailable */ }
    return new TextDecoder('utf-8').decode(bytes);
  };

  function splitLine(line) {
    let parts = line.split(/[,\t;]/);
    if (parts.length === 1) parts = line.split(/\s+/);
    return parts.map(s => s.trim().replace(/^"(.*)"$/, '$1').trim());
  }
  function scaleOf(s) {
    s = String(s || '').toLowerCase();
    if (s.includes('log')) return 'log';
    if (s.includes('lin')) return 'linear';
    return null;
  }

  // テキスト → {meta, x, y}。ヘッダは「キー:, 値, ...」形式、データは「x, y」
  P.parse = function (text) {
    const headers = {};
    let x = [], y = [];
    let overall = null;
    for (const raw of text.split(/\r\n|\r|\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const parts = splitLine(line);
      const key = parts[0];
      if (key.endsWith(':')) {
        const name = key.slice(0, -1).trim();
        if (!(name in headers)) headers[name] = parts.slice(1).filter(s => s !== '');
        continue;
      }
      if (parts.length >= 2) {
        const a = P.num(parts[0]), b = P.num(parts[1]);
        if (!isNaN(a) && !isNaN(b)) { x.push(a); y.push(b); continue; }
        if (/^overall$/i.test(parts[0]) && !isNaN(b)) overall = b;
      }
    }
    // 周波数が昇順でなければ並べ替える（補間・積分の前提）
    for (let i = 1; i < x.length; i++) {
      if (x[i] < x[i - 1]) {
        const idx = x.map((_, k) => k).sort((p, q) => x[p] - x[q]);
        x = idx.map(k => x[k]);
        y = idx.map(k => y[k]);
        break;
      }
    }
    const h = k => headers[k] || [];
    const dk = h('DataKind'), fr = h('Frequency');
    // 計測器の出力は "Y-AxisMagniude"（t 抜け）。正しい綴りも受け付ける
    const magKey = Object.keys(headers).find(k => /^Y-AxisMagnit?ude$/i.test(k));
    const yScaleRaw = (h('Y-AxisScale')[0] || '').trim();
    const yUnit = h('Y-AxisUnit')[0] || '';
    const meta = {
      channel: dk[0] || '',
      graphType: dk[1] || '',
      subType: dk[2] || '',
      label: h('Label').join(', '),
      dateTime: h('DateTime').join(', '),
      freqMin: P.num(fr[0]),
      freqMax: P.num(fr[1]),
      xUnit: h('X-AxisUnit')[0] || fr[2] || '',
      yUnit,
      xScale: scaleOf(h('X-AxisScale')[0]),
      yScale: scaleOf(yScaleRaw),
      // Y-AxisScale が "Log"（"MagLog" ではない）のとき値は dB（例: FRF Mag = 20·log10|H|）
      yDb: /^log$/i.test(yScaleRaw) || /db/i.test(yUnit),
      yMag: magKey ? headers[magKey].slice() : [],
      overall,
      headers,
    };
    if (meta.yDb) meta.yScale = 'linear';
    return {meta, x, y};
  };

  // ── グラフ種 ────────────────────────────────────────────────────────────────
  P.KIND_ORDER = ['PSD', 'SPEC', 'FRF_Mag', 'FRF_Phase', 'FRF_Real', 'FRF_Imag', 'COH'];
  P.KIND_INFO = {
    PSD:       {label: 'PSD',       desc: 'パワースペクトル密度', yScale: 'log'},
    SPEC:      {label: 'Spectrum',  desc: 'パワースペクトル（0-p / rms）', yScale: 'log'},
    FRF_Mag:   {label: 'FRF Mag',   desc: '伝達関数 振幅', yScale: 'log'},
    FRF_Phase: {label: 'FRF Phase', desc: '伝達関数 位相', yScale: 'linear', yRange: [-190, 190], dtick: 90},
    FRF_Real:  {label: 'FRF Real',  desc: '伝達関数 実部', yScale: 'linear'},
    FRF_Imag:  {label: 'FRF Imag',  desc: '伝達関数 虚部', yScale: 'linear'},
    COH:       {label: 'Coherence', desc: 'コヒーレンス', yScale: 'linear', yRange: [0, 1.05]},
  };
  P.kindLabel = k => P.KIND_INFO[k] ? P.KIND_INFO[k].label : String(k || '').replace(/^X:/, '');
  P.kindDesc = k => P.KIND_INFO[k] ? P.KIND_INFO[k].desc : 'その他のデータ';

  P.classify = function (meta) {
    const g = meta.graphType.toLowerCase(), s = meta.subType.toLowerCase();
    const mags = meta.yMag.map(m => m.toLowerCase());
    if (g.includes('powerspec') || g === 'psd' || g.includes('autospec')) {
      // 「rms, PSD, V2」→ PSD [G²/Hz]、「0-p」「rms」→ 振幅スペクトル。指定なしは従来どおり PSD 扱い
      if (g === 'psd' || mags.includes('psd') || !mags.length) return 'PSD';
      return 'SPEC';
    }
    if (g.includes('frf') || g.includes('transfer')) {
      if (s.includes('real')) return 'FRF_Real';
      if (s.includes('imag')) return 'FRF_Imag';
      if (s.includes('phase')) return 'FRF_Phase';
      return 'FRF_Mag';
    }
    if (g.includes('coh')) return 'COH';
    return 'X:' + ([meta.graphType, meta.subType].filter(Boolean).join(' ') || 'Data');
  };

  // ── 既定の軸ラベル ──────────────────────────────────────────────────────────
  const prettyUnit = u => String(u || '').replace(/\^2/g, '²').replace(/\^3/g, '³');
  function quantity(u) {
    const s = String(u || '').toLowerCase().replace(/\s/g, '');
    if (['g', 'm/s^2', 'm/s2', 'm/s²', 'gal', 'mm/s^2', 'mm/s2'].includes(s)) return 'Acceleration';
    if (['m/s', 'mm/s', 'cm/s', 'kine'].includes(s)) return 'Velocity';
    if (['m', 'mm', 'um', 'µm', 'μm'].includes(s)) return 'Displacement';
    if (['v', 'mv'].includes(s)) return 'Voltage';
    if (['n', 'kn', 'kgf'].includes(s)) return 'Force';
    return 'Amplitude';
  }
  P.defaultXLabel = function (meta) {
    const u = (meta && meta.xUnit) || 'Hz';
    if (/^hz$/i.test(u)) return 'Frequency [Hz]';
    if (/^(s|sec|ms)$/i.test(u)) return `Time [${u}]`;
    return `X [${prettyUnit(u)}]`;
  };
  P.defaultYLabel = function (kind, meta) {
    meta = meta || {};
    const u = prettyUnit(meta.yUnit);
    if (meta.yDb && /^(PSD|SPEC|FRF_Mag)$/.test(kind)) {
      const name = {PSD: 'PSD', SPEC: quantity(meta.yUnit), FRF_Mag: 'FRF Magnitude'}[kind];
      return `${name} [${/db/i.test(u) ? u : 'dB'}]`;
    }
    switch (kind) {
      case 'PSD': {
        const base = u || 'G';
        return `PSD [${base.includes('/') ? `(${base})` : base}²/Hz]`;
      }
      case 'SPEC': {
        const mag = (meta.yMag || []).find(m => /0-p|rms|p-p/i.test(m)) || '';
        return `${quantity(meta.yUnit)} [${[u, mag].filter(Boolean).join(' ') || '-'}]`;
      }
      case 'FRF_Mag': return u ? `FRF Magnitude [${u}]` : 'FRF Magnitude';
      case 'FRF_Phase': return 'Phase [deg]';
      case 'FRF_Real': return u ? `FRF Real [${u}]` : 'FRF Real';
      case 'FRF_Imag': return u ? `FRF Imag [${u}]` : 'FRF Imag';
      case 'COH': return 'Coherence';
      default: return [P.kindLabel(kind), u ? `[${u}]` : ''].filter(Boolean).join(' ');
    }
  };

  // 色の共有キー: CH1-9（CH1 基準の CH9 応答）は CH9 と同じ色にする
  P.colorKey = function (ch) {
    const s = String(ch || '').trim();
    let m = s.match(/^CH\s*(\d+)\s*-\s*(?:CH)?\s*(\d+)$/i);
    if (m) return 'CH' + m[2];
    m = s.match(/^CH\s*(\d+)$/i);
    if (m) return 'CH' + m[1];
    return s;
  };

  // ファイル名群の共通部分からデータセット名を作る（例: TSUKUTO_PFM_modal_before_z_001.txt → TSUKUTO_PFM_modal_before_z）
  P.commonPrefixName = function (names) {
    if (!names.length) return '';
    const base = names.map(n => n.replace(/\.[^.]+$/, ''));
    let p = base[0];
    for (const n of base) {
      let i = 0;
      while (i < p.length && i < n.length && p[i] === n[i]) i++;
      p = p.slice(0, i);
    }
    return p.replace(/[\s_\-.(]*\d*$/, '').replace(/[\s_\-.(]+$/, '');
  };
})(globalThis.VT = globalThis.VT || {});
