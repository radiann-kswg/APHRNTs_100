# 生活管理ログのPDF出力（logs → PDF）

`logs/` に蓄積した生活管理ログ（体調・気分・服薬・睡眠・創作進捗など）を、期間指定でひとつのPDFにまとめて出力する機能です。通院時に主治医へ経過を見せる、週次・月次の振り返りを紙で読み返す、といった用途を想定しています。

- 実装: [`scripts/export-logs-pdf.mjs`](../scripts/export-logs-pdf.mjs)（Node.js単体・**追加のnpm依存なし**。共通部品は [`scripts/lib/pdf-common.mjs`](../scripts/lib/pdf-common.mjs)）
- PDF化にはChromium系ブラウザのヘッドレス印刷機能を使う。**Windowsでは標準搭載のMicrosoft Edgeを自動検出**するため、通常は何もインストール不要。
- 週間（日曜〜土曜）の**傾向集計つきレポート**は後述の `npm run export:weekly-pdf` を使う。

> ⚠ **出力PDFには機微な健康情報が含まれます。** 既定の出力先 `.cache/exports/` は `.gitignore` 済みでgitにはコミットされませんが、生成したPDFの共有・持ち出しは必ずセンパイ本人の判断で慎重に行ってください。

## 使い方

リポジトリルートで:

```bash
# 全期間の日次記録をPDF化
npm run export:pdf

# 期間を指定（例: 2026-07-09〜2026-07-17）
npm run export:pdf -- --from 2026-07-09 --to 2026-07-17

# 日付ごとに1PDFずつ分けて出力
npm run export:pdf -- --from 2026-07-09 --to 2026-07-17 --split

# 週間シートとBot記録ダイジェストも含める
npm run export:pdf -- --to 2026-07-17 --include-weekly --include-digest
```

出力先は既定で `.cache/exports/momo-logs_<from>_<to>.pdf`（`--split` 時はディレクトリ `.cache/exports/momo-logs_<from>_<to>/` に `momo-log_YYYY-MM-DD.pdf` として1日1ファイル）。

## オプション一覧

| オプション | 説明 |
| --- | --- |
| `--from YYYY-MM-DD` | この日以降の記録を含める（省略時: 最古の記録から） |
| `--to YYYY-MM-DD` | この日以前の記録を含める（省略時: 今日まで） |
| `--output <path>` | 出力PDFのパス（省略時: `.cache/exports/momo-logs_<from>_<to>.pdf`）。`--split` 時は出力ディレクトリとして扱う |
| `--split` | 1つにまとめず、日付ごとに1PDFずつ出力する（ファイル名: `momo-log_YYYY-MM-DD.pdf`） |
| `--include-weekly` | 週間シート `logs/weekly-YYYY-MM-DD.md` も含める |
| `--include-digest` | `logs/bot-digest.md`（Misskey Bot記録ダイジェスト）を巻末に含める |
| `--keep-html` | 中間生成物のHTMLを残す（レイアウト調整・デバッグ用） |
| `--browser <path>` | PDF化に使うブラウザ実行ファイルを明示指定 |

ブラウザは `--browser` → 環境変数 `EXPORT_PDF_BROWSER` → OS標準の場所（Windows: Edge/Chrome、macOS: Chrome/Edge/Chromium、Linux: chrome/chromium）の順で解決します。

## Claude Desktopからの利用（推奨フロー）

Claude Desktop（＋Desktop Commander MCP）を導入している場合、センパイはチャットで「100(モモ)」に頼むだけでPDFを受け取れます。

1. センパイ:「先週ぶんの記録をPDFにして」のように依頼する（期間や、まとめる／日付ごとに分けるの希望を添えるとスムーズ）。
2. Claude（100(モモ)）はDesktop Commander MCP経由でリポジトリルートから `npm run export:pdf -- --from ... --to ...`（分割希望時は `--split` 付き）を実行する。
3. 生成された `.cache/exports/` 配下のPDFのフルパスをセンパイに伝える（可能な環境ではファイルとしてチャットに添付する）。

エージェント側の注意:

