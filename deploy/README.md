# deploy/ — GCE VM上の本番運用設定

本リポジトリのMisskey Bot（`src/`）を、Google Compute Engineの本番VM（`aphrnts-100-bot` / プロジェクト`numbertales-misskey-surver` / `asia-northeast1-a`）上で常駐運用するための設定一式です。VMを再構築する場合や、設定内容を確認したい場合の正典として、実際にVMへ配置している内容をここに記録しています。

VM自体は `/opt/aphrnts-100` に本リポジトリ（`master`ブランチ）をクローンし、専用の非rootユーザー`aphrnts-bot`で稼働しています。`.env`は`.gitignore`対象のため、VM側で別途配置してください。

## ファイル一覧

| ファイル | 配置先（VM上） | 役割 |
| --- | --- | --- |
| `aphrnts-100-bot.service` | `/etc/systemd/system/aphrnts-100-bot.service` | Bot本体（`node dist/index.js`）を常駐・自動再起動させるsystemdサービス |
| `aphrnts-100-deploy.sh` | `/opt/aphrnts-100/deploy/aphrnts-100-deploy.sh`（リポジトリの一部としてそのまま配置） | `origin/master`に新しいコミットがあれば pull → `npm ci` → `npm run build` → Bot再起動する自動デプロイチェックスクリプト |
| `aphrnts-100-deploy.service` | `/etc/systemd/system/aphrnts-100-deploy.service` | 上記スクリプトを1回実行するsystemdサービス（oneshot） |
| `aphrnts-100-deploy.timer` | `/etc/systemd/system/aphrnts-100-deploy.timer` | `aphrnts-100-deploy.service`を5分おきに起動するタイマー |

## 自動デプロイの仕組み

`master`へのマージ後、最大5分以内にVM側のタイマーが検知し、自動でpull・ビルド・Bot再起動まで行います（VM側からGitHubへ定期的に取りに行く「pull型」。GitHub Actions等の外部からVMへの新しい受信経路・SSH秘密鍵の保存は不要です）。

- git・npmの操作はBotの実行ユーザーである`aphrnts-bot`として行い、ファイル所有権を崩しません。
- 差分がない場合は何もせず終了します（毎回ビルドし直すことはありません）。
- 動作確認: `sudo journalctl -u aphrnts-100-deploy --no-pager -n 20`

## 初回セットアップ（VM再構築時の参考手順）

1. `aphrnts-100-bot.service` を `/etc/systemd/system/` へ配置し、`systemctl daemon-reload && systemctl enable --now aphrnts-100-bot`
2. `aphrnts-100-deploy.service` / `aphrnts-100-deploy.timer` を `/etc/systemd/system/` へ配置し、`systemctl daemon-reload && systemctl enable --now aphrnts-100-deploy.timer`
3. `aphrnts-bot`ユーザーが`systemctl restart aphrnts-100-bot`を実行できるよう、このタイマー・サービスは**root権限**で実行されるように構成すること（`User=`を指定しない＝root実行。`aphrnts-100-deploy.sh`内で`sudo -u aphrnts-bot`によりgit/npm操作のみ非root権限に降格する）。

以降、`aphrnts-100-deploy.sh`自体は`/opt/aphrnts-100`配下（gitで管理される側）に置かれているため、このスクリプトの中身を更新した場合も次回のpullで自動的に反映されます。ただし`*.service` / `*.timer`ユニットファイルの変更は`/etc/systemd/system/`への再配置と`systemctl daemon-reload`が別途必要です（自動化の対象外）。

## ローカルPC側の定期取得（Windowsタスクスケジューラ）

本番Botの記録（`logs/bot-digest.md`）はVMのローカルディスクにのみ存在し、GitHub経由では戻ってこない（[README.mdの「本番VM運用時の注意」](../README.md#本番vm運用時の注意npm-run-syncpull-remote)参照）。Claude Desktop/Codeが常に最新のダイジェストを読めるようにするため、ローカルPC側で`npm run sync:pull-remote`を定期実行する運用を推奨する。

Windowsの場合の設定例（PowerShell、管理者権限不要）:

```powershell
$repo = "C:\Visual Studio Code UserFile\APHRNTs_100"
$action = New-ScheduledTaskAction -Execute "$repo\scripts\pull-bot-digest-task.cmd"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration ([TimeSpan]::MaxValue)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName "APHRNTs100-PullBotDigest" -Action $action -Trigger $trigger `
  -Settings $settings -Description "本番VMのlogs/bot-digest.mdをgcloud経由でローカルへ定期取得する"
```

- 実行内容は[`scripts/pull-bot-digest-task.cmd`](../scripts/pull-bot-digest-task.cmd)（リポジトリ直下へ`cd`して`npm run sync:pull-remote`を呼ぶだけの薄いラッパー）。
- 出力は`logs/pull-digest.log`に追記される（`logs/`はgit管理外）。
- 前提条件（gcloud CLIの認証・VMへのSSH+sudo権限）は[README.mdの該当箇所](../README.md#本番vm運用時の注意npm-run-syncpull-remote)を参照。
- タスクの確認・削除: `Get-ScheduledTask -TaskName "APHRNTs100-PullBotDigest"` / `Unregister-ScheduledTask -TaskName "APHRNTs100-PullBotDigest" -Confirm:$false`。
- 頻度（既定30分）はセンパイの運用に合わせて`-RepetitionInterval`を変更してよい。本番VM側のデプロイタイマー同様、間隔を短くしすぎると`gcloud compute ssh`のIAPトンネル確立が積み重なるため、5分未満は推奨しない。
