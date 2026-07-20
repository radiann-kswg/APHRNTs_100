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
| `aphrnts-100-watchdog.sh` | `/opt/aphrnts-100/deploy/aphrnts-100-watchdog.sh`（リポジトリの一部としてそのまま配置） | Botが無応答（クラッシュを伴わないハング）になっていないかを確認し、必要なら自動復帰させるウォッチドッグスクリプト |
| `aphrnts-100-watchdog.service` | `/etc/systemd/system/aphrnts-100-watchdog.service` | 上記スクリプトを1回実行するsystemdサービス（oneshot） |
| `aphrnts-100-watchdog.timer` | `/etc/systemd/system/aphrnts-100-watchdog.timer` | `aphrnts-100-watchdog.service`を3分おきに起動するタイマー |

## 自動デプロイの仕組み

`master`へのマージ後、最大5分以内にVM側のタイマーが検知し、自動でpull・ビルド・Bot再起動まで行います（VM側からGitHubへ定期的に取りに行く「pull型」。GitHub Actions等の外部からVMへの新しい受信経路・SSH秘密鍵の保存は不要です）。

- git・npmの操作はBotの実行ユーザーである`aphrnts-bot`として行い、ファイル所有権を崩しません。
- 差分がない場合は何もせず終了します（毎回ビルドし直すことはありません）。
- 動作確認: `sudo journalctl -u aphrnts-100-deploy --no-pager -n 20`

## 応答停止時の自動復帰（ウォッチドッグ）

`Restart=on-failure`はプロセスがクラッシュ（異常終了）した場合にしか働かない。プロセス自体は生きているのに、WebSocket接続が切れたまま戻らない・イベントループがハングして無応答になる、といった「クラッシュを伴わない障害」には対応できない。これを補うのが`aphrnts-100-watchdog.sh`。

- Bot本体（`src/index.ts`）が30秒おきに書き出す`/opt/aphrnts-100/.cache/heartbeat.json`（`wsConnected` / `lastConnectedAt` / `lastDisconnectedAt` / `reconnectCount` / `disconnectsLastHour`）を3分おきに確認する。
- 次のいずれかに該当すれば`systemctl restart aphrnts-100-bot`で自動復帰させる。
  - heartbeat.jsonの更新が3分以上止まっている（プロセスが完全にハングしている可能性）
  - WS切断状態（`wsConnected: false`）が5分以上続いている（後述のアプリ側keepalive・自動再接続でも復帰できていない可能性）
  - 直近1時間のWS切断回数（`disconnectsLastHour`）が8回以上ある（**churn検知**。「切れてはすぐ繋ぎ直す」を繰り返す状態は上記2条件をすり抜けるため、ストリームを張り直して立て直す。再起動後はカウントが0に戻るので連続再起動にはならない）
  - `aphrnts-100-bot.service`自体が`StartLimitBurst`（後述）に達して`failed`状態のまま止まっている
- 復帰させた際、`.env`に`MISSKEY_HOST` / `MISSKEY_TOKEN` / `BOT_OWNER_USER_ID`が揃っていれば、オーナー宛にMisskeyチャットで一言（自動再起動した旨と理由）を通知する。通知に失敗しても復帰処理自体は継続する。

なお、切断中に届いてしまったメンション・一対一チャットは、Bot本体側の**取りこぼし回収（replay）**が再接続時にREST API（`notes/mentions` / `chat/messages/user-timeline`）で遡って処理する（`src/bot/replay.ts`）。watchdogや自動デプロイによる再起動の間に届いたメッセージも、再起動後の初回接続時に同じ仕組みで回収される。加えてこのreplayは`.env`の`REPLAY_INTERVAL_MS`（既定60秒）ごとに接続の有無に依らず定期実行される。keepaliveで接続が安定して再接続が起きなくなっても取りこぼしを拾い直せ、ライブ受信（特に一対一チャット）が未達でもこの間隔内で応答できる（再接続起点の回収と重なっても`src/bot/replay.ts`側で二重処理を抑止する）。

