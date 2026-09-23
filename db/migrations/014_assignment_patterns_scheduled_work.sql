-- P0-007B: assignment patterns, scheduled additions, explicit Unassigned
-- Forward migration after 013.

PRAGMA foreign_keys = OFF;

DROP TRIGGER IF EXISTS occurrences_accountable_household_insert;
DROP TRIGGER IF EXISTS occurrences_accountable_household_update;

-- Nullable owner for unstarted responsibilities; structure fingerprint for intent.
CREATE TABLE occurrences_b014 (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  definition_id TEXT NOT NULL REFERENCES routine_definitions(id),
  revision_id TEXT NOT NULL REFERENCES routine_revisions(id),
  household_date TEXT NOT NULL,
  accountable_member_id TEXT,
  title TEXT NOT NULL,
  daypart TEXT NOT NULL CHECK (
    daypart IN ('morning', 'after_school', 'evening', 'bedtime', 'anytime')
  ),
  version INTEGER NOT NULL DEFAULT 1,
  started_at TEXT,
  canceled_at TEXT,
  calendar_edition_id TEXT,
  calendar_provenance TEXT NOT NULL DEFAULT 'legacy',
  kind TEXT NOT NULL DEFAULT 'routine' CHECK (kind IN ('routine', 'responsibility')),
  structure_fingerprint TEXT,
  unassigned_reason TEXT
);

INSERT INTO occurrences_b014
  (id, household_id, definition_id, revision_id, household_date,
   accountable_member_id, title, daypart, version, started_at, canceled_at,
   calendar_edition_id, calendar_provenance, kind, structure_fingerprint, unassigned_reason)
SELECT
  id, household_id, definition_id, revision_id, household_date,
  accountable_member_id, title, daypart, version, started_at, canceled_at,
  calendar_edition_id, calendar_provenance, kind, NULL, NULL
FROM occurrences;

DROP TABLE occurrences;
ALTER TABLE occurrences_b014 RENAME TO occurrences;

CREATE INDEX IF NOT EXISTS idx_occurrences_household_date
  ON occurrences (household_id, household_date);

CREATE UNIQUE INDEX occurrences_routine_identity
  ON occurrences (definition_id, household_date, accountable_member_id)
  WHERE kind = 'routine';

CREATE UNIQUE INDEX occurrences_responsibility_identity
  ON occurrences (definition_id, household_date)
  WHERE kind = 'responsibility';

-- Owner integrity: routines always assigned; responsibilities may be unassigned when unstarted.
CREATE TRIGGER occurrences_accountable_household_insert
BEFORE INSERT ON occurrences
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'routine occurrences require an accountable member')
  WHERE NEW.kind = 'routine' AND NEW.accountable_member_id IS NULL;

  SELECT RAISE(ABORT, 'started responsibility occurrences require an accountable member')
  WHERE NEW.kind = 'responsibility'
    AND NEW.started_at IS NOT NULL
    AND NEW.accountable_member_id IS NULL;

  SELECT RAISE(ABORT, 'accountable member must belong to occurrence household')
  WHERE NEW.accountable_member_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM household_memberships hm
      WHERE hm.id = NEW.accountable_member_id AND hm.household_id = NEW.household_id
    );
END;

CREATE TRIGGER occurrences_accountable_household_update
BEFORE UPDATE OF accountable_member_id, household_id, started_at, kind ON occurrences
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'routine occurrences require an accountable member')
  WHERE NEW.kind = 'routine' AND NEW.accountable_member_id IS NULL;

  SELECT RAISE(ABORT, 'started responsibility occurrences require an accountable member')
  WHERE NEW.kind = 'responsibility'
    AND NEW.started_at IS NOT NULL
    AND NEW.accountable_member_id IS NULL;

  SELECT RAISE(ABORT, 'accountable member must belong to occurrence household')
  WHERE NEW.accountable_member_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM household_memberships hm
      WHERE hm.id = NEW.accountable_member_id AND hm.household_id = NEW.household_id
    );
END;

-- Versioned assignment + scheduled additions per responsibility revision.
CREATE TABLE revision_responsibility_plans (
  revision_id TEXT PRIMARY KEY REFERENCES routine_revisions(id) ON DELETE CASCADE,
  assignment_json TEXT NOT NULL,
  scheduled_additions_json TEXT NOT NULL DEFAULT '[]'
);

