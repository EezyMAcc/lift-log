CREATE TABLE IF NOT EXISTS exercises (
  key   TEXT PRIMARY KEY,
  name  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sets (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  date      TEXT    NOT NULL,
  liftKey   TEXT    NOT NULL,
  lift      TEXT    NOT NULL,
  type      TEXT    NOT NULL,
  setNumber INTEGER NOT NULL,
  weight    REAL    NOT NULL,
  reps      INTEGER NOT NULL,
  partials  INTEGER
);