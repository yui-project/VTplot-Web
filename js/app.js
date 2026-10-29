'use strict';
// アプリ本体: 読み込み・メニュー・連動・解析・セッション
(function (VT) {
  const S = VT.state, U = VT.util, P = VT.parser, A = VT.analysis, PL = VT.plot, W = VT.win, I = VT.inspector, D = VT.dialogs;
  const App = VT.app = {};
  const DATA_EXT = /\.(txt|csv|dat|tsv)$/i;
  let welcome = null;

  App.init = function () {
    welcome = U.$('#welcome');
    W.init(U.$('#workspace'));
    I.init(U.$('#sidebar'));
    S.profiles = S.mergeProfiles(U.store.get('profiles', null), U.store.get('profile', null));
    const link = U.store.get('link', null);
    if (link) Object.assign(S.link, link);
    if (U.store.get('sidebar', true) === false) document.body.classList.add('no-sidebar');
    bindTopbar();
    bindFileInputs();
    bindDrop();
    bindKeys();
    window.addEventListener('beforeunload', e => { if (S.series.length) { e.preventDefault(); e.returnValue = ''; } });
    refreshAll();
  };

  function refreshAll() {
    for (const w of S.windows) { W.refreshHead(w); W.buildPanel(w); }
    PL.renderAll();
    I.refresh();
    updateUI();
  }
  function updateUI() {
    const has = S.series.length > 0;
    welcome.hidden = S.windows.length > 0;
    welcome.classList.toggle('has-data', has);
    if (has && !S.windows.length) {
      U.$('#welcome-kinds').replaceChildren(...S.kinds().map(k => U.h('button', {class: 'btn', type: 'button', title: P.kindDesc(k), dataset: {act: 'kind', kind: k}},
        P.kindLabel(k), U.h('span', {class: 'n'}, String(S.kindCount(k))))));
    }
    U.$('#tg-cursor').setAttribute('aria-pressed', String(S.link.cursor));
    U.$('#tg-xlink').setAttribute('aria-pressed', String(S.link.x));
    U.$('#status').textContent = has ? `${S.datasets.length} データセット · ${S.series.length} 系列` : '';
  }
  const dsName = s => (S.dataset(s.datasetId) || {}).name || '';
  const hasKind = k => S.series.some(s => s.kind === k);
  const PROFILE_NAME = {PSD: 'PSD', SPEC: '正弦波'};
  const profileSet = k => S.profiles[k].points.length >= 2;
  // プロファイルの画面で最初に開く種類（選択中グラフの種類 → データにある種類 → PSD）
  function profileKind() {
    const a = S.activeWin();
    if (a && S.profileOf(a.y1Kind)) return a.y1Kind;
    return S.PROFILE_KINDS.find(hasKind) || 'PSD';
  }

  // ── 上部バー ────────────────────────────────────────────────────────────────
  function bindTopbar() {
    const menu = (id, items) => U.$(id).addEventListener('click', e => D.toggleMenu(e.currentTarget, items()));
    menu('#btn-open', () => [
      {label: 'ファイルを開く…', icon: 'file', hint: '.txt 複数可', onClick: () => U.$('#in-files').click()},
      {label: 'フォルダを開く…', icon: 'folder', hint: 'フォルダ＝データセット', onClick: () => U.$('#in-dir').click()},
      '-',
      {label: 'セッションを開く…', icon: 'save', hint: '.json', onClick: () => U.$('#in-session').click()},
      {label: 'サンプルデータ', icon: 'wave', onClick: App.loadSample},
    ]);
    menu('#btn-add', () => {
      const kinds = S.kinds();
      if (!kinds.length) return [{header: 'データなし'}];
      return [{header: 'データの種類'}].concat(kinds.map(k => ({
        label: P.kindLabel(k), hint: `${P.kindDesc(k)} · ${S.kindCount(k)}`, onClick: () => App.addWindow(k),
      })));
    });
    menu('#btn-arrange', () => [
      {label: 'タイル', icon: 'layout', disabled: !S.windows.length, onClick: () => W.arrange('grid')},
      {label: '横並び', icon: 'cols', disabled: !S.windows.length, onClick: () => W.arrange('cols')},
      {label: '縦並び', icon: 'rows', disabled: !S.windows.length, onClick: () => W.arrange('rows')},
      {label: '重ねる', icon: 'cascade', disabled: !S.windows.length, onClick: () => W.arrange('cascade')},
    ]);
    menu('#btn-analysis', () => [
      {label: '加振プロファイル…', icon: 'profile', onClick: () => D.profile(profileKind()),
        hint: S.PROFILE_KINDS.filter(profileSet).map(k => PROFILE_NAME[k]).join('・') || '未設定'},
      {label: '許容範囲チェック', disabled: !S.PROFILE_KINDS.some(hasKind), hint: 'PSD / Spectrum', onClick: App.runCheck},
      {label: 'RMS 算出', disabled: !hasKind('PSD'), hint: 'PSD → Grms', onClick: App.runRms},
      '-',
      {label: 'ピーク解析（試験機能）', disabled: !S.windows.length, hint: '選択中のグラフ', onClick: App.runPeaks},
      {label: 'ピーク注釈を消去', disabled: !S.peaks, onClick: () => { S.peaks = null; PL.renderAll(); }},
    ]);
    menu('#btn-save', () => [
      {label: 'セッションを保存', icon: 'save', disabled: !S.series.length, hint: 'Ctrl+S', onClick: App.saveSession},
      {label: '全グラフを 1 枚の PNG に', icon: 'image', disabled: !S.windows.length, hint: '配置どおり', onClick: App.exportWorkspace},
      '-',
      {label: 'すべて閉じる', icon: 'trash', disabled: !S.series.length && !S.windows.length, onClick: App.clearAll},
    ]);
    U.$('#tg-cursor').addEventListener('click', () => {
      S.link.cursor = !S.link.cursor;
      U.store.set('link', S.link);
      updateUI();
      App.refreshCursor();
    });
    U.$('#tg-xlink').addEventListener('click', () => {
      S.link.x = !S.link.x;
      U.store.set('link', S.link);
      updateUI();
      const a = S.activeWin();
      if (S.link.x && a) propagateX(a);
    });
    U.$('#btn-help').addEventListener('click', D.help);
    U.$('#btn-sidebar').addEventListener('click', () => {
      document.body.classList.toggle('no-sidebar');
      U.store.set('sidebar', !document.body.classList.contains('no-sidebar'));
    });
    welcome.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'files') U.$('#in-files').click();
      else if (act === 'dir') U.$('#in-dir').click();
      else if (act === 'session') U.$('#in-session').click();
      else if (act === 'sample') App.loadSample();
      else if (act === 'kind') App.addWindow(b.dataset.kind);
    });
  }

  // ── 読み込み ────────────────────────────────────────────────────────────────
  function bindFileInputs() {
    const take = (input, fn) => input.addEventListener('change', () => { const files = Array.from(input.files); input.value = ''; if (files.length) fn(files); });
    take(U.$('#in-files'), files => App.loadItems(files.map(f => ({file: f, path: f.name}))));
    take(U.$('#in-dir'), files => App.loadItems(files.map(f => ({file: f, path: f.webkitRelativePath || f.name}))));
    take(U.$('#in-session'), files => App.openSession(files[0]));
  }

  function bindDrop() {
    const ov = U.$('#drop-overlay');
    let depth = 0;
    const hasFiles = e => Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files');
    window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; ov.classList.add('show'); });
    window.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) ov.classList.remove('show'); });
    window.addEventListener('drop', async e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      ov.classList.remove('show');
      // エントリはイベント処理中に同期的に取得しておく必要がある
      const dt = e.dataTransfer;
      const entries = Array.from(dt.items || []).filter(i => i.kind === 'file').map(i => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null));
      const files = Array.from(dt.files || []);
      let items = [];
      if (entries.length && entries.every(Boolean)) { for (const en of entries) await walk(en, '', items); }
      else items = files.map(f => ({file: f, path: f.name}));
      if (items.length === 1 && /\.json$/i.test(items[0].file.name)) { App.openSession(items[0].file); return; }
      App.loadItems(items);
    });
  }
  async function walk(entry, prefix, out) {
    if (entry.isFile) {
      try { out.push({file: await new Promise((res, rej) => entry.file(res, rej)), path: prefix + entry.name}); } catch (e) { /* 読めないファイルは無視 */ }
      return;
    }
    if (!entry.isDirectory) return;
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const en of batch) await walk(en, prefix + entry.name + '/', out);
    }
  }

  // items: [{file, path}]。フォルダごとにデータセットを作る（keepOrder: フォルダを名前順に並べ替えない）
  App.loadItems = async function (items, keepOrder) {
    const data = items.filter(it => DATA_EXT.test(it.file.name) || !/\.[^./\\]+$/.test(it.file.name));
    let skipped = items.length - data.length;
    if (!data.length) { U.toast('対象ファイルなし（.txt / .csv）', 'warn'); return; }
    const groups = new Map();
    for (const it of data) {
      const i = it.path.lastIndexOf('/');
      const dir = i >= 0 ? it.path.slice(0, i) : '';
      if (!groups.has(dir)) groups.set(dir, []);
      groups.get(dir).push(it);
    }
    const dirs = keepOrder ? [...groups.keys()] : [...groups.keys()].sort(U.naturalCompare);
    const parts = dirs.filter(Boolean).map(d => d.split('/'));
    let common = 0;
    if (parts.length > 1) while (parts.every(p => p.length > common + 1 && p[common] === parts[0][common])) common++;
    const created = [];
    let loaded = 0;
    for (const dir of dirs) {
      const list = groups.get(dir).sort((a, b) => U.naturalCompare(a.path, b.path));
      const name = dir ? (parts.length > 1 ? dir.split('/').slice(common).join('/') : dir.split('/').pop())
        : P.commonPrefixName(list.map(it => it.file.name));
      const ds = S.addDataset(name);
      let n = 0;
      for (const it of list) {
        try {
          const parsed = P.parse(P.decode(await it.file.arrayBuffer()));
          if (parsed.x.length < 2) { skipped++; continue; }
          S.addSeries(ds, parsed, it.file.name, it.path);
          n++;
        } catch (err) {
          console.warn('読み込み失敗:', it.path, err);
          skipped++;
        }
      }
      if (n) { created.push(ds); loaded += n; } else S.datasets = S.datasets.filter(d => d !== ds);
    }
    afterLoad(created, loaded, skipped);
  };

  function afterLoad(created, loaded, skipped) {
    if (!created.length) { U.toast('読み取れるデータなし', 'warn'); return; }
    if (!S.windows.length) createDefaultWindows(created);
    else {
      const shown = new Set(S.windows.flatMap(w => [w.y1Kind, w.y2Kind]));
      const ids = new Set(created.map(d => d.id));
      const fresh = U.unique(S.series.filter(s => ids.has(s.datasetId)).map(s => s.kind)).filter(k => !shown.has(k));
      if (fresh.length) U.toast(`未表示の種類: ${fresh.map(P.kindLabel).join('、')}`, 'info', 6000);
    }
    refreshAll();
    U.toast(`${loaded} ファイル読み込み（データセット ${created.length}${skipped ? `、対象外 ${skipped}` : ''}）`, 'ok');
  }
  function createDefaultWindows(created) {
    const kinds = S.kinds();
    let pick = ['PSD', 'SPEC', 'FRF_Mag', 'FRF_Phase', 'COH'].filter(k => kinds.includes(k)).slice(0, 4);
    if (!pick.length) pick = kinds.slice(0, 4);
    // データセットが多いときは、各グラフにその種類を含む最初のデータセットだけを表示する
    const many = created.length > 3;
    for (const k of pick) {
      const first = many && created.find(d => S.series.some(s => s.datasetId === d.id && s.kind === k));
      const w = S.makeWindow({y1Kind: k, datasets: first ? [first.id] : null});
      S.windows.push(w);
      W.mount(w);
    }
    S.activeWinId = S.windows[0].id;
    W.arrange('grid');
    W.markActive();
    if (many) U.toast('各グラフはデータセット 1 つ（グラフ設定で追加）', 'info', 7000);
  }

  // ── ウィンドウ操作 ───────────────────────────────────────────────────────────
  App.addWindow = function (kind) {
    const w = S.makeWindow({y1Kind: kind, rect: W.freeRect()});
    S.windows.push(w);
    W.mount(w);
    W.activate(w);
    PL.render(w);
    I.refresh();
    updateUI();
  };
  App.duplicate = function (win) {
    const copy = JSON.parse(JSON.stringify(Object.assign({}, win, {rt: undefined})));
    const w = Object.assign(S.makeWindow({y1Kind: win.y1Kind}), copy, {id: U.uid('w'), rt: {}, z: ++S.zTop, maximized: false});
    const r = win.rect;
    w.rect = {x: Math.max(0, Math.min(r.x + 0.03, 1 - r.w)), y: Math.max(0, Math.min(r.y + 0.04, 1 - r.h)), w: r.w, h: r.h};
    S.windows.push(w);
    W.mount(w);
    W.activate(w);
    PL.render(w);
    updateUI();
  };
  App.closeWindow = function (win) {
    W.unmount(win);
    S.windows = S.windows.filter(w => w !== win);
    if (S.activeWinId === win.id) {
      const top = S.windows.slice().sort((a, b) => b.z - a.z)[0];
      S.activeWinId = top ? top.id : null;
    }
    if (S.cursor.winId === win.id) S.cursor = {x: null, locked: false, winId: null, unit: null};
    W.markActive();
    App.refreshCursor();
    I.refresh();
    updateUI();
  };
  App.windowAction = function (win, act) {
    if (act === 'panel') { win.showPanel = !win.showPanel; W.applyRect(win); if (win.id === S.activeWinId) I.refresh(); }
    else if (act === 'png') PL.download(win, 'png').catch(e => U.toast('保存失敗: ' + e.message, 'err'));
    else if (act === 'copy') PL.copy(win).then(() => U.toast('コピー完了', 'ok')).catch(e => U.toast(e.message || 'コピー失敗', 'err'));
    else if (act === 'dup') App.duplicate(win);
    else if (act === 'max') W.toggleMax(win);
    else if (act === 'close') App.closeWindow(win);
  };

  // ── 状態変更の通知 ───────────────────────────────────────────────────────────
  App.onLabelsChanged = function (win) {
    W.refreshHead(win);
    PL.render(win);
    I.syncLabels();   // 入力中の欄はそのまま
  };
  App.onRangesChanged = function (win, keys) {
    PL.render(win);
    if (keys.includes('x') && S.link.x) propagateX(win);
    I.syncRanges();
  };
  function propagateX(src) {
    const unit = S.xUnitOf(src);
    for (const w of S.windows) {
      if (w === src || S.xUnitOf(w) !== unit) continue;
      w.x.min = src.x.min;
      w.x.max = src.x.max;
      PL.render(w);
    }
  }
  App.resetAxes = function (win) {
    for (const k of ['x', 'y', 'y2']) { win[k].min = null; win[k].max = null; }
    App.onRangesChanged(win, ['x', 'y', 'y2']);
  };
  App.onVisibilityChanged = function (win) { W.buildPanel(win); PL.render(win); };
  App.onWindowDataChanged = function (win) { W.refreshHead(win); W.buildPanel(win); PL.render(win); I.refresh(); };
  App.onSeriesRenamed = function (rebuildInspector = true) {
    for (const w of S.windows) W.buildPanel(w);
    PL.renderAll();
    if (rebuildInspector) I.refresh();
  };
  App.onColorsChanged = function () { for (const w of S.windows) W.buildPanel(w); PL.renderAll(); };
  App.onDatasetRenamed = function () { for (const w of S.windows) { W.refreshHead(w); W.buildPanel(w); } PL.renderAll(); };
  App.onProfileChanged = function () {
    U.store.set('profiles', S.profiles);
    for (const w of S.windows) W.buildPanel(w);
    PL.renderAll();
    I.refresh();
  };
  App.removeDataset = function (id) { S.removeDataset(id); refreshAll(); };

  // ── カーソル ────────────────────────────────────────────────────────────────
  let curRaf = 0, lockKey = null;
  App.refreshCursor = function () {
    if (curRaf) return;
    curRaf = requestAnimationFrame(() => {
      curRaf = 0;
      // 固定カーソルは図の一部なので、固定位置が変わったときだけ描き直す
      const key = S.cursor.locked ? `${S.cursor.x}|${S.cursor.winId}|${S.link.cursor}` : null;
      if (key !== lockKey) { lockKey = key; PL.renderAll(); }
      for (const w of S.windows) { W.positionCursor(w); W.updatePanelValues(w); }
    });
  };
  App.setCursor = function (x, win) {
    if (S.cursor.locked) return;
    S.cursor.x = x;
    if (win) { S.cursor.winId = win.id; S.cursor.unit = S.xUnitOf(win); }
    App.refreshCursor();
  };
  App.lockCursor = function (x, win) {
    S.cursor = {x, locked: true, winId: win.id, unit: S.xUnitOf(win)};
    App.refreshCursor();
  };
  App.unlockCursor = function (x, win) {
    S.cursor.locked = false;
    S.cursor.x = x == null ? null : x;
    if (win) S.cursor.winId = win.id;
    App.refreshCursor();
  };
  function stepCursor(dir, n) {
    const win = S.win(S.cursor.winId) || S.activeWin();
    if (!win) return;
    const {y1, y2} = S.windowSeries(win);
    const ref = y1.concat(y2).find(s => !win.hidden[s.id]);
    if (!ref) return;
    const xs = ref.x, x = S.cursor.x;
    let i = A.nearestIndex(xs, x);
    if (Math.abs(xs[i] - x) <= 1e-9 * Math.max(1, Math.abs(x))) i += dir * n;
    else i = (dir > 0 ? A.bisect(xs, x) : A.bisect(xs, x) - 1) + dir * (n - 1);
    S.cursor.x = xs[U.clamp(i, 0, xs.length - 1)];
    App.refreshCursor();
  }
  function bindKeys() {
    document.addEventListener('keydown', e => {
      const t = e.target;
      const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (e.key === 'Escape') {
        if (D.closeMenu() || D.closeTop()) return;
        if (!typing && S.cursor.locked) { App.unlockCursor(null); return; }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (S.series.length) App.saveSession();
        return;
      }
      if (typing) return;
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && S.cursor.locked && S.cursor.x != null) {
        e.preventDefault();
        stepCursor(e.key === 'ArrowRight' ? 1 : -1, e.shiftKey ? 10 : 1);
      }
    });
  }

  // ── 解析 ────────────────────────────────────────────────────────────────────
  // 選択中グラフの表示範囲（kind 指定時はその種類のグラフのときだけ）
  function viewRange(kind) {
    const win = S.activeWin();
    if (!win || (kind && win.y1Kind !== kind)) return null;
    const g = PL.geom(win);
    if (!g) return null;
    const a = g.log ? Math.pow(10, g.r0) : g.r0, b = g.log ? Math.pow(10, g.r1) : g.r1;
    return [Math.min(a, b), Math.max(a, b)];
  }
  // PSD・Spectrum それぞれ、自分のプロファイルと比べる（選択中グラフの種類はその表示範囲内だけ）
  App.runCheck = function () {
    const kinds = S.PROFILE_KINDS.filter(k => hasKind(k) && profileSet(k));
    if (!kinds.length) { U.toast('加振プロファイル未設定', 'warn'); D.profile(profileKind()); return; }
    const rows = [], notes = [];
    for (const kind of kinds) {
      const pr = S.profiles[kind], pts = pr.points, k = A.dbScale(kind);
      let lo = pts[0].f, hi = pts[pts.length - 1].f;
      const r = viewRange(kind);
      if (r) { lo = Math.max(lo, r[0]); hi = Math.min(hi, r[1]); }
      notes.push(`${P.kindLabel(kind)}: ${pr.name}（+${pr.tolPlus} / −${pr.tolMinus} dB）${U.fmtF(lo)}–${U.fmtF(hi)} Hz${r ? '（表示範囲内）' : ''}`);
      for (const s of S.series.filter(q => q.kind === kind)) {
        const res = A.toleranceCheck({x: s.x, y: A.linearY(s)}, pts, pr.tolPlus, pr.tolMinus, lo, hi, k);
        if (!res.total) continue;
        rows.push([P.kindLabel(kind), dsName(s), S.seriesName(s, false),
          {text: res.pass ? '✓ 合格' : '✗ 不合格', cls: res.pass ? 'ok' : 'ng'},
          `+${res.maxP.toFixed(2)} / ${res.maxM.toFixed(2)} dB`,
          res.fail ? `${res.fail} / ${res.total} 点（最大超過 ${U.fmtF(res.worstF)} Hz）` : `0 / ${res.total} 点`]);
      }
    }
    const unset = S.PROFILE_KINDS.filter(k => hasKind(k) && !profileSet(k));
    if (unset.length) notes.push(`${unset.map(P.kindLabel).join('・')}: プロファイル未設定`);
    D.table({
      title: '許容範囲チェック',
      note: notes.join('\n'),
      columns: ['種類', 'データセット', '系列', '判定', '最大偏差（上 / 下）', '許容外の点'], rows,
      empty: '対象データなし',
    });
  };
  App.runRms = function () {
    const pts = S.profiles.PSD.points, hasProf = pts.length >= 2;
    const r = viewRange('PSD');
    const rows = [];
    for (const s of S.series.filter(q => q.kind === 'PSD')) {
      const xs = s.x, ys = A.linearY(s);
      let lo = hasProf ? pts[0].f : (xs.find(v => v > 0) || xs[0]);
      let hi = hasProf ? pts[pts.length - 1].f : xs[xs.length - 1];
      if (r) { lo = Math.max(lo, r[0]); hi = Math.min(hi, r[1]); }
      lo = Math.max(lo, xs[0]);
      hi = Math.min(hi, xs[xs.length - 1]);
      if (!(hi > lo)) continue;
      const rms = A.psdRms(xs, ys, lo, hi);
      const ref = hasProf ? A.profileRms(pts, lo, hi) : 0;
      rows.push([dsName(s), S.seriesName(s, false), rms.toFixed(3), `${U.fmtF(lo)}–${U.fmtF(hi)} Hz`,
        ref > 0 ? `${(20 * Math.log10(rms / ref)).toFixed(2)} dB（${((rms / ref - 1) * 100).toFixed(1)} %）` : '—']);
    }
    const note = (hasProf ? `プロファイル: ${A.profileRms(pts).toFixed(3)} Grms（${U.fmtF(pts[0].f)}–${U.fmtF(pts[pts.length - 1].f)} Hz）` : 'プロファイル未設定')
      + (r ? '（表示範囲内）' : '');
    D.table({title: 'RMS 算出（PSD → Grms）', note, columns: ['データセット', '系列', 'Grms', '積分範囲', 'プロファイル比'], rows, empty: 'PSD データなし'});
  };
  App.runPeaks = function () {
    const win = S.activeWin();
    if (!win) { U.toast('グラフ未選択', 'warn'); return; }
    const {y1, y2} = S.windowSeries(win);
    const keys = new Set(y1.concat(y2).filter(s => !win.hidden[s.id]).map(s => s.datasetId + '|' + P.colorKey(s.channel)));
    if (!keys.size) { U.toast('表示中の系列なし', 'warn'); return; }
    const groups = new Map();
    for (const s of S.series) {
      if (!keys.has(s.datasetId + '|' + P.colorKey(s.channel))) continue;
      const k = s.datasetId + '|' + s.channel;
      if (!groups.has(k)) groups.set(k, {datasetId: s.datasetId, datasetName: dsName(s), channel: s.channel, colorKey: P.colorKey(s.channel), color: S.colorOf(s), kinds: {}, spectra: []});
      groups.get(k).kinds[s.kind] = s;
    }
    for (const g of groups.values()) {
      g.spectra = S.series.filter(s => s.datasetId === g.datasetId && s.channel !== g.channel && P.colorKey(s.channel) === g.colorKey && (s.kind === 'SPEC' || s.kind === 'PSD'));
    }
    const range = viewRange();
    const res = A.findResonances([...groups.values()], range);
    if (!res.length) { U.toast('ピークなし', 'warn'); return; }
    S.peaks = res;
    PL.renderAll();
    D.peaks(res, range);
  };

  // ── セッション・出力 ─────────────────────────────────────────────────────────
  App.saveSession = function () {
    const blob = new Blob([JSON.stringify(S.serialize())], {type: 'application/json'});
    U.download(blob, `VTplot_session_${U.stamp()}.json`);
    U.toast('セッション保存完了', 'ok');
  };
  App.openSession = async function (file) {
    let obj;
    try { obj = JSON.parse(await file.text()); } catch (e) { U.toast('JSON 読み込み失敗', 'err'); return; }
    if (!obj || obj.app !== 'VTplot Web') { U.toast('非対応のファイル', 'err'); return; }
    if ((S.series.length || S.windows.length) && !confirm('現在の内容を閉じて開きますか？')) return;
    for (const w of S.windows) W.unmount(w);
    try { S.restore(obj); } catch (e) { S.reset(); U.toast(e.message, 'err'); refreshAll(); return; }
    for (const w of S.windows) W.mount(w);
    W.markActive();
    refreshAll();
    U.toast(`セッション読み込み（データセット ${S.datasets.length}・グラフ ${S.windows.length}）`, 'ok');
  };
  App.clearAll = function () {
    if (!confirm('すべて閉じますか？')) return;
    for (const w of S.windows) W.unmount(w);
    S.reset();
    refreshAll();
  };
  App.exportWorkspace = function () {
    PL.exportWorkspace().then(() => U.toast('保存完了', 'ok')).catch(e => U.toast(e.message, 'err'));
  };

  // ── サンプルデータ（Graduo 形式のテキストを生成して通常の読み込み経路に流す） ─────────
  App.loadSample = function () {
    let seed = 7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const noise = a => 1 + a * (rnd() * 2 - 1);
    const f = Array.from({length: 801}, (_, i) => i * 2.5);
    const sdof = (fq, fn, z) => { const r = fq / fn, re = 1 - r * r, im = 2 * z * r; const d = re * re + im * im; return [(re + im * im) / d, (-im * r * r) / d]; };
    const H = (fq, modes) => modes.reduce((acc, [fn, z]) => {
      const [a, b] = sdof(fq, fn, z);
      return [acc[0] * a - acc[1] * b, acc[0] * b + acc[1] * a];
    }, [1, 0]);
    const fmt = v => v.toExponential(8).toUpperCase().replace(/E([+-])(\d)$/, 'E$10$2').replace(/E([+-])(\d\d)$/, 'E$1$2');
    const file = (name, ch, kind, sub, unit, scale, mag, ys, dir) => {
      const lines = [`Label:, ${ch}: sample`, 'DateTime:, Thu Oct 29 10:00:00 2026', `DataKind:, ${ch}, ${kind}, ${sub}`, `DataPoints:, ${f.length}`,
        'Frequency:, 0.000 , 2000.000, Hz', 'X-AxisScale:, Log', 'X-AxisUnit:, Hz', `Y-AxisScale:, ${scale}`, `Y-AxisUnit:, ${unit}`, `Y-AxisMagniude:${mag ? ', ' + mag : ''}`];
      f.forEach((fq, i) => lines.push(`${fmt(fq)}, ${fmt(ys[i])}`));
      return {file: new File([lines.join('\r\n')], name, {type: 'text/plain'}), path: `sample/${dir}/${name}`};
    };
    const prof = [{f: 20, v: 0.026}, {f: 50, v: 0.16}, {f: 800, v: 0.16}, {f: 2000, v: 0.026}];
    const items = [];
    for (const [dir, shift] of [['before', 1], ['after', 0.97]]) {
      const modes = {CH2: [[310 * shift, 0.03]], CH3: [[420 * shift, 0.025], [1150 * shift, 0.02]]};
      let n = 1;
      const nm = () => `sample_${dir}_${String(n++).padStart(3, '0')}.txt`;
      items.push(file(nm(), 'CH1', 'PowerSpec', 'Mag', 'G', 'MagLog', '0-p', f.map(() => 0.5 * noise(0.03)), dir));
      for (const ch of ['CH2', 'CH3']) {
        const h = f.map(fq => H(fq, modes[ch]));
        const ref = 'CH1-' + ch.slice(2);
        items.push(file(nm(), ch, 'PowerSpec', 'Mag', 'G', 'MagLog', '0-p', h.map(([a, b]) => 0.5 * Math.hypot(a, b) * noise(0.05)), dir));
        items.push(file(nm(), ref, 'FRF', 'Mag', '', 'Log', '', h.map(([a, b]) => 20 * Math.log10(Math.hypot(a, b) * noise(0.04))), dir));
        items.push(file(nm(), ref, 'FRF', 'Phase', '', 'Lin', '', h.map(([a, b]) => Math.atan2(b, a) * 180 / Math.PI), dir));
        items.push(file(nm(), ref, 'FRF', 'Real', '', 'Lin', '', h.map(([a]) => a * noise(0.04)), dir));
        items.push(file(nm(), ref, 'FRF', 'Imag', '', 'Lin', '', h.map(([, b]) => b * noise(0.04)), dir));
        items.push(file(nm(), ref, 'COH', 'Mag', '', 'Lin', '', f.map(fq => Math.min(1, 0.985 - 0.04 * rnd() - (fq > 1600 ? 0.2 * rnd() : 0))), dir));
      }
      const pf = fq => (fq < 20 ? 0.026 * Math.pow(fq / 20, 2) : A.profileAt(prof, Math.min(fq, 2000))) || 1e-6;
      for (const ch of ['CH1', 'CH2', 'CH3']) {
        items.push(file(`sample_${dir}_rnd_${ch}.txt`, ch, 'PowerSpec', 'Mag', 'G', 'MagLog', 'rms, PSD, V2', f.map(fq => {
          const g = ch === 'CH1' ? 1 : Math.hypot(...H(fq, modes[ch]));
          return Math.max(1e-7, pf(fq) * g * g * noise(0.35));
        }), dir));
      }
    }
    // サンプル用のプロファイル（未設定のときだけ）: ランダムは GEVS、正弦波は入力 0.5 G 一定
    if (!profileSet('PSD')) S.profiles.PSD.points = prof;
    if (!profileSet('SPEC')) S.profiles.SPEC.points = [{f: 20, v: 0.5}, {f: 2000, v: 0.5}];
    U.store.set('profiles', S.profiles);
    App.loadItems(items, true);
  };
})(globalThis.VT = globalThis.VT || {});
