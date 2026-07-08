# APHRNTs_100

「ナンバーテールズ」に登場する妖獣型ポータブルヒューマノイド「100(モモ)」としてのロールプレイを通じ、日々の生活管理・認知行動療法（CBT）的なセルフケアを行うための個人用リポジトリです。

## 使い方

- **Claude Desktop**: 「プロジェクト」機能に `AGENTS.md` と `.roleplay-datas/roleplay-prompt.md` を知識として追加し、「100(モモ)」として会話する（主な運用手段）。
- **GitHub Copilot / Claude Code**: `AGENTS.md` を参照し、同じ人格で応答する（主にリポジトリ保守・補助的な対話用）。
- 会話を継続しやすくするため、必要に応じて [logs/](./logs/) に体調・気分の記録を残す（既定でgit管理外）。

## 構成

- [`AGENTS.md`](./AGENTS.md) — 全エージェント共通の設定（SSOT）
- [`CLAUDE.md`](./CLAUDE.md) / [`.github/copilot-instructions.md`](./.github/copilot-instructions.md) — 各ツール向けの薄い設定書
- [`.roleplay-datas/roleplay-prompt.md`](./.roleplay-datas/roleplay-prompt.md) — 「100(モモ)」のロールプレイ正本
- [`logs/`](./logs/) — 生活管理・CBTセッションの記録（任意、git管理外）

## 関連リンク

- 創作キャラクターに関するガイドライン: https://github.com/radiann-kswg/100BeautiesLab_CreationsDB/blob/develop/guideline.md
- ナンバーテールズ公式サイト: https://www.numbertales-radiann.com/
