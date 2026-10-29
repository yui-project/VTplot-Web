'use strict';
// グラフウィンドウ: 生成・移動・リサイズ・スナップ・整列、系列パネル、カーソル表示
(function (VT) {
  const S = VT.state, U = VT.util, PL = VT.plot, P = VT.parser, A = VT.analysis;
  const W = VT.win = {};
  const GAP = 6, SNAP = 8, MIN_W = 280, MIN_H = 180;
  // プロット内でもカーソル操作の対象外にする要素（凡例・タイトル編集など）
  const IGNORE = '.legend, .modebar-container, .plugin-editable, .annotation, .g-gtitle, .g-xtitle, .g-ytitle, .g-y2title';
  let ws = null;
  let press = null, lastClick = null;

  W.init = function (el) {
    ws = el;
    document.addEventListener('mouseup', onDocMouseUp, true);
  };
  W.size = () => ({w: ws.clientWidth, h: ws.clientHeight});
  function rectPx(win) {
    const {w, h} = W.size(), r = win.rect;
    return {x: r.x * w, y: r.y * h, w: r.w * w, h: r.h * h};
  }
  function setRectPx(win, r) {
    const {w, h} = W.size();
    if (!w || !h) return;
    win.rect = {x: r.x / w, y: r.y / h, w: r.w / w, h: r.h / h};
    W.applyRect(win);
  }

  // ── 生成と破棄 ──────────────────────────────────────────────────────────────
  W.mount = function (win) {
    const el = U.h('section', {class: 'win', dataset: {id: win.id}});
    el.innerHTML = `
      <header class="win-head">
        <span class="win-title" title="ダブルクリックでタイトルを編集"></span>
        <span class="win-badge"></span>
        <div class="win-tools">
          <button class="wbtn" data-act="panel" title="系列パネルの表示 / 非表示">${U.icon('panel', 15)}</button>
          <button class="wbtn" data-act="png" title="PNG で保存">${U.icon('download', 15)}</button>
          <button class="wbtn" data-act="copy" title="画像をクリップボードにコピー">${U.icon('copy', 15)}</button>
          <button class="wbtn" data-act="dup" title="このグラフを複製">${U.icon('dup', 15)}</button>
          <button class="wbtn" data-act="max" title="最大化 / 元に戻す（タイトルバーのダブルクリックでも可）">${U.icon('max', 15)}</button>
          <button class="wbtn wbtn-close" data-act="close" title="閉じる">${U.icon('close', 15)}</button>
        </div>
      </header>
      <div class="win-body">
        <div class="plot-host">
          <div class="plot"></div>
          <div class="cur-line"></div>
          <div class="cur-tag"></div>
          <div class="plot-empty">表示する系列がありません</div>
        </div>
        <aside class="spanel">
          <div class="sp-head">
            <span class="sp-x" title="カーソル位置（プロットをクリックで固定）">—</span>
            <span class="sp-tools">
              <button class="sp-btn" data-sp="all" title="すべて表示">全表示</button>
              <button class="sp-btn" data-sp="none" title="すべて非表示">全非表示</button>
            </span>
          </div>
          <div class="sp-list"></div>
        </aside>
      </div>
      ${['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map(d => `<div class="rz rz-${d}" data-dir="${d}"></div>`).join('')}`;
    ws.appendChild(el);
    const rt = win.rt;
    rt.el = el;
    rt.head = el.querySelector('.win-head');
    rt.titleEl = el.querySelector('.win-title');
    rt.badge = el.querySelector('.win-badge');
    rt.host = el.querySelector('.plot-host');
    rt.gd = el.querySelector('.plot');
    rt.line = el.querySelector('.cur-line');
    rt.tag = el.querySelector('.cur-tag');
    rt.empty = el.querySelector('.plot-empty');
    rt.panel = el.querySelector('.spanel');
    rt.spX = el.querySelector('.sp-x');
    rt.spList = el.querySelector('.sp-list');
    bindWindow(win);
    W.applyRect(win);
    W.refreshHead(win);
    W.buildPanel(win);
    rt.ro = new ResizeObserver(() => scheduleResize(win));
    rt.ro.observe(rt.host);
  };

  W.unmount = function (win) {
    const rt = win.rt;
    if (rt.ro) rt.ro.disconnect();
    if (rt.resizeRaf) cancelAnimationFrame(rt.resizeRaf);
    try { if (rt.gd) Plotly.purge(rt.gd); } catch (e) { /* 既に破棄済み */ }
    if (rt.el) rt.el.remove();
    win.rt = {};
  };

  function scheduleResize(win) {
    if (win.rt.resizeRaf) return;
    win.rt.resizeRaf = requestAnimationFrame(() => {
      win.rt.resizeRaf = 0;
      const gd = win.rt.gd;
      if (!gd || !gd._fullLayout || !gd.isConnected || !gd.clientWidth) return;
      Plotly.Plots.resize(gd).then(() => W.positionCursor(win)).catch(() => {});
    });
  }

  function bindWindow(win) {
    const rt = win.rt, el = rt.el;
    el.addEventListener('pointerdown', () => W.activate(win), true);
    rt.head.addEventListener('pointerdown', e => {
      if (e.target.closest('button, input')) return;
      startMove(win, e);
    });
    rt.head.addEventListener('dblclick', e => {
      if (e.target.closest('button, input')) return;
      if (e.target.closest('.win-title')) editTitle(win); else W.toggleMax(win);
    });
    el.querySelector('.win-tools').addEventListener('click', e => {
      const b = e.target.closest('button[data-act]');
      if (b) VT.app.windowAction(win, b.dataset.act);
    });
    el.querySelectorAll('.rz').forEach(h => h.addEventListener('pointerdown', e => startResize(win, h.dataset.dir, e)));
    rt.panel.querySelector('.sp-tools').addEventListener('click', e => {
      const b = e.target.closest('button[data-sp]');
      if (!b) return;
      const {y1, y2} = S.windowSeries(win);
      for (const s of y1.concat(y2)) { if (b.dataset.sp === 'all') delete win.hidden[s.id]; else win.hidden[s.id] = true; }
      VT.app.onVisibilityChanged(win);
    });
    rt.host.addEventListener('mousemove', e => onHostMove(win, e));
    rt.host.addEventListener('mouseleave', () => {
      if (!S.cursor.locked && S.cursor.winId === win.id) VT.app.setCursor(null, win);
    });
    rt.host.addEventListener('mousedown', e => onHostDown(win, e));
  }

  // ── 前面化・配置 ────────────────────────────────────────────────────────────
  W.activate = function (win) {
    if (!win || !win.rt.el) return;
    if (win.z < S.zTop) { win.z = ++S.zTop; win.rt.el.style.zIndex = win.z; }
    if (S.activeWinId !== win.id) {
      S.activeWinId = win.id;
      W.markActive();
      VT.inspector.refresh();
    }
  };
  W.markActive = function () {
    for (const w of S.windows) if (w.rt.el) w.rt.el.classList.toggle('active', w.id === S.activeWinId);
  };
  W.applyRect = function (win) {
    const el = win.rt.el;
    if (!el) return;
    const r = win.rect;
    el.style.left = (r.x * 100) + '%';
    el.style.top = (r.y * 100) + '%';
    el.style.width = (r.w * 100) + '%';
    el.style.height = (r.h * 100) + '%';
    el.style.zIndex = win.z;
    el.classList.toggle('maximized', !!win.maximized);
    el.classList.toggle('nopanel', !win.showPanel);
    el.classList.toggle('active', S.activeWinId === win.id);
    const mb = el.querySelector('[data-act="max"]');
    if (mb) mb.innerHTML = U.icon(win.maximized ? 'restore' : 'max', 15);
  };
  W.toggleMax = function (win) {
    win.maximized = !win.maximized;
    if (win.maximized) win.z = ++S.zTop;
    W.applyRect(win);
  };

  // スナップ候補線（作業領域の端・中央、他ウィンドウの辺）
  function xLines(others, WW) {
    const L = [GAP, WW - GAP, WW / 2 - GAP / 2, WW / 2 + GAP / 2];
    for (const o of others) L.push(o.x, o.x + o.w, o.x - GAP, o.x + o.w + GAP);
    return L;
  }
  function yLines(others, WH) {
    const L = [GAP, WH - GAP, WH / 2 - GAP / 2, WH / 2 + GAP / 2];
    for (const o of others) L.push(o.y, o.y + o.h, o.y - GAP, o.y + o.h + GAP);
    return L;
  }
  function snapDelta(edges, lines) {
    let best = 0, bd = SNAP + 1;
    for (const e of edges) for (const l of lines) { const d = l - e; if (Math.abs(d) < bd) { bd = Math.abs(d); best = d; } }
    return bd <= SNAP ? best : 0;
  }

  function startMove(win, e) {
    if (e.button !== 0 || win.maximized) return;
    const head = e.currentTarget, el = win.rt.el;
    const r0 = rectPx(win), {w: WW, h: WH} = W.size();
    const sx = e.clientX, sy = e.clientY;
    const others = S.windows.filter(o => o !== win && !o.maximized).map(rectPx);
    const xl = xLines(others, WW), yl = yLines(others, WH);
    head.setPointerCapture(e.pointerId);
    let moved = false;
    const move = ev => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      if (!moved) { moved = true; el.classList.add('moving'); }
      let x = U.clamp(r0.x + dx, 0, Math.max(0, WW - r0.w));
      let y = U.clamp(r0.y + dy, 0, Math.max(0, WH - r0.h));
      if (!ev.altKey) { x += snapDelta([x, x + r0.w], xl); y += snapDelta([y, y + r0.h], yl); }
      setRectPx(win, {x: U.clamp(x, 0, Math.max(0, WW - r0.w)), y: U.clamp(y, 0, Math.max(0, WH - r0.h)), w: r0.w, h: r0.h});
    };
    const up = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      head.removeEventListener('pointercancel', up);
      el.classList.remove('moving');
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  }

  function startResize(win, dir, e) {
    if (e.button !== 0 || win.maximized) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget, el = win.rt.el;
    const r0 = rectPx(win), {w: WW, h: WH} = W.size();
    const sx = e.clientX, sy = e.clientY;
    const others = S.windows.filter(o => o !== win && !o.maximized).map(rectPx);
    const xl = xLines(others, WW), yl = yLines(others, WH);
    handle.setPointerCapture(e.pointerId);
    el.classList.add('resizing');
    const move = ev => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      let left = r0.x, top = r0.y, right = r0.x + r0.w, bottom = r0.y + r0.h;
      if (dir.includes('w')) left = U.clamp(r0.x + dx, 0, right - MIN_W);
      if (dir.includes('e')) right = U.clamp(right + dx, left + MIN_W, WW);
      if (dir.includes('n')) top = U.clamp(r0.y + dy, 0, bottom - MIN_H);
      if (dir.includes('s')) bottom = U.clamp(bottom + dy, top + MIN_H, WH);
      if (!ev.altKey) {
        if (dir.includes('w')) left += snapDelta([left], xl);
        if (dir.includes('e')) right += snapDelta([right], xl);
        if (dir.includes('n')) top += snapDelta([top], yl);
        if (dir.includes('s')) bottom += snapDelta([bottom], yl);
      }
      setRectPx(win, {x: left, y: top, w: Math.max(MIN_W, right - left), h: Math.max(MIN_H, bottom - top)});
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      el.classList.remove('resizing');
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  // 整列: grid（自動タイル）/ cols（横並び）/ rows（縦並び）/ cascade（重ねる）
  function gridDims(n, WW, WH) {
    let best = null;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const aspect = (WW / cols) / (WH / rows);
      const score = Math.abs(Math.log(aspect / 1.55)) + (rows * cols - n) * 0.3;
      if (!best || score < best.score) best = {cols, rows, score};
    }
    return best;
  }
  W.arrange = function (mode) {
    const wins = S.windows.slice();
    if (!wins.length) return;
    wins.sort((a, b) => (Math.round(a.rect.y * 6) - Math.round(b.rect.y * 6)) || (a.rect.x - b.rect.x));
    const {w: WW, h: WH} = W.size();
    const n = wins.length;
    const place = (win, x, y, w, h) => { win.maximized = false; setRectPx(win, {x, y, w, h}); };
    if (mode === 'cascade') {
      const w = Math.max(MIN_W, WW * 0.6), h = Math.max(MIN_H, WH * 0.6), step = 30;
      const room = Math.max(1, Math.floor(Math.min(WW - w, WH - h) / step) + 1);
      wins.forEach((win, i) => {
        const k = i % room;
        win.z = ++S.zTop;
        place(win, GAP + k * step, GAP + k * step, w - GAP, h - GAP);
      });
      return;
    }
    let cols, rows;
    if (mode === 'cols') { cols = n; rows = 1; }
    else if (mode === 'rows') { cols = 1; rows = n; }
    else ({cols, rows} = gridDims(n, WW, WH));
    const ch = (WH - GAP * (rows + 1)) / rows;
    let i = 0;
    for (let r = 0; r < rows; r++) {
      const inRow = Math.min(cols, n - i);
      const cw = (WW - GAP * (inRow + 1)) / inRow;
      for (let c = 0; c < inRow; c++, i++) place(wins[i], GAP + c * (cw + GAP), GAP + r * (ch + GAP), cw, ch);
    }
  };

  // 新しいウィンドウの置き場所（空いている区画、なければ選択中ウィンドウから少しずらす）
  function overlap(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
  }
  W.freeRect = function () {
    const {w: WW, h: WH} = W.size();
    if (!WW || !WH) return {x: 0.02, y: 0.03, w: 0.5, h: 0.5};
    const occupied = S.windows.filter(w => !w.maximized).map(rectPx);
    if (!occupied.length) return {x: GAP / WW, y: GAP / WH, w: (WW - 2 * GAP) / WW, h: (WH - 2 * GAP) / WH};
    const cands = [];
    for (const [cols, rows] of [[2, 2], [3, 2], [3, 3]]) {
      const cw = (WW - GAP * (cols + 1)) / cols, ch = (WH - GAP * (rows + 1)) / rows;
      if (cw < MIN_W || ch < MIN_H) continue;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cands.push({x: GAP + c * (cw + GAP), y: GAP + r * (ch + GAP), w: cw, h: ch});
    }
    let best = null, bestOv = Infinity;
    for (const c of cands) {
      const ov = occupied.reduce((s, o) => s + overlap(c, o), 0) / (c.w * c.h);
      if (ov < bestOv - 1e-6) { bestOv = ov; best = c; }
    }
    if (!best || bestOv > 0.12) {
      const a = S.activeWin();
      const base = a && a.rt.el ? rectPx(a) : {x: GAP, y: GAP, w: WW * 0.5, h: WH * 0.5};
      const w = Math.max(MIN_W, Math.min(base.w, WW * 0.6)), h = Math.max(MIN_H, Math.min(base.h, WH * 0.6));
      best = {x: Math.max(0, Math.min(base.x + 28, WW - w)), y: Math.max(0, Math.min(base.y + 28, WH - h)), w, h};
    }
    return {x: best.x / WW, y: best.y / WH, w: best.w / WW, h: best.h / WH};
  };

  // ── タイトルバー ─────────────────────────────────────────────────────────────
  W.refreshHead = function (win) {
    const rt = win.rt;
    if (!rt.titleEl) return;
    const custom = win.title != null && win.title !== '';
    rt.titleEl.textContent = S.titleOf(win);
    rt.titleEl.classList.toggle('auto', !custom);
    rt.badge.textContent = custom ? [win.y1Kind, win.y2Kind].filter(Boolean).map(P.kindLabel).join(' / ') : '';
  };
  function editTitle(win) {
    const span = win.rt.titleEl;
    const input = U.h('input', {class: 'win-title-input', value: S.titleOf(win), 'aria-label': 'グラフのタイトル'});
    span.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = commit => {
      if (done) return;
      done = true;
      if (commit) {
        const v = input.value.trim();
        win.title = (v === '' || v === S.autoTitle(win)) ? null : v;
      }
      input.replaceWith(span);
      if (commit) VT.app.onLabelsChanged(win);
    };
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', e => e.stopPropagation());
  }

  // ── 系列パネル（凡例・表示切替・カーソル値） ───────────────────────────────────
  W.buildPanel = function (win) {
    const rt = win.rt;
    if (!rt.spList) return;
    const list = rt.spList;
    list.innerHTML = '';
    const {y1, y2} = S.windowSeries(win);
    const dsIds = S.windowDatasetIds(win), multi = dsIds.length > 1;
    rt.rows = [];
    rt.profileVal = null;
    if (win.y1Kind === 'PSD' && S.profile.points.length >= 2) {
      const row = U.h('div', {class: 'sp-row sp-profile' + (win.showProfile ? '' : ' off'), title: 'クリックで表示 / 非表示'});
      row.innerHTML = `<span class="sp-sw">${U.lineSample(PL.PROFILE_COLOR, 'solid')}</span><span class="sp-name"></span><span class="sp-val">—</span>`;
      row.querySelector('.sp-name').textContent = S.profile.name;
      row.addEventListener('click', () => { win.showProfile = !win.showProfile; VT.app.onVisibilityChanged(win); });
      list.appendChild(row);
      rt.profileVal = row.querySelector('.sp-val');
    }
    const all = y1.map(s => ({s, axis: 1})).concat(y2.map(s => ({s, axis: 2})));
    for (const dsId of dsIds) {
      const items = all.filter(it => it.s.datasetId === dsId);
      if (multi) {
        const shown = items.filter(it => !win.hidden[it.s.id]).length;
        const g = U.h('div', {class: 'sp-group' + (shown ? '' : ' off'), title: 'クリックでこのデータセットをまとめて表示 / 非表示'},
          U.h('span', {class: 'sp-gname'}, S.dataset(dsId).name), U.h('span', {class: 'sp-gcount'}, `${shown}/${items.length}`));
        g.addEventListener('click', () => {
          for (const it of items) { if (shown) win.hidden[it.s.id] = true; else delete win.hidden[it.s.id]; }
          VT.app.onVisibilityChanged(win);
        });
        list.appendChild(g);
      }
      for (const {s, axis} of items) {
        const row = U.h('div', {class: 'sp-row' + (win.hidden[s.id] ? ' off' : ''),
          title: `${s.path}${s.meta.label ? '\n' + s.meta.label : ''}\nクリック: 表示切替 / Ctrl+クリック: これだけ表示 / 名前をダブルクリック: 名前を変更`});
        row.innerHTML = `<span class="sp-sw">${U.lineSample(S.colorOf(s), S.dashOf(win, s, axis))}</span><span class="sp-name"></span>${axis === 2 ? '<span class="sp-ax">Y2</span>' : ''}<span class="sp-val">—</span>`;
        // データセット名はグループの見出しにあるので、行には付けない
        const nameEl = row.querySelector('.sp-name');
        nameEl.textContent = S.seriesName(s);
        let timer = 0;
        row.addEventListener('click', e => {
          clearTimeout(timer);
          if (e.detail > 1) return;
          const solo = e.ctrlKey || e.metaKey;
          timer = setTimeout(() => {
            if (solo) { for (const it of all) win.hidden[it.s.id] = true; delete win.hidden[s.id]; }
            else if (win.hidden[s.id]) delete win.hidden[s.id];
            else win.hidden[s.id] = true;
            VT.app.onVisibilityChanged(win);
          }, 200);
        });
        nameEl.addEventListener('dblclick', e => { e.stopPropagation(); clearTimeout(timer); renameSeries(s, nameEl); });
        list.appendChild(row);
        rt.rows.push({s, val: row.querySelector('.sp-val')});
      }
    }
    if (!all.length) list.appendChild(U.h('div', {class: 'sp-empty'}, 'このグラフに該当する系列がありません'));
    rt.empty.style.display = all.some(it => !win.hidden[it.s.id]) ? 'none' : '';
    W.updatePanelValues(win);
  };
  function renameSeries(s, nameEl) {
    const input = U.h('input', {class: 'sp-input', value: S.seriesName(s), 'aria-label': '系列名'});
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = commit => {
      if (done) return;
      done = true;
      if (commit) {
        const v = input.value.trim();
        s.name = (v === '' || v === S.seriesName(Object.assign({}, s, {name: null}))) ? null : v;
      }
      input.replaceWith(nameEl);
      if (commit) VT.app.onSeriesRenamed();
    };
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', e => e.stopPropagation());
  }

  // ── カーソル ────────────────────────────────────────────────────────────────
  W.cursorXFor = function (win) {
    const c = S.cursor;
    if (c.x == null) return null;
    if (c.winId !== win.id && !S.link.cursor) return null;
    if (c.unit && c.unit !== S.xUnitOf(win)) return null;
    return c.x;
  };
  W.updatePanelValues = function (win) {
    const rt = win.rt;
    if (!rt.spX) return;
    const x = W.cursorXFor(win);
    rt.spX.textContent = x == null ? '—' : `${U.fmtX(x)} ${S.xUnitOf(win)}`;
    rt.spX.classList.toggle('locked', S.cursor.locked && x != null);
    for (const r of rt.rows || []) {
      r.val.textContent = (x == null || win.hidden[r.s.id]) ? '—' : U.fmtValue(A.interp(x, r.s.x, r.s.y), r.s.kind);
    }
    if (rt.profileVal) {
      const v = x == null || !win.showProfile ? null : A.profileAt(S.profile.points, x);
      rt.profileVal.textContent = v == null ? '—' : U.fmt(v);
    }
  };
  W.positionCursor = function (win) {
    const rt = win.rt;
    if (!rt.line) return;
    // 固定中は Plotly 側で線とラベルを描くので、ここではマウス追従のカーソルだけを扱う
    const x = S.cursor.locked ? null : W.cursorXFor(win);
    const g = x == null ? null : PL.geom(win);
    const px = g ? PL.xToPx(g, x) : NaN;
    if (!g || !Number.isFinite(px) || px < g.l - 0.5 || px > g.l + g.w + 0.5) {
      rt.line.style.display = 'none';
      rt.tag.style.display = 'none';
      return;
    }
    rt.line.style.display = 'block';
    rt.line.style.top = g.t + 'px';
    rt.line.style.height = g.h + 'px';
    rt.line.style.transform = `translateX(${Math.round(px)}px)`;
    rt.tag.style.display = 'block';
    rt.tag.textContent = `${U.fmtX(x)} ${S.xUnitOf(win)}`;
    // 固定カーソルの値と同じく枠の上に付ける（右半分では線の左側）
    const left = px - g.l > g.w / 2 ? px - rt.tag.offsetWidth : px;
    rt.tag.style.transform = `translate(${Math.round(left)}px, ${Math.round(g.t - rt.tag.offsetHeight)}px)`;
  };
  W.afterRender = function (win) {
    W.positionCursor(win);
    W.updatePanelValues(win);
  };

  function localPos(win, e) {
    const r = win.rt.host.getBoundingClientRect();
    return {px: e.clientX - r.left, py: e.clientY - r.top};
  }
  const inArea = (g, p) => g && p.px >= g.l && p.px <= g.l + g.w && p.py >= g.t && p.py <= g.t + g.h;

  function onHostMove(win, e) {
    if (S.cursor.locked || e.buttons) return;
    const g = PL.geom(win), p = localPos(win, e);
    if (!inArea(g, p) || e.target.closest(IGNORE)) {
      if (S.cursor.winId === win.id && S.cursor.x != null) VT.app.setCursor(null, win);
      return;
    }
    VT.app.setCursor(PL.pxToX(g, p.px), win);
  }
  function onHostDown(win, e) {
    press = null;
    if (e.button !== 0 || e.target.closest(IGNORE)) return;
    const g = PL.geom(win), p = localPos(win, e);
    if (!inArea(g, p)) return;
    press = {win, cx: e.clientX, cy: e.clientY, t: Date.now(), px: p.px};
  }
  // Plotly はドラッグ中に全面カバーを置くため、クリック判定は document の mouseup で行う
  function onDocMouseUp(e) {
    const pr = press;
    press = null;
    if (!pr || e.button !== 0) return;
    if (Math.hypot(e.clientX - pr.cx, e.clientY - pr.cy) > 4 || Date.now() - pr.t > 700) return;
    plotClick(pr.win, pr.px);
  }
  function plotClick(win, px) {
    const now = Date.now();
    if (lastClick && lastClick.win === win && now - lastClick.t < 380 && Math.abs(px - lastClick.px) < 8) {
      // ダブルクリック: 1 回目のロック操作を取り消して全体表示へ
      S.cursor = lastClick.prev;
      lastClick = null;
      VT.app.resetAxes(win);
      VT.app.refreshCursor();
      return;
    }
    lastClick = {win, t: now, px, prev: Object.assign({}, S.cursor)};
    const g = PL.geom(win);
    if (!g) return;
    if (S.cursor.locked) VT.app.unlockCursor(PL.pxToX(g, px), win);
    else VT.app.lockCursor(PL.pxToX(g, px), win);
  }
})(globalThis.VT = globalThis.VT || {});
