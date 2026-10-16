-- P0-008D: optional guided first-household-day progress on setup_progress,
-- and guide-bound structure mutation receipt kinds.

-- ---------------------------------------------------------------------------
-- Optional guide metadata (independent of setupRequired / required basics)
-- ---------------------------------------------------------------------------
ALTER TABLE setup_progress ADD COLUMN guide_version INTEGER NOT NULL DEFAULT 0;
-- Status values enforced in application code: not_chosen | completed | skipped
ALTER TABLE setup_progress ADD COLUMN people_status TEXT NOT NULL DEFAULT 'not_chosen';
ALTER TABLE setup_progress ADD COLUMN school_status TEXT NOT NULL DEFAULT 'not_chosen';
ALTER TABLE setup_progress ADD COLUMN first_work_status TEXT NOT NULL DEFAULT 'not_chosen';
ALTER TABLE setup_progress ADD COLUMN people_membership_ids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE setup_progress ADD COLUMN work_definition_ids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE setup_progress ADD COLUMN finished_at TEXT;
ALTER TABLE setup_progress ADD COLUMN dismissed_at TEXT;

-- ---------------------------------------------------------------------------
-- Widen structure_mutation_receipts for guide commands
-- ---------------------------------------------------------------------------
PRAGMA foreign_keys = OFF;

CREATE TABLE structure_mutation_receipts_new (
  mutation_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN (
    'person_create',
    'group_create',
    'setup_issue',
    'permission_save',
    'access_claim_issue',
    'access_claim_cancel',
    'sign_in_revoke',
    'member_remove',
    'fixture_remediation',
    'password_change',
    'guide_progress',
    'guide_people',
    'guide_school',
    'guide_work',
    'guide_dismiss'
  )),
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO structure_mutation_receipts_new (mutation_id, kind, response_json, created_at)
SELECT mutation_id, kind, response_json, created_at
FROM structure_mutation_receipts;

DROP TABLE structure_mutation_receipts;
ALTER TABLE structure_mutation_receipts_new RENAME TO structure_mutation_receipts;

PRAGMA foreign_keys = ON;
