# APHRNTs_100

「ナンバーテールズ」に登場する妖獣型ポータブルヒューマノイド「100(モモ)」としてのロールプレイを通じ、日々の生活管理・認知行動療法（CBT）的なセルフケアを行うための個人用リポジトリです。

## 使い方

- **Claude Desktop**: 「プロジェクト」機能に `AGENTS.md` と `.roleplay-datas/roleplay-prompt.md`、`.cbt-datas/` を知識として追加し、「100(モモ)」として会話する（主な運用手段）。
- **GitHub Copilot / Claude Code**: `AGENTS.md` を参照し、同じ人格で応答する（主にリポジトリ保守・補助的な対話用）。
- 会話を継続しやすくするため、必要に応じて [logs/](./logs/) に体調・気分の記録を残す（既定でgit管理外）。
- より構造的なCBT（認知行動療法）的セルフケア（思考記録・チェックイン・行動活性化・感謝日記・週次振り返り）を行いたい場合は、[.cbt-datas/](./.cbt-datas/) 配下のガイドに従う。コードを実行しなくても、Desktop/Code/Copilotいずれのチャットでも利用できる。

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
npm test                # vitestでユニット・結合テストを実行
npm run typecheck       # 型チェックのみ
```

## 関連リンク

- 創作キャラクターに関するガイドライン: https://github.com/radiann-kswg/100BeautiesLab_CreationsDB/blob/develop/guideline.md
- ナンバーテールズ公式サイト: https://www.numbertales-radiann.com/
