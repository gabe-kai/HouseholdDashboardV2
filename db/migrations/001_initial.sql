-- Initial schema for P0-001 Shared Morning Routine

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  display_name TEXT NOT NULL,
  capabilities_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS routine_definitions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL UNIQUE REFERENCES households(id),
  kind TEXT NOT NULL CHECK (kind = 'morning')
);

CREATE TABLE IF NOT EXISTS routine_revisions (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES routine_definitions(id),
  effective_date TEXT NOT NULL,
  title TEXT NOT NULL,
  weekdays_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (definition_id, effective_date)
);

CREATE TABLE IF NOT EXISTS revision_steps (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES routine_revisions(id),
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  obligation TEXT NOT NULL CHECK (obligation IN ('required', 'as_needed', 'optional')),
  UNIQUE (revision_id, position)
);

CREATE TABLE IF NOT EXISTS revision_assignees (
  revision_id TEXT NOT NULL REFERENCES routine_revisions(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  PRIMARY KEY (revision_id, member_id)
);

CREATE TABLE IF NOT EXISTS occurrences (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  definition_id TEXT NOT NULL REFERENCES routine_definitions(id),
  revision_id TEXT NOT NULL REFERENCES routine_revisions(id),
  household_date TEXT NOT NULL,
  accountable_member_id TEXT NOT NULL REFERENCES members(id),
  title TEXT NOT NULL,
  schedule_anchor TEXT NOT NULL CHECK (schedule_anchor = 'morning'),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (definition_id, household_date, accountable_member_id)
);

CREATE TABLE IF NOT EXISTS occurrence_steps (
  id TEXT PRIMARY KEY,
  occurrence_id TEXT NOT NULL REFERENCES occurrences(id),
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  obligation TEXT NOT NULL CHECK (obligation IN ('required', 'as_needed', 'optional')),
  status TEXT NOT NULL CHECK (status IN ('open', 'completed', 'not_needed')),
  UNIQUE (occurrence_id, position)
);

CREATE TABLE IF NOT EXISTS step_reports (
  id TEXT PRIMARY KEY,
  mutation_id TEXT NOT NULL UNIQUE,
  occurrence_id TEXT NOT NULL REFERENCES occurrences(id),
  occurrence_step_id TEXT NOT NULL REFERENCES occurrence_steps(id),
  accountable_member_id TEXT NOT NULL,
  acting_member_id TEXT NOT NULL,
  performed_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  resulting_state TEXT NOT NULL CHECK (resulting_state IN ('open', 'completed', 'not_needed'))
);

CREATE TABLE IF NOT EXISTS mutation_receipts (
  mutation_id TEXT PRIMARY KEY,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
