#!/bin/bash
# APHRNTs_100 自動デプロイチェックスクリプト。
# root権限のsystemdタイマー（aphrnts-100-deploy.timer）から数分おきに実行される。
# origin/master に新しいコミットがあれば pull → npm ci → build → Bot再起動する。
# git/npm はアプリの実行ユーザー（aphrnts-bot）として行い、ファイル所有権を崩さない。
set -euo pipefail

APP_DIR=/opt/aphrnts-100
APP_USER=aphrnts-bot
SERVICE_NAME=aphrnts-100-bot
LOG_PREFIX="[auto-deploy]"

cd "$APP_DIR"

sudo -u "$APP_USER" git fetch origin master
LOCAL_REV=$(sudo -u "$APP_USER" git rev-parse HEAD)
REMOTE_REV=$(sudo -u "$APP_USER" git rev-parse origin/master)

if [ "$LOCAL_REV" = "$REMOTE_REV" ]; then
  exit 0
fi

echo "$LOG_PREFIX updating $LOCAL_REV -> $REMOTE_REV"
sudo -u "$APP_USER" git reset --hard origin/master
sudo -u "$APP_USER" npm ci
sudo -u "$APP_USER" npm run build

systemctl restart "$SERVICE_NAME"
echo "$LOG_PREFIX deployed $REMOTE_REV and restarted $SERVICE_NAME"
