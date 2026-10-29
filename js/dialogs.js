'use strict';
// モーダル・ドロップダウンメニュー・解析結果の表示
(function (VT) {
  const S = VT.state, U = VT.util, A = VT.analysis;
  const D = VT.dialogs = {};
  const stack = [];

  // ── モーダル ────────────────────────────────────────────────────────────────
  D.modal = function ({title, body, buttons = [], width = 560}) {
    const back = U.h('div', {class: 'modal-back'});
    const closeBtn = U.h('button', {class: 'icon-btn', type: 'button', title: '閉じる', html: U.icon('close', 16)});
    const foot = buttons.length ? U.h('div', {class: 'modal-foot'}) : null;
    const box = U.h('div', {class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: {width: width + 'px'}},
      U.h('div', {class: 'modal-head'}, U.h('h2', null, title), closeBtn),
      U.h('div', {class: 'modal-body'}, body), foot);
    const api = {el: box, close};
    for (const b of buttons) {
      if (b === 'spacer') { foot.appendChild(U.h('span', {class: 'spacer'})); continue; }
      const btn = U.h('button', {type: 'button', class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '')}, b.label);
      btn.addEventListener('click', () => (b.onClick ? b.onClick(api, btn) : close()));
      foot.appendChild(btn);
    }
    back.appendChild(box);
    document.body.appendChild(back);
    back.addEventListener('mousedown', e => { if (e.target === back) close(); });
    closeBtn.addEventListener('click', close);
    stack.push(api);
    requestAnimationFrame(() => back.classList.add('show'));
    function close() {
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      back.remove();
    }
    return api;
  };
  D.closeTop = function () {
    const t = stack[stack.length - 1];
    if (!t) return false;
    t.close();
    return true;
  };

  // ── ドロップダウンメニュー ────────────────────────────────────────────────────
  let openMenu = null;
  D.toggleMenu = function (anchor, items) {
    if (openMenu && openMenu.anchor === anchor) { D.closeMenu(); return; }
    D.closeMenu();
    const m = U.h('div', {class: 'menu', role: 'menu'});
    for (const it of items) {
      if (it === '-') { m.appendChild(U.h('div', {class: 'menu-sep'})); continue; }
      if (it.header) { m.appendChild(U.h('div', {class: 'menu-h'}, it.header)); continue; }
      const b = U.h('button', {type: 'button', class: 'menu-item', role: 'menuitem', disabled: !!it.disabled},
        U.h('span', {class: 'mi-ic', html: it.icon ? U.icon(it.icon, 15) : ''}),
        U.h('span', {class: 'mi-l'}, it.label),
        it.hint ? U.h('span', {class: 'mi-hint'}, it.hint) : null);
      b.addEventListener('click', () => { D.closeMenu(); if (it.onClick) it.onClick(); });
      m.appendChild(b);
    }
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8)) + 'px';
    m.style.top = (r.bottom + 4) + 'px';
    anchor.classList.add('open');
    openMenu = {m, anchor};
    document.addEventListener('mousedown', outside, true);
  };
  function outside(e) {
    if (openMenu && !openMenu.m.contains(e.target) && !openMenu.anchor.contains(e.target)) D.closeMenu();
  }
  D.closeMenu = function () {
    if (!openMenu) return false;
    openMenu.m.remove();
    openMenu.anchor.classList.remove('open');
    openMenu = null;
    document.removeEventListener('mousedown', outside, true);
    return true;
  };

  // テキストをクリップボードへ（結果を通知）
  const copied = text => async () => {
    const ok = await U.copyText(text);
    U.toast(ok ? 'コピー完了' : 'コピー失敗', ok ? 'ok' : 'err');
  };

  // ── 表形式の結果（TSV コピー付き） ─────────────────────────────────────────────
  D.table = function ({title, note, columns, rows, empty}) {
    const body = U.h('div', {class: 'res'});
    if (note) body.appendChild(U.h('p', {class: 'res-note'}, note));
    if (!rows.length) body.appendChild(U.h('p', {class: 'muted'}, empty || '結果なし'));
    else {
      const tbl = U.h('table', {class: 'tbl'});
      tbl.appendChild(U.h('tr', null, columns.map(c => U.h('th', null, c))));
      for (const r of rows) tbl.appendChild(U.h('tr', null, r.map(c => (c && typeof c === 'object') ? U.h('td', {class: c.cls || ''}, c.text) : U.h('td', null, c))));
      body.appendChild(U.h('div', {class: 'tbl-wrap'}, tbl));
    }
    const tsv = [columns.join('\t')].concat(rows.map(r => r.map(c => (c && typeof c === 'object') ? c.text : c).join('\t'))).join('\n');
    D.modal({title, body, width: 760, buttons: [
      {label: '表をコピー', onClick: copied(tsv)},
      'spacer',
      {label: '閉じる', primary: true},
    ]});
  };

  // ── 加振プロファイル（ランダム = PSD、正弦波掃引 = Spectrum） ──────────────────────
  // 正弦波の例: 5–20 Hz は変位一定（1.24 mm 0-p、加速度は f² に比例 = 12 dB/oct）、20–100 Hz は 2 G 一定
  const PROFILE_FORM = {
    PSD: {tab: 'ランダム（PSD）', head: 'PSD',
      placeholder: '# 周波数[Hz]  PSD[G²/Hz]\n20    0.026\n50    0.16\n800   0.16\n2000  0.026',
      exLabel: '例: GEVS 認定レベル（14.1 Grms）', ex: '20\t0.026\n50\t0.16\n800\t0.16\n2000\t0.026'},
    SPEC: {tab: '正弦波掃引（Spectrum）', head: '加速度',
      placeholder: '# 周波数[Hz]  加速度[G 0-p]\n5     0.125\n20    2\n100   2',
      exLabel: '例: 5–20 Hz 変位一定 → 20–100 Hz 2 G', ex: '5\t0.125\n20\t2\n100\t2'},
  };
  D.profile = function (kind) {
    let cur = S.profileOf(kind) ? kind : 'PSD';
    // タブを切り替えても適用までは入力を保持する
    const drafts = {};
    for (const k of S.PROFILE_KINDS) {
      const p = S.profileOf(k);
      drafts[k] = {text: A.profileText(p.points), tolPlus: p.tolPlus, tolMinus: p.tolMinus};
    }
    const ta = U.h('textarea', {class: 'inp mono', rows: 10, spellcheck: false, 'aria-label': 'プロファイルの点'});
    const tp = U.h('input', {type: 'number', class: 'inp inp-sm', min: 0, step: 0.5, 'aria-label': '許容幅（上）'});
    const tm = U.h('input', {type: 'number', class: 'inp inp-sm', min: 0, step: 0.5, 'aria-label': '許容幅（下）'});
    const ratio = U.h('span', {class: 'muted'});
    const preview = U.h('div', {class: 'pf-preview'});
    const ex = U.h('button', {class: 'btn btn-sm', type: 'button'});
    ex.addEventListener('click', () => { ta.value = PROFILE_FORM[cur].ex; update(); });
    const tabs = U.h('div', {class: 'seg pf-tabs', role: 'tablist'});
    for (const k of S.PROFILE_KINDS) {
      const b = U.h('button', {type: 'button', role: 'tab', dataset: {kind: k}}, PROFILE_FORM[k].tab);
      b.addEventListener('click', () => { keep(); load(k); });
      tabs.appendChild(b);
    }
    const keep = () => { drafts[cur] = {text: ta.value, tolPlus: tp.value, tolMinus: tm.value}; };
    function load(k) {
      cur = k;
      const d = drafts[k], form = PROFILE_FORM[k];
      ta.value = d.text;
      ta.placeholder = form.placeholder;
      tp.value = d.tolPlus;
      tm.value = d.tolMinus;
      ex.textContent = form.exLabel;
      tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.kind === k));
      update();
    }
    function update() {
      const {points, errors} = A.parseProfile(ta.value);
      const k = A.dbScale(cur);
      // 正弦波は振幅の比でも示す（±1 dB ≒ +12 % / −11 %）
      ratio.textContent = cur === 'SPEC'
        ? `振幅比 +${((Math.pow(10, (+tp.value || 0) / k) - 1) * 100).toFixed(1)} % / −${((1 - Math.pow(10, -(+tm.value || 0) / k)) * 100).toFixed(1)} %` : '';
      preview.innerHTML = '';
      if (!points.length && !errors.length) {
        preview.appendChild(U.h('p', {class: 'muted'}, '書式: 周波数 値（1 行 1 点）'));
        return;
      }
      const tbl = U.h('table', {class: 'tbl tbl-compact'});
      tbl.appendChild(U.h('tr', null, U.h('th', null, '周波数 [Hz]'), U.h('th', null, PROFILE_FORM[cur].head), U.h('th', null, '傾き')));
      points.forEach((p, i) => tbl.appendChild(U.h('tr', null,
        U.h('td', null, U.fmtF(p.f)), U.h('td', null, U.fmt(p.v)),
        U.h('td', null, i < points.length - 1 ? `${A.slopeDbOct(p, points[i + 1], k).toFixed(2)} dB/oct` : ''))));
      preview.appendChild(tbl);
      const range = points.length >= 2 ? `${points.length} 点 · ${U.fmtF(points[0].f)}–${U.fmtF(points[points.length - 1].f)} Hz` : '';
      preview.appendChild(U.h('p', {class: 'pf-sum'}, !range ? '2 点以上必要' : cur === 'PSD'
        ? `${range} · 実効値 ${A.profileRms(points).toFixed(2)} Grms`
        : `${range} · 最大 ${U.fmt(Math.max(...points.map(p => p.v)))}`));
      if (errors.length) preview.appendChild(U.h('p', {class: 'err'}, `読み取れない行: ${errors.join(', ')} 行目`));
    }
    ta.addEventListener('input', update);
    tp.addEventListener('input', update);
    tm.addEventListener('input', update);
    const body = U.h('div', {class: 'pf'},
      tabs,
      U.h('div', {class: 'pf-grid'}, U.h('div', {class: 'pf-left'}, ta, ex), preview),
      U.h('div', {class: 'row gap tol'}, U.h('span', null, '許容幅'), U.h('span', null, '+'), tp, U.h('span', null, 'dB'),
        U.h('span', {class: 'sep'}, '/'), U.h('span', null, '−'), tm, U.h('span', null, 'dB'), ratio));
    load(cur);
    D.modal({title: '加振プロファイル', body, width: 760, buttons: [
      {label: 'クリア', danger: true, onClick: () => { ta.value = ''; update(); }},
      'spacer',
      {label: 'キャンセル'},
      {label: '適用', primary: true, onClick: api => {
        keep();
        for (const k of S.PROFILE_KINDS) {
          const p = S.profileOf(k), d = drafts[k];
          p.points = A.parseProfile(d.text).points;
          p.tolPlus = Math.max(0, +d.tolPlus || 0);
          p.tolMinus = Math.max(0, +d.tolMinus || 0);
        }
        VT.app.onProfileChanged();
        api.close();
      }},
    ]});
    setTimeout(() => ta.focus(), 30);
  };

  // ── ピーク解析の結果 ─────────────────────────────────────────────────────────
  D.peaks = function (res, range) {
    const score = n => `確度 ${Math.max(1, Math.min(5, n))}/5`;
    const body = U.h('div', {class: 'res'});
    body.appendChild(U.h('p', {class: 'res-note'},
      `${res.length} 件${range ? `（${U.fmtF(range[0])}–${U.fmtF(range[1])} Hz）` : ''}`));
    const list = U.h('div', {class: 'pk-list'});
    let txt = `ピーク解析結果 — ${res.length} 件\n`;
    res.forEach((r, i) => {
      const head = `[${i + 1}] ${U.fmtF(r.freq)} Hz  ${S.channelName(r.channel)}（${r.datasetName}）  ${score(r.score)}`;
      txt += `\n${head}\n` + r.evidence.map(e => `    ${e.ok === true ? '✓' : e.ok === false ? '×' : '・'} ${e.text}`).join('\n') + '\n';
      list.appendChild(U.h('div', {class: 'pk'},
        U.h('div', {class: 'pk-head'},
          U.h('span', {class: 'pk-no', style: {background: r.color}}, String(i + 1)),
          U.h('b', null, `${U.fmtF(r.freq)} Hz`),
          U.h('span', null, `${S.channelName(r.channel)}（${r.datasetName}）`),
          U.h('span', {class: 'pk-score'}, score(r.score))),
        U.h('ul', null, r.evidence.map(e => U.h('li', {class: e.ok === true ? 'ok' : e.ok === false ? 'ng' : ''}, e.text)))));
    });
    body.appendChild(list);
    D.modal({title: 'ピーク解析（共振候補）', body, width: 760, buttons: [
      {label: 'テキストをコピー', onClick: copied(txt)},
      'spacer',
      {label: '閉じる', primary: true},
    ]});
  };

  // ── ヘルプ（画面から外した説明はここにまとめる） ─────────────────────────────────
  D.help = function () {
    const item = (k, v) => U.h('tr', null, U.h('th', null, k), U.h('td', null, v));
    const group = (title, ...items) => [U.h('h4', null, title), U.h('table', {class: 'kv'}, items)];
    const body = U.h('div', {class: 'help'},
      group('読み込み',
        item('ファイル / フォルダ', 'ドロップ、または「開く」から。フォルダ 1 つが 1 データセット（例: modal1・modal2 を同時にドロップ → 前後比較）。'),
        item('対応形式', 'ONOSOKKI DS2000（Graduo）のテキスト出力（Shift_JIS / UTF-8）。PSD / Spectrum / FRF（Real・Imag・Mag・Phase）/ Coherence。'),
        item('最初のグラフ', '主要な種類を最大 4 枚。データセットが 4 つ以上のときは、各グラフにデータセット 1 つ（グラフ設定で追加）。')),
      group('グラフウィンドウ',
        item('移動', 'タイトルバーをドラッグ。端や他のグラフにスナップ（Alt で無効）。'),
        item('サイズ変更', '辺・角をドラッグ。'),
        item('最大化', 'タイトルバーをダブルクリック。'),
        item('並べる', '「配置」からタイル・横並び・縦並び・重ねる。'),
        item('タイトル', 'タイトルバーをダブルクリック、またはグラフ上のタイトルをクリック。')),
      group('プロット操作',
        item('ズーム', 'ドラッグで範囲選択、ホイールで拡大縮小。ダブルクリックで全体表示。'),
        item('カーソル', 'マウス位置の値を系列パネルに表示。クリックで固定、← → で 1 点ずつ（Shift で 10 点）、Esc で解除。'),
        item('連動', '「カーソル」「X 範囲」で全グラフの縦線・表示範囲をそろえる。'),
        item('ラベル', 'タイトル・軸ラベル・凡例はグラフ上でクリックして編集（凡例はドラッグで移動）。グラフ設定でも変更可。空欄で自動のラベル。'),
        item('凡例', '「自動」は 8 系列以下のときだけ表示。多いときは系列パネルが凡例の代わり。')),
      group('系列パネル',
        item('表示切替', '行をクリック。Ctrl+クリックでその系列だけ。データセット名のクリックでまとめて切替。'),
        item('名前変更', '名前をダブルクリック（凡例のクリック、データタブでも可）。')),
      group('グラフ設定',
        item('データセット', '複数を重ねると線種（実線・破線…）で区別。'),
        item('軸', '空欄で自動。ズーム・パンの結果も入る。リセットで全体表示。'),
        item('画像出力', 'PNG は 2 倍の解像度。SVG は拡大しても粗くならない（Word / PowerPoint 向き）。')),
      group('データ',
        item('チャンネル名・色', '全グラフ共通。名前は凡例と系列パネルに使用（重ねたときは後ろにデータセット名）。CH1-9 のような伝達関数は応答側（CH9）と同じ色。')),
      group('解析',
        item('加振プロファイル', 'ランダム（PSD）と正弦波掃引（Spectrum）を別々に設定。同じ種類のグラフに基準線と許容帯を表示。1 行に「周波数 値」（空白・タブ・カンマ区切り、Excel から貼り付け可、# 以降はコメント）。点の間は両対数で直線補間。'),
        item('許容幅', 'dB で指定。PSD は 10·log10、正弦波は振幅なので 20·log10（±1 dB ≒ +12 % / −11 %）。'),
        item('変位一定の区間', '両端の加速度を入力（12 dB/oct の直線になる）。'),
        item('許容範囲チェック', 'PSD・Spectrum の全系列を、それぞれのプロファイルで判定。選択中グラフの種類は表示範囲内だけ。'),
        item('RMS 算出', 'PSD を積分して Grms。積分範囲はプロファイルの範囲（未設定なら全範囲、0 Hz を除く）。選択中が PSD グラフならその表示範囲内。'),
        item('ピーク解析', '試験機能。選択中グラフの系列が対象。確度は根拠（FRF 位相・実部・虚部・コヒーレンス・他のスペクトル）の数による目安。番号はグラフ上の注釈と対応。')),
      group('保存',
        item('画像', '各グラフの保存ボタン（PNG / SVG / コピー）、または「保存 → 全グラフを 1 枚の PNG に」（配置どおり）。'),
        item('セッション', '「保存 → セッションを保存」（Ctrl+S）。データ・配置・ラベル・プロファイルを .json に保存し、ドロップで復元。')));
    D.modal({title: 'ヘルプ', body, width: 720, buttons: [{label: '閉じる', primary: true}]});
  };
})(globalThis.VT = globalThis.VT || {});
