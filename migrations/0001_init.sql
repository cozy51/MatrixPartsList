-- 部品表・図面リンク・UnitBaseを、これまでDriveに置いていたJSONと同じ単位（文書）で保存する。
-- D1は1つの値に約2MBまでしか入らないため、JSONを分割して doc_chunks に入れる。
CREATE TABLE IF NOT EXISTS docs (
  name TEXT PRIMARY KEY,
  chunks INTEGER NOT NULL,
  size INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS doc_chunks (
  name TEXT NOT NULL,
  seq INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (name, seq)
);
