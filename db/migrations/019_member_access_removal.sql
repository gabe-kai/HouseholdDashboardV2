-- P0-008C: member access administration, sign-in links, departure, authority version.
-- Forward migration after 018. Never removes people.

-- ---------------------------------------------------------------------------
-- Grants: household.access.manage + household.member.remove
-- Holders of BOTH enroll AND structure receive both (Manager backfill).
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO membership_grants (membership_id, grant_name)
SELECT mg_enroll.membership_id, 'household.access.manage'
FROM membership_grants mg_enroll
INNER JOIN membership_grants mg_structure
  ON mg_structure.membership_id = mg_enroll.membership_id
 AND mg_structure.grant_name = 'household.structure.manage'
WHERE mg_enroll.grant_name = 'household.member.enroll';

INSERT OR IGNORE INTO membership_grants (membership_id, grant_name)
SELECT mg_enroll.membership_id, 'household.member.remove'
FROM membership_grants mg_enroll
INNER JOIN membership_grants mg_structure
  ON mg_structure.membership_id = mg_enroll.membership_id
 AND mg_structure.grant_name = 'household.structure.manage'
WHERE mg_enroll.grant_name = 'household.member.enroll';

-- ---------------------------------------------------------------------------
-- Membership access / departure / authority versioning
-- ---------------------------------------------------------------------------
ALTER TABLE household_memberships ADD COLUMN authority_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE household_memberships ADD COLUMN departed_at TEXT;
ALTER TABLE household_memberships ADD COLUMN departed_household_date TEXT;
ALTER TABLE household_memberships ADD COLUMN sign_in_revoked_at TEXT;

CREATE INDEX IF NOT EXISTS idx_household_memberships_departed
  ON household_memberships (household_id, departed_at);

-- ---------------------------------------------------------------------------
-- Person-bound access claims (invitation / password reset / restore sign-in)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS membership_access_claims (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  membership_id TEXT NOT NULL REFERENCES household_memberships(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('invitation', 'password_reset', 'restore_sign_in')),
  token_digest TEXT NOT NULL UNIQUE,
  created_by_membership_id TEXT REFERENCES household_memberships(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_membership_access_claims_membership
  ON membership_access_claims (membership_id, purpose, revoked_at, consumed_at);

CREATE INDEX IF NOT EXISTS idx_membership_access_claims_digest
  ON membership_access_claims (token_digest);

-- ---------------------------------------------------------------------------
-- Widen structure_mutation_receipts for access / removal / remediation
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
    'password_change'
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
