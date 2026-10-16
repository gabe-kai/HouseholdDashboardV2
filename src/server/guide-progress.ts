import type Database from "better-sqlite3";
import type { GuideProgressPublic, GuideStepStatus } from "../shared/schemas.js";

export type GuideProgressRow = {
  household_id: string;
  account_completed_at: string | null;
  household_completed_at: string | null;
  membership_id: string | null;
  user_id: string | null;
  guide_version: number;
  people_status: GuideStepStatus;
  school_status: GuideStepStatus;
  first_work_status: GuideStepStatus;
  people_membership_ids_json: string;
  work_definition_ids_json: string;
  finished_at: string | null;
  dismissed_at: string | null;
  updated_at: string;
};

const STEP_STATUSES = new Set<string>(["not_chosen", "completed", "skipped"]);

export function parseGuideStepStatus(value: unknown): GuideStepStatus {
  return STEP_STATUSES.has(String(value)) ? (value as GuideStepStatus) : "not_chosen";
}

export function parseIdListJson(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

export function readGuideProgressRow(
  db: Database.Database,
  householdId: string,
): GuideProgressRow | null {
  const row = db
    .prepare(
      `SELECT household_id, account_completed_at, household_completed_at, membership_id, user_id,
              guide_version, people_status, school_status, first_work_status,
              people_membership_ids_json, work_definition_ids_json, finished_at, dismissed_at, updated_at
       FROM setup_progress WHERE household_id = ?`,
    )
    .get(householdId) as GuideProgressRow | undefined;
  return row ?? null;
}

/** Resolve linked membership IDs against current nondeparted household members. */
export function resolvePeopleLinks(
  db: Database.Database,
  householdId: string,
  linkedIds: readonly string[],
): string[] {
  if (linkedIds.length === 0) return [];
  const active = new Set(
    (
      db
        .prepare(
          `SELECT id FROM household_memberships
           WHERE household_id = ? AND departed_at IS NULL`,
        )
        .all(householdId) as Array<{ id: string }>
    ).map((r) => r.id),
  );
  return linkedIds.filter((id) => active.has(id));
}

/** Resolve linked work definition IDs against current non-deleted definitions. */
export function resolveWorkLinks(
  db: Database.Database,
  householdId: string,
  linkedIds: readonly string[],
): string[] {
  if (linkedIds.length === 0) return [];
  const alive = new Set(
    (
      db
        .prepare(
          `SELECT id FROM routine_definitions
           WHERE household_id = ? AND deleted_at IS NULL`,
        )
        .all(householdId) as Array<{ id: string }>
    ).map((r) => r.id),
  );
  return linkedIds.filter((id) => alive.has(id));
}

export function toGuideProgressPublic(
  db: Database.Database,
  row: GuideProgressRow,
  setupRequired: boolean,
): GuideProgressPublic {
  const peopleMembershipIds = resolvePeopleLinks(
    db,
    row.household_id,
    parseIdListJson(row.people_membership_ids_json),
  );
  const workDefinitionIds = resolveWorkLinks(
    db,
    row.household_id,
    parseIdListJson(row.work_definition_ids_json),
  );
  return {
    householdId: row.household_id,
    accountCompletedAt: row.account_completed_at,
    householdCompletedAt: row.household_completed_at,
    setupRequired,
    guideVersion: row.guide_version ?? 0,
    peopleStatus: parseGuideStepStatus(row.people_status),
    schoolStatus: parseGuideStepStatus(row.school_status),
    firstWorkStatus: parseGuideStepStatus(row.first_work_status),
    peopleMembershipIds,
    workDefinitionIds,
    finishedAt: row.finished_at,
    dismissedAt: row.dismissed_at,
  };
}

/** Remove a membership id from guide people links so unused delete is never blocked by progress. */
export function unlinkGuideMembership(
  db: Database.Database,
  householdId: string,
  membershipId: string,
): void {
  const row = readGuideProgressRow(db, householdId);
  if (!row) return;
  const ids = parseIdListJson(row.people_membership_ids_json).filter((id) => id !== membershipId);
  if (ids.length === parseIdListJson(row.people_membership_ids_json).length) return;
  db.prepare(
    `UPDATE setup_progress
     SET people_membership_ids_json = ?, updated_at = ?
     WHERE household_id = ?`,
  ).run(JSON.stringify(ids), new Date().toISOString(), householdId);
}

/** Remove a definition id from guide work links so unused work delete is never blocked by progress. */
export function unlinkGuideWorkDefinition(
  db: Database.Database,
  householdId: string,
  definitionId: string,
): void {
  const row = readGuideProgressRow(db, householdId);
  if (!row) return;
  const ids = parseIdListJson(row.work_definition_ids_json).filter((id) => id !== definitionId);
  if (ids.length === parseIdListJson(row.work_definition_ids_json).length) return;
  db.prepare(
    `UPDATE setup_progress
     SET work_definition_ids_json = ?, updated_at = ?
     WHERE household_id = ?`,
  ).run(JSON.stringify(ids), new Date().toISOString(), householdId);
}
