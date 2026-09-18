-- P0-006C: membership profiles, family order, activity generation, checklist receipt ownership
-- Forward migration after 009.
-- Backfills household.activity.clear only for memberships with routine.shared.manage.
-- Initializes family order from existing alphabetical display_name + id tie-break.
-- Backfills mutation_receipts.household_id from embedded occurrence JSON when possible.

PRAGMA foreign_keys = OFF;

-- ---------------------------------------------------------------------------
-- Profile fields on household memberships
-- ---------------------------------------------------------------------------
ALTER TABLE household_memberships ADD COLUMN full_name TEXT;
ALTER TABLE household_memberships ADD COLUMN birthday TEXT;
ALTER TABLE household_memberships ADD COLUMN email TEXT;
ALTER TABLE household_memberships ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Household activity generation + family-order version + reset floor
-- ---------------------------------------------------------------------------
ALTER TABLE households ADD COLUMN activity_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE households ADD COLUMN family_order_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE households ADD COLUMN activity_reset_floor TEXT;

CREATE TABLE IF NOT EXISTS activity_reset_receipts (
  mutation_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  kind TEXT NOT NULL CHECK (kind IN ('activity_clear')),
  payload_digest TEXT NOT NULL,
  actor_membership_id TEXT NOT NULL,
  expected_generation INTEGER NOT NULL,
  result_generation INTEGER NOT NULL,
  reset_floor TEXT NOT NULL,
  counts_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS family_order_mutation_receipts (
  mutation_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  kind TEXT NOT NULL CHECK (kind IN ('family_order_save')),
  payload_digest TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Checklist receipt ownership (scoped clear)
-- ---------------------------------------------------------------------------
ALTER TABLE mutation_receipts ADD COLUMN household_id TEXT;
ALTER TABLE mutation_receipts ADD COLUMN occurrence_id TEXT;

-- ---------------------------------------------------------------------------
-- Deterministic initial family order: alphabetical display_name, then id
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE IF NOT EXISTS _p010_family_order AS
SELECT id AS mid,
       ROW_NUMBER() OVER (
         PARTITION BY household_id
         ORDER BY display_name COLLATE NOCASE, id
       ) - 1 AS ord
FROM household_memberships;

UPDATE household_memberships
SET sort_order = (
  SELECT ord FROM _p010_family_order WHERE mid = household_memberships.id
);

DROP TABLE IF EXISTS _p010_family_order;

-- ---------------------------------------------------------------------------
-- Backfill checklist receipt household/occurrence from response JSON when present
-- ---------------------------------------------------------------------------
UPDATE mutation_receipts
SET
  occurrence_id = json_extract(response_json, '$.occurrence.id'),
  household_id = (
    SELECT o.household_id
    FROM occurrences o
    WHERE o.id = json_extract(mutation_receipts.response_json, '$.occurrence.id')
  )
WHERE json_extract(response_json, '$.occurrence.id') IS NOT NULL;

UPDATE mutation_receipts
SET household_id = (
  SELECT o.household_id
  FROM occurrences o
  WHERE o.id = json_extract(mutation_receipts.response_json, '$.report.occurrenceId')
),
occurrence_id = COALESCE(
  occurrence_id,
  json_extract(response_json, '$.report.occurrenceId')
)
WHERE household_id IS NULL
  AND json_extract(response_json, '$.report.occurrenceId') IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Grant backfill: activity clear only where shared routine manage already exists
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO membership_grants (membership_id, grant_name)
SELECT membership_id, 'household.activity.clear'
FROM membership_grants
WHERE grant_name = 'routine.shared.manage';

PRAGMA foreign_keys = ON;
