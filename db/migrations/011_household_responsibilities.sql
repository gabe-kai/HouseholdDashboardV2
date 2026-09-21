-- P0-007A: household responsibilities share recurring-work foundations
-- Forward migration after 010.
-- Adds immutable work kind, responsibility occurrence identity, performer fact,
-- grant backfill, and acknowledged activity-clear scope.

PRAGMA foreign_keys = OFF;

-- ---------------------------------------------------------------------------
-- routine_definitions: closed work kind (routine | responsibility)
-- ---------------------------------------------------------------------------
ALTER TABLE routine_definitions ADD COLUMN kind TEXT NOT NULL DEFAULT 'routine'
  CHECK (kind IN ('routine', 'responsibility'));

-- Existing rows already default to routine; keep explicit for clarity.
UPDATE routine_definitions SET kind = 'routine' WHERE kind IS NULL OR kind = '';

CREATE INDEX IF NOT EXISTS idx_routine_definitions_household_kind
  ON routine_definitions (household_id, kind);

-- ---------------------------------------------------------------------------
-- occurrences: kind + rebuild uniqueness (routine vs responsibility)
-- ---------------------------------------------------------------------------
CREATE TABLE occurrences_new (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  definition_id TEXT NOT NULL REFERENCES routine_definitions(id),
  revision_id TEXT NOT NULL REFERENCES routine_revisions(id),
  household_date TEXT NOT NULL,
  accountable_member_id TEXT NOT NULL,
  title TEXT NOT NULL,
  daypart TEXT NOT NULL CHECK (
    daypart IN ('morning', 'after_school', 'evening', 'bedtime', 'anytime')
  ),
  version INTEGER NOT NULL DEFAULT 1,
  started_at TEXT,
  canceled_at TEXT,
  calendar_edition_id TEXT,
  calendar_provenance TEXT NOT NULL DEFAULT 'legacy',
  kind TEXT NOT NULL DEFAULT 'routine' CHECK (kind IN ('routine', 'responsibility'))
);

INSERT INTO occurrences_new
  (id, household_id, definition_id, revision_id, household_date,
   accountable_member_id, title, daypart, version, started_at, canceled_at,
   calendar_edition_id, calendar_provenance, kind)
SELECT
  o.id,
  o.household_id,
  o.definition_id,
  o.revision_id,
  o.household_date,
  o.accountable_member_id,
  o.title,
  o.daypart,
  o.version,
  o.started_at,
  o.canceled_at,
  o.calendar_edition_id,
  o.calendar_provenance,
  COALESCE(d.kind, 'routine')
FROM occurrences o
LEFT JOIN routine_definitions d ON d.id = o.definition_id;

DROP TABLE occurrences;
ALTER TABLE occurrences_new RENAME TO occurrences;

CREATE INDEX IF NOT EXISTS idx_occurrences_household_date
  ON occurrences (household_id, household_date);

-- Routine: one occurrence per definition/date/member (includes canceled).
CREATE UNIQUE INDEX occurrences_routine_identity
  ON occurrences (definition_id, household_date, accountable_member_id)
  WHERE kind = 'routine';

-- Responsibility: one occurrence per definition/date (includes canceled).
CREATE UNIQUE INDEX occurrences_responsibility_identity
  ON occurrences (definition_id, household_date)
  WHERE kind = 'responsibility';

-- ---------------------------------------------------------------------------
-- step_reports: actual performer (nullable; no fabricated backfill)
-- ---------------------------------------------------------------------------
ALTER TABLE step_reports ADD COLUMN performer_member_id TEXT;

-- ---------------------------------------------------------------------------
-- activity_reset_receipts: acknowledged clear scope (legacy NULL = routines-only)
-- ---------------------------------------------------------------------------
ALTER TABLE activity_reset_receipts ADD COLUMN acknowledged_scope TEXT
  CHECK (
    acknowledged_scope IS NULL
    OR acknowledged_scope IN ('routines_and_responsibilities')
  );

-- ---------------------------------------------------------------------------
-- routine_mutation_receipts: responsibility lifecycle kinds
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
    'routine_schedule_delete',
    'responsibility_create',
    'responsibility_revision',
    'responsibility_end',
    'responsibility_delete',
    'responsibility_schedule_move',
    'responsibility_schedule_delete'
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

-- ---------------------------------------------------------------------------
-- Grant backfill once: parallel responsibility grants from routine grants
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO membership_grants (membership_id, grant_name)
SELECT membership_id, 'responsibility.manage'
FROM membership_grants
WHERE grant_name = 'routine.shared.manage';

INSERT OR IGNORE INTO membership_grants (membership_id, grant_name)
SELECT membership_id, 'responsibility.execute.own'
FROM membership_grants
WHERE grant_name = 'routine.execute.own';

PRAGMA foreign_keys = ON;
