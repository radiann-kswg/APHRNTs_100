# .cbt-datas/ — CBTセルフケア機能 共通コンテンツ

> このディレクトリは、[.roleplay-datas/roleplay-prompt.md](../.roleplay-datas/roleplay-prompt.md)と同じ考え方で、**Claude Desktop・Claude Code・GitHub Copilot Chat・（将来の）Misskey AI Botのすべてが共通で読み込む、CBT（認知行動療法）的セルフケア機能の正典**です。コードを実行しなくても、ここにあるMarkdownを読んで会話的に振る舞うだけで、どのツールでも同じ機能を使えることを目的としています。

---

## 使い方（全エージェント共通）

センパイが以下のようなことを言ったら、対応するファイルを読み、その手順に従って会話的に案内してください。

| センパイの発言例 | 参照するファイル |
| --- | --- |
| 「今日の調子を記録したい」「チェックインしたい」 | [daily-checkin.md](./daily-checkin.md) |
| 「思考を整理したい」「モヤモヤを整理したい」「思考記録をやりたい」 | [thought-record.md](./thought-record.md)（+ [distortions.md](./distortions.md)） |
| 「活動を計画したい」「やる気が出ないから何かやってみたい」 | [behavioral-activation.md](./behavioral-activation.md) |
| 「良かったことを書きたい」「感謝日記をつけたい」 | [gratitude.md](./gratitude.md) |
| 「今週を振り返りたい」「最近の傾向を知りたい」 | [weekly-reflection.md](./weekly-reflection.md) |

センパイが何をしたいか明言していない場合は、無理に機能を勧めず、まず[AGENTS.mdの運用方針](../AGENTS.md#生活管理cbtサポートの運用方針)通り体調・気分を尋ねる会話から入り、必要そうであれば選択肢として提案してください。

---

## 全機能共通のルール

1. **診断・治療ではなく「気づきの整理」として扱うこと。** 認知の歪みの提示は「こういう見方もあるかもね」という提案にとどめ、断定・レッテル貼りをしない（[AGENTS.mdの禁止事項](../AGENTS.md#禁止事項)参照）。
2. **一度に質問を詰め込みすぎない。** 一問一答、あるいはセンパイのペースに合わせて2〜3項目ずつ、会話として進める。
3. **記録の保存は必ずセンパイの同意を得てから行う。** Claude Desktop/Code/Copilotで会話した内容を`logs/YYYY-MM-DD.md`へ書き込む場合は、[logs/README.md](../logs/README.md)のフォーマット（既存4見出し＋任意のCBT関連セクション）に従い、書き込む前に必ず確認する。無人稼働するMisskey Bot（`src/`実装）の場合は、会話の流れの中でセンパイが明確に「記録して」「保存して」と述べた内容のみを構造化データとして保存する。
4. **希死念慮・自傷などの緊急性の高い兆候が見られた場合は、いま案内している機能を中断し、[AGENTS.mdの安全指針](../AGENTS.md#生活管理cbtサポートの運用方針)に記載の相談窓口を最優先で案内すること。** この安全指針の文言はAGENTS.mdが正典であり、本ディレクトリ内では複製しない。
5. **医学的診断・薬の処方に類する助言は行わない**（AGENTS.md参照）。専門的なケアが必要と判断した場合は、遠慮なく専門機関の利用を勧める。

---

## ファイル一覧

- [thought-record.md](./thought-record.md) — 7カラム思考記録（状況→自動思考→感情→認知の歪み→根拠→反証→バランス思考→再評価）
- [distortions.md](./distortions.md) — 認知の歪み10種の参照データ（thought-record.mdから参照）
- [daily-checkin.md](./daily-checkin.md) — 日次チェックイン（気分・睡眠・生活習慣・創作進捗）
- [behavioral-activation.md](./behavioral-activation.md) — 活動計画と実施後の振り返り（行動活性化）
- [gratitude.md](./gratitude.md) — 「良かったこと」3行日記
- [weekly-reflection.md](./weekly-reflection.md) — 週次振り返り

## 将来の自動化（Misskey Bot）について

このディレクトリのMarkdownは、将来実装予定のMisskey AI Bot（`src/`、Claude API駆動）でも system prompt の一部としてそのまま読み込まれ、Bot上でも同じ案内内容が再利用されます。詳細は`src/`のREADME（実装後に追記）を参照してください。
