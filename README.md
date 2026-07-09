# APHRNTs_100

「ナンバーテールズ」に登場する妖獣型ポータブルヒューマノイド「100(モモ)」としてのロールプレイを通じ、日々の生活管理・認知行動療法（CBT）的なセルフケアを行うためのリポジトリです。

もともとはリポジトリ所有者（センパイ）の個人用ですが、**Misskey上のBotとして他のユーザーも利用できる**ほか、リポジトリをクローンして**自分専用の「100(モモ)」をセルフホストする**こともできます。

## ⚠️ 最初に大切なお願い

- 「100(モモ)」はAIキャラクターであり、**医療従事者ではありません**。医学的な診断・治療・薬に関する判断はできません。つらい状態が続くときは、精神科・心療内科の受診や公的な相談窓口の利用を検討してください。
- 緊急のときはためらわず頼ってください:
  - **よりそいホットライン**: 0120-279-338（24時間対応）
  - **いのちの電話**: 0570-783-556（ナビダイヤル・10時〜22時）／ 0120-783-556（毎日16時〜21時、毎月10日8時〜翌8時）
  - 命に関わる緊急時は **119番（救急）** または **110番（警察）**
- Botには危機的な言葉を検知した場合に、会話よりも優先して上記の窓口を案内する仕組みが組み込まれています。

## 使い方は3通り

### 1. Misskeyユーザーとして使う（いちばん簡単）

ホストされているBotアカウントに**メンションを送るだけ**です。アカウント登録やAPIキーは不要です。

- 「今日は気分が沈んでて……」のように話しかけると、「100(モモ)」として返信します。
- 「今日のチェックインを記録して」「この思考記録を保存して」のように**明示的に頼んだ場合のみ**、日次チェックイン・思考記録・行動活性化・感謝日記が構造化データとして保存されます（勝手に保存はしません）。
- 記録はMisskeyのユーザーIDごとに分離して保存され、他のユーザーの会話に混ざることはありません。
- 連投を防ぐため、返信にはクールダウン（既定30分。会話が続いている間は緩和）があります。
- 毎日20時（既定、`DAILY_REFLECTION_HOUR`で変更可）に、その日の振り返りを促すリマインドが届きます。
- Misskeyは半公開の場です。**見られたくない内容は公開の場に書かない**よう気をつけてください。

### 2. Claude Desktop / Claude Code で使う

リポジトリをクローンし、Claude Desktopの「プロジェクト」機能に `AGENTS.md`・`.roleplay-datas/roleplay-prompt.md`・`.cbt-datas/` を知識として追加すると、チャットだけで「100(モモ)」との生活管理・CBTセルフケアができます（コード実行は不要）。

- 会話の継続性のため、セッション記録を [logs/](./logs/) に `YYYY-MM-DD.md` 形式で残せます（既定でgit管理外）。
- 構造的なCBTセルフケア（思考記録・チェックイン・行動活性化・感謝日記・週次振り返り・月次振り返り）は [.cbt-datas/](./.cbt-datas/) のガイドに従ってください。Claude Desktop / Claude.aiでは、週次・月次振り返りの際に気分推移などをArtifact（自己完結型HTML）としてグラフ化することもできます。

### 3. 自分でBotをホストする（セルフホスト）

自分のMisskeyアカウント・自分のAPIキーで、自分専用の「100(モモ)」Botを動かせます。**他人のトークンは不要・共有も不可**です（下記「APIトークンとシークレットの扱い」参照）。

必要なもの: Node.js 20以上／Bot用のMisskeyアカウント／Anthropic（Claude）等のAI APIキー

```bash
git clone <このリポジトリ>
cd APHRNTs_100
npm install
cp .env.example .env
```

`.env` に以下を設定します（詳細なコメントは [.env.example](./.env.example) を参照）。

| 変数 | 内容 |
| --- | --- |
| `MISSKEY_HOST` | BotアカウントのあるMisskeyインスタンスURL |
| `MISSKEY_TOKEN` | Botアカウントで発行したAPIトークン（Misskeyの「設定 > API」から発行） |
| `ANTHROPIC_API_KEY` | Claude APIキー（`AI_PROVIDER` でOpenAI/Geminiにも切替可） |
| `BOT_OWNER_USER_ID` | あなた（Bot管理者）のMisskeyユーザーID。**複数ユーザーに開放するなら必須**（下記プライバシー参照） |

```bash
npm run dev:cli   # まずはMisskey接続なしで会話を確認（推奨）
npm run dev       # Misskeyに接続して起動
```

## Claude連携ブリッジ（Misskey Bot ⇄ Claude のヘルスケア連携）

