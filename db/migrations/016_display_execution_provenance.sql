-- P0-007C-3A: Display execution actor provenance and replay-safe checklist receipts.
-- Forward migration after 015. Preserves human acting_member_id rows; does not
-- rewrite historical reports as display actions. Adds display-session CSRF secrets.

PRAGMA foreign_keys = OFF;

-- ---------------------------------------------------------------------------
-- display_sessions: session-bound CSRF proof for display writes
-- ---------------------------------------------------------------------------
ALTER TABLE display_sessions ADD COLUMN csrf_secret TEXT NOT NULL DEFAULT '';

UPDATE display_sessions
SET csrf_secret = lower(hex(randomblob(32)))
WHERE csrf_secret = '' OR csrf_secret IS NULL;

-- ---------------------------------------------------------------------------
-- step_reports: typed actor class; nullable human actor for display principals
-- ---------------------------------------------------------------------------
CREATE TABLE step_reports_new (
  id TEXT PRIMARY KEY,
  mutation_id TEXT NOT NULL UNIQUE,
  occurrence_id TEXT NOT NULL REFERENCES occurrences(id),
  occurrence_step_id TEXT NOT NULL REFERENCES occurrence_steps(id),
  accountable_member_id TEXT NOT NULL,
  actor_class TEXT NOT NULL DEFAULT 'member'
    CHECK (actor_class IN ('member', 'display')),
  acting_member_id TEXT,
  acting_display_id TEXT REFERENCES household_displays(id),
  acting_display_session_id TEXT,
  performer_member_id TEXT,
  performed_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  resulting_state TEXT NOT NULL CHECK (resulting_state IN ('open', 'completed', 'not_needed')),
  CHECK (
    (actor_class = 'member' AND acting_member_id IS NOT NULL
      AND acting_display_id IS NULL AND acting_display_session_id IS NULL)
    OR
    (actor_class = 'display' AND acting_member_id IS NULL
      AND acting_display_id IS NOT NULL AND acting_display_session_id IS NOT NULL)
  )
);

INSERT INTO step_reports_new (
  id, mutation_id, occurrence_id, occurrence_step_id, accountable_member_id,
  actor_class, acting_member_id, acting_display_id, acting_display_session_id,
  performer_member_id, performed_at, recorded_at, resulting_state
)
SELECT
  id, mutation_id, occurrence_id, occurrence_step_id, accountable_member_id,
  'member', acting_member_id, NULL, NULL,
  performer_member_id, performed_at, recorded_at, resulting_state
FROM step_reports;

DROP TABLE step_reports;
ALTER TABLE step_reports_new RENAME TO step_reports;

CREATE INDEX IF NOT EXISTS idx_step_reports_occurrence
  ON step_reports (occurrence_id);
CREATE INDEX IF NOT EXISTS idx_step_reports_display
  ON step_reports (acting_display_id);

-- ---------------------------------------------------------------------------
-- mutation_receipts: bind replay to display session when actor is display
-- ---------------------------------------------------------------------------
ALTER TABLE mutation_receipts ADD COLUMN actor_class TEXT
  CHECK (actor_class IS NULL OR actor_class IN ('member', 'display'));
ALTER TABLE mutation_receipts ADD COLUMN actor_display_id TEXT;
ALTER TABLE mutation_receipts ADD COLUMN actor_display_session_id TEXT;

UPDATE mutation_receipts
SET actor_class = 'member'
WHERE actor_class IS NULL AND actor_membership_id IS NOT NULL;

PRAGMA foreign_keys = ON;
