# 月次振り返り — 対話ガイド

センパイが「今月を振り返りたい」「月次で振り返りたい」と言ったとき、あるいは概ね1か月ごとの節目に、直近30日の記録を踏まえてより長いスパンでの振り返りを提案するためのガイドです。基本的な進め方は[weekly-reflection.md](./weekly-reflection.md)と共通のため、ここでは月次特有の違いのみを記します。

## 週次振り返りとの違い

- **対象期間**: 直近7日ではなく直近**30日**。
- **参照できる過去の記録**: [weekly-reflection.mdの該当節](./weekly-reflection.md#参照できる過去の記録ツールによって異なる)と同じ方法。Misskey Bot側でより長期間のダイジェストが必要な場合、開発者側で`BOT_DIGEST_DAYS`環境変数を変えるか`npm run sync:export -- --days=31`を一時実行できる。Claude Desktopで`logs/*.md`をProject knowledgeにアップロードしている場合は、30日分すべてが揃っているとは限らないため、ある範囲だけで判断してよいかセンパイに一言確認すること。
- **粒度**: 日々の細かな増減より、月単位の大きな流れ（気分の底・山、生活リズムの変化、創作活動の進み具合）に注目する。
- **進め方・注意**: [weekly-reflection.mdの進め方](./weekly-reflection.md#進め方)・[注意](./weekly-reflection.md#注意)をそのまま踏襲する。

## Artifactでのグラフ化

[weekly-reflection.mdのArtifact節](./weekly-reflection.md#artifactでのグラフ化claude-desktop--claudeaiのみ)を参照。月次でも同じ要領で、対象期間が30日になるだけである。
