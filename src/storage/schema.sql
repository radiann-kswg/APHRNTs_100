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
