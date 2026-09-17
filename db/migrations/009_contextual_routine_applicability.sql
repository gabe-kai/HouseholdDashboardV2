-- P0-006B: step applicability + household school calendar editions
-- Forward migration after 008. Defaults legacy content to Every time.
-- Backfills household.schedule.manage only for memberships with routine.shared.manage.

PRAGMA foreign_keys = OFF;

-- ---------------------------------------------------------------------------
-- Applicability on shared revision steps (JSON discriminated rule)
-- ---------------------------------------------------------------------------
ALTER TABLE revision_steps ADD COLUMN applicability_json TEXT NOT NULL DEFAULT '{"kind":"every_time"}';

-- ---------------------------------------------------------------------------
-- Applicability on personal additions and proposals
-- ---------------------------------------------------------------------------
ALTER TABLE personal_additions ADD COLUMN applicability_json TEXT NOT NULL DEFAULT '{"kind":"every_time"}';
ALTER TABLE routine_proposals ADD COLUMN applicability_json TEXT NOT NULL DEFAULT '{"kind":"every_time"}';

-- ---------------------------------------------------------------------------
-- Occurrence provenance for calendar edition + evaluated applicability
-- ---------------------------------------------------------------------------
ALTER TABLE occurrences ADD COLUMN calendar_edition_id TEXT;
ALTER TABLE occurrences ADD COLUMN calendar_provenance TEXT NOT NULL DEFAULT 'legacy';

ALTER TABLE occurrence_steps ADD COLUMN applicability_json TEXT NOT NULL DEFAULT '{"kind":"every_time"}';
ALTER TABLE occurrence_steps ADD COLUMN applicability_reason TEXT;

-- ---------------------------------------------------------------------------
-- Household school calendar (one row per household; editions are immutable)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS household_calendars (
  household_id TEXT PRIMARY KEY REFERENCES households(id),
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS school_calendar_editions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  version INTEGER NOT NULL,
  effective_from TEXT NOT NULL,
  created_at TEXT NOT NULL,
  mutation_id TEXT NOT NULL UNIQUE,
  UNIQUE (household_id, version)
);

CREATE INDEX IF NOT EXISTS idx_school_calendar_editions_lookup
  ON school_calendar_editions (household_id, effective_from, version);

CREATE TABLE IF NOT EXISTS school_years (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES school_calendar_editions(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  usual_weekdays_json TEXT NOT NULL,
  position INTEGER NOT NULL,
  UNIQUE (edition_id, position)
);

CREATE TABLE IF NOT EXISTS school_exceptions (
  id TEXT PRIMARY KEY,
  year_id TEXT NOT NULL REFERENCES school_years(id),
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  position INTEGER NOT NULL,
  UNIQUE (year_id, position)
);

CREATE TABLE IF NOT EXISTS calendar_mutation_receipts (
  mutation_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('calendar_save')),
  payload_digest TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Grant backfill: schedule manage only where shared routine manage already exists
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO membership_grants (membership_id, grant_name)
SELECT membership_id, 'household.schedule.manage'
FROM membership_grants
WHERE grant_name = 'routine.shared.manage';

PRAGMA foreign_keys = ON;
