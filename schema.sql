CREATE TABLE IF NOT EXISTS game_questions (
  question_id TEXT PRIMARY KEY,
  image_id TEXT NOT NULL,
  image_url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  creator_id TEXT,
  creator_username TEXT,
  captured_at INTEGER,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  acceptance_radius_m REAL NOT NULL DEFAULT 15,
  sequence_id TEXT,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'answered', 'skipped')),
  answer_latitude REAL,
  answer_longitude REAL,
  distance_m REAL
);

CREATE INDEX IF NOT EXISTS idx_game_questions_image_created
  ON game_questions (image_id, created_at);

CREATE INDEX IF NOT EXISTS idx_game_questions_created
  ON game_questions (created_at);
