'use strict';
// 共通ユーティリティ（DOM 生成・数値書式・通知・保存）
(function (VT) {
  const U = VT.util = {};

  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // h('div', {class: 'a', on: {click: fn}}, '子', 子要素...)
  U.h = function (tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') {
          for (const [sk, sv] of Object.entries(v)) {
            if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv;
          }
        } else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'value') el.value = v;
        else if (typeof v === 'boolean' || (k in el && typeof v !== 'string')) el[k] = v;
        else el.setAttribute(k, v);
      }
    }
    U.append(el, kids);
    return el;
  };
  U.append = function (el, kids) {
    for (const c of [kids].flat(Infinity)) {
      if (c == null || c === false) continue;
      el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  };

  U.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  U.debounce = function (fn, ms) {
    let t = 0;
    return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
  };
  U.uid = p => p + Math.random().toString(36).slice(2, 9);
  U.naturalCompare = (a, b) => String(a).localeCompare(String(b), 'ja', {numeric: true, sensitivity: 'base'});
  U.unique = arr => [...new Set(arr)];

  // ── 数値書式 ────────────────────────────────────────────────────────────────
  U.fmt = function (v, digits = 4) {
    if (v == null || !Number.isFinite(v)) return '—';
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e5 || a < 1e-2) return v.toExponential(digits - 1).replace('e+', 'e');
    return String(+v.toPrecision(digits));
  };
  U.fmtX = function (x) {
    if (x == null || !Number.isFinite(x)) return '—';
    const a = Math.abs(x);
    if (a >= 1000) return x.toFixed(0);
    if (a >= 100) return x.toFixed(1);
    if (a >= 10) return x.toFixed(2);
    return x.toPrecision(3);
  };
  // 範囲・ピークなどの周波数表示（末尾の 0 を付けない）
  U.fmtF = f => (f == null || !Number.isFinite(f)) ? '—' : String(+f.toPrecision(Math.abs(f) >= 1000 ? 5 : 4));
  U.fmtValue = function (v, kind) {
    if (v == null || !Number.isFinite(v)) return '—';
    if (kind === 'FRF_Phase') return v.toFixed(1) + '°';
    if (kind === 'COH') return v.toFixed(3);
    return U.fmt(v);
  };
  // 入力欄に入れる範囲値（桁を丸める）
  U.fmtInput = v => (v == null || !Number.isFinite(v)) ? '' : String(+v.toPrecision(5));
  U.parseInput = function (s) {
    const t = String(s == null ? '' : s).trim();
    if (!t) return null;
    const v = Number(t);
    return Number.isFinite(v) ? v : NaN;
  };

  U.stamp = function () {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  };
  U.safeName = s => String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);

  U.download = function (data, filename, mime) {
    const isUrl = typeof data === 'string' && data.startsWith('data:');
    const url = isUrl ? data : URL.createObjectURL(data instanceof Blob ? data : new Blob([data], {type: mime || 'application/octet-stream'}));
    const a = U.h('a', {href: url, download: filename});
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (!isUrl) setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  U.copyText = async function (text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall through */ }
    const ta = U.h('textarea', {style: {position: 'fixed', left: '-9999px'}}, text);
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  };

  // ── 通知 ────────────────────────────────────────────────────────────────────
  U.toast = function (msg, type = 'info', ms = 3600) {
    const box = document.getElementById('toasts');
    if (!box) return;
    const t = U.h('div', {class: 'toast ' + type, role: 'status'}, msg);
    box.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, ms);
  };

  // ── localStorage（失敗しても動作は継続） ──────────────────────────────────────
  U.store = {
    get(k, d) {
      try { const v = localStorage.getItem('vtplot.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem('vtplot.' + k, JSON.stringify(v)); } catch (e) { /* 保存できなくても無視 */ }
    },
  };

  // ── アイコン（24px グリッドの線画。角は丸めない） ──────────────────────────────────
  const ICONS = {
    panel: '<path d="M3 4h18v16H3z"/><path d="M15 4v16"/>',
    download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
    copy: '<path d="M9 9h11v11H9z"/><path d="M15 5V4H4v11h1"/>',
    dup: '<path d="M8 8h12v12H8z"/><path d="M4 16V4h12"/><path d="M14 11v6M11 14h6"/>',
    max: '<path d="M4 4h16v16H4z"/>',
    restore: '<path d="M4 9h11v11H4z"/><path d="M9 9V4h11v11h-5"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    folder: '<path d="M3 5h6l2 2h10v12H3z"/>',
    file: '<path d="M14 3H5v18h14V8z"/><path d="M14 3v5h5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    layout: '<path d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z"/>',
    cols: '<path d="M3 4h7v16H3zM14 4h7v16h-7z"/>',
    rows: '<path d="M3 3h18v7H3zM3 14h18v7H3z"/>',
    cascade: '<path d="M9 15H3V3h12v6"/><path d="M9 9h12v12H9z"/>',
    // 共振ピーク（解析）・加振プロファイル（台形）・波形（サンプル）
    peak: '<path d="M3 20h18"/><path d="M3 17c5 0 6-11 9-11s4 11 9 11"/>',
    profile: '<path d="M3 20h18"/><path d="M3 17l5-9h8l5 9"/>',
    wave: '<path d="M3 12h3l2-6 3 12 3-9 2 5 2-2h3"/>',
    save: '<path d="M4 3h12l4 4v14H4z"/><path d="M8 3v5h7V3"/><path d="M7 21v-7h10v7"/>',
    image: '<path d="M3 4h18v16H3z"/><path d="M8 8h2v2H8z"/><path d="m21 15-5-5-10 10"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7"/><path d="M12 17h.01"/>',
    sidebar: '<path d="M3 4h18v16H3z"/><path d="M15 4v16"/><path d="M17.5 8h1M17.5 11h1"/>',
    trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 14h10l1-14"/><path d="M9 7V4h6v3"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
  };
  U.icon = function (name, size = 16) {
    return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  };

  // Plotly の dash 名 → SVG stroke-dasharray（系列パネルの線見本用）
  U.DASH_ARRAY = {solid: '', dash: '6 3', dot: '2 2.5', dashdot: '6 2.5 2 2.5', longdash: '11 3', longdashdot: '11 2.5 2 2.5'};
  U.lineSample = function (color, dash, width = 22) {
    const da = U.DASH_ARRAY[dash] || '';
    return `<svg width="${width}" height="10" viewBox="0 0 ${width} 10" aria-hidden="true"><line x1="1" y1="5" x2="${width - 1}" y2="5" stroke="${color}" stroke-width="2.4" stroke-linecap="butt"${da ? ` stroke-dasharray="${da}"` : ''}/></svg>`;
  };
})(globalThis.VT = globalThis.VT || {});
