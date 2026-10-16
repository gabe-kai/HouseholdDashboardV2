-- P0-008D correction: bound guide mutation receipts (actor/household/epoch/digest)
-- and distinct action kinds. Retains structure_mutation_receipts for non-guide kinds.

CREATE TABLE IF NOT EXISTS guide_mutation_receipts (
  mutation_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  actor_membership_id TEXT NOT NULL,
  installation_epoch INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'guide_person_create',
    'guide_people_complete',
    'guide_school',
    'guide_work',
    'guide_finish',
    'guide_dismiss'
  )),
  payload_digest TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_guide_mutation_receipts_household
  ON guide_mutation_receipts (household_id);
