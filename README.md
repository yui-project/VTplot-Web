[![Launch VTplot Web](https://img.shields.io/badge/Launch_VTplot_Web-▶-1C1B18?style=for-the-badge)](https://yui-project.github.io/VTplot-Web/)

# VTplot Web

ONOSOKKI DS2000（Graduo）で記録した加速度応答データ（.txt）をブラウザでプロットし、複数のグラフを並べて比較する Web アプリ。

---

## 起動

- 上のバッジ（GitHub Pages）を開く
- または `index.html` をブラウザで直接開く

## 機能

- **グラフを自由に配置**: ウィンドウをドラッグで移動・辺や角でリサイズ・最大化。「配置」でタイル / 横並び / 縦並び
- **ラベルの書き換え**: タイトル・軸ラベル・凡例をグラフ上でクリックして直接編集（右の「グラフ設定」からも可）
- **比較**: カーソル（縦線と値）と X 範囲を全グラフで連動。フォルダごとのデータセットを線種で重ね描き
- **左右 2 軸**: 例）FRF Mag（左）＋ FRF Phase（右）
- **解析**: 加振プロファイル（ランダム = PSD、正弦波掃引 = Spectrum。許容帯表示）・許容範囲チェック・RMS 算出（PSD → Grms）・ピーク解析（共振候補と減衰比、試験機能のため参考程度に）
  - 許容幅は dB で指定（PSD は 10·log10、正弦波は振幅なので 20·log10。±1 dB ≒ +12 % / −11 %）
- **出力**: グラフごとに PNG / SVG / クリップボード、全グラフを配置どおり 1 枚の PNG に
- **セッション保存**: データ・配置・ラベルを .json に保存し、ドロップで復元

## 使い方

1. ファイルまたはフォルダをドロップ（「開く」からも可）
   - フォルダごとに 1 データセット（例: `z` フォルダ → `modal1` / `modal2` / `random`）
   - データセットが 4 つ以上のときは、各グラフに 1 つだけ表示（「グラフ設定 → データセット」で追加）
2. 主要な種類（PSD / Spectrum / FRF Mag / FRF Phase など最大 4 枚）のグラフが自動で並ぶ
3. 「グラフ追加」で種類を選んでグラフを増やし、自由に配置
4. グラフをクリックで選択 → 右の「グラフ設定」でラベル・データ・軸範囲・出力を設定

## 操作一覧

| 操作 | 方法 |
|---|---|
| ウィンドウ移動 | タイトルバーをドラッグ（端・他のグラフにスナップ、Alt で無効） |
| リサイズ / 最大化 | 辺・角をドラッグ / タイトルバーをダブルクリック |
| タイトル編集 | タイトルバーのタイトルをダブルクリック、またはグラフ上のタイトルをクリック |
| ズーム | ドラッグで範囲選択・ホイール。ダブルクリックで全体表示 |
| カーソル | マウス位置の値を系列パネルに表示。クリックで固定、← → で 1 点ずつ（Shift で 10 点）、Esc で解除 |
| 系列の表示切替 | 系列パネルの行をクリック（Ctrl+クリックでその系列だけ表示） |
| 系列名の変更 | 系列パネルの名前をダブルクリック、凡例をクリック、または「データ」タブ |
| セッション保存 | Ctrl+S |

## データ形式

Graduo のテキスト出力（Shift_JIS 可）。ヘッダーは `キー:, 値, ...`、データは `周波数, 値`。

```
Label:, CH6: ﾊﾟﾜｰｽﾍﾟｸﾄﾙ
DataKind:, CH6, PowerSpec, Mag
Frequency:, 0.000 , 20000.000, Hz
X-AxisScale:, Log
X-AxisUnit:, Hz
Y-AxisScale:, MagLog
Y-AxisUnit:, G
Y-AxisMagniude:, 0-p
0.00000000E+000, 3.30214828E-001
...
"OVERALL", 6.71637829E+000
```

| `DataKind` / ヘッダー | グラフの種類 | 既定の Y 軸ラベル |
|---|---|---|
| `PowerSpec` ＋ `Y-AxisMagniude` に `PSD`（例: `rms, PSD, V2`）または指定なし | PSD | PSD [G²/Hz] |
| `PowerSpec` ＋ `0-p` / `rms` | Spectrum | Acceleration [G 0-p] |
| `FRF` ＋ `Real` / `Imag` / `Mag` / `Phase` | FRF Real / Imag / Mag / Phase | FRF Magnitude など |
| `COH` | Coherence | Coherence |
| それ以外（2 列の数値データ） | その他 | ― |

- 計測器の出力は `Y-AxisMagniude`（t 抜け）。正しい綴りも受け付ける
- `Y-AxisScale: Log` の系列は dB 値として扱い、線形軸・「[dB]」ラベルで表示（例: FRF Mag）
- 色はチャンネル番号で固定（CH1 = 青、CH2 = 橙 …）。`CH1-9` のような伝達関数は応答側 `CH9` と同じ色
- Y 軸を Log にして負値がある場合は疑似対数（symlog）で表示

## ファイル構成

| パス | 内容 |
|---|---|
| `index.html` | 画面 |
| `css/style.css` | スタイル |
| `js/parser.js` | ファイル読み込み・グラフ種の判定・既定ラベル |
| `js/analysis.js` | 補間・積分・加振プロファイル・ピーク解析 |
| `js/state.js` | データセット・系列・グラフの状態、セッション形式 |
| `js/plot.js` | Plotly の図の組み立て・画像出力 |
| `js/windows.js` | ウィンドウの移動・リサイズ・整列、系列パネル、カーソル |
| `js/inspector.js` | 右パネル（グラフ設定・データ） |
| `js/dialogs.js` | メニュー・ダイアログ・解析結果 |
| `js/app.js` | 読み込み・連動・解析・保存の全体制御 |
| `vendor/plotly-basic-2.35.2.min.js` | Plotly（MIT License） |
| `VTplot.py` | 旧デスクトップ版（Python / Tkinter） |
