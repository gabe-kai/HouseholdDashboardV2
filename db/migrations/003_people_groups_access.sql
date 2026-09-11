-- P0-004A People, Groups, and Access Status
-- Forward migration: preserve IDs and historical occurrence/personal facts.

ALTER TABLE household_memberships ADD COLUMN classification TEXT
  CHECK (classification IS NULL OR classification IN ('adult', 'child'));

ALTER TABLE household_memberships ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE enrollment_claims ADD COLUMN revoked_at TEXT;

-- Structure authority for current enrollment managers only (no Adult/Child inference).
INSERT INTO membership_grants (membership_id, grant_name)
SELECT mg.membership_id, 'household.structure.manage'
FROM membership_grants mg
WHERE mg.grant_name = 'household.member.enroll'
  AND NOT EXISTS (
    SELECT 1 FROM membership_grants existing
    WHERE existing.membership_id = mg.membership_id
      AND existing.grant_name = 'household.structure.manage'
  );

CREATE TABLE IF NOT EXISTS household_groups (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_household_groups_name_fold
  ON household_groups (household_id, lower(name));

CREATE TABLE IF NOT EXISTS household_group_members (
  group_id TEXT NOT NULL REFERENCES household_groups(id) ON DELETE CASCADE,
  membership_id TEXT NOT NULL REFERENCES household_memberships(id),
  PRIMARY KEY (group_id, membership_id)
);

CREATE INDEX IF NOT EXISTS idx_household_group_members_membership
  ON household_group_members (membership_id);

CREATE TABLE IF NOT EXISTS structure_mutation_receipts (
  mutation_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('person_create', 'group_create', 'setup_issue')),
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
