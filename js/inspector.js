'use strict';
// サイドパネル: 選択中グラフの設定（ラベル・データ・軸・表示・出力）とデータ管理
(function (VT) {
  const S = VT.state, U = VT.util, P = VT.parser, PL = VT.plot;
  const I = VT.inspector = {};
  let root = null, body = null, tab = 'graph';

  I.init = function (el) {
    root = el;
    body = root.querySelector('#sb-body');
    tab = U.store.get('tab', 'graph') === 'data' ? 'data' : 'graph';
    root.querySelectorAll('.sb-tab').forEach(b => b.addEventListener('click', () => {
      tab = b.dataset.tab;
      U.store.set('tab', tab);
      I.refresh();
    }));
  };
  I.showTab = function (t) { tab = t; I.refresh(); };

  I.refresh = function () {
    if (!body) return;
    root.querySelectorAll('.sb-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    const scroll = body.scrollTop;
    body.innerHTML = '';
    if (tab === 'graph') buildGraphTab(); else buildDataTab();
    body.scrollTop = scroll;
  };

  // ── 部品 ────────────────────────────────────────────────────────────────────
  const section = (title, ...kids) => U.h('section', {class: 'sb-sec'}, U.h('h3', null, title), ...kids);
  const field = (label, control) => U.h('div', {class: 'fld'}, U.h('span', {class: 'fld-l'}, label), control);
  function select(opts, value, onChange) {
    const sel = U.h('select', {class: 'inp'});
    for (const [v, label] of Object.entries(opts)) sel.appendChild(U.h('option', {value: v}, label));
    sel.value = value;
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }
  function segmented(opts, value, onChange) {
    const box = U.h('div', {class: 'seg', role: 'group'});
    for (const [v, label] of Object.entries(opts)) {
      const b = U.h('button', {type: 'button', class: v === value ? 'on' : ''}, label);
      b.addEventListener('click', () => {
        box.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
        onChange(v);
      });
      box.appendChild(b);
    }
    return box;
  }
  function checkbox(label, checked, onChange, title) {
    const cb = U.h('input', {type: 'checkbox', checked: !!checked});
    cb.addEventListener('change', () => onChange(cb.checked));
    return U.h('label', {class: 'chk', title}, cb, U.h('span', null, label));
  }

  // ── グラフ設定タブ ───────────────────────────────────────────────────────────
  function buildGraphTab() {
    const win = S.activeWin();
    if (!win) {
      body.appendChild(U.h('div', {class: 'sb-empty'}, S.series.length
        ? 'グラフをクリックして選択すると、ここでタイトル・軸ラベル・範囲などを設定できます。'
        : 'データを読み込むと、選択したグラフの設定がここに表示されます。'));
      return;
    }
    const labelInput = (key, auto) => {
      const inp = U.h('input', {type: 'text', class: 'inp', value: win[key] || '', placeholder: auto, 'data-key': key, spellcheck: false});
      inp.addEventListener('input', U.debounce(() => {
        win[key] = inp.value.trim() ? inp.value : null;
        VT.app.onLabelsChanged(win);
      }, 150));
      return inp;
    };
    const showTitle = checkbox('表示', win.showTitle, v => { win.showTitle = v; VT.app.onLabelsChanged(win); }, 'グラフ内にタイトルを表示');
    body.appendChild(U.h('div', {class: 'sb-target'}, U.h('span', {class: 'sb-target-l'}, '編集中'), U.h('span', {class: 'sb-target-t'}, S.titleOf(win))));
    body.appendChild(section('ラベル',
      field('タイトル', U.h('div', {class: 'row'}, labelInput('title', S.autoTitle(win)), showTitle)),
      field('X 軸', labelInput('xLabel', S.autoXLabel(win))),
      field(win.y2Kind ? 'Y 軸（左）' : 'Y 軸', labelInput('yLabel', S.autoYLabel(win, 1))),
      win.y2Kind ? field('Y 軸（右）', labelInput('y2Label', S.autoYLabel(win, 2))) : null,
      field('凡例', select(PL.LEGEND_LABEL, win.legend.pos, v => { win.legend.pos = v; win.legend.custom = null; VT.plot.render(win); })),
      U.h('p', {class: 'hint'}, '')));

    const kinds = S.kinds();
    const kindOpts = {};
    for (const k of kinds) kindOpts[k] = `${P.kindLabel(k)}（${S.kindCount(k)}）`;
    if (!kindOpts[win.y1Kind]) kindOpts[win.y1Kind] = P.kindLabel(win.y1Kind);
    const y2Opts = Object.assign({'': 'なし'}, kindOpts);
    const dataSec = section('データ',
      field(win.y2Kind ? '左 Y 軸' : 'グラフの種類', select(kindOpts, win.y1Kind, v => { S.setWindowKind(win, 1, v); VT.app.onWindowDataChanged(win); })),
      field('右 Y 軸', select(y2Opts, win.y2Kind || '', v => { S.setWindowKind(win, 2, v || null); VT.app.onWindowDataChanged(win); })));
    // このグラフの種類を含むデータセットだけを選択肢にする
    const relevant = S.datasets.filter(d => S.series.some(s => s.datasetId === d.id && (s.kind === win.y1Kind || s.kind === win.y2Kind)));
    if (relevant.length > 1) {
      const box = U.h('div', {class: 'checks'});
      for (const d of relevant) {
        const on = !win.datasets || win.datasets.includes(d.id);
        box.appendChild(checkbox(d.name, on, v => {
          const cur = new Set(win.datasets || S.datasets.map(x => x.id));
          if (v) cur.add(d.id); else cur.delete(d.id);
          win.datasets = relevant.every(x => cur.has(x.id)) ? null : S.datasets.map(x => x.id).filter(id => cur.has(id));
          VT.app.onWindowDataChanged(win);
        }));
      }
      dataSec.appendChild(field('データセット', box));
      dataSec.appendChild(U.h('p', {class: 'hint'}, ''));
    }
    body.appendChild(dataSec);

    const axisRow = (key, label) => {
      const st = win[key];
      const mk = which => {
        const inp = U.h('input', {type: 'text', class: 'inp inp-num', value: U.fmtInput(st[which]), placeholder: '自動',
          'data-axis': key, 'data-which': which, inputmode: 'decimal', spellcheck: false, 'aria-label': `${label} ${which === 'min' ? '最小' : '最大'}`});
        const commit = () => {
          const v = U.parseInput(inp.value);
          const bad = Number.isNaN(v) || (st.scale === 'log' && v != null && v <= 0);
          inp.classList.toggle('bad', bad);
          if (bad || v === st[which]) return;
          st[which] = v;
          VT.app.onRangesChanged(win, [key], true);
        };
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });
        inp.addEventListener('change', commit);
        return inp;
      };
      const seg = segmented({log: 'Log', linear: 'Lin'}, st.scale, v => {
        st.scale = v;
        if (v === 'log') { if (st.min != null && st.min <= 0) st.min = null; if (st.max != null && st.max <= 0) st.max = null; }
        VT.app.onRangesChanged(win, [key], true);
        I.syncRanges();
      });
      return U.h('div', {class: 'axis-row'}, U.h('span', {class: 'axis-name'}, label), mk('min'), U.h('span', {class: 'dash'}, '–'), mk('max'), seg);
    };
    const reset = U.h('button', {class: 'btn btn-sm', type: 'button'}, '全体表示に戻す');
    reset.addEventListener('click', () => VT.app.resetAxes(win));
    body.appendChild(section('軸の範囲とスケール',
      axisRow('x', 'X'), axisRow('y', win.y2Kind ? 'Y左' : 'Y'), win.y2Kind ? axisRow('y2', 'Y右') : null,
      U.h('div', {class: 'row between'}, U.h('span', {class: 'hint'}, ''), reset)));

    const lw = U.h('input', {type: 'range', min: 0.5, max: 4, step: 0.25, value: win.lineWidth, 'aria-label': '線の太さ'});
    const lwVal = U.h('span', {class: 'num'}, win.lineWidth.toFixed(2));
    const renderLater = U.debounce(() => VT.plot.render(win), 60);
    lw.addEventListener('input', () => { win.lineWidth = +lw.value; lwVal.textContent = (+lw.value).toFixed(2); renderLater(); });
    body.appendChild(section('表示',
      field('線の太さ', U.h('div', {class: 'row'}, lw, lwVal)),
      win.y1Kind === 'PSD' ? checkbox('加振プロファイルと許容帯を表示', win.showProfile, v => { win.showProfile = v; VT.app.onVisibilityChanged(win); }) : null,
      checkbox('ピーク解析の注釈を表示', win.showPeaks, v => { win.showPeaks = v; VT.plot.render(win); }),
      checkbox('系列パネル（カーソル値）を表示', win.showPanel, v => { win.showPanel = v; VT.win.applyRect(win); })));

    const out = (label, fn) => {
      const b = U.h('button', {class: 'btn btn-sm', type: 'button'}, label);
      b.addEventListener('click', fn);
      return b;
    };
    body.appendChild(section('画像出力',
      field('サイズ', select(PL.EXPORT_SIZES, win.exportSize || 'screen', v => { win.exportSize = v; })),
      U.h('div', {class: 'row gap'},
        out('PNG 保存', () => VT.app.windowAction(win, 'png')),
        out('SVG 保存', () => VT.plot.download(win, 'svg').catch(e => U.toast(e.message, 'err'))),
        out('コピー', () => VT.app.windowAction(win, 'copy'))),
      U.h('p', {class: 'hint'}, '')));
  }

  I.syncRanges = function () {
    const win = S.activeWin();
    if (!win || tab !== 'graph' || !body) return;
    body.querySelectorAll('input[data-axis]').forEach(inp => {
      if (document.activeElement === inp) return;
      inp.value = U.fmtInput(win[inp.dataset.axis][inp.dataset.which]);
      inp.classList.remove('bad');
    });
  };
  I.syncLabels = function () {
    const win = S.activeWin();
    if (!win || tab !== 'graph' || !body) return;
    const target = body.querySelector('.sb-target-t');
    if (target) target.textContent = S.titleOf(win);
    body.querySelectorAll('input[data-key]').forEach(inp => {
      if (document.activeElement === inp) return;
      inp.value = win[inp.dataset.key] || '';
      if (inp.dataset.key === 'title') inp.placeholder = S.autoTitle(win);
    });
  };

  // ── データタブ ──────────────────────────────────────────────────────────────
  function buildDataTab() {
    const add = (label, id) => {
      const b = U.h('button', {class: 'btn btn-sm', type: 'button'}, label);
      b.addEventListener('click', () => document.getElementById(id).click());
      return b;
    };
    if (!S.datasets.length) {
      body.appendChild(U.h('div', {class: 'sb-empty'}, 'データがありません。ファイルやフォルダをドラッグ＆ドロップするか、下のボタンから読み込んでください。'));
      body.appendChild(U.h('div', {class: 'row gap pad'}, add('ファイルを開く', 'in-files'), add('フォルダを開く', 'in-dir')));
      return;
    }
    const sec = section(`データセット（${S.datasets.length}）`);
    for (const d of S.datasets) {
      const ser = S.series.filter(s => s.datasetId === d.id);
      const name = U.h('input', {type: 'text', class: 'inp ds-name', value: d.name, 'aria-label': 'データセット名', spellcheck: false});
      name.addEventListener('change', () => {
        const v = name.value.trim();
        if (v) { d.name = v; VT.app.onDatasetRenamed(); } else name.value = d.name;
      });
      const del = U.h('button', {class: 'icon-btn danger', type: 'button', title: 'このデータセットを削除', html: U.icon('trash', 15)});
      del.addEventListener('click', () => { if (confirm(`データセット「${d.name}」を削除しますか？`)) VT.app.removeDataset(d.id); });
      const dt = (ser.find(s => s.meta.dateTime) || {meta: {}}).meta.dateTime;
      const kinds = S.kinds().filter(k => ser.some(s => s.kind === k));
      const info = U.h('div', {class: 'ds-info'},
        U.h('div', null, `${ser.length} 系列${dt ? ' · ' + dt : ''}`),
        U.h('div', {class: 'ds-kinds'}, kinds.map(k => U.h('span', {class: 'tag'},`${P.kindLabel(k)} ${ser.filter(s => s.kind === k).length}`))));
      const details = U.h('details', {class: 'ds-series'}, U.h('summary', null, '系列の名前と色'));
      details.addEventListener('toggle', () => {
        if (details.open && !details.dataset.built) { details.dataset.built = '1'; buildSeriesRows(details, ser); }
      });
      sec.appendChild(U.h('div', {class: 'ds-card'}, U.h('div', {class: 'row'}, name, del), info, details));
    }
    sec.appendChild(U.h('div', {class: 'row gap'}, add('ファイルを追加', 'in-files'), add('フォルダを追加', 'in-dir')));
    body.appendChild(sec);

    const chs = U.unique(S.series.map(s => s.channel)).sort(U.naturalCompare);
    const sec2 = section('チャンネル名と色（全グラフ共通）');
    const recolor = U.debounce(() => VT.app.onColorsChanged(), 80);
    const rename = U.debounce(() => VT.app.onSeriesRenamed(false), 200);
    for (const ch of chs) {
      const key = P.colorKey(ch);
      const color = U.h('input', {type: 'color', class: 'clr', value: S.keyColor(key), title: key !== ch ? `色は ${key} と共通` : '線の色'});
      color.addEventListener('input', () => { S.channelColors[key] = color.value; recolor(); });
      const alias = U.h('input', {type: 'text', class: 'inp', value: S.channelAlias[ch] || '', placeholder: ch, 'aria-label': `${ch} の表示名`, spellcheck: false});
      alias.addEventListener('input', () => {
        const v = alias.value.trim();
        if (v) S.channelAlias[ch] = v; else delete S.channelAlias[ch];
        rename();
      });
      sec2.appendChild(U.h('div', {class: 'ch-row'}, color, U.h('span', {class: 'ch-id'}, ch), alias));
    }
    sec2.appendChild(U.h('p', {class: 'hint'}, ''));
    body.appendChild(sec2);
  }

  function buildSeriesRows(container, ser) {
    const order = new Map(S.kinds().map((k, i) => [k, i]));
    const list = U.h('div', {class: 'ser-list'});
    const recolor = U.debounce(() => VT.app.onColorsChanged(), 80);
    const rename = U.debounce(() => VT.app.onSeriesRenamed(false), 200);
    for (const s of ser.slice().sort((a, b) => (order.get(a.kind) - order.get(b.kind)) || U.naturalCompare(a.channel, b.channel))) {
      const color = U.h('input', {type: 'color', class: 'clr', value: S.colorOf(s), title: 'この系列だけの色'});
      color.addEventListener('input', () => { s.color = color.value; recolor(); });
      const nm = U.h('input', {type: 'text', class: 'inp', value: s.name || '', placeholder: S.channelName(s.channel), 'aria-label': '系列名', spellcheck: false});
      nm.addEventListener('input', () => { s.name = nm.value.trim() || null; rename(); });
      list.appendChild(U.h('div', {class: 'ser-row', title: s.path}, color, U.h('span', {class: 'ser-kind'}, P.kindLabel(s.kind)), nm));
    }
    container.appendChild(list);
  }
})(globalThis.VT = globalThis.VT || {});
