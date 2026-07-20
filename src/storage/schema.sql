-- APHRNTs_100 Misskey Bot — SQLiteスキーマ
-- better-sqlite3で起動時に冪等に実行される（CREATE TABLE IF NOT EXISTS）

CREATE TABLE IF NOT EXISTS daily_checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  mood INTEGER,
  sleep_hours REAL,
  sleep_quality INTEGER,
  energy INTEGER,
  notes TEXT,
  creative_progress TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS thought_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  situation TEXT,
  automatic_thought TEXT,
  emotion_label TEXT,
  emotion_intensity INTEGER,
  distortion_id TEXT,
  evidence_for TEXT,
  evidence_against TEXT,
  balanced_thought TEXT,
  re_rated_emotion_intensity INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS behavioral_activation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  activity TEXT NOT NULL,
  predicted_pleasure INTEGER,
  predicted_mastery INTEGER,
  actual_pleasure INTEGER,
  actual_mastery INTEGER,
  status TEXT NOT NULL DEFAULT 'planned',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gratitude_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  item1 TEXT,
  item2 TEXT,
  item3 TEXT,
  created_at TEXT NOT NULL
);

-- 服薬アドヒアランス（有無の記録のみ。増減・変更提案は含まない）
CREATE TABLE IF NOT EXISTS medication_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  morning_taken INTEGER,     -- NULL=未報告, 0=未服用, 1=服用済み
  midday_taken INTEGER,
  after_meal_taken INTEGER,
  night_taken INTEGER,
  prn_count INTEGER,         -- 発作時（顬服）の回数
  prn_notes TEXT,            -- きっかけ・効き具合などの自由記述
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS sessions (
  user_id TEXT PRIMARY KEY,
  messages_json TEXT NOT NULL,
  last_interaction_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limit_state (
  user_id TEXT PRIMARY KEY,
  last_reply_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS global_post_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  posted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS safety_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  triggered_at TEXT NOT NULL,
  matched_terms TEXT NOT NULL,
  channel TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Claude連携ブリッジ: Claude(Desktop等)が logs/YYYY-MM-DD.md に残した
-- 生活管理セッション記録を取り込み、Botの応答文脈として参照するためのテーブル
CREATE TABLE IF NOT EXISTS claude_session_notes (
  date TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  source_path TEXT NOT NULL,
  imported_at TEXT NOT NULL
);

-- Claude連携ブリッジ: logs/ の creative-log 区間（## 創作活動の進捗・## 取り組んだタスク）を
-- 日付単位で構造化して取り込むテーブル。Claude側の記録が正（日付キーの上書きupsert・冪等）。
-- 週次の振り返り・週間サマリーでBot側から創作活動の傾向を参照できるようにする。
CREATE TABLE IF NOT EXISTS creative_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  progress TEXT,             -- 「## 創作活動の進捗」の中身（Markdown）
  tasks TEXT,                -- 「## 取り組んだタスク」の中身（Markdown）
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, date)
);

-- 気分の時点記録（瞬間値）。daily_checkins.mood は「一日の総括」、こちらは「その時点の気分」。
-- 朝/昼/夜での気分の浮き沈み（推移）を総括と混同せずに残すためのテーブル。
CREATE TABLE IF NOT EXISTS mood_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,          -- 対象日（JSTのYYYY-MM-DD）
  recorded_at TEXT NOT NULL,   -- 記録時刻（ISO 8601）
  timepoint TEXT,              -- 「朝」「昼」「夕方」「夜」「HH:MM」等の時点ラベル（自由記述）
  mood INTEGER NOT NULL,       -- 1〜10
  note TEXT,
  created_at TEXT NOT NULL
);