`aphrnts-100-bot.service`には`StartLimitIntervalSec=600` / `StartLimitBurst=5`を設定してある（10分間に5回まで再起動を試み、それでも直らなければ諶めて`failed`状態で止まる、というsystemdの既定の暴走防止機構）。何もなければこのタイマーがウォッチドッグとして`failed`状態を検知し、`reset-failed`してから再度復帰を試みる。

### VM自体の停止・フリーズへの備え（レイヤー3）と復帰報告

上記ウォッチドッグはVM内で動くため、**VM自体**が停止・フリーズした場合は救えない。この層（GCE外部ウォッチドッグ）の導入計画・手順は [docs/gce-watchdog-layer3.md](../docs/gce-watchdog-layer3.md) を参照。また、VMごと復旧した場合はウォッチドッグの再起動通知が飛ばないため、Bot本体が起動時に長時間ダウン（`RECOVERY_NOTICE_THRESHOLD_MS`・既定10分以上）を検知するとオーナーへ復帰報告のチャットを送る（`src/utils/recovery-notice.ts`）。

## Misskeyストリームの接続維持（keepalive・自動再接続）

Bot本体（[`src/misskey/client.ts`](../src/misskey/client.ts)）は、Misskeyのストリーミング（WebSocket）接続を次の2段構えで維持する。

以前はアイドル時（メンション等が来ない間）にサーバ/ロードバランサのWebSocketアイドルタイムアウトで数分おきに切断され、`misskey-js`内蔵の即時再接続（`reconnecting-websocket`・`minReconnectionDelay`=1ms、かつ`minUptime`=5sにより5秒以上続いた接続が切れるとバックオフ試行回数が0に戻る）と噛み合って「切断→即再接続」を高速に繰り返す**フラッピング**が起きていた。切断中に届いたメンション/一対一チャットを取りこぼし、Botが無応答に見える原因になっていた。

- **keepalive（定期ping）**: 接続中は既定30秒ごと（`.env`の`MISSKEY_PING_INTERVAL_MS`）にアプリレベルのpingを送り、ソケットを非アイドルに保つ。これでアイドルタイムアウトによる切断自体を減らす（＝根本原因の抑止）。サーバ/LBのアイドルタイムアウトより十分短い値にすること。
- **自前の再接続（指数バックオフ＋上限＋ジッタ）**: それでも切断された場合は、`misskey-js`内蔵の1ms即再接続を`close()`で止めたうえで、指数バックオフ（既定: 基準1秒 →毎回2倍 →上限30秒、±20%のジッタ）で新しいストリームを張り直す。再接続のたびに必要なチャンネル購読（`main`）も張り直す。接続が既定60秒以上継続したら「安定」とみなしてバックオフ試行回数を0に戻すため、単発の切断は素早く、連続する切断ほど間隔が開く。
- **可観測性（ログ間引き・フラップ検知）**: 切断/再接続ログはスパムにならないよう間引く。最初の切断は`warn`、短時間切断が既定3回連続したら「フラッピングを検知」を`warn`で1回だけ出し（以降は閾値の倍数ごと）、その間は`debug`へ落とす。フラッピングが収まって安定したら「N回のフラッピング後に接続が安定した」を`info`で記録する。`wsConnected`の状態は従来どおり`heartbeat.json`へ書き出され、上記ウォッチドッグが最終セーフティネットになる。

既定値は[`src/config/constants.ts`](../src/config/constants.ts)（`DEFAULT_MISSKEY_PING_INTERVAL_MS` / `MISSKEY_RECONNECT_*` / `MISSKEY_STABILITY_MS` / `MISSKEY_FLAP_ALERT_THRESHOLD`）に、方針の純粋実装は[`src/misskey/reconnect-policy.ts`](../src/misskey/reconnect-policy.ts)にまとめてある。運用でのチューニング頻度が高い`MISSKEY_PING_INTERVAL_MS`のみ`.env`で調整可能にし、他は定数に置いている。

## 初回セットアップ（VM再構築時の参考手順）

