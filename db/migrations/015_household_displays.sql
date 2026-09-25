-- P0-007C-2: Household Display identity, enrollment claims, sessions, and
-- management receipts. Forward migration after 014.
-- Backfill household.display.manage only for holders of household.member.enroll.

-- ---------------------------------------------------------------------------
-- Grant backfill (enroll holders only; no Adult/work-management inference)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO membership_grants (membership_id, grant_name)
SELECT membership_id, 'household.display.manage'
FROM membership_grants
WHERE grant_name = 'household.member.enroll';

-- ---------------------------------------------------------------------------
-- Household displays (stable device identity; not a user/membership)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS household_displays (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  label TEXT NOT NULL,
  created_by_membership_id TEXT NOT NULL REFERENCES household_memberships(id),
  created_at TEXT NOT NULL,
  config_version INTEGER NOT NULL DEFAULT 1,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_household_displays_household
  ON household_displays (household_id);

-- ---------------------------------------------------------------------------
-- One-time Base32 enrollment claims (digest-only; plaintext never stored)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS display_enrollment_claims (
  id TEXT PRIMARY KEY,
  display_id TEXT NOT NULL REFERENCES household_displays(id),
  code_digest TEXT NOT NULL UNIQUE,
  issued_by_membership_id TEXT NOT NULL REFERENCES household_memberships(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_display_enrollment_claims_display
  ON display_enrollment_claims (display_id);

-- ---------------------------------------------------------------------------
-- Display sessions (opaque token digest; 90d idle / 365d absolute)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS display_sessions (
  id TEXT PRIMARY KEY,
  display_id TEXT NOT NULL REFERENCES household_displays(id),
  token_digest TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_display_sessions_display
  ON display_sessions (display_id);

-- ---------------------------------------------------------------------------
-- MutationId replay receipts for display management commands
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS display_command_receipts (
  mutation_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (
    kind IN (
      'display_create',
      'display_enrollment_issue',
      'display_enrollment_cancel',
      'display_revoke'
    )
  ),
  household_id TEXT NOT NULL,
  actor_membership_id TEXT NOT NULL,
  display_id TEXT,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_display_command_receipts_display
  ON display_command_receipts (display_id);
