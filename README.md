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

ホストされているBotアカウントに**メンションを送る**か、**Misskeyの一対一メッセージ（Chat）を送る**だけです。アカウント登録やAPIキーは不要です。

- 「今日は気分が沈んでて……」のように話しかけると、「100(モモ)」として返信します。
- 日次チェックイン（気分・睡眠・エネルギー・創作進捗）と服薬記録（朝・日中・食後・夜の服用有無、頓服の回数）は、雑談の中で触れただけでも構造化データとして自動で保存されます（保存した際は必ずその旨を伝えます）。思考記録・行動活性化・感謝日記は「この思考記録を保存して」のように**明示的に頼んだ場合のみ**保存されます。
- 記録はMisskeyのユーザーIDごとに分離して保存され、他のユーザーの会話に混ざることはありません。
- 連投を防ぐため、返信にはクールダウン（既定30分。会話が続いている間は緩和）があります。
- 毎日20時（既定、`DAILY_REFLECTION_HOUR`で変更可）に、その日の振り返りを促すリマインドが一対一チャットで届きます。
- 毎日18時（既定、`MED_REMINDER_HOUR`で変更可）に、その日の夜🌙の服薬がまだ記録されていない場合だけ、服薬リマインドが一対一チャットで届きます（服用済みの記録があれば送られません）。
- Misskeyの公開メンションは半公開の場です。**見られたくない内容は公開の場に書かない**よう気をつけてください。込み入った相談になってきた場合、Botの方から一対一チャットへの移行をそっと提案することがあります。

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
   │   行動活性化・感謝日記・服薬記録）の直近14日分（既定、   │
   │   変更可）を logs/bot-digest.md へMarkdownダイジェスト  │
   │   出力                                                  │
   └─────────────────────────────────────────────────┘
```

### 使い方

```bash
# ローカル内で完結する同期（logs/ ⇄ ローカルの .cache/session.db）
npm run sync             # 双方向同期（logs/取り込み → bot-digest.md書き出し）を手動実行
npm run sync:import      # Claude→Bot のみ（logs/*.md をSQLiteへ取り込み。服薬の逆マージ含む・下記参照）
npm run sync:export      # Bot→Claude のみ（SQLite記録を logs/bot-digest.md へ出力）

