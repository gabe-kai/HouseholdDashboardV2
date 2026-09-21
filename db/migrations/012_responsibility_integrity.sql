-- P0-007A Architecture FIX REQUIRED R1/R2: checklist receipt binding + occurrence integrity
-- Forward migration after 011. Do not edit 011 for already-applied databases.

PRAGMA foreign_keys = OFF;

-- ---------------------------------------------------------------------------
-- mutation_receipts: bind replay to household/occurrence/step/actor/command
-- ---------------------------------------------------------------------------
ALTER TABLE mutation_receipts ADD COLUMN occurrence_step_id TEXT;
ALTER TABLE mutation_receipts ADD COLUMN actor_membership_id TEXT;
ALTER TABLE mutation_receipts ADD COLUMN kind TEXT
  CHECK (kind IS NULL OR kind IN ('routine', 'responsibility'));
ALTER TABLE mutation_receipts ADD COLUMN resulting_state TEXT
  CHECK (
    resulting_state IS NULL
    OR resulting_state IN ('open', 'completed', 'not_needed')
  );
ALTER TABLE mutation_receipts ADD COLUMN activity_generation INTEGER;
ALTER TABLE mutation_receipts ADD COLUMN payload_digest TEXT;

UPDATE mutation_receipts
SET
  occurrence_step_id = COALESCE(
    occurrence_step_id,
    json_extract(response_json, '$.report.occurrenceStepId')
  ),
  actor_membership_id = COALESCE(
    actor_membership_id,
    json_extract(response_json, '$.report.actingMemberId')
  ),
  kind = COALESCE(
    kind,
    CASE
      WHEN json_extract(response_json, '$.occurrence.kind') = 'responsibility'
        THEN 'responsibility'
      WHEN json_extract(response_json, '$.occurrence.kind') = 'routine'
        THEN 'routine'
      ELSE 'routine'
    END
  ),
  resulting_state = COALESCE(
    resulting_state,
    json_extract(response_json, '$.report.resultingState')
  ),
  activity_generation = COALESCE(activity_generation, 0)
WHERE response_json IS NOT NULL;

-- ---------------------------------------------------------------------------
-- occurrences: kind must match definition; revision must belong to definition
-- ---------------------------------------------------------------------------
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

  -- Responsibility definitions: one occurrence per date regardless of spoofed kind.
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
