import type { Grant } from "../shared/schemas.js";

/** Policy dimensions for each registered `/api/v1` route (P0-003). */
export type RouteOriginPolicy =
  | "none"
  | "auth_entry"
  | "mutation_when_configured"
  | "websocket";

export type RouteCsrfPolicy = "n/a" | "exempt" | "required";

export type RoutePolicyEntry = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  auth: "public" | "session";
  origin: RouteOriginPolicy;
  csrf: RouteCsrfPolicy;
  /** Store-enforced grant when applicable; null if public or grant varies/none beyond session. */
  grant: Grant | null;
  /** When true, route is registered only for development/test profiles. */
  testOnly?: boolean;
  /** Short policy note for the catalog (not runtime-enforced). */
  notes: string;
};

/**
 * Authoritative route-policy inventory. Completeness tests fail if Fastify
 * registers an `/api/v1` route absent from this list.
 */
export const ROUTE_POLICY_INVENTORY: RoutePolicyEntry[] = [
  {
    method: "GET",
    path: "/api/v1/health",
    auth: "public",
    origin: "none",
    csrf: "n/a",
    grant: null,
    notes: "Liveness probe",
  },
  {
    method: "GET",
    path: "/api/v1/meta",
    auth: "public",
    origin: "none",
    csrf: "n/a",
    grant: null,
    notes: "Public profile/banner metadata including allowEvaluationHistoryClear",
  },
  {
    method: "POST",
    path: "/api/v1/auth/login",
    auth: "public",
    origin: "auth_entry",
    csrf: "exempt",
    grant: null,
    notes: "Creates session; Origin required",
  },
  {
    method: "POST",
    path: "/api/v1/auth/claim",
    auth: "public",
    origin: "auth_entry",
    csrf: "exempt",
    grant: null,
    notes: "Consumes enrollment/bootstrap claim",
  },
  {
    method: "POST",
    path: "/api/v1/auth/logout",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: null,
    notes: "Revokes session; no household broadcast",
  },
  {
    method: "GET",
    path: "/api/v1/auth/session",
    auth: "session",
    origin: "none",
    csrf: "n/a",
    grant: null,
    notes: "Returns session body + CSRF secret",
  },
  {
    method: "POST",
    path: "/api/v1/enrollment/claims",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "household.member.enroll",
    notes: "Issues/replaces one actionable enrollment claim for an existing person",
  },
  {
    method: "GET",
    path: "/api/v1/memberships",
    auth: "session",
    origin: "none",
    csrf: "n/a",
    grant: null,
    notes: "Household membership directory",
  },
  {
    method: "GET",
    path: "/api/v1/people",
    auth: "session",
    origin: "none",
    csrf: "n/a",
    grant: null,
    notes: "People directory with access-state projection and familyOrderVersion",
  },
  {
    method: "POST",
    path: "/api/v1/people",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "household.structure.manage",
    notes: "Create pending person without access; mutationId replay-safe",
  },
  {
    method: "GET",
    path: "/api/v1/people/:membershipId",
    auth: "session",
    origin: "none",
    csrf: "n/a",
    grant: null,
    notes: "Person detail including access, groups, resolved Morning Routine assignment",
  },
  {
    method: "PATCH",
    path: "/api/v1/people/:membershipId",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "household.structure.manage",
    notes:
      "Edit friendly name/classification/optional profile fields; version-guarded; does not change sort_order",
  },
  {
    method: "PUT",
    path: "/api/v1/people/order",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "household.structure.manage",
    notes:
      "Save household family order; expectedVersion + mutationId digest replay; broadcasts family_order",
  },
  {
    method: "DELETE",
    path: "/api/v1/people/:membershipId/setup",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "household.member.enroll",
    notes: "Cancel/revoke actionable enrollment setup",
  },
  {
    method: "GET",
    path: "/api/v1/groups",
    auth: "session",
    origin: "none",
    csrf: "n/a",
    grant: null,
    notes: "List live (non-deleted) household groups; includes usedByMorningRoutine",
  },
  {
    method: "POST",
    path: "/api/v1/groups",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "household.structure.manage",
    notes: "Create named group + baseline membership version; mutationId replay-safe",
  },
  {
    method: "GET",
    path: "/api/v1/groups/:groupId",
    auth: "session",
    origin: "none",
    csrf: "n/a",
    grant: null,
    notes: "Group detail with usedByMorningRoutine / routineEffectFromDate",
  },
  {
    method: "PATCH",
    path: "/api/v1/groups/:groupId",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "household.structure.manage",
    notes:
      "Rename/replace members; expectedVersion conflict; membership changes dated next household day",
  },
  {
    method: "DELETE",
    path: "/api/v1/groups/:groupId",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "household.structure.manage",
    notes:
      "Tombstone unreferenced group; CONFLICT if selected by operative/scheduled routines (archive cutoff intersected)",
  },
  {
    method: "GET",
    path: "/api/v1/school-calendar",
    auth: "session",
    origin: "none",
    csrf: "n/a",
    grant: null,
    notes: "Read household school calendar; any active member",
  },
  {
    method: "PUT",
    path: "/api/v1/school-calendar",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "household.schedule.manage",
    notes: "Save school calendar edition; version + mutationId replay",
  },
  {
    method: "GET",
    path: "/api/v1/routines",
    auth: "session",
    origin: "none",
    csrf: "n/a",
    grant: null,
    notes:
      "List household routine definitions (active by default; ?includeArchived=1 includes archived)",
  },
  {
    method: "GET",
    path: "/api/v1/routines/:definitionId",
    auth: "session",
    origin: "none",
    csrf: "n/a",
    grant: null,
    notes: "Single routine definition detail by id",
  },
  {
    method: "POST",
    path: "/api/v1/routines",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "routine.shared.manage",
    notes:
      "Create shared definition + first revision (daypart); mutationId replay-safe; multiple per household",
  },
  {
    method: "POST",
    path: "/api/v1/routines/:definitionId/revisions",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "routine.shared.manage",
    notes:
      "Current or schedule plan mutation; immutable revision content + schedule entry; range reconcile; mutationId replay-safe",
  },
  {
    method: "POST",
    path: "/api/v1/routines/:definitionId/archive",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "routine.shared.manage",
    notes:
      "Legacy prospective archive with tomorrow cutoff (end_mode=legacy_archive); mutationId replay-safe",
  },
  {
    method: "POST",
    path: "/api/v1/routines/:definitionId/end",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "routine.shared.manage",
    notes:
      "Immediate End: cancel today+ unstarted and upcoming schedule entries; keep started; mutationId replay-safe",
  },
  {
    method: "POST",
    path: "/api/v1/routines/:definitionId/delete",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "routine.shared.manage",
    notes:
      "Hard-delete unused routine graph when no started/reports/personal/proposals; keep deletion receipt",
  },
  {
    method: "POST",
    path: "/api/v1/routines/:definitionId/schedule-entries/:scheduleEntryId/move",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "routine.shared.manage",
    notes: "Move upcoming schedule entry start_date; re-reconcile vacated/new ranges",
  },
  {
    method: "POST",
    path: "/api/v1/routines/:definitionId/schedule-entries/:scheduleEntryId/delete",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "routine.shared.manage",
    notes: "Cancel upcoming schedule entry; recompose vacated interval to previous plan",
  },
  {
    method: "GET",
    path: "/api/v1/responsibilities",
    auth: "session",
    origin: "none",
    csrf: "n/a",
    grant: null,
    notes:
      "List household responsibility definitions (active by default; ?includeArchived=1 includes ended)",
  },
  {
    method: "GET",
    path: "/api/v1/responsibilities/:definitionId",
    auth: "session",
    origin: "none",
    csrf: "n/a",
    grant: null,
    notes: "Single responsibility definition detail by id; routine ids → NOT_FOUND",
  },
  {
    method: "POST",
    path: "/api/v1/responsibilities",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "responsibility.manage",
    notes:
      "Create responsibility + first revision (single assignee, base steps); mutationId replay-safe",
  },
  {
    method: "POST",
    path: "/api/v1/responsibilities/:definitionId/revisions",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "responsibility.manage",
    notes:
      "Current or schedule plan mutation; single owner; range reconcile; mutationId replay-safe",
  },
  {
    method: "POST",
    path: "/api/v1/responsibilities/:definitionId/end",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "responsibility.manage",
    notes:
      "Immediate End: cancel today+ unstarted and upcoming schedule entries; keep started",
  },
  {
    method: "POST",
    path: "/api/v1/responsibilities/:definitionId/delete",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "responsibility.manage",
    notes:
      "Hard-delete unused responsibility when no started/reports/prior-date history; keep deletion receipt",
  },
  {
    method: "POST",
    path: "/api/v1/responsibilities/:definitionId/schedule-entries/:scheduleEntryId/move",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "responsibility.manage",
    notes: "Move upcoming responsibility schedule entry start_date",
  },
  {
    method: "POST",
    path: "/api/v1/responsibilities/:definitionId/schedule-entries/:scheduleEntryId/delete",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "responsibility.manage",
    notes: "Cancel upcoming responsibility schedule entry",
  },
  {
    method: "GET",
    path: "/api/v1/responsibilities/:definitionId/preview",
    auth: "session",
    origin: "none",
    csrf: "n/a",
    grant: null,
    notes:
      "Read-only next-7-days preview; never materializes; started days show protected owner/work",
  },
  {
    method: "POST",
    path: "/api/v1/responsibilities/preview-draft",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "responsibility.manage",
    notes:
      "Read-only draft preview for unsaved assignment/addition plans; never materializes or locks",
  },
  {
    method: "GET",
    path: "/api/v1/today",
    auth: "session",
    origin: "none",
    csrf: "n/a",
    grant: null,
    notes:
      "Authoritative today occurrences (routines + responsibilities) for viewer; includes activityGeneration",
  },
  {
    method: "GET",
    path: "/api/v1/history",
    auth: "session",
    origin: "none",
    csrf: "n/a",
    grant: null,
    notes:
      "Read-only History; store requires routine.shared.manage and/or responsibility.manage per kind; optional kind filter; never materializes",
  },
  {
    method: "GET",
    path: "/api/v1/history/occurrences/:occurrenceId",
    auth: "session",
    origin: "none",
    csrf: "n/a",
    grant: null,
    notes:
      "History occurrence detail; matching kind manage grant enforced in store; foreign → NOT_FOUND",
  },
  {
    method: "POST",
    path: "/api/v1/household/activity/clear",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "household.activity.clear",
    notes:
      "Clear activity history; new requests acknowledge routines_and_responsibilities; legacy rejected when responsibility data exists; broadcasts activity_reset",
  },
  {
    method: "POST",
    path: "/api/v1/occurrences/:occurrenceId/steps/:stepId/status",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: null,
    notes:
      "Accountable checklist mutation; grant/kind from stored occurrence (routine.execute.own or responsibility.execute.own); intendedStructure for responsibilities",
  },
  {
    method: "PUT",
    path: "/api/v1/personal-layer",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "routine.personalize.direct",
    notes:
      "Prospective personal layer for self; requires routine definitionId; responsibility ids rejected",
  },
  {
    method: "GET",
    path: "/api/v1/personal-layer/preview",
    auth: "session",
    origin: "none",
    csrf: "n/a",
    grant: null,
    notes: "Composition preview for definitionId; other-member restricted in store",
  },
  {
    method: "POST",
    path: "/api/v1/proposals",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "routine.personalize.propose",
    notes: "Create pending personal addition proposal; requires definitionId",
  },
  {
    method: "GET",
    path: "/api/v1/proposals",
    auth: "session",
    origin: "none",
    csrf: "n/a",
    grant: null,
    notes: "List proposals scoped by grant",
  },
  {
    method: "POST",
    path: "/api/v1/proposals/:proposalId/decide",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "routine.proposal.decide",
    notes: "Approve/reject once; may create personal layer",
  },
  {
    method: "POST",
    path: "/api/v1/personal-tasks",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "personal_task.create",
    notes: "Create private or household-visible task for self",
  },
  {
    method: "GET",
    path: "/api/v1/personal-tasks",
    auth: "session",
    origin: "none",
    csrf: "n/a",
    grant: null,
    notes: "Owner tasks + household-visible others",
  },
  {
    method: "POST",
    path: "/api/v1/personal-tasks/:taskId/status",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: null,
    notes: "Owner-only status; idempotent mutationId",
  },
  {
    method: "GET",
    path: "/api/v1/sync",
    auth: "session",
    origin: "websocket",
    csrf: "n/a",
    grant: null,
    notes: "Household-scoped invalidation WebSocket",
  },
  {
    method: "POST",
    path: "/api/v1/test/bootstrap-claim",
    auth: "public",
    origin: "none",
    csrf: "exempt",
    grant: null,
    testOnly: true,
    notes: "Test/dev only bootstrap claim issuer",
  },
];

export function routePolicyKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

export const ROUTE_POLICY_KEYS = new Set(
  ROUTE_POLICY_INVENTORY.map((entry) => routePolicyKey(entry.method, entry.path)),
);
