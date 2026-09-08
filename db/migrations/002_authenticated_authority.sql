-- P0-002 Authenticated Household Authority
-- Forward migration: preserve household/member IDs and historical occurrence data.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  login_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  passphrase_phc TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS household_memberships (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  user_id TEXT REFERENCES users(id),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS membership_grants (
  membership_id TEXT NOT NULL REFERENCES household_memberships(id),
  grant_name TEXT NOT NULL,
  PRIMARY KEY (membership_id, grant_name)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  membership_id TEXT NOT NULL REFERENCES household_memberships(id),
  token_digest TEXT NOT NULL UNIQUE,
  csrf_secret TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS enrollment_claims (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  membership_id TEXT REFERENCES household_memberships(id),
  token_digest TEXT NOT NULL UNIQUE,
  preset TEXT NOT NULL,
  display_name TEXT,
  created_by_membership_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('bootstrap', 'enrollment'))
);

CREATE TABLE IF NOT EXISTS login_throttle (
  key TEXT PRIMARY KEY,
  fail_count INTEGER NOT NULL,
  window_started_at TEXT NOT NULL,
  blocked_until TEXT
);

CREATE TABLE IF NOT EXISTS personal_routine_revisions (
  id TEXT PRIMARY KEY,
  membership_id TEXT NOT NULL REFERENCES household_memberships(id),
  definition_id TEXT NOT NULL REFERENCES routine_definitions(id),
  effective_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (membership_id, effective_date)
);

CREATE TABLE IF NOT EXISTS personal_additions (
  id TEXT PRIMARY KEY,
  personal_revision_id TEXT NOT NULL REFERENCES personal_routine_revisions(id),
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  obligation TEXT NOT NULL CHECK (obligation IN ('required', 'as_needed', 'optional')),
  anchor_logical_item_id TEXT,
  place TEXT NOT NULL CHECK (place IN ('before', 'after', 'end')),
  UNIQUE (personal_revision_id, position)
);

CREATE TABLE IF NOT EXISTS routine_proposals (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  membership_id TEXT NOT NULL REFERENCES household_memberships(id),
  text TEXT NOT NULL,
  obligation TEXT NOT NULL CHECK (obligation IN ('required', 'as_needed', 'optional')),
  anchor_logical_item_id TEXT,
  place TEXT NOT NULL CHECK (place IN ('before', 'after', 'end')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  proposed_at TEXT NOT NULL,
  decided_at TEXT,
  decider_membership_id TEXT,
  personal_revision_id TEXT,
  UNIQUE (id)
);

CREATE TABLE IF NOT EXISTS personal_tasks (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  owner_membership_id TEXT NOT NULL REFERENCES household_memberships(id),
  title TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'household')),
  status TEXT NOT NULL CHECK (status IN ('open', 'completed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS personal_task_mutations (
  mutation_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES personal_tasks(id),
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Preserve existing member rows as pending memberships (IDs unchanged).
INSERT INTO household_memberships (id, household_id, user_id, display_name, status, created_at)
SELECT id, household_id, NULL, display_name, 'pending', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM members
WHERE NOT EXISTS (SELECT 1 FROM household_memberships hm WHERE hm.id = members.id);

-- Revoke evaluation sessions (table retained for rollback inspection but unused).
DELETE FROM sessions;

-- Stable shared item identity + occurrence provenance columns (nullable for historical rows).
ALTER TABLE revision_steps ADD COLUMN logical_item_id TEXT;
ALTER TABLE occurrence_steps ADD COLUMN source TEXT NOT NULL DEFAULT 'shared';
ALTER TABLE occurrence_steps ADD COLUMN logical_item_id TEXT;
