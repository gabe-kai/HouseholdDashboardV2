-- P0-005 r3 repair: widen routine_mutation_receipts.kind CHECK.
-- Some databases applied an earlier 007 draft that created schedule entries
-- without rebuilding receipts; schedule delete/move and End/Delete then fail
-- with an opaque SQLITE_CONSTRAINT / HTTP 500.

PRAGMA foreign_keys = OFF;

CREATE TABLE routine_mutation_receipts_new (
  mutation_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  definition_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN (
    'routine_create',
    'routine_revision',
    'routine_archive',
    'routine_end',
    'routine_delete',
    'routine_schedule_move',
    'routine_schedule_delete'
  )),
  payload_digest TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO routine_mutation_receipts_new
  (mutation_id, household_id, definition_id, kind, payload_digest, response_json, created_at)
SELECT mutation_id, household_id, definition_id, kind, payload_digest, response_json, created_at
FROM routine_mutation_receipts;

DROP TABLE routine_mutation_receipts;
ALTER TABLE routine_mutation_receipts_new RENAME TO routine_mutation_receipts;

PRAGMA foreign_keys = ON;
