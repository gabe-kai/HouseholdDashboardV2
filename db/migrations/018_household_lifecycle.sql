-- P0-008A: installation epoch on sessions, setup progress, lifecycle grant backfill.
-- Forward migration after 017.

-- ---------------------------------------------------------------------------
-- Grant: household.lifecycle.manage
-- Holders of BOTH household.member.enroll AND household.structure.manage receive
-- lifecycle authority (Manager backfill; preserves all other grants).
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO membership_grants (membership_id, grant_name)
SELECT mg_enroll.membership_id, 'household.lifecycle.manage'
FROM membership_grants mg_enroll
INNER JOIN membership_grants mg_structure
  ON mg_structure.membership_id = mg_enroll.membership_id
 AND mg_structure.grant_name = 'household.structure.manage'
WHERE mg_enroll.grant_name = 'household.member.enroll';

-- ---------------------------------------------------------------------------
-- Bind human sessions to installation dataset epoch (D-051).
-- ---------------------------------------------------------------------------
ALTER TABLE auth_sessions ADD COLUMN installation_epoch INTEGER NOT NULL DEFAULT 1;
ALTER TABLE auth_sessions ADD COLUMN password_confirmed_at TEXT;

-- ---------------------------------------------------------------------------
-- Display sessions (when present) participate in epoch fencing.
-- ---------------------------------------------------------------------------
ALTER TABLE display_sessions ADD COLUMN installation_epoch INTEGER NOT NULL DEFAULT 1;

-- ---------------------------------------------------------------------------
-- Required first-run basics progress (Account + Household steps only).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS setup_progress (
  household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  account_completed_at TEXT,
  household_completed_at TEXT,
  membership_id TEXT REFERENCES household_memberships(id),
  user_id TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_setup_progress_membership
  ON setup_progress (membership_id);
