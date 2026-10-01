-- P0-007C-3B: Owner-controlled personal-task wall promotion.
-- Forward migration after 016. Existing tasks remain unpromoted.
-- Adds durable completed_at so sharing edits do not move reported completion time.
-- Adds sharing_version for stale competing sharing-edit conflicts.

PRAGMA foreign_keys = OFF;

ALTER TABLE personal_tasks ADD COLUMN show_on_shared_dashboard INTEGER NOT NULL DEFAULT 0
  CHECK (show_on_shared_dashboard IN (0, 1));

ALTER TABLE personal_tasks ADD COLUMN completed_at TEXT;

ALTER TABLE personal_tasks ADD COLUMN sharing_version INTEGER NOT NULL DEFAULT 0;

-- Backfill completion time from previous projection (completed used updated_at).
UPDATE personal_tasks
SET completed_at = updated_at
WHERE status = 'completed' AND completed_at IS NULL;

-- Reject private+promoted combinations if any slipped in (none expected).
UPDATE personal_tasks
SET show_on_shared_dashboard = 0
WHERE visibility = 'private' AND show_on_shared_dashboard = 1;

CREATE TABLE IF NOT EXISTS personal_task_sharing_mutations (
  mutation_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES personal_tasks(id),
  owner_membership_id TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

PRAGMA foreign_keys = ON;