# 本番VM（GCE）との同期（下記「本番VM運用時の注意」参照）
npm run sync:remote      # 相互同期（ローカル→VM取り込み → VM側でダイジェスト再生成 → VM→ローカル取得）
npm run sync:push-remote # Claude→Bot のみ（ローカルのlogs/*.mdをVMへ転送し、VM上のSQLiteへ取り込み）
npm run sync:pull-remote # Bot→Claude のみ（VM上のbot-digest.mdをローカルへ取得）
```

- Bot本体（`npm run dev` / `npm start`）とdev-cli（`npm run dev:cli`）では同期が自動で走るため、通常は手動実行は不要です（dev-cli内では `/sync` でも実行可能）。
- **服薬の逆マージ**: `sync:import` は、`BOT_OWNER_USER_ID` 設定時にセッション記録の「## 服薬」セクションを読み取り、**チェック済み（`[x]`）のスロットと発作時⚡の記述だけ**をBotの服薬記録（`medication_logs`）へ上書きします（Claude/Health Sheet側の記録を正とする運用）。未チェック（`[ ]`）や記載のないスロットはテンプレートの置き場の可能性があるため一切触れず、Misskeyで直接報告した記録やダイジェストの「記録の抜け」検知はそのまま活きます。
- Claude Desktop側は追加操作不要です。セッション開始時に `logs/bot-digest.md`（存在する場合）を読む運用が `CLAUDE.md` に組み込まれています。ただし本番Bot運用時は下記の注意を参照してください。

### 本番VM運用時の注意（`npm run sync:remote`）

本番Bot（[deploy/README.md](./deploy/README.md)参照）はGCE VM上で単独稼働しており、VM上の`logs/`・SQLite（`.cache/session.db`）はいずれもVMのローカルディスクにのみ存在します。デプロイは「GitHub→VM」のpull型一方向のみで、VM→GitHubへ書き戻す経路はありません。加えて`logs/`はgit管理対象外（機微情報のため）なので、**ローカルとVMの間ではどちらの方向にも記録が自動では流れません**（ローカルでの`npm run sync`は、あくまでローカルの`.cache/session.db`だけを対象にします）。

そのため、本番VM運用時は次の2方向をローカル側から明示的に橋渡しする必要があります。

```bash
npm run sync:remote   # 下記3つをこの順で実行（通常はこれ1本でよい）
```

| 方向 | 単独実行 | 内容 |
| --- | --- | --- |
| Claude→Bot | `npm run sync:push-remote` | ローカルの`logs/YYYY-MM-DD.md`（既定で直近**7日**分）を`gcloud compute scp`でVMへ転送し、VM上で`npm run sync:import`を実行してVMのSQLiteへ取り込む。取り込まれた記録は本番Botの応答文脈（システムプロンプトの`<claude-session-notes>`）に載る |
| （VM側） | — | VM上で`npm run sync:export`を実行し、取り込み後のVMのSQLiteから`logs/bot-digest.md`を再生成する |
| Bot→Claude | `npm run sync:pull-remote` | `gcloud compute ssh`経由でVM上の`logs/bot-digest.md`を取得し、ローカルへ上書きする |

- **前提**: このPCに[gcloud CLI](https://cloud.google.com/sdk/docs/install)がインストール・認証済みで（`gcloud auth list`で本番VMのプロジェクトへアクセスできるアカウントが見えること）、かつVM上でsudo権限を持つユーザーとしてSSH接続できること（VM本体はOS Loginで認証、Bot自体は非特権ユーザー`aphrnts-bot`で稼働しているため、ダイジェストの読み取りには`sudo cat`を、転送したログの配置とVM上の同期実行には`sudo install` / `sudo -u aphrnts-bot`を使う）。
- **設定**: `.env`の`GCE_PROJECT` / `GCE_ZONE` / `GCE_INSTANCE` / `REMOTE_BOT_DIGEST_PATH` / `REMOTE_BOT_USER`（既定値は本番VM構成に合わせ済み。VM再構築時のみ変更）。VM上のログディレクトリ・リポジトリのパスは`REMOTE_BOT_DIGEST_PATH`から導出するため、別途の設定は不要です。
- **転送範囲**: `logs/`直下の`YYYY-MM-DD.md`のうち、JST基準で直近7日分（Botがプロンプトへ注入する範囲と同じ）。空ファイル・`weekly-*.md`・`bot-digest.md`・`README.md`は対象外です。一時的に範囲を変える場合は`npm run sync:push-remote -- --days=14`のように指定します。同じログを何度転送しても日付をキーに上書きされるだけなので、繰り返し実行しても結果は変わりません。
- **定期実行**: 常に最新化しておきたい場合は、OS側のタスクスケジューラ等でこのコマンドを定期実行するよう設定してください（Windowsの場合の設定例は[deploy/README.md](./deploy/README.md#ローカルpc側の定期同期windowsタスクスケジューラ)を参照）。Claude Desktopアプリ自体はコードを実行できないため、この定期実行はOS側の仕組みに委ねる必要があります。

### 仕様

| 項目 | 内容 |
| --- | --- |
| Claude→Bot対象 | `logs/` 直下の `YYYY-MM-DD.md`（`README.md`・`bot-digest.md` 等は対象外、空ファイルはスキップ） |
| 取り込み先 | SQLite `claude_session_notes` テーブル（日付をキーに上書き） |
| 服薬の逆マージ | `BOT_OWNER_USER_ID` 設定時、「## 服薬」のチェック済み（`[x]`）スロットと発作時⚡の記述を `medication_logs` へ上書き（未チェック・記載なしは不変・冪等） |
| プロンプト注入 | 直近**7日**分・1日あたり最大**2,000字**（超過分は省略）。記録が無い日はセクション自体を注入しない |
| Bot→Claude出力 | `logs/bot-digest.md`（**自動生成・手動編集禁止**。同期のたびに直近**14日（既定、`BOT_DIGEST_DAYS`で変更可）**分で上書き） |
| 同期タイミング | Bot/dev-cli起動時、各メッセージ処理の前（import）と後（export）、および手動の `npm run sync` |
| 設定 | `.env` の `CLAUDE_SYNC_ENABLED`（既定 `true`）／ `CLAUDE_LOGS_DIR`（既定 `logs`）／ `BOT_DIGEST_PATH`（既定 `logs/bot-digest.md`）／ `BOT_DIGEST_DAYS`（既定 `14`）／ `BOT_OWNER_USER_ID` |
| ダイジェストの一時延長 | `npm run sync:export -- --days=31` のように実行すると、`BOT_DIGEST_DAYS`を変えずにその場限りで対象日数を上書きできる（月次振り返りの準備等） |
| ローカル⇄VMの相互同期 | `npm run sync:remote`（`npm run sync:push-remote` → VM側のダイジェスト再生成 → `npm run sync:pull-remote`。`gcloud compute ssh` / `scp`経由。本番VM運用時のみ必要。上記「本番VM運用時の注意」参照） |
| 実装 | [`src/bridge/`](./src/bridge/)（`log-importer` / `medication-importer` / `digest-exporter` / `notes-section` / `sync` / `runtime` / `cli` / `remote-common` / `remote-pull` / `remote-push` / `remote-sync`） |

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

`.cbt-datas/`と同じコンテンツをClaude(Anthropic API)経由で自動応答するMisskey Botのコア実装。現時点ではオフライン確認（`npm run dev:cli`）に加え、GCE VM上でのsystemd常駐運用・`master`マージ後の自動デプロイまで対応済み（詳細は[deploy/README.md](./deploy/README.md)参照）。

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