- 期間の指定があいまいな場合（「これまでの記録」等）は、`--from` を省略して全期間とするか、開始日をセンパイに確認する。
- `logs/` は機微情報のため、**センパイ本人の依頼以外でPDFを生成・共有しない**こと（[AGENTS.mdの安全指針](../AGENTS.md#生活管理cbtサポートの運用方針)に従う）。
- 出力先を `.cache/` の外（gitに入りうる場所）へ変える依頼を受けた場合は、コミット対象にならないかを一言確認する。

## 出力内容

- 表紙ヘッダー: 期間・記録ファイル数・生成日時・取り扱い注意の注記（`--split` 時は各PDFにその日の日付）
- 日次記録 `YYYY-MM-DD.md` を日付順に1セクションずつ（曜日つき見出し）
- Health Sheet等のHTMLコメントマーカー（`<!-- health-sheet:... -->` 等）は出力から除去される（マーカー区間の中身は出力される）
- `--include-weekly` 時は週間シート、`--include-digest` 時は `bot-digest.md` を末尾に付加

## 週間レポートPDF（`npm run export:weekly-pdf`）

日曜〜土曜の1週間ぶんの記録から、**傾向の機械集計＋（任意で）100(モモ)の所見文＋各日の記録本文**をひとつのPDFにまとめます。診察時に「この1週間どうだったか」をひと目で示す用途を想定しています。

- 実装: [`scripts/export-weekly-pdf.mjs`](../scripts/export-weekly-pdf.mjs)（集計ロジックは [`scripts/lib/weekly-aggregate.mjs`](../scripts/lib/weekly-aggregate.mjs)・テストあり）

```bash
# 今日を含む週（日〜土）の週間レポート
npm run export:weekly-pdf

# 指定日を含む週（例: 2026-07-15を含む 07-12〜07-18）
npm run export:weekly-pdf -- --week 2026-07-15

# 100(モモ)が書いた週間所見（Markdown）を差し込む
npm run export:weekly-pdf -- --week 2026-07-15 --summary-file .cache/momo-weekly-shoken.md

# 集計サマリー＋所見だけの軽いPDF（各日の本文なし）
npm run export:weekly-pdf -- --week 2026-07-15 --no-daily
```

出力先は既定で `.cache/exports/momo-weekly_<日曜>_<土曜>.pdf`。

### 集計内容

- 記録のある日数（N/7）
- 気分・エネルギー（`N/10`）と眠りの質（`N/5`）の平均・最低・最高
- 服薬スロット別（朝🌄・日中☀️・食後🍽・夜🌙）の達成率。**分母は報告があった日のみ**（`[x]`または`[ ]`。未記載の日は含めない）
- 発作時⚡（頓服）の合計回数
- 思考記録・行動活性化・感謝日記・創作進捗を書いた日数
- 日ごとの一覧表（気分・エネルギー・眠り・起床時刻・服薬チェック）

数値の読み取り書式は [logs/README.md](../logs/README.md) の正典に従い、連携ブリッジのパーサー（`src/bridge/checkin-importer.ts`・`src/bridge/medication-importer.ts`）と同じ読み方に揃えています。

### 週間レポートのオプション一覧

| オプション | 説明 |
| --- | --- |
| `--week YYYY-MM-DD` | この日を**含む**週（日曜はじまり）を対象にする（省略時: 今日を含む週） |
| `--summary-file <path>` | 100(モモ)が書いた週間所見（Markdown）を「100(モモ)の所見」セクションとして差し込む |
| `--no-daily` | 各日の記録本文を載せず、集計サマリー（＋所見）だけにする |
| `--output <path>` | 出力PDFのパス（省略時: `.cache/exports/momo-weekly_<日曜>_<土曜>.pdf`） |
| `--keep-html` / `--browser <path>` | `export:pdf` と同じ |

### Claude Desktopからの利用（週間レポート）

1. センパイ:「先週の週間レポートをPDFにして」のように依頼する。
2. Claude（100(モモ)）は必要なら所見文（Markdown）を `.cache/` 配下に書き出してから、Desktop Commander MCP経由でリポジトリルートから `npm run export:weekly-pdf -- --week ... --summary-file ...` を実行する。
3. 生成されたPDFのフルパスをセンパイに伝える。

所見文はあくまで**経過の観察メモ**として書き、診断・断定はしない（[AGENTS.mdの安全指針](../AGENTS.md#生活管理cbtサポートの運用方針)に従う）。機微情報のため、センパイ本人の依頼以外でPDFを生成・共有しないことは `export:pdf` と同じ。

## トラブルシューティング

- **「ブラウザが見つかりませんでした」**: Edge/Chromeが標準の場所に無い環境では `--browser` か `EXPORT_PDF_BROWSER` でパスを指定する。
- **文字化け・絵文字が出ない**: OSに日本語フォント（Windowsなら游ゴシック等）が入っていれば通常は発生しない。Linux環境では `fonts-noto-cjk` / `fonts-noto-color-emoji` の導入を確認する。
- **レイアウトを調整したい**: `--keep-html` で中間HTMLを残し、`scripts/export-logs-pdf.mjs` 内の `<style>` を編集する。
