# レイヤー3: GCE外部ウォッチドッグ（公式Bot基盤への相乗り）

> 作成日: 2026-07-20
> ステータス: 計画（デプロイ未実施。実施はセンパイの承認を得てからローカルの gcloud CLI で行う）

## 背景・目的

本リポジトリのBot（`aphrnts-100-bot` VM）には、レイヤー1（systemd `Restart=on-failure`）と
レイヤー2（VM内ウォッチドッグ。[deploy/README.md](../deploy/README.md)参照）が実装済みだが、
**VM自体が停止（TERMINATED）・フリーズ（RUNNING だが無応答）した場合**に復旧する手段がない。
ナンバーテールズ公式Bot（[NumberTales-MisskeyAIBot](https://github.com/radiann-kswg/NumberTales-MisskeyAIBot)）で
本番稼働中の3層ウォッチドッグ（2026-07-04マイルストーン）のレイヤー3に相当する部分を、
同じGCPプロジェクト（`numbertales-misskey-surver`）の既存基盤に相乗りする形で導入する。

## 方式

公式リポジトリの `tools/gce-watchdog/`（Cloud Run functions 2nd gen）は監視対象を
**環境変数**（`GCE_ZONE` / `GCE_INSTANCE` / `TARGET_IP` 等）で受け取るため、**コード改修は不要**。
同じソースから2本目の関数を別名でデプロイし、Cloud Schedulerジョブを1つ追加するだけでよい。

| 項目 | 公式Bot（稼働中） | 本Bot（追加分） |
| --- | --- | --- |
| 関数名 | `numbertales-gce-watchdog` | `aphrnts-100-gce-watchdog` |
| リージョン | `us-central1` | `asia-northeast1`（VMと同リージョン推奨） |
| 監視対象 | `misskey-bots-group-numbertales`（`us-central1-a`） | `aphrnts-100-bot`（`asia-northeast1-a`） |
| Schedulerジョブ | `numbertales-vm-watchdog` | `aphrnts-100-vm-watchdog` |
| サービスアカウント | `numbertales-watchdog@numbertales-misskey-surver.iam.gserviceaccount.com` | **同じものを流用**（`roles/compute.instanceAdmin.v1` はプロジェクト単位で付与済み） |

無料枠内で運用可能（5分毎の軽量HTTP起動×2本になっても十分収まる）。

## 事前確認（デプロイ前にやること）

```bash
# 1. automaticRestart（レイヤー3c相当）の確認
gcloud compute instances describe aphrnts-100-bot --zone=asia-northeast1-a \
  --format="value(scheduling.automaticRestart, scheduling.onHostMaintenance)"
# → automaticRestart: true / onHostMaintenance: MIGRATE なら追加対応不要

# 2. 外部IPの確認（TARGET_IP に使う）
gcloud compute instances describe aphrnts-100-bot --zone=asia-northeast1-a \
  --format="value(networkInterfaces[0].accessConfigs[0].natIP)"

# 3. 外部IPが「エフェメラル」か「静的」かの確認
gcloud compute addresses list --filter="region:asia-northeast1"
```

> **重要**: 外部IPがエフェメラルの場合、VMの停止→起動でIPが変わり `TARGET_IP` が古くなって
> ウォッチドッグが誤作動する（永遠にunreachable判定→reset連打はクールダウンで抑止されるが無意味）。
> エフェメラルなら先に静的IPへ昇格させること（使用中のVMに紐づく静的IPは追加課金なし）:
> `gcloud compute addresses create aphrnts-100-bot-ip --addresses=<現IP> --region=asia-northeast1`

## デプロイ手順（公式リポジトリのルートから実行）

```bash
# NumberTales-MisskeyAIBot リポジトリの tools/gce-watchdog をソースにする
gcloud functions deploy aphrnts-100-gce-watchdog --gen2 \
  --runtime=nodejs20 --region=asia-northeast1 \
  --source=tools/gce-watchdog --entry-point=watchdog \
  --trigger-http --no-allow-unauthenticated \
  --run-service-account=numbertales-watchdog@numbertales-misskey-surver.iam.gserviceaccount.com \
  --set-env-vars=GCP_PROJECT=numbertales-misskey-surver,GCE_ZONE=asia-northeast1-a,GCE_INSTANCE=aphrnts-100-bot,TARGET_IP=<上で確認した外部IP>

# Scheduler（OIDC）からの起動を許可
gcloud run services add-iam-policy-binding aphrnts-100-gce-watchdog \
  --region=asia-northeast1 --role=roles/run.invoker \
  --member=serviceAccount:numbertales-watchdog@numbertales-misskey-surver.iam.gserviceaccount.com

# Schedulerジョブ作成（5分毎・Asia/Tokyo）
gcloud scheduler jobs create http aphrnts-100-vm-watchdog \
  --location=asia-northeast1 --schedule="*/5 * * * *" --time-zone=Asia/Tokyo \
  --uri=<デプロイ時に表示される関数URL> --http-method=GET \
  --oidc-service-account-email=numbertales-watchdog@numbertales-misskey-surver.iam.gserviceaccount.com

# 動作確認（healthyなら {"action":"none","reachable":true} が返る）
gcloud scheduler jobs run aphrnts-100-vm-watchdog --location=asia-northeast1
gcloud functions logs read aphrnts-100-gce-watchdog --region=asia-northeast1 --limit=10
```

注意: gcloud のバージョンによりフラグ表記が `--gen2`/`--v2` で揺れる（公式マイルストーンの注記参照）。

## 復帰報告（本リポジトリ側で実装済み）との関係

レイヤー3やGCEの `automaticRestart` でVMごと復旧した場合、VM内watchdog（レイヤー2）の
再起動通知は飛ばない。そのため本リポジトリのBot本体に**復帰報告**を実装した
（[src/utils/recovery-notice.ts](../src/utils/recovery-notice.ts)）:

- 起動時に前回 `heartbeat.json` の最終更新時刻を読み、`RECOVERY_NOTICE_THRESHOLD_MS`
  （既定10分・`.env`で調整可・0で無効）以上空いていたら、ダウン時間の目安を添えて
  オーナーへ一対一チャットで一言報告する。
- レイヤー2のwatchdog再起動（ダウン数十秒）では発火しないため、既存のwatchdog通知と重複しない。
- 切断中に届いたメッセージは従来どおり replay（[deploy/README.md](../deploy/README.md)参照）が回収する。

## 撤去する場合

```bash
gcloud scheduler jobs delete aphrnts-100-vm-watchdog --location=asia-northeast1
gcloud functions delete aphrnts-100-gce-watchdog --region=asia-northeast1 --gen2
```
（サービスアカウントは公式Bot側で使用中のため削除しないこと）
