# 気分推移Artifact — 生成ガイド（Claude Desktop / Claude.aiのみ）

週次・月次の振り返りで、`logs/` に溜まった気分の数値記録を**自己完結型HTML（Artifact）**として折れ線グラフ化し、センパイが自分の気分の流れを一目で振り返れるようにするための機能ガイドです。この機能はArtifactを表示できる**Claude Desktop / Claude.ai**でのみ使えます（Claude Code / GitHub Copilot Chat / Misskey Botはグラフ描画の対象外で、これらは従来どおり[weekly-reflection.md](./weekly-reflection.md) の言葉での振り返りを行う）。

会話上の位置づけは[weekly-reflection.md の「Artifactでのグラフ化」節](./weekly-reflection.md#artifactでのグラフ化claude-desktop--claudeaiのみ)を正とし、本ファイルはその**具体的な生成手順**を担う。

## データ源

- `logs/YYYY-MM-DD.md` の「## 体調・気分」セクション先頭行にある `気分: N/10`（Nは1〜10の整数。[logs/README.md「気分の数値記録について」](../logs/README.md)準拠）。
- 数値が無い日（自由記述のみ）は**グラフには点を打たず**、タイムラインの注記としてのみ扱う。**気分の数値を推測・捏造しないこと。**

## 抽出（scripts/extract-mood.mjs）

数値の読み取りは手作業ではなく、リポジトリ同梱のスクリプトで機械的に行う。全角/半角コロン・範囲外(1〜10以外)の除外に対応済み。

```bash
node scripts/extract-mood.mjs --days=7    # 週次（直近7日）
node scripts/extract-mood.mjs --days=30   # 月次（直近30日）
node scripts/extract-mood.mjs             # 全期間
```

出力は `{ generatedAt, days, entries: [{ date, mood, note }] }` のJSON。`mood` は整数または `null`、`note` は「体調・気分」先頭の箇条書き1行。Claude Desktopでリポジトリのファイルを直接読めない場合は、センパイがアップロードした `logs/*.md` の中身から同じ規則（`気分: N/10`）で人手抽出してもよい。

## Artifactの生成手順

1. 上記スクリプト（または人手抽出）で `entries` を得る。
2. `entries` を**そのままHTMLに埋め込んだ自己完結型HTML**を作る。外部通信は禁止で、グラフ描画は許可されたCDNの Chart.js のみ使用する。ライトモード配色（明るい背景・濃い文字）で組む。
3. グラフは日付×気分(1〜10)の折れ線。数値の無い日は線を切らずスキップ（`spanGaps`）、各点のツールチップに `note` を出す。グラフ下に日付付きのタイムライン（`note`）を併記する。
4. 期間切り替え（週次7日／月次30日／全期間）のボタンを付けると、同じArtifactで両方の振り返りに使える。
5. Cowork環境では `create_artifact` でサイドバーに保存する（id例: `mood-trend`）。既存Artifactの更新は `update_artifact` で最新データに差し替える（毎回新規作成しない）。

## 空データ時の扱い

気分の数値記録が0件のときは、グラフ領域に「まだ数値の気分記録がない。夜の振り返りで `気分: N/10` を残すと、ここに推移が出る」という空状態メッセージを出す。責める調子にはせず、[weekly-reflection.md の注意](./weekly-reflection.md#注意)に従う。

## 制約

- グラフの傾向を「診断」「評価」として突きつけない。センパイ自身が振り返るための材料として優しく提示する（[AGENTS.md 安全指針](../AGENTS.md#生活管理cbtサポートの運用方針)）。
- 気分の著しい落ち込みが続く／希死念慮・自傷を思わせる記録があるときは、グラフ化より先に相談窓口の案内を最優先する。
- `logs/` はセンパイの機微情報。Artifactは外部送信せず、ローカル表示にとどめる。
