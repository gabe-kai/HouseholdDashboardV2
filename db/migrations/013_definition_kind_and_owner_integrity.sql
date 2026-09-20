-- P0-007A Architecture re-acceptance: immutable definition kind + same-household owner
-- Forward migration after 012. Do not edit 011/012 for already-applied databases.

PRAGMA foreign_keys = OFF;

-- ---------------------------------------------------------------------------
-- routine_definitions.kind is immutable after insert
-- ---------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS routine_definitions_kind_immutable
BEFORE UPDATE OF kind ON routine_definitions
FOR EACH ROW
WHEN OLD.kind IS NOT NEW.kind
BEGIN
  SELECT RAISE(ABORT, 'definition kind is immutable');
END;

-- ---------------------------------------------------------------------------
-- accountable_member_id must belong to the occurrence household
-- (applies to routine and responsibility; does not change valid same-household rows)
-- ---------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS occurrences_accountable_household_insert
BEFORE INSERT ON occurrences
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'accountable member must belong to occurrence household')
  WHERE NOT EXISTS (
    SELECT 1
    FROM household_memberships hm
    WHERE hm.id = NEW.accountable_member_id
      AND hm.household_id = NEW.household_id
  );
END;

CREATE TRIGGER IF NOT EXISTS occurrences_accountable_household_update
BEFORE UPDATE OF accountable_member_id, household_id ON occurrences
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'accountable member must belong to occurrence household')
  WHERE NOT EXISTS (
    SELECT 1
    FROM household_memberships hm
    WHERE hm.id = NEW.accountable_member_id
      AND hm.household_id = NEW.household_id
  );
END;

PRAGMA foreign_keys = ON;
