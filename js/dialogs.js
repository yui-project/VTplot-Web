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

  // ── 表形式の結果（TSV コピー付き） ─────────────────────────────────────────────
  D.table = function ({title, note, columns, rows, empty}) {
    const body = U.h('div', {class: 'res'});
    if (note) body.appendChild(U.h('p', {class: 'res-note'}, note));
    if (!rows.length) body.appendChild(U.h('p', {class: 'muted'}, empty || '結果がありません'));
    else {
      const tbl = U.h('table', {class: 'tbl'});
      tbl.appendChild(U.h('tr', null, columns.map(c => U.h('th', null, c))));
      for (const r of rows) tbl.appendChild(U.h('tr', null, r.map(c => (c && typeof c === 'object') ? U.h('td', {class: c.cls || ''}, c.text) : U.h('td', null, c))));
      body.appendChild(U.h('div', {class: 'tbl-wrap'}, tbl));
    }
    const tsv = [columns.join('\t')].concat(rows.map(r => r.map(c => (c && typeof c === 'object') ? c.text : c).join('\t'))).join('\n');
    D.modal({title, body, width: 760, buttons: [
      {label: '表をコピー（Excel 貼り付け用）', onClick: async () => U.toast(await U.copyText(tsv) ? 'コピーしました' : 'コピーできませんでした', 'ok')},
      'spacer',
      {label: '閉じる', primary: true},
    ]});
  };

  // ── 加振プロファイル ─────────────────────────────────────────────────────────
  D.profile = function () {
    const pr = S.profile;
    const ta = U.h('textarea', {class: 'inp mono', rows: 10, spellcheck: false, 'aria-label': 'プロファイルの点',
      placeholder: '# 周波数[Hz]  PSD[G²/Hz]\n20    0.026\n50    0.16\n800   0.16\n2000  0.026'});
    ta.value = A.profileText(pr.points);
    const tp = U.h('input', {type: 'number', class: 'inp inp-sm', value: pr.tolPlus, min: 0, step: 0.5, 'aria-label': '許容幅（上）'});
    const tm = U.h('input', {type: 'number', class: 'inp inp-sm', value: pr.tolMinus, min: 0, step: 0.5, 'aria-label': '許容幅（下）'});
    const preview = U.h('div', {class: 'pf-preview'});
    const update = () => {
      const {points, errors} = A.parseProfile(ta.value);
      preview.innerHTML = '';
      if (!points.length && !errors.length) {
        preview.appendChild(U.h('p', {class: 'muted'}, '1 行に「周波数 値」を書きます。区切りは空白・タブ・カンマのどれでも構いません（Excel からそのまま貼り付け可）。'));
        return;
      }
      const tbl = U.h('table', {class: 'tbl tbl-compact'});
      tbl.appendChild(U.h('tr', null, U.h('th', null, '周波数 [Hz]'), U.h('th', null, 'PSD'), U.h('th', null, '次の点への傾き')));
      points.forEach((p, i) => tbl.appendChild(U.h('tr', null,
        U.h('td', null, U.fmtF(p.f)), U.h('td', null, U.fmt(p.v)),
        U.h('td', null, i < points.length - 1 ? `${A.slopeDbOct(p, points[i + 1]).toFixed(2)} dB/oct` : ''))));
      preview.appendChild(tbl);
      preview.appendChild(U.h('p', {class: 'pf-sum'}, points.length >= 2
        ? `${points.length} 点 · ${U.fmtF(points[0].f)}–${U.fmtF(points[points.length - 1].f)} Hz · 実効値 ${A.profileRms(points).toFixed(2)} Grms`
        : '2 点以上必要です'));
      if (errors.length) preview.appendChild(U.h('p', {class: 'err'}, `読み取れない行: ${errors.join(', ')} 行目`));
    };
    ta.addEventListener('input', update);
    const ex = U.h('button', {class: 'btn btn-sm', type: 'button'}, '例: GEVS 認定レベル（14.1 Grms）');
    ex.addEventListener('click', () => { ta.value = '20\t0.026\n50\t0.16\n800\t0.16\n2000\t0.026'; update(); });
    const body = U.h('div', {class: 'pf'},
      U.h('p', {class: 'muted'}, 'PSD グラフに基準線と許容帯を表示し、許容範囲チェックと RMS 算出の基準にします。点の間は両対数で直線補間します。'),
      U.h('div', {class: 'pf-grid'}, U.h('div', {class: 'pf-left'}, ta, ex), preview),
      U.h('div', {class: 'row gap tol'}, U.h('span', null, '許容幅'), U.h('span', null, '+'), tp, U.h('span', null, 'dB'),
        U.h('span', {class: 'sep'}, '/'), U.h('span', null, '−'), tm, U.h('span', null, 'dB')));
    update();
    D.modal({title: '加振プロファイル', body, width: 760, buttons: [
      {label: 'クリア', danger: true, onClick: () => { ta.value = ''; update(); }},
      'spacer',
      {label: 'キャンセル'},
      {label: '適用', primary: true, onClick: api => {
        const {points} = A.parseProfile(ta.value);
        S.profile.points = points;
        S.profile.tolPlus = Math.max(0, +tp.value || 0);
        S.profile.tolMinus = Math.max(0, +tm.value || 0);
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
      `${res.length} 件検出${range ? `（${U.fmtF(range[0])}–${U.fmtF(range[1])} Hz）` : ''}。確度は FRF 位相・実部・虚部・コヒーレンス・他のスペクトルの根拠の数から付けた目安です。番号はグラフ上の注釈と対応します。`));
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
      {label: 'テキストをコピー', onClick: async () => U.toast(await U.copyText(txt) ? 'コピーしました' : 'コピーできませんでした', 'ok')},
      'spacer',
      {label: '閉じる', primary: true},
    ]});
  };

  // ── 使い方 ──────────────────────────────────────────────────────────────────
  D.help = function () {
    const item = (k, v) => U.h('tr', null, U.h('th', null, k), U.h('td', null, v));
    const body = U.h('div', {class: 'help'},
      U.h('h4', null, '読み込み'),
      U.h('table', {class: 'kv'},
        item('ファイル / フォルダ', 'ドラッグ＆ドロップ、または「開く」から。フォルダごとにデータセットになります（例: modal1・modal2 を同時にドロップ → 前後比較）。'),
        item('対応形式', 'ONOSOKKI DS2000（Graduo）のテキスト出力（Shift_JIS 可）。PSD / スペクトル / FRF（Real・Imag・Mag・Phase）/ コヒーレンス。')),
      U.h('h4', null, 'グラフウィンドウ'),
      U.h('table', {class: 'kv'},
        item('移動', 'タイトルバーをドラッグ。端や他のグラフにスナップします（Alt を押しながらでスナップ無効）。'),
        item('サイズ変更', 'ウィンドウの辺・角をドラッグ。'),
        item('最大化', 'タイトルバーをダブルクリック。'),
        item('並べる', '上部の「配置」からタイル・横並び・縦並び。'),
        item('タイトル', 'タイトルバーまたはグラフ上のタイトルをダブルクリック / クリックで編集。')),
      U.h('h4', null, 'プロット操作'),
      U.h('table', {class: 'kv'},
        item('ズーム', 'ドラッグで範囲選択、ホイールで拡大縮小。ダブルクリックで全体表示。'),
        item('カーソル', 'マウス位置の値を系列パネルに表示。クリックで固定、← → で 1 点ずつ移動（Shift で 10 点）、Esc で解除。'),
        item('連動', '上部の「カーソル」「X 範囲」で全グラフの縦線・表示範囲を連動。'),
        item('ラベル', 'タイトル・軸ラベル・凡例はグラフ上でクリックして直接編集。右の「グラフ設定」でも変更できます。'),
        item('系列', '系列パネルの行をクリックで表示切替、Ctrl+クリックでその系列だけ表示、名前をダブルクリックで名前変更。')),
      U.h('h4', null, '保存'),
      U.h('table', {class: 'kv'},
        item('画像', '各グラフの保存ボタン（PNG / SVG / クリップボード）、または「保存 → 全グラフを 1 枚の PNG に」。'),
        item('セッション', '「保存 → セッションを保存」でデータ・配置・ラベルを .json に保存。ドロップで復元（Ctrl+S でも保存）。')));
    D.modal({title: 'VTplot Web の使い方', body, width: 720, buttons: [{label: '閉じる', primary: true}]});
  };
})(globalThis.VT = globalThis.VT || {});
