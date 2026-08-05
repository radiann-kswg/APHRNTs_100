#!/bin/bash
# APHRNTs_100 自動デプロイチェックスクリプト。
# root権限のsystemdタイマー（aphrnts-100-deploy.timer）から数分おきに実行される。
# origin/master に新しいコミットがあれば pull → npm ci → build → Bot再起動する。
# git/npm はアプリの実行ユーザー（aphrnts-bot）として行い、ファイル所有権を崩さない。
#
# 共用VM（misskey-bots-unified・Spot）での注意:
#   HEADとorigin/masterの一致だけで「反映済み」と判断すると、`git reset --hard`の後・
#   ビルドの前にプリエンプト（またはTimeoutStartSec）で中断された場合、次回以降ずっと
#   「差分なし」で終了し、古い/壊れた dist/ のまま復帰し続ける。そのため
#   「ビルドと再起動まで完了したSHA」をマーカーファイルに記録し、判定はそちらでも行う。
set -euo pipefail

# 既定値は本番VMの構成。検証時のみ環境変数で差し替える（本番では未設定のまま使う）。
APP_DIR=${APP_DIR:-/opt/aphrnts-100}
APP_USER=${APP_USER:-aphrnts-bot}
SERVICE_NAME=${SERVICE_NAME:-aphrnts-100-bot}
# ビルド＋再起動まで完了したSHAの記録先。.cache/ はgit管理外なので `git reset --hard` では消えない。
DEPLOYED_REV_PATH=${DEPLOYED_REV_PATH:-$APP_DIR/.cache/deployed-rev}
LOG_PREFIX="[auto-deploy]"

cd "$APP_DIR"

sudo -u "$APP_USER" git fetch origin master
LOCAL_REV=$(sudo -u "$APP_USER" git rev-parse HEAD)
REMOTE_REV=$(sudo -u "$APP_USER" git rev-parse origin/master)
DEPLOYED_REV=$(cat "$DEPLOYED_REV_PATH" 2>/dev/null || true)

if [ "$LOCAL_REV" = "$REMOTE_REV" ] && [ "$DEPLOYED_REV" = "$REMOTE_REV" ]; then
  exit 0
fi

if [ "$LOCAL_REV" = "$REMOTE_REV" ]; then
  # 作業ツリーは最新だが、ビルド・再起動まで到達した記録がない（前回の実行が中断された）。
  echo "$LOG_PREFIX resuming interrupted deploy at $REMOTE_REV (last built: ${DEPLOYED_REV:-none})"
else
  echo "$LOG_PREFIX updating $LOCAL_REV -> $REMOTE_REV"
fi

# 中断時に次回もやり直せるよう、完了記録は作業を始める前に消しておく。
rm -f "$DEPLOYED_REV_PATH"

sudo -u "$APP_USER" git reset --hard origin/master
sudo -u "$APP_USER" npm ci
sudo -u "$APP_USER" npm run build

systemctl restart "$SERVICE_NAME"
# 所有者を崩さないよう、完了記録の書き込みもアプリの実行ユーザーで行う。
printf '%s\n' "$REMOTE_REV" | sudo -u "$APP_USER" tee "$DEPLOYED_REV_PATH" >/dev/null
echo "$LOG_PREFIX deployed $REMOTE_REV and restarted $SERVICE_NAME"
