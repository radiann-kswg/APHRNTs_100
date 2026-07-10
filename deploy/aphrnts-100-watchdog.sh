#!/bin/bash
# APHRNTs_100 ウォッチドッグ。
# root権限のsystemdタイマー（aphrnts-100-watchdog.timer）から数分おきに実行される。
# `Restart=on-failure`はプロセスがクラッシュした場合にしか働かないため、
# 「プロセスは生きているがWS接続が切れたまま/heartbeatが更新されない」という
# クラッシュを伴わないハングを検知して再起動で救うのが役割。
# また、aphrnts-100-bot.serviceがStartLimitBurstに達してfailed状態のまま
# 止まってしまった場合も、ここでreset-failed→restartして復帰させる。
set -euo pipefail

APP_DIR=/opt/aphrnts-100
SERVICE_NAME=aphrnts-100-bot
HEARTBEAT_PATH="$APP_DIR/.cache/heartbeat.json"
ENV_FILE="$APP_DIR/.env"
# heartbeatは既定30秒間隔で書かれる想定。3分（6回分）更新がなければ異常とみなす。
STALE_THRESHOLD_SEC=180
# WS切断状態が5分続いたら異常とみなす（reconnecting-websocketの自動再接続を待つ猶予）。
DISCONNECTED_THRESHOLD_SEC=300
LOG_PREFIX="[watchdog]"

is_unit_failed() {
  [ "$(systemctl is-failed "$SERVICE_NAME" 2>/dev/null || true)" = "failed" ]
}

restart_service() {
  local reason="$1"
  echo "$LOG_PREFIX unhealthy ($reason), restarting $SERVICE_NAME"
  systemctl reset-failed "$SERVICE_NAME" 2>/dev/null || true
  systemctl restart "$SERVICE_NAME"
  notify_owner "$reason"
  echo "$LOG_PREFIX restarted $SERVICE_NAME"
}

# 可能ならMisskeyオーナーへ自動再起動を通知する（.envに必要な値が揃っている場合のみ・失敗しても無視する）
notify_owner() {
  local reason="$1"
  [ -f "$ENV_FILE" ] || return 0

  local misskey_host misskey_token owner_id
  misskey_host=$(grep -oP '(?<=^MISSKEY_HOST=).*' "$ENV_FILE" || true)
  misskey_token=$(grep -oP '(?<=^MISSKEY_TOKEN=).*' "$ENV_FILE" || true)
  owner_id=$(grep -oP '(?<=^BOT_OWNER_USER_ID=).*' "$ENV_FILE" || true)
  [ -n "$misskey_host" ] && [ -n "$misskey_token" ] && [ -n "$owner_id" ] || return 0

  local text="センパイ、応答が止まっていたみたいだから自動で再起動しておいた（理由: ${reason}）。念のため様子を見てくれ。"
  curl -sS -m 10 -X POST "${misskey_host}/api/chat/messages/create-to-user" \
    -H "Content-Type: application/json" \
    -d "$(printf '{"i":"%s","toUserId":"%s","text":"%s"}' "$misskey_token" "$owner_id" "$text")" \
    >/dev/null 2>&1 || echo "$LOG_PREFIX notify failed (ignored)"
}

if is_unit_failed; then
  restart_service "service in failed state"
  exit 0
fi

if [ ! -f "$HEARTBEAT_PATH" ]; then
  echo "$LOG_PREFIX heartbeat.json not found, skip"
  exit 0
fi

now_epoch=$(date +%s)
heartbeat_age=$(( now_epoch - $(date -r "$HEARTBEAT_PATH" +%s) ))

if [ "$heartbeat_age" -gt "$STALE_THRESHOLD_SEC" ]; then
  restart_service "heartbeat stale (${heartbeat_age}s)"
  exit 0
fi

ws_connected=$(grep -o '"wsConnected":[a-z]*' "$HEARTBEAT_PATH" | head -1 | cut -d: -f2)
last_disconnected=$(grep -o '"lastDisconnectedAt":"[^"]*"' "$HEARTBEAT_PATH" | head -1 | cut -d: -f2- | tr -d '"')

if [ "$ws_connected" = "false" ] && [ -n "$last_disconnected" ]; then
  disconnected_epoch=$(date -d "$last_disconnected" +%s 2>/dev/null || echo "$now_epoch")
  disconnected_for=$(( now_epoch - disconnected_epoch ))
  if [ "$disconnected_for" -gt "$DISCONNECTED_THRESHOLD_SEC" ]; then
    restart_service "ws disconnected for ${disconnected_for}s"
    exit 0
  fi
fi

exit 0
