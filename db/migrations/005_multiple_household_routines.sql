-- P0-005 Multiple Household Routines
-- Forward migration: lift singleton constraints; add dayparts, archive, scoped personal/proposals.
-- Preserve definition/revision/occurrence/member IDs and FK relationships.

PRAGMA foreign_keys = OFF;

-- ---------------------------------------------------------------------------
-- routine_definitions: many per household; archive cutoff; drop morning-only kind
-- ---------------------------------------------------------------------------
CREATE TABLE routine_definitions_new (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  version INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT,
  archive_cutoff_date TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO routine_definitions_new (id, household_id, version, archived_at, archive_cutoff_date, created_at)
SELECT id, household_id, 1, NULL, NULL, '1970-01-01T00:00:00.000Z'
FROM routine_definitions;

DROP TABLE routine_definitions;
ALTER TABLE routine_definitions_new RENAME TO routine_definitions;

CREATE INDEX IF NOT EXISTS idx_routine_definitions_household
  ON routine_definitions (household_id);

-- ---------------------------------------------------------------------------
-- routine_revisions: snapshotted daypart (migrated Morning stays morning)
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
  created_at TEXT NOT NULL,
  UNIQUE (definition_id, effective_date)
);

INSERT INTO routine_revisions_new
  (id, definition_id, effective_date, title, weekdays_json, daypart, created_at)
SELECT id, definition_id, effective_date, title, weekdays_json, 'morning', created_at
FROM routine_revisions;

DROP TABLE routine_revisions;
ALTER TABLE routine_revisions_new RENAME TO routine_revisions;

CREATE INDEX IF NOT EXISTS idx_routine_revisions_definition
  ON routine_revisions (definition_id, effective_date);

-- ---------------------------------------------------------------------------
-- occurrences: daypart vocabulary (legacy schedule_anchor morning -> morning)
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
  UNIQUE (definition_id, household_date, accountable_member_id)
);

INSERT INTO occurrences_new
  (id, household_id, definition_id, revision_id, household_date,
   accountable_member_id, title, daypart, version)
SELECT
  id, household_id, definition_id, revision_id, household_date,
  accountable_member_id, title,
  CASE WHEN schedule_anchor = 'morning' THEN 'morning' ELSE schedule_anchor END,
  version
FROM occurrences;

DROP TABLE occurrences;
ALTER TABLE occurrences_new RENAME TO occurrences;

CREATE INDEX IF NOT EXISTS idx_occurrences_household_date
  ON occurrences (household_id, household_date);

-- ---------------------------------------------------------------------------
-- personal_routine_revisions: uniqueness includes definition_id
-- ---------------------------------------------------------------------------
CREATE TABLE personal_routine_revisions_new (
  id TEXT PRIMARY KEY,
  membership_id TEXT NOT NULL REFERENCES household_memberships(id),
  definition_id TEXT NOT NULL REFERENCES routine_definitions(id),
  effective_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (membership_id, definition_id, effective_date)
);

INSERT INTO personal_routine_revisions_new
  (id, membership_id, definition_id, effective_date, created_at)
SELECT id, membership_id, definition_id, effective_date, created_at
FROM personal_routine_revisions;

DROP TABLE personal_routine_revisions;
ALTER TABLE personal_routine_revisions_new RENAME TO personal_routine_revisions;

CREATE INDEX IF NOT EXISTS idx_personal_layers_lookup
  ON personal_routine_revisions (membership_id, definition_id, effective_date);

-- ---------------------------------------------------------------------------
-- revision_assignees: point at household_memberships (legacy members FK)
-- ---------------------------------------------------------------------------
CREATE TABLE revision_assignees_new (
  revision_id TEXT NOT NULL REFERENCES routine_revisions(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES household_memberships(id),
  PRIMARY KEY (revision_id, member_id)
);

INSERT INTO revision_assignees_new (revision_id, member_id)
SELECT revision_id, member_id FROM revision_assignees;

DROP TABLE revision_assignees;
ALTER TABLE revision_assignees_new RENAME TO revision_assignees;

-- ---------------------------------------------------------------------------
-- routine_proposals: store definition identity; flag unresolved legacy rows
-- ---------------------------------------------------------------------------
ALTER TABLE routine_proposals ADD COLUMN definition_id TEXT REFERENCES routine_definitions(id);
ALTER TABLE routine_proposals ADD COLUMN association_status TEXT NOT NULL DEFAULT 'resolved'
  CHECK (association_status IN ('resolved', 'unresolved'));

-- Backfill from sole pre-upgrade routine when unambiguous.
UPDATE routine_proposals
SET definition_id = (
  SELECT rd.id FROM routine_definitions rd
  WHERE rd.household_id = routine_proposals.household_id
  LIMIT 1
),
association_status = 'resolved'
WHERE definition_id IS NULL
  AND (
    SELECT COUNT(*) FROM routine_definitions rd
    WHERE rd.household_id = routine_proposals.household_id
  ) = 1;

-- Decided proposals: prefer linked personal revision's definition when present.
UPDATE routine_proposals
SET definition_id = (
  SELECT pr.definition_id FROM personal_routine_revisions pr
  WHERE pr.id = routine_proposals.personal_revision_id
),
association_status = 'resolved'
WHERE personal_revision_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM personal_routine_revisions pr
    WHERE pr.id = routine_proposals.personal_revision_id
  );

-- Remaining without definition stay unresolved (readable, not writable targets).
UPDATE routine_proposals
SET association_status = 'unresolved'
WHERE definition_id IS NULL;

-- ---------------------------------------------------------------------------
-- routine_mutation_receipts: bind target definition; allow archive kind
-- ---------------------------------------------------------------------------
CREATE TABLE routine_mutation_receipts_new (
  mutation_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  definition_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('routine_create', 'routine_revision', 'routine_archive')),
  payload_digest TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO routine_mutation_receipts_new
  (mutation_id, household_id, definition_id, kind, payload_digest, response_json, created_at)
SELECT mutation_id, household_id, NULL, kind, payload_digest, response_json, created_at
FROM routine_mutation_receipts;

DROP TABLE routine_mutation_receipts;
ALTER TABLE routine_mutation_receipts_new RENAME TO routine_mutation_receipts;

PRAGMA foreign_keys = ON;
