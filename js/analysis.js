'use strict';
// 数値計算: 補間・積分・加振プロファイル・疑似対数・ピーク（共振）解析
(function (VT) {
  const A = VT.analysis = {};

  A.bisect = function (arr, x) {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; }
    return lo;
  };
  // 線形補間。データ範囲外は NaN
  A.interp = function (x, xs, ys) {
    const n = xs.length;
    if (!n || !(x >= xs[0] && x <= xs[n - 1])) return NaN;
    const i = A.bisect(xs, x);
    if (xs[i] === x || i === 0) return ys[i];
    const x0 = xs[i - 1], x1 = xs[i];
    return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - x0) / (x1 - x0);
  };
  A.nearestIndex = function (xs, x) {
    const i = A.bisect(xs, x);
    if (i <= 0) return 0;
    if (i >= xs.length) return xs.length - 1;
    return (x - xs[i - 1] <= xs[i] - x) ? i - 1 : i;
  };
  A.median = function (arr) {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b), m = s.length >> 1;
    return s.length & 1 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  A.stdDev = function (arr) {
    if (arr.length < 2) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
  };

  // 台形積分（[lo, hi] の端は線形補間で切り出す）
  A.trapz = function (xs, ys, lo = -Infinity, hi = Infinity) {
    let s = 0;
    for (let i = 0; i < xs.length - 1; i++) {
      const xa = xs[i], xb = xs[i + 1], ya = ys[i], yb = ys[i + 1];
      if (!(xb > xa)) continue;
      const x0 = Math.max(xa, lo), x1 = Math.min(xb, hi);
      if (!(x1 > x0)) continue;
      const f = x => ya + (yb - ya) * (x - xa) / (xb - xa);
      s += (f(x0) + f(x1)) / 2 * (x1 - x0);
    }
    return s;
  };
  // PSD [G²/Hz] → 実効値 [Grms]
  A.psdRms = (xs, ys, lo, hi) => Math.sqrt(Math.max(A.trapz(xs, ys, lo, hi), 0));

  // dB で記録された系列を線形量に戻す（解析用。PSD は電力量なので 10、振幅量は 20）
  A.linearY = function (s) {
    if (!s.meta || !s.meta.yDb) return s.y;
    const k = s.kind === 'PSD' ? 10 : 20;
    return s.y.map(v => Math.pow(10, v / k));
  };

  // ── 加振プロファイル（log–log 折れ線） ────────────────────────────────────────
  A.parseProfile = function (text) {
    const pts = [], errors = [];
    String(text || '').split(/\r?\n/).forEach((line, i) => {
      const s = line.replace(/#.*/, '').trim();
      if (!s) return;
      const parts = s.split(/[\s,;\t]+/).filter(Boolean);
      const f = VT.parser.num(parts[0]), v = VT.parser.num(parts[1]);
      if (parts.length < 2 || !(f > 0) || !(v > 0)) { errors.push(i + 1); return; }
      pts.push({f, v});
    });
    pts.sort((a, b) => a.f - b.f);
    const out = [];
    for (const p of pts) {
      if (out.length && out[out.length - 1].f === p.f) out[out.length - 1] = p; else out.push(p);
    }
    return {points: out, errors};
  };
  A.profileText = pts => pts.map(p => `${p.f}\t${p.v}`).join('\n');
  // プロファイル値（範囲外は null）
  A.profileAt = function (pts, f) {
    const n = pts.length;
    if (n < 2 || !(f >= pts[0].f && f <= pts[n - 1].f)) return null;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].f <= f) lo = m; else hi = m; }
    const a = pts[lo], b = pts[hi];
    const t = Math.log(f / a.f) / Math.log(b.f / a.f);
    return Math.exp(Math.log(a.v) + t * Math.log(b.v / a.v));
  };
  // 折れ線（両対数で直線）の厳密積分
  A.profileArea = function (pts, lo = 0, hi = Infinity) {
    let s = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const f1 = pts[i].f, f2 = pts[i + 1].f, v1 = pts[i].v, v2 = pts[i + 1].v;
      const a = Math.max(f1, lo), b = Math.min(f2, hi);
      if (!(b > a)) continue;
      const n = Math.log(v2 / v1) / Math.log(f2 / f1);
      const va = v1 * Math.pow(a / f1, n);
      s += Math.abs(n + 1) < 1e-9 ? va * a * Math.log(b / a) : va * a / (n + 1) * (Math.pow(b / a, n + 1) - 1);
    }
    return s;
  };
  A.profileRms = (pts, lo, hi) => Math.sqrt(Math.max(A.profileArea(pts, lo, hi), 0));
  A.slopeDbOct = (a, b) => 10 * Math.log10(b.v / a.v) / Math.log2(b.f / a.f);

  // 許容範囲チェック（PSD は電力量なので dB = 10·log10）
  A.toleranceCheck = function (s, pts, tolPlus, tolMinus, lo, hi) {
    let maxP = -Infinity, maxM = Infinity, fail = 0, total = 0, worstF = null, worst = 0;
    for (let i = 0; i < s.x.length; i++) {
      const f = s.x[i], v = s.y[i];
      if (!(f >= lo && f <= hi)) continue;
      const ref = A.profileAt(pts, f);
      if (!(ref > 0) || !(v > 0)) continue;
      total++;
      const dev = 10 * Math.log10(v / ref);
      if (dev > maxP) maxP = dev;
      if (dev < maxM) maxM = dev;
      if (dev > tolPlus || dev < -tolMinus) {
        fail++;
        const over = dev > 0 ? dev - tolPlus : -tolMinus - dev;
        if (over > worst) { worst = over; worstF = f; }
      }
    }
    return {total, fail, maxP, maxM, worstF, pass: total > 0 && fail === 0};
  };

  // ── 疑似対数（負値を含むデータを Log 表示するとき） ─────────────────────────────
  // p = sign(v)·log10(1 + |v|/C)。C はデータ最大値の 1/10⁴ 程度
  A.symlog = function (maxAbs) {
    const C = maxAbs > 0 ? Math.pow(10, Math.floor(Math.log10(maxAbs)) - 3) : 1;
    return {
      C,
      f: v => Math.sign(v) * Math.log10(1 + Math.abs(v) / C),
      inv: p => Math.sign(p) * (Math.pow(10, Math.abs(p)) - 1) * C,
    };
  };
  A.symlogTicks = function (sl, vmin, vmax) {
    const pmin = sl.f(vmin), pmax = sl.f(vmax);
    const span = Math.max(pmax - pmin, 1e-12);
    const cands = [], seen = new Set();
    const add = v => {
      const p = sl.f(v);
      if (p < pmin - 1e-9 || p > pmax + 1e-9) return;
      const key = Math.round(p * 1e7);
      if (seen.has(key)) return;
      seen.add(key);
      const a = Math.abs(v);
      const label = v === 0 ? '0' : (a < 1e-3 || a >= 1e4) ? v.toExponential(0).replace('e+', 'e') : String(+v.toPrecision(3));
      cands.push({p, v, label});
    };
    add(0);
    const maxAbs = Math.max(Math.abs(vmin), Math.abs(vmax));
    if (maxAbs > 0) {
      const e0 = Math.round(Math.log10(sl.C)), e1 = Math.ceil(Math.log10(maxAbs));
      for (let e = e0; e <= e1; e++) for (const m of [1, 2, 5]) { const v = m * Math.pow(10, e); add(v); add(-v); }
    }
    cands.sort((a, b) => a.p - b.p);
    if (!cands.length) return {tickvals: [], ticktext: []};
    // 0 と両端を確保し、外側から順に間隔が十分なものを追加
    const minGap = span / 9;
    const kept = new Set();
    const zero = cands.find(c => c.v === 0);
    if (zero) kept.add(zero);
    kept.add(cands[0]);
    kept.add(cands[cands.length - 1]);
    for (const c of cands.slice().sort((a, b) => Math.abs(b.p) - Math.abs(a.p))) {
      if (kept.has(c)) continue;
      if (![...kept].some(k => Math.abs(k.p - c.p) < minGap)) kept.add(c);
    }
    const out = [...kept].sort((a, b) => a.p - b.p);
    return {tickvals: out.map(c => c.p), ticktext: out.map(c => c.label)};
  };

  // ── ピーク検出 ──────────────────────────────────────────────────────────────
  A.findPeaks = function (arr, {prominence = 0, distance = 1} = {}) {
    const raw = [];
    for (let i = 1; i < arr.length - 1; i++) if (arr[i] > arr[i - 1] && arr[i] >= arr[i + 1]) raw.push(i);
    const withProm = raw.map(pi => {
      const pv = arr[pi];
      let lb = pv;
      for (let i = pi - 1; i >= 0; i--) { lb = Math.min(lb, arr[i]); if (arr[i] > pv) break; }
      let rb = pv;
      for (let i = pi + 1; i < arr.length; i++) { rb = Math.min(rb, arr[i]); if (arr[i] > pv) break; }
      return {pi, prom: pv - Math.max(lb, rb)};
    }).filter(p => p.prom >= prominence);
    withProm.sort((a, b) => b.prom - a.prom);
    const keep = [];
    for (const p of withProm) if (!keep.some(k => Math.abs(p.pi - k.pi) < distance)) keep.push(p);
    return keep.sort((a, b) => a.pi - b.pi);
  };

  // 共振候補の検出。groups: [{datasetId, datasetName, channel, colorKey, color, kinds: {FRF_Mag: series, ...}, spectra: [series]}]
  A.findResonances = function (groups, range) {
    const results = [];
    const fmt = VT.util.fmt;
    const inRange = f => f > 0 && (!range || (f >= range[0] && f <= range[1]));
    for (const g of groups) {
      const primary = g.kinds.FRF_Mag ? 'FRF_Mag' : g.kinds.SPEC ? 'SPEC' : g.kinds.PSD ? 'PSD' : null;
      if (!primary) continue;
      const src = g.kinds[primary];
      const srcY = A.linearY(src);
      const freqs = [], vals = [];
      for (let i = 0; i < src.x.length; i++) if (inRange(src.x[i])) { freqs.push(src.x[i]); vals.push(srcY[i]); }
      const n = freqs.length;
      if (n < 10) continue;
      const pos = vals.filter(v => v > 0);
      if (pos.length < 5) continue;
      let minLog = Infinity;
      for (const v of pos) minLog = Math.min(minLog, Math.log10(v));
      minLog -= 1;
      const logV = vals.map(v => v > 0 ? Math.log10(v) : minLog);
      const peaks = A.findPeaks(logV, {prominence: 0.3, distance: Math.max(3, Math.floor(n / 200))})
        .sort((a, b) => b.prom - a.prom).slice(0, 15);

      for (const {pi, prom} of peaks) {
        const freq = freqs[pi], mag = vals[pi];
        const w = Math.max(10, Math.floor(n / 15));
        const nb = vals.slice(Math.max(0, pi - w), pi).concat(vals.slice(pi + 1, Math.min(n, pi + w + 1))).filter(v => v > 0);
        const bg = nb.length ? A.median(nb) : mag;
        const ratio = bg > 0 ? mag / bg : 1;
        if (ratio < 1.5) continue;
        const ev = [];
        let score = ratio >= 10 ? 2 : 1;
        ev.push({ok: null, text: `${VT.parser.kindLabel(primary)} ピーク ${fmt(mag)}（周辺の ${ratio.toFixed(1)} 倍${ratio >= 10 ? '、顕著' : ''}）`});

        const ph = g.kinds.FRF_Phase;
        if (ph) {
          const p = A.interp(freq, ph.x, ph.y);
          const near90 = Math.abs(Math.abs(p) - 90) < 45;
          const srch = Math.max(3, Math.floor(ph.x.length * 0.025));
          const ci = A.bisect(ph.x, freq);
          const i0 = Math.max(0, ci - srch), i1 = Math.min(ph.x.length - 1, ci + srch);
          const chg = Math.abs(ph.y[i1] - ph.y[i0]);
          const cross = chg > 60;
          const notes = [];
          if (near90) notes.push('±90° 付近');
          if (cross) notes.push(`位相変化 ${chg.toFixed(0)}°`);
          ev.push({ok: near90 || cross, text: `FRF Phase ${Number.isFinite(p) ? p.toFixed(1) : '—'}°${notes.length ? '（' + notes.join('、') + '）' : ''}`});
          if (near90 && cross) score += 2; else if (near90 || cross) score += 1;
        }
        const im = g.kinds.FRF_Imag;
        if (im) {
          const ix = [], iy = [];
          for (let i = 0; i < im.x.length; i++) if (inRange(im.x[i])) { ix.push(im.x[i]); iy.push(im.y[i]); }
          const sd = A.stdDev(iy);
          if (sd > 0) {
            const pp = A.findPeaks(iy, {prominence: sd * 0.3}).map(p => p.pi)
              .concat(A.findPeaks(iy.map(v => -v), {prominence: sd * 0.3}).map(p => p.pi));
            if (pp.length) {
              const near = pp.reduce((b, i) => Math.abs(ix[i] - freq) < Math.abs(ix[b] - freq) ? i : b);
              const hit = Math.abs(ix[near] - freq) / (freq + 1e-9) < 0.05;
              ev.push({ok: hit, text: `FRF Imag ピーク ${ix[near].toFixed(1)} Hz${hit ? '' : '（5% 以上ずれ）'}`});
              if (hit) score += 1;
            }
          }
        }
        const re = g.kinds.FRF_Real;
        if (re) {
          const ci = A.bisect(re.x, freq), srch = Math.max(3, Math.floor(re.x.length * 0.025));
          const seg = re.y.slice(Math.max(0, ci - srch), Math.min(re.y.length, ci + srch + 1));
          let zc = false;
          for (let i = 0; i < seg.length - 1; i++) if (seg[i] !== 0 && Math.sign(seg[i]) !== Math.sign(seg[i + 1])) { zc = true; break; }
          ev.push({ok: zc, text: `FRF Real ゼロクロス${zc ? 'あり' : 'なし'}`});
          if (zc) score += 1;
        }
        const coh = g.kinds.COH;
        if (coh) {
          const c = Math.min(1, Math.max(0, A.interp(freq, coh.x, coh.y)));
          const q = c >= 0.9 ? '高' : c >= 0.7 ? '中' : '低';
          ev.push({ok: c >= 0.8, text: `Coherence ${Number.isFinite(c) ? c.toFixed(3) : '—'}（信頼性: ${q}）`});
          if (c >= 0.8) score += 1;
        }
        if (primary === 'FRF_Mag') {
          for (const sp of g.spectra || []) {
            const spY = A.linearY(sp);
            const good = spY.filter(v => v > 0);
            if (!good.length) continue;
            let lm = Infinity;
            for (const v of good) lm = Math.min(lm, Math.log10(v));
            const lv = spY.map(v => v > 0 ? Math.log10(v) : lm - 1);
            const pp = A.findPeaks(lv, {prominence: 0.2}).map(p => p.pi);
            if (!pp.length) continue;
            const near = pp.reduce((b, i) => Math.abs(sp.x[i] - freq) < Math.abs(sp.x[b] - freq) ? i : b);
            if (Math.abs(sp.x[near] - freq) / (freq + 1e-9) < 0.05) {
              ev.push({ok: true, text: `${VT.parser.kindLabel(sp.kind)}（${sp.channel}）にもピーク ${sp.x[near].toFixed(1)} Hz`});
              score += 1;
              break;
            }
          }
        }
        // 半値幅法による減衰比（PSD は電力量なので 1/2、振幅量は 1/√2）
        const hp = primary === 'PSD' ? mag / 2 : mag / Math.SQRT2;
        let f1 = null, f2 = null;
        for (let i = pi - 1; i >= 0; i--) {
          if (vals[i] <= hp) { const d = vals[i + 1] - vals[i]; f1 = Math.abs(d) > 1e-30 ? freqs[i] + (hp - vals[i]) / d * (freqs[i + 1] - freqs[i]) : freqs[i]; break; }
        }
        for (let i = pi + 1; i < n; i++) {
          if (vals[i] <= hp) { const d = vals[i] - vals[i - 1]; f2 = Math.abs(d) > 1e-30 ? freqs[i - 1] + (hp - vals[i - 1]) / d * (freqs[i] - freqs[i - 1]) : freqs[i]; break; }
        }
        let zeta = null;
        if (f1 != null && f2 != null && f2 > f1) {
          zeta = (f2 - f1) / (2 * freq);
          ev.push({ok: null, text: `半値幅 ${(f2 - f1).toFixed(2)} Hz → 減衰比 ζ ≈ ${(zeta * 100).toFixed(2)} %（Q ≈ ${(1 / (2 * zeta)).toFixed(1)}）`});
        }
        results.push({freq, mag, ratio, prom, score, zeta, primary,
          datasetId: g.datasetId, datasetName: g.datasetName, channel: g.channel, colorKey: g.colorKey, color: g.color, evidence: ev});
      }
    }
    return results.sort((a, b) => (b.score - a.score) || (b.prom - a.prom));
  };
})(globalThis.VT = globalThis.VT || {});
