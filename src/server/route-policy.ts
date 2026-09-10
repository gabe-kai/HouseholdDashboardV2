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
    notes: "Public profile/banner metadata",
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
    notes: "Issues single-use enrollment claim",
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
    path: "/api/v1/routines",
    auth: "session",
    origin: "none",
    csrf: "n/a",
    grant: null,
    notes: "Shared Morning Routine definition",
  },
  {
    method: "POST",
    path: "/api/v1/routines",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "routine.shared.manage",
    notes: "Create shared definition + first revision",
  },
  {
    method: "POST",
    path: "/api/v1/routines/:definitionId/revisions",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "routine.shared.manage",
    notes: "Append prospective shared revision",
  },
  {
    method: "GET",
    path: "/api/v1/today",
    auth: "session",
    origin: "none",
    csrf: "n/a",
    grant: null,
    notes: "Authoritative today occurrences for viewer",
  },
  {
    method: "GET",
    path: "/api/v1/history",
    auth: "session",
    origin: "none",
    csrf: "n/a",
    grant: "routine.shared.manage",
    notes: "Household occurrence history",
  },
  {
    method: "POST",
    path: "/api/v1/occurrences/:occurrenceId/steps/:stepId/status",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "routine.execute.own",
    notes: "Accountable member checklist mutation; idempotent mutationId",
  },
  {
    method: "PUT",
    path: "/api/v1/personal-layer",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "routine.personalize.direct",
    notes: "Prospective personal layer for self",
  },
  {
    method: "GET",
    path: "/api/v1/personal-layer/preview",
    auth: "session",
    origin: "none",
    csrf: "n/a",
    grant: null,
    notes: "Composition preview; other-member restricted in store",
  },
  {
    method: "POST",
    path: "/api/v1/proposals",
    auth: "session",
    origin: "mutation_when_configured",
    csrf: "required",
    grant: "routine.personalize.propose",
    notes: "Create pending personal addition proposal",
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
