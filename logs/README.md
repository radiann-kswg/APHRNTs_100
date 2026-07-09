# 生活管理ログの記録フォーマット

このディレクトリには、「100(モモ)」との会話セッションで記録した体調・気分・生活習慣・CBT的な気づきなどを1日単位で保存します。個人の機微な健康情報を含むため、`logs/*.md`（本READMEを除く）は既定で git 管理対象外です（[../.gitignore](../.gitignore)参照）。

## ファイル名

`YYYY-MM-DD.md`（例: `2026-07-09.md`）

このファイル名形式（`YYYY-MM-DD.md`）の記録は、Claude連携ブリッジによってMisskey Bot（`../src/`）へ自動で取り込まれ、Botの応答文脈に利用されます（詳細は[../README.md](../README.md)参照）。

## bot-digest.md（自動生成・編集禁止）

`bot-digest.md` は、Misskey Bot側で保存された記録（日次チェックイン・思考記録・行動活性化・感謝日記）の直近14日分ダイジェストです。連携ブリッジ（Bot起動時・返信時・`npm run sync`）が自動生成・上書きするため、**手動で編集しないでください**。Claude（Desktop / Code）はセッション開始時にこのファイルを読み、Misskey側の記録を会話に反映します。

## 推奨フォーマット

```markdown
# YYYY-MM-DD

## 体調・気分

## 睡眠・生活習慣

## 創作活動の進捗

## 100(モモ)からのひとこと / 次回への引き継ぎ
```

記録する・しない、内容を書き換えるかどうかの判断は、毎回センパイの意思を確認してから行うこと。

## 任意セクション（CBTセルフケア機能を使った場合のみ）

[.cbt-datas/](../.cbt-datas/)配下のガイドに従ってCBTセルフケア機能を使った場合は、上記4見出しに加えて以下を必要に応じて追記してよい。使わない日は書かなくてよい。

```markdown
## 思考記録

## 行動活性化

## 感謝日記
```

- 「思考記録」には[.cbt-datas/thought-record.md](../.cbt-datas/thought-record.md)の7ステップの要点を簡潔にまとめる。
- 「行動活性化」には[.cbt-datas/behavioral-activation.md](../.cbt-datas/behavioral-activation.md)の計画内容と（あれば）実施後の振り返りを記す。
- 「感謝日記」には[.cbt-datas/gratitude.md](../.cbt-datas/gratitude.md)で挙げた3つの良かったことを記す。
