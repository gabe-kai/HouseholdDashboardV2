-- P0-005 r2: first-execution structural lock on occurrences.
-- started_at is set once on the first locking checklist action and never cleared.

ALTER TABLE occurrences ADD COLUMN started_at TEXT;

UPDATE occurrences
SET started_at = (
  SELECT MIN(sr.recorded_at)
  FROM step_reports sr
  WHERE sr.occurrence_id = occurrences.id
    AND sr.resulting_state IN ('completed', 'not_needed')
)
WHERE started_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM step_reports sr
    WHERE sr.occurrence_id = occurrences.id
      AND sr.resulting_state IN ('completed', 'not_needed')
  );