INSERT INTO revision_responsibility_plans (revision_id, assignment_json, scheduled_additions_json)
SELECT
  rr.id,
  json_object(
    'mode', 'fixed',
    'anchorDate', rr.effective_date,
    'fixedMemberId', (
      SELECT ra.member_id FROM revision_assignees ra
      WHERE ra.revision_id = rr.id LIMIT 1
    ),
    'cycleOrder', json('[]'),
    'weeklyMap', json('{}'),
    'excludedMemberIds', json('[]'),
    'savedRingOrder', json('[]')
  ),
  '[]'
FROM routine_revisions rr
JOIN routine_definitions d ON d.id = rr.definition_id
WHERE d.kind = 'responsibility';

-- Scheduled-work provenance on occurrence steps.
ALTER TABLE occurrence_steps ADD COLUMN addition_id TEXT;
ALTER TABLE occurrence_steps ADD COLUMN addition_heading TEXT;

-- Recreate 012 occurrence integrity triggers (lost when occurrences table was rebuilt).
CREATE TRIGGER IF NOT EXISTS occurrences_integrity_insert
BEFORE INSERT ON occurrences
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'occurrence kind must match definition kind')
  WHERE (
    SELECT d.kind FROM routine_definitions d WHERE d.id = NEW.definition_id
  ) IS NULL
     OR (
       SELECT d.kind FROM routine_definitions d WHERE d.id = NEW.definition_id
     ) != NEW.kind;

  SELECT RAISE(ABORT, 'occurrence household must match definition household')
  WHERE (
    SELECT d.household_id FROM routine_definitions d WHERE d.id = NEW.definition_id
  ) IS NULL
     OR (
       SELECT d.household_id FROM routine_definitions d WHERE d.id = NEW.definition_id
     ) != NEW.household_id;

  SELECT RAISE(ABORT, 'occurrence revision must belong to definition')
  WHERE (
    SELECT r.definition_id FROM routine_revisions r WHERE r.id = NEW.revision_id
  ) IS NULL
     OR (
       SELECT r.definition_id FROM routine_revisions r WHERE r.id = NEW.revision_id
     ) != NEW.definition_id;

  SELECT RAISE(ABORT, 'responsibility occurrence already exists for date')
  WHERE (
    SELECT d.kind FROM routine_definitions d WHERE d.id = NEW.definition_id
  ) = 'responsibility'
    AND EXISTS (
      SELECT 1 FROM occurrences o
      WHERE o.definition_id = NEW.definition_id
        AND o.household_date = NEW.household_date
        AND o.id != NEW.id
    );
END;

CREATE TRIGGER IF NOT EXISTS occurrences_integrity_update
BEFORE UPDATE OF kind, definition_id, revision_id, household_id, household_date ON occurrences
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'occurrence kind must match definition kind')
  WHERE (
    SELECT d.kind FROM routine_definitions d WHERE d.id = NEW.definition_id
  ) IS NULL
     OR (
       SELECT d.kind FROM routine_definitions d WHERE d.id = NEW.definition_id
     ) != NEW.kind;

  SELECT RAISE(ABORT, 'occurrence household must match definition household')
  WHERE (
    SELECT d.household_id FROM routine_definitions d WHERE d.id = NEW.definition_id
  ) IS NULL
     OR (
       SELECT d.household_id FROM routine_definitions d WHERE d.id = NEW.definition_id
     ) != NEW.household_id;

  SELECT RAISE(ABORT, 'occurrence revision must belong to definition')
  WHERE (
    SELECT r.definition_id FROM routine_revisions r WHERE r.id = NEW.revision_id
  ) IS NULL
     OR (
       SELECT r.definition_id FROM routine_revisions r WHERE r.id = NEW.revision_id
     ) != NEW.definition_id;

  SELECT RAISE(ABORT, 'responsibility occurrence already exists for date')
  WHERE (
    SELECT d.kind FROM routine_definitions d WHERE d.id = NEW.definition_id
  ) = 'responsibility'
    AND EXISTS (
      SELECT 1 FROM occurrences o
      WHERE o.definition_id = NEW.definition_id
        AND o.household_date = NEW.household_date
        AND o.id != NEW.id
    );
END;

PRAGMA foreign_keys = ON;
