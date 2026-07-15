export const AGENT_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, subject TEXT NOT NULL, status TEXT NOT NULL,
  active_run_id TEXT, domain_state_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session_messages (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session_attachments (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), file_id TEXT NOT NULL,
  name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL, UNIQUE(session_id, file_id)
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), objective TEXT NOT NULL,
  status TEXT NOT NULL, started_at TEXT, finished_at TEXT, error_json TEXT,
  expected_accepted_artifact_id TEXT, expected_accepted_version INTEGER, expected_accepted_fingerprint TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_run_per_session
  ON runs(session_id) WHERE status IN ('queued','running');
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id),
  run_id TEXT, type TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_replay ON events(session_id, id);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), run_id TEXT,
  type TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL,
  data_json TEXT NOT NULL, metadata_json TEXT, logical_key TEXT, scope_key TEXT,
  supersedes TEXT, superseded INTEGER NOT NULL CHECK(superseded IN (0,1))
);
CREATE INDEX IF NOT EXISTS artifacts_by_session ON artifacts(session_id, created_at, id);
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), artifact_id TEXT NOT NULL,
  artifact_version INTEGER NOT NULL, fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','superseded')),
  confirmation_id TEXT, reason TEXT, created_at TEXT NOT NULL, resolved_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_review_per_artifact
  ON reviews(artifact_id) WHERE status = 'pending';
`

export type SessionStatusRow =
  | 'idle' | 'queued' | 'running' | 'awaiting_review' | 'completed' | 'failed' | 'cancelled'
export type RunStatusRow = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type ReviewStatusRow = 'pending' | 'approved' | 'rejected' | 'superseded'