1. `aphrnts-100-bot.service` を `/etc/systemd/system/` へ配置し、`systemctl daemon-reload && systemctl enable --now aphrnts-100-bot`
2. `aphrnts-100-deploy.service` / `aphrnts-100-deploy.timer` を `/etc/systemd/system/` へ配置し、`systemctl daemon-reload && systemctl enable --now aphrnts-100-deploy.timer`
3. `aphrnts-100-watchdog.service` / `aphrnts-100-watchdog.timer` を `/etc/systemd/system/` へ配置し、`systemctl daemon-reload && systemctl enable --now aphrnts-100-watchdog.timer`
4. `aphrnts-bot`ユーザーが`systemctl restart aphrnts-100-bot`を実行できるよう、これらのタイマー・サービスは**root権限**で実行されるように構成すること（`User=`を指定しない＝root実行。`aphrnts-100-deploy.sh`内で`sudo -u aphrnts-bot`によりgit/npm操作のみ非root権限に降格する）。

以降、`aphrnts-100-deploy.sh` / `aphrnts-100-watchdog.sh`自体は`/opt/aphrnts-100`配下（gitで管理される側）に置かれているため、これらのスクリプトの中身を更新した場合も次回のpullで自動的に反映されます。ただし`*.service` / `*.timer`ユニットファイルの変更は`/etc/systemd/system/`への再配置と`systemctl daemon-reload`が別途必要です（自動化の対象外）。

- 動作確認: `sudo journalctl -u aphrnts-100-watchdog --no-pager -n 20`

## ローカルPC側の定期同期（Windowsタスクスケジューラ）

本番Botの記録（`logs/bot-digest.md`）はVMのローカルディスクにのみ存在し、GitHub経由では戻ってこない。逆にローカルの`logs/YYYY-MM-DD.md`（Claudeのセッション記録）もVMへは自動で届かない（[README.mdの「本番VM運用時の注意」](../README.md#本番vm運用時の注意npm-run-syncremote)参照）。Claude Desktop/Codeが常に最新のダイジェストを読め、かつ本番Botがセンパイのセッション記録を文脈に載せられるようにするため、ローカルPC側で`npm run sync:remote`（相互同期）を定期実行する運用を推奨する。

Windowsの場合の設定例（PowerShell、管理者権限不要）:

```powershell
$repo = "C:\Visual Studio Code UserFile\APHRNTs_100"
$action = New-ScheduledTaskAction -Execute "wscript.exe" `
  -Argument "`"$repo\scripts\run-hidden.vbs`" `"$repo\scripts\sync-remote-task.cmd`""
$trigger = New-ScheduledTaskTrigger -Daily -At 3:00am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName "APHRNTs100-PullBotDigest" -Action $action -Trigger $trigger `
  -Settings $settings -Description "本番VMとlogs/を相互同期する（ローカル→VMの取り込み・VM→ローカルのダイジェスト取得）" -Force
```

- スケジュールは**毎日03:00 JST**（1日1回）。以前は「起動時＋30分ごと」の高頻度運用だったが、相互同期（`sync:remote`）は取得のみの頃よりgcloud呼び出しが増える（ssh/scp計5回程度）ため、1日1回に見直した。`-StartWhenAvailable`を付けているので、03:00にPCが起動していなくても次回起動時に取りこぼし分を実行する。
- 同名タスクを上書きするため`-Force`を付ける。付けないと既存タスクがある場合に登録が失敗する。

- 実行内容は[`scripts/sync-remote-task.cmd`](../scripts/sync-remote-task.cmd)（リポジトリ直下へ`cd`して`npm run sync:remote`を呼ぶだけの薄いラッパー）を、[`scripts/run-hidden.vbs`](../scripts/run-hidden.vbs)経由で起動する。タスクスケジューラが`.cmd`を直接実行するとトリガーのたびにコマンドプロンプトの窓が表示されてしまうため、`wscript.exe`でウィンドウ非表示（`WScript.Shell.Run`のwindowstyle=0）にラップしている。
- 出力は`logs/sync-remote.log`に追記される（`logs/`はgit管理外）。
- タスク名`APHRNTs100-PullBotDigest`は、取得のみ（`sync:pull-remote`）だった頃からの歴史的な名前をそのまま使っている。改名すると旧名のタスクが残って二重に走るため、意図して据え置いている。
- **既に旧`pull-bot-digest-task.cmd`でタスクを登録している場合は、上記のコマンドで登録し直すこと**（`Register-ScheduledTask`に`-Force`を付けると同名タスクを上書きできる）。旧ラッパーは削除済みのため、差し替えないとトリガーのたびに失敗して定期同期が黙って止まる。
- 前提条件（gcloud CLIの認証・VMへのSSH+sudo権限）は[README.mdの該当箇所](../README.md#本番vm運用時の注意npm-run-syncremote)を参照。
- タスクの確認・削除: `Get-ScheduledTask -TaskName "APHRNTs100-PullBotDigest"` / `Unregister-ScheduledTask -TaskName "APHRNTs100-PullBotDigest" -Confirm:$false`。
- 頻度（既定は毎日03:00 JST）はセンパイの運用に合わせて`-Daily -At`の時刻を変えてよい。より高頻度にしたい場合は`-Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Days 3650)`のような繰り返しトリガーへ戻すこともできる（`-RepetitionDuration`に`[TimeSpan]::MaxValue`を渡すと`P99999999DT23H59M59S`に展開されて範囲外エラーになるため、実質無期限として`-Days 3650`を指定する）。ただし相互同期は1回あたりのgcloud呼び出しが取得のみの頃より増える（ssh/scp計5回程度）ため、本番VM側のデプロイタイマー同様、間隔を短くしすぎると`gcloud compute ssh`のIAPトンネル確立が積み重なる。5分未満は避けること。

## 相互同期（`npm run sync:remote`）の本番VM適用ランブック

ローカル→VM方向（`sync:push-remote`）を本番で初めて使うときの手順。**VM側の構成変更・ユニットファイルの再配置は不要**（`sync:push-remote`がVM上で実行するのは既存の`npm run sync:import`のみで、systemdの構成にもBot本体の挙動にも変更を加えない）。

### 0. 事前確認（ローカル）

```powershell
npm run typecheck
npm test
gcloud auth list          # 本番VMのプロジェクトへアクセスできるアカウントが ACTIVE か
```

- `.env`の`REMOTE_BOT_USER`は未設定でよい（既定`aphrnts-bot`）。VMを再構築して実行ユーザーを変えた場合のみ設定する。
- **この操作はセンパイの健康記録（`logs/YYYY-MM-DD.md`）をVMへ送信する**。実行はセンパイの同意のもとで行うこと（[AGENTS.mdの禁止事項](../AGENTS.md#禁止事項)）。VM上のBotが記録を注入する相手は`BOT_OWNER_USER_ID`で限定されるため、複数ユーザー運用時はこの設定が入っていることを先に確認する。

### 1. コードを本番へ反映（PR経由）

`develop`から`master`へPRを作成し、センパイの承認を得てマージする。マージ後、最大5分で自動デプロイタイマーがVMへ反映する。

```bash
gcloud compute ssh aphrnts-100-bot --zone=asia-northeast1-a --project=numbertales-misskey-surver \
  --tunnel-through-iap --command="sudo journalctl -u aphrnts-100-deploy --no-pager -n 20"
```

- ここでVMに入る新しいコードは`src/bridge/`の追加分と`package.json`のスクリプト追加のみで、Bot本体の挙動は変わらない。
- 厳密には、push側が使う`npm run sync:import`は既存masterにもあるため、**この反映を待たずに手順2は実行できる**。ただし記録の追跡性のため、通常はPRマージ後に実施する。

### 2. 少量で試す（ローカルから実行）

```powershell
npm run sync:push-remote -- --days=1     # まず当日分だけ転送・取り込み
```

正常時の出力例（VM上での実行結果は`[VM]`付きで表示される）:

```
[sync] ローカル→VM: 2026-07-17以降の1件を /opt/aphrnts-100/logs へ転送した（2026-07-17.md）。
  [VM] [sync] Claude→Bot: logs/ から 1件のセッション記録を取り込んだ（スキップ 2件）。
```

- `--days=1`の対象は**当日（JST）のログ1件のみ**。その日の`logs/YYYY-MM-DD.md`をまだ書いていない場合は「転送をスキップした」と表示されて**VMに一切接続せず終わる**（試行にならない）。前日分で試すなら`--days=2`を使うこと。

### 3. VM側の状態を確認

```bash
gcloud compute ssh aphrnts-100-bot --zone=asia-northeast1-a --project=numbertales-misskey-surver \
  --tunnel-through-iap --command="sudo ls -l /opt/aphrnts-100/logs/ && ls -a ~/.aphrnts-100-push"
```

- 日次ログが`-rw------- aphrnts-bot aphrnts-bot`で置かれていること（所有者・パーミッションが崩れていない）。
- 中継ディレクトリ`~/.aphrnts-100-push`に`.md`が残っていないこと（転送のたびにtrapで消える）。
- VMの`.env`で`CLAUDE_SYNC_ENABLED=false`にしていないこと（既定`true`。`false`だと取り込み済みの記録がプロンプトへ注入されない）。
- 応答文脈への反映は、Misskeyの一対一チャットでBotにその日の記録に触れる話題を振って確認するのが確実。**Botの再起動は不要**（注入する記録は返信のたびにSQLiteから読み直され、各メッセージ処理前に`logs/`の再取り込みも走る）。

### 4. 通常運用へ

```powershell
npm run sync:remote        # 相互同期（push → VM側でダイジェスト再生成 → pull）
```

既にタスクスケジューラで定期取得を登録している場合は、[前節](#ローカルpc側の定期同期windowsタスクスケジューラ)の手順でタスクを登録し直すこと。旧`pull-bot-digest-task.cmd`は削除済みのため、`-Argument`を`scripts\sync-remote-task.cmd`へ差し替えないと定期同期が失敗し続ける。

### 5. ロールバック

| 戻したいもの | 手順 |
| --- | --- |
| 定期実行 | `Unregister-ScheduledTask -TaskName "APHRNTs100-PullBotDigest" -Confirm:$false`で止め、必要なときだけ手動で`npm run sync:pull-remote`（取得のみ）を実行する。取得のみの定期実行に戻したい場合は、本PRをrevertすれば旧`pull-bot-digest-task.cmd`も復活する |
| コード | `master`へrevert PRを出してマージする（最大5分で自動デプロイが元に戻す）。ローカルからpushしなければVM上のBotの挙動は変わらないため、緊急性は低い |
| VMへ転送した記録 | `sudo rm -f /opt/aphrnts-100/logs/YYYY-MM-DD.md` でファイルを削除する。取り込み済みの行はVMのSQLite（`claude_session_notes`）に残るが、プロンプトへ注入されるのは直近7日分のみなので、以後pushしなければ1週間で参照範囲から外れる。即時に消す場合は`sudo -u aphrnts-bot`でDBから当該日付の行を削除する |

### つまずきやすい点

- `sudo: a password is required` … ログインユーザーにVM上のパスワードなしsudo権限がない。`sync:pull-remote`（`sudo cat`）が通るなら同じ条件を満たしている。
- `npm ERR! missing script: sync:import` … VMのコードが古い（`master`未反映）。手順1を先に済ませる。
- `tsx: not found` … VM側で`npm ci`が開発依存を入れていない。`sudo -u aphrnts-bot bash -c 'cd /opt/aphrnts-100 && npm ci'`で入れ直すか、暫定的に`node dist/bridge/cli.js import`で代替する（`dist/`はデプロイ時にビルド済み）。
- `gcloud CLIが見つからない` … ローカルの問題。`GCLOUD_PATH`に`gcloud.cmd`の場所を指定する。
