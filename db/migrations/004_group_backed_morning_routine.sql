-- P0-004B Group-backed Morning Routine
-- Forward migration: preserve IDs, revisions, occurrences, and current group members.

ALTER TABLE household_groups ADD COLUMN deleted_at TEXT;

DROP INDEX IF EXISTS idx_household_groups_name_fold;
CREATE UNIQUE INDEX IF NOT EXISTS idx_household_groups_name_fold
  ON household_groups (household_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS group_membership_versions (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES household_groups(id),
  version INTEGER NOT NULL,
  effective_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (group_id, version)
);

CREATE INDEX IF NOT EXISTS idx_group_membership_versions_lookup
  ON group_membership_versions (group_id, effective_date, version);

CREATE TABLE IF NOT EXISTS group_membership_version_members (
  version_id TEXT NOT NULL REFERENCES group_membership_versions(id) ON DELETE CASCADE,
  membership_id TEXT NOT NULL,
  PRIMARY KEY (version_id, membership_id)
);

CREATE TABLE IF NOT EXISTS revision_group_sources (
  revision_id TEXT NOT NULL REFERENCES routine_revisions(id),
  group_id TEXT NOT NULL REFERENCES household_groups(id),
  PRIMARY KEY (revision_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_revision_group_sources_group
  ON revision_group_sources (group_id);

CREATE TABLE IF NOT EXISTS routine_mutation_receipts (
  mutation_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('routine_create', 'routine_revision')),
  payload_digest TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Baseline membership versions are inserted by the TypeScript migrate hook
-- `backfillGroupMembershipBaselines` so effective_date uses each household's
-- local calendar date (not UTC substr of created_at).
