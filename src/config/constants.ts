export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
export const DEFAULT_GEMINI_MODEL = "gemini-1.5-flash";

// AIプロバイダーへの1リクエストあたりのタイムアウト。上流APIがハングした際に
// プロセスは生きたまま無応答になり続けるのを防ぐため、有限時間で失敗させる。
export const AI_REQUEST_TIMEOUT_MS = 30_000;

// セッション（会話履歴）の保持ポリシー。参考repoのSessionStore（30分TTL）を踏襲。
export const SESSION_TTL_MS = 30 * 60 * 1000;
export const SESSION_MAX_MESSAGES = 24;

export const CHARACTER_NAME = "100(モモ)";

// Misskeyストリームのkeepalive・自前再接続ポリシーの既定値。
// 症状: keepaliveが無くアイドル切断され、misskey-js内蔵のreconnecting-websocketは
// minReconnectionDelay=1ms・minUptime=5sのため、数分ごとの切断→即再接続（フラッピング）になる。
// 対策: 定期pingでアイドル切断自体を減らし、切断時はネイティブ即再接続を止めて
// 指数バックオフ＋上限＋ジッタで張り直す（詳細は src/misskey/client.ts）。
// アプリレベルのping送信間隔（ms）。サーバ/LBのWSアイドルタイムアウトより十分短くする。
export const DEFAULT_MISSKEY_PING_INTERVAL_MS = 30_000;
// 再接続の指数バックオフの基準待機時間（ms・attempt=0のときの基礎値）。
export const MISSKEY_RECONNECT_BASE_MS = 1_000;
// 1試行ごとに待機時間を何倍にするか（指数バックオフの底）。
export const MISSKEY_RECONNECT_FACTOR = 2;
// 再接続待機時間の上限（ms）。指数的な増加をここで頭打ちにする。
export const MISSKEY_RECONNECT_MAX_MS = 30_000;
// ジッタ幅の割合（0..1）。±この割合で待機時間を揺らし、再接続の同期集中を防ぐ。
export const MISSKEY_RECONNECT_JITTER_RATIO = 0.2;
// 接続がこの時間（ms）以上継続したら「安定」とみなし、バックオフ試行回数をリセットする。
export const MISSKEY_STABILITY_MS = 60_000;
// 短時間切断（フラッピング）がこの回数連続したら警告ログを出す閾値。
export const MISSKEY_FLAP_ALERT_THRESHOLD = 3;

// 取りこぼし回収（replay）の定期実行間隔（ms）。
// keepaliveで接続が安定して再接続が起きなくなると、replayが接続イベント起点でしか
// 走らず、ライブのメンション/一対一チャットの取りこぼしを拾えなくなる。これを防ぐため、
// 接続の有無に依らずこの間隔でREST APIから未処理分を回収する安全網（詳細は
// src/bot/replay.ts・src/index.ts）。一対一チャットのライブ受信が未達でも、この間隔内で応答できる。
export const DEFAULT_REPLAY_INTERVAL_MS = 60_000;

// Claude連携ブリッジ（logs/ ⇄ SQLite）の既定値
// Bot→Claude: ダイジェスト（logs/bot-digest.md）に含める日数
export const CLAUDE_BRIDGE_DIGEST_DAYS = 14;
// Claude→Bot: システムプロンプトへ注入するセッション記録の日数
export const CLAUDE_BRIDGE_NOTES_DAYS = 7;
// 1日分の記録をプロンプトへ注入する際の最大文字数（超過分は省略）
export const CLAUDE_BRIDGE_NOTE_MAX_CHARS = 2000;
