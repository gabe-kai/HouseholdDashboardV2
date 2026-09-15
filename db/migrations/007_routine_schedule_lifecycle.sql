-- P0-005 r3: schedule entries, immutable revision content, End/Delete lifecycle.
-- Preserve revision/occurrence IDs. Existing archived cutoffs keep legacy meaning.

PRAGMA foreign_keys = OFF;

-- ---------------------------------------------------------------------------
-- routine_definitions: End lifecycle fields (legacy archive rows unchanged)
-- ---------------------------------------------------------------------------
CREATE TABLE routine_definitions_new (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  version INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT,
  archive_cutoff_date TEXT,
  ended_at TEXT,
  end_mode TEXT CHECK (end_mode IS NULL OR end_mode IN ('legacy_archive', 'immediate')),
  deleted_at TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO routine_definitions_new
  (id, household_id, version, archived_at, archive_cutoff_date, ended_at, end_mode, deleted_at, created_at)
SELECT
  id,
  household_id,
  version,
  archived_at,
  archive_cutoff_date,
  archived_at,
  CASE WHEN archived_at IS NOT NULL THEN 'legacy_archive' ELSE NULL END,
  NULL,
  created_at
FROM routine_definitions;

DROP TABLE routine_definitions;
ALTER TABLE routine_definitions_new RENAME TO routine_definitions;

CREATE INDEX IF NOT EXISTS idx_routine_definitions_household
  ON routine_definitions (household_id);

-- ---------------------------------------------------------------------------
-- routine_revisions: drop UNIQUE(definition_id, effective_date) so content
-- versions can be immutable while schedule entries own date boundaries.
-- ---------------------------------------------------------------------------
CREATE TABLE routine_revisions_new (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES routine_definitions(id),
  effective_date TEXT NOT NULL,
  title TEXT NOT NULL,
  weekdays_json TEXT NOT NULL,
  daypart TEXT NOT NULL CHECK (
    daypart IN ('morning', 'after_school', 'evening', 'bedtime', 'anytime')
  ),
  created_at TEXT NOT NULL
);

INSERT INTO routine_revisions_new
  (id, definition_id, effective_date, title, weekdays_json, daypart, created_at)
SELECT id, definition_id, effective_date, title, weekdays_json, daypart, created_at
FROM routine_revisions;

DROP TABLE routine_revisions;
ALTER TABLE routine_revisions_new RENAME TO routine_revisions;

CREATE INDEX IF NOT EXISTS idx_routine_revisions_definition
  ON routine_revisions (definition_id, effective_date);

-- ---------------------------------------------------------------------------
-- schedule entries: intentional upcoming / current boundaries
-- ---------------------------------------------------------------------------
CREATE TABLE routine_schedule_entries (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES routine_definitions(id),
  start_date TEXT NOT NULL,
  revision_id TEXT NOT NULL REFERENCES routine_revisions(id),
  canceled_at TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO routine_schedule_entries (id, definition_id, start_date, revision_id, canceled_at, created_at)
SELECT
  lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
        substr(hex(randomblob(2)), 2) || '-' ||
        substr('89ab', abs(random()) % 4 + 1, 1) ||
        substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
  definition_id,
  effective_date,
  id,
  NULL,
  created_at
FROM routine_revisions;

CREATE UNIQUE INDEX routine_schedule_active_date
  ON routine_schedule_entries (definition_id, start_date)
  WHERE canceled_at IS NULL;

CREATE INDEX idx_routine_schedule_definition
  ON routine_schedule_entries (definition_id, start_date);

-- ---------------------------------------------------------------------------
-- occurrences: soft-cancel for End / audience exclusion (started rows stay)
-- ---------------------------------------------------------------------------
ALTER TABLE occurrences ADD COLUMN canceled_at TEXT;

-- ---------------------------------------------------------------------------
-- routine_mutation_receipts: End / Delete / schedule move-delete kinds
-- ---------------------------------------------------------------------------
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
