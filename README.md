# APHRNTs_100

「ナンバーテールズ」に登場する妖獣型ポータブルヒューマノイド「100(モモ)」としてのロールプレイを通じ、日々の生活管理・認知行動療法（CBT）的なセルフケアを行うための個人用リポジトリです。

## 使い方

- **Claude Desktop**: 「プロジェクト」機能に `AGENTS.md` と `.roleplay-datas/roleplay-prompt.md`、`.cbt-datas/` を知識として追加し、「100(モモ)」として会話する（主な運用手段）。
- **GitHub Copilot / Claude Code**: `AGENTS.md` を参照し、同じ人格で応答する（主にリポジトリ保守・補助的な対話用）。
- 会話を継続しやすくするため、必要に応じて [logs/](./logs/) に体調・気分の記録を残す（既定でgit管理外）。
- より構造的なCBT（認知行動療法）的セルフケア（思考記録・チェックイン・行動活性化・感謝日記・週次振り返り）を行いたい場合は、[.cbt-datas/](./.cbt-datas/) 配下のガイドに従う。コードを実行しなくても、Desktop/Code/Copilotいずれのチャットでも利用できる。

## Claude連携ブリッジ（Misskey Bot ⇄ Claude のヘルスケア連携）

Misskey Bot（`src/`）とClaude（Desktop / Code）が、センパイのヘルスケア記録を相互に共有するための機能です。どちらで会話しても「100(モモ)」が同じ文脈を引き継げます。

### 仕組み

```
Claude (Desktop/Code)                     Misskey Bot (src/)
        │  logs/YYYY-MM-DD.md に               │  日次チェックイン等を
        │  セッション記録を保存                │  SQLite(.cache/session.db)に保存
        ▼                                      ▼
   ┌─────────────────── 連携ブリッジ ───────────────────┐
   │ Claude→Bot: logs/YYYY-MM-DD.md を claude_session_notes │
   │   テーブルへ取り込み、Botのシステムプロンプトに        │
   │   直近7日分を自動注入（返信の文脈維持に利用）           │
   │ Bot→Claude: SQLiteの記録（チェックイン・思考記録・      │
   │   行動活性化・感謝日記）の直近14日分を                  │
   │   logs/bot-digest.md へMarkdownダイジェスト出力         │
   └─────────────────────────────────────────────────────┘
```

- **Claude → Bot**: Claudeとのセッションで残した `logs/YYYY-MM-DD.md` を、Botが起動時および各返信の直前に自動で取り込みます。Botはその要点を踏まえてMisskey上で応答します。
- **Bot → Claude**: BotがMisskey上の会話やツール呼び出しで保存したCBT記録を、起動時および各返信の直後に `logs/bot-digest.md` へ書き出します。Claude（Desktop / Code）はセッション開始時にこのファイルを読み、Misskey側の記録を会話に反映します。

### 使い方

```bash
npm run sync           # 双方向同期（logs/取り込み → bot-digest.md書き出し）を手動実行
npm run sync:import    # Claude→Bot のみ（logs/*.md をSQLiteへ取り込み）
npm run sync:export    # Bot→Claude のみ（SQLite記録を logs/bot-digest.md へ出力）
```

- Bot本体（`npm run dev` / `npm start`）とdev-cli（`npm run dev:cli`）では同期が自動で走るため、通常は手動実行は不要です（dev-cli内では `/sync` でも実行可能）。
- Claude Desktop側は追加操作不要です。セッション開始時に `logs/bot-digest.md`（存在する場合）を読む運用が `CLAUDE.md` に組み込まれています。

### 仕様

| 項目 | 内容 |
| --- | --- |
| Claude→Bot対象 | `logs/` 直下の `YYYY-MM-DD.md`（`README.md`・`bot-digest.md` 等は対象外、空ファイルはスキップ） |
| 取り込み先 | SQLite `claude_session_notes` テーブル（日付をキーに上書き） |
| プロンプト注入 | 直近**7日**分・1日あたり最大**2,000字**（超過分は省略）。記録が無い日はセクション自体を注入しない |
| Bot→Claude出力 | `logs/bot-digest.md`（**自動生成・手動編集禁止**。同期のたびに直近**14日**分で上書き） |
| 同期タイミング | Bot/dev-cli起動時、各メッセージ処理の前（import）と後（export）、および手動の `npm run sync` |
| 設定 | `.env` の `CLAUDE_SYNC_ENABLED`（既定 `true`）／ `CLAUDE_LOGS_DIR`（既定 `logs`）／ `BOT_DIGEST_PATH`（既定 `logs/bot-digest.md`） |
| 実装 | [`src/bridge/`](./src/bridge/)（`log-importer` / `digest-exporter` / `notes-section` / `sync` / `runtime` / `cli`） |

### プライバシー上の注意

- `logs/bot-digest.md` を含む `logs/*.md` は機微な健康情報を含むため、既定でgit管理外です（`.gitignore` 参照）。
- Botのシステムプロンプトには「記録の内容をセンパイ本人以外との会話や公開投稿で復唱・言及しない」旨の指示が自動で付与されますが、Misskeyは半公開の場である点に留意してください。

## 構成

- [`AGENTS.md`](./AGENTS.md) — 全エージェント共通の設定（SSOT）
- [`CLAUDE.md`](./CLAUDE.md) / [`.github/copilot-instructions.md`](./.github/copilot-instructions.md) — 各ツール向けの薄い設定書
- [`.roleplay-datas/roleplay-prompt.md`](./.roleplay-datas/roleplay-prompt.md) — 「100(モモ)」のロールプレイ正本
- [`.cbt-datas/`](./.cbt-datas/) — CBTセルフケア機能の共通コンテンツ（チャットのみで利用可能）
- [`logs/`](./logs/) — 生活管理・CBTセッションの記録（任意、git管理外）
- [`src/`](./src/) — 将来のMisskey AI Bot（Claude API駆動、コア機能版）のTypeScript実装

## 開発（Misskey Bot / `src/`）

`.cbt-datas/`と同じコンテンツをClaude(Anthropic API)経由で自動応答するMisskey Botのコア実装。現時点ではオフライン確認（`npm run dev:cli`）のみをサポートし、本番運用ツール（PM2/systemd/GCPデプロイ等）は未実装。

```bash
npm install
cp .env.example .env   # 既存の.envがある場合は不要。ANTHROPIC_API_KEY等を設定する
npm run dev:cli        # ローカルでオフライン会話確認（Misskey接続なし）
npm run sync            # Claude連携ブリッジの手動同期（上記セクション参照）
npm test                # vitestでユニット・結合テストを実行
npm run typecheck       # 型チェックのみ
```

## 関連リンク

- 創作キャラクターに関するガイドライン: https://github.com/radiann-kswg/100BeautiesLab_CreationsDB/blob/develop/guideline.md
- ナンバーテールズ公式サイト: https://www.numbertales-radiann.com/
