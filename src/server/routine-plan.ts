/**
 * Schedule-entry and range-reconcile helpers for P0-005 r3 plan mutations.
 * Domain date math lives in domain/plan.ts; this module owns store-facing shapes.
 */
import type Database from "better-sqlite3";
import {
  enumerateAffectedDates,
  governedRangeEndExclusive,
  selectScheduleEntryForDate,
  type ScheduleEntryLike,
} from "../domain/plan.js";
import type { PlanRefineOutcome } from "../shared/schemas.js";

export type ScheduleEntryRow = {
  id: string;
  definition_id: string;
  start_date: string;
  revision_id: string;
  canceled_at: string | null;
  created_at: string;
};

export function emptyRefineOutcome(
  fromDate: string,
  untilDateExclusive: string | null,
): PlanRefineOutcome {
  return {
    fromDate,
    untilDateExclusive,
    updatedMemberIds: [],
    protectedMemberIds: [],
    excludedMemberIds: [],
  };
}

export function mergeRefineOutcomes(
  base: PlanRefineOutcome,
  next: {
    updated?: string[];
    protected?: string[];
    excluded?: string[];
  },
): PlanRefineOutcome {
  const uniq = (ids: string[]) => [...new Set(ids)].sort((a, b) => a.localeCompare(b));
  return {
    fromDate: base.fromDate,
    untilDateExclusive: base.untilDateExclusive,
    updatedMemberIds: uniq([...base.updatedMemberIds, ...(next.updated ?? [])]),
    protectedMemberIds: uniq([...base.protectedMemberIds, ...(next.protected ?? [])]),
    excludedMemberIds: uniq([...base.excludedMemberIds, ...(next.excluded ?? [])]),
  };
}

export function loadScheduleEntryRows(
  db: Database.Database,
  definitionId: string,
): ScheduleEntryRow[] {
  return db
    .prepare(
      `SELECT id, definition_id, start_date, revision_id, canceled_at, created_at
       FROM routine_schedule_entries
       WHERE definition_id = ?
       ORDER BY start_date, created_at`,
    )
    .all(definitionId) as ScheduleEntryRow[];
}

export function toScheduleEntryLike(row: ScheduleEntryRow): ScheduleEntryLike {
  return {
    id: row.id,
    startDate: row.start_date,
    revisionId: row.revision_id,
    canceledAt: row.canceled_at,
  };
}

export function selectActiveEntryRowForDate(
  rows: ScheduleEntryRow[],
  date: string,
): ScheduleEntryRow | null {
  const like = rows.map(toScheduleEntryLike);
  const selected = selectScheduleEntryForDate(like, date);
  if (!selected) return null;
  return rows.find((r) => r.id === selected.id) ?? null;
}

export function knownOccurrenceDatesInRange(
  db: Database.Database,
  definitionId: string,
  fromDate: string,
  endExclusive: string | null,
): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT household_date AS d FROM occurrences
       WHERE definition_id = ? AND household_date >= ?
       ${endExclusive ? "AND household_date < ?" : ""}
       ORDER BY household_date`,
    )
    .all(
      ...(endExclusive
        ? [definitionId, fromDate, endExclusive]
        : [definitionId, fromDate]),
    ) as Array<{ d: string }>;
  return rows.map((r) => r.d);
}

/** Dates to visit when reconciling a governed current-plan or vacated range. */
export function reconcileDatesForRange(
  db: Database.Database,
  definitionId: string,
  fromDate: string,
  entries: ScheduleEntryLike[],
): { dates: string[]; untilDateExclusive: string | null } {
  const untilDateExclusive = governedRangeEndExclusive(fromDate, entries);
  const known = knownOccurrenceDatesInRange(
    db,
    definitionId,
    fromDate,
    untilDateExclusive,
  );
  return {
    dates: enumerateAffectedDates(fromDate, untilDateExclusive, known),
    untilDateExclusive,
  };
}