Misskey Bot（`src/`）とClaude（Desktop / Code）が、`logs/` を共有ハブとしてヘルスケア記録を相互共有する機能です。どちらで会話しても「100(モモ)」が同じ文脈を引き継ぎます。

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
   │   行動活性化・感謝日記）の直近14日分（既定、変更可）を   │
   │   logs/bot-digest.md へMarkdownダイジェスト出力         │
   └─────────────────────────────────────────────────────┘
```

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
| Bot→Claude出力 | `logs/bot-digest.md`（**自動生成・手動編集禁止**。同期のたびに直近**14日（既定、`BOT_DIGEST_DAYS`で変更可）**分で上書き） |
| 同期タイミング | Bot/dev-cli起動時、各メッセージ処理の前（import）と後（export）、および手動の `npm run sync` |
| 設定 | `.env` の `CLAUDE_SYNC_ENABLED`（既定 `true`）／ `CLAUDE_LOGS_DIR`（既定 `logs`）／ `BOT_DIGEST_PATH`（既定 `logs/bot-digest.md`）／ `BOT_DIGEST_DAYS`（既定 `14`）／ `BOT_OWNER_USER_ID` |
| ダイジェストの一時延長 | `npm run sync:export -- --days=31` のように実行すると、`BOT_DIGEST_DAYS`を変えずにその場限りで対象日数を上書きできる（月次振り返りの準備等） |
| 実装 | [`src/bridge/`](./src/bridge/)（`log-importer` / `digest-exporter` / `notes-section` / `sync` / `runtime` / `cli`） |

### 複数ユーザー運用時のプライバシー（`BOT_OWNER_USER_ID`）

Botを自分以外のユーザーにも開放する場合は、`.env` の `BOT_OWNER_USER_ID` に**管理者自身のMisskeyユーザーID**を必ず設定してください。設定すると:

- `logs/bot-digest.md` には**管理者自身の記録だけ**が出力されます（他ユーザーの記録が管理者のClaudeへ渡らない）。
- `logs/YYYY-MM-DD.md`（管理者のClaudeセッション記録）は**管理者との会話にのみ**注入されます（管理者の個人ログが他ユーザーへの返信文脈に混ざらない）。

未設定（空）の場合は単一ユーザー運用とみなし、全記録が連携対象になります。また、Botのシステムプロンプトには常に「記録内容を本人以外との会話や公開投稿で復唱・言及しない」指示が付与されます。

## APIトークンとシークレットの扱い

- **トークンは各自が自分の分を用意します。** MisskeyのAPIトークンは「そのBotアカウントを操作する鍵」そのものなので、他人と共有したり、公開リポジトリにコミットしたりしてはいけません。
- 秘密情報はすべて `.env` に置きます。`.env` は `.gitignore` で除外済みで、**クローン・フォークには含まれません**。各利用者は `cp .env.example .env` して自分の値を設定します。
- GitHubの「リポジトリシークレット」は**GitHub Actions（CI/CD）の実行時にのみ**復号される仕組みで、クローンした人に配布する用途には使えません（本リポジトリでは現在Actionsを使用していません）。
- リポジトリを公開する前のチェックリスト:
  - [ ] `.env` がコミットされていない（`git ls-files | grep -E "^\.env$"` が空）
  - [ ] `logs/`（README.md以外）・`.cache/` がコミットされていない（機微な健康情報を含む）
  - [ ] 過去のコミット履歴にトークンが残っていない（残っている場合はトークンを再発行）

## 構成

- [`AGENTS.md`](./AGENTS.md) — 全エージェント共通の設定（SSOT）
- [`CLAUDE.md`](./CLAUDE.md) / [`.github/copilot-instructions.md`](./.github/copilot-instructions.md) — 各ツール向けの薄い設定書
- [`.roleplay-datas/roleplay-prompt.md`](./.roleplay-datas/roleplay-prompt.md) — 「100(モモ)」のロールプレイ正本
- [`.cbt-datas/`](./.cbt-datas/) — CBTセルフケア機能の共通コンテンツ（チャットのみで利用可能）
- [`logs/`](./logs/) — 生活管理・CBTセッションの記録＋連携ブリッジの共有ハブ（任意、git管理外）
- [`src/`](./src/) — Misskey AI Bot（Claude API駆動、コア機能版）のTypeScript実装

## 開発（Misskey Bot / `src/`）

`.cbt-datas/`と同じコンテンツをClaude(Anthropic API)経由で自動応答するMisskey Botのコア実装。現時点ではオフライン確認（`npm run dev:cli`）と手動起動をサポートし、本番運用ツール（PM2/systemd/GCPデプロイ等）は未実装。

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
