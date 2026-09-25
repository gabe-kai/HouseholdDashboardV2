import fs from "node:fs";
import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, {
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { nowUtcIso } from "../domain/time.js";
import {
  ArchiveRoutineSchema,
  ClaimSchema,
  ClearRoutineActivitySchema,
  CreateGroupSchema,
  ClaimDisplaySchema,
  CreateDisplaySchema,
  CreatePersonSchema,
  DisplayConfigCommandSchema,
  CreatePersonalTaskSchema,
  CreateProposalSchema,
  CreateResponsibilityRevisionSchema,
  CreateResponsibilitySchema,
  CreateRevisionSchema,
  CreateRoutineSchema,
  DeleteResponsibilitySchema,
  DeleteRoutineSchema,
  DeleteScheduleEntrySchema,
  DecideProposalSchema,
  EndResponsibilitySchema,
  EndRoutineSchema,
  HouseholdDateSchema,
  IssueEnrollmentSchema,
  LoginSchema,
  MoveScheduleEntrySchema,
  SaveFamilyOrderSchema,
  SavePersonalLayerSchema,
  SaveSchoolCalendarSchema,
  SetPersonalTaskStatusSchema,
  SetStepStatusSchema,
  UpdateGroupSchema,
  UpdatePersonSchema,
  UuidSchema,
  WorkKindSchema,
} from "../shared/schemas.js";
import type { AppConfig } from "./config.js";
import { digestEquals, sha256Hex } from "./crypto.js";
import { DisplayStore, type DisplayContext } from "./display.js";
import { migrate, openDatabase, resolveDbPath } from "./db.js";
import { originMatchesConfig } from "./origin.js";
import { AppStore, type AuthContext } from "./store.js";
import { SyncHub } from "./sync-hub.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_EXEMPT = new Set([
  "/api/v1/auth/login",
  "/api/v1/auth/claim",
  "/api/v1/health",
  "/api/v1/meta",
  "/api/v1/test/bootstrap-claim",
  "/api/v1/display/claim",
]);
/** CSRF-exempt auth entry points still require an allowed Origin. */
const AUTH_ORIGIN_REQUIRED = new Set([
  "/api/v1/auth/login",
  "/api/v1/auth/claim",
  "/api/v1/display/claim",
]);

function errorBody(
  code: string,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
) {
  return details && Object.keys(details).length > 0
    ? { code, message, requestId, ...details }
    : { code, message, requestId };
}

function statusForCode(code: string): number {
  switch (code) {
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
    case "CSRF":
    case "ORIGIN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "THROTTLED":
      return 429;
    case "VALIDATION":
      return 400;
    default:
      return 500;
  }
}

export async function buildApp(
  config: AppConfig,
  options?: {
    onRoute?: (routeOptions: { method: string | string[]; url?: string }) => void;
  },
) {
  const db = openDatabase(resolveDbPath(config.dbPath));
  migrate(db);
  const store = new AppStore(db);
  if (config.autoSeed) store.seed(config.householdTimezone);
  const displayStore = new DisplayStore(db, store);
  const sync = new SyncHub();
  const requestSessions = new WeakMap<object, AuthContext>();
  const requestDisplays = new WeakMap<object, DisplayContext>();

  const app = Fastify({
    logger: {
      level: "info",
      redact: {
        paths: [
          "req.headers.cookie",
          "req.headers.authorization",
          "req.headers['x-csrf-token']",
          "res.headers['set-cookie']",
        ],
        censor: "[REDACTED]",
      },
    },
    genReqId: () => randomUUID(),
    bodyLimit: 64 * 1024,
    trustProxy: config.trustedProxy,
  });

  if (options?.onRoute) {
    app.addHook("onRoute", options.onRoute);
  }

  await app.register(cookie);
  await app.register(websocket);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, {
    global: true,
    max: config.profile === "test" ? 10_000 : 120,
    timeWindow: "1 minute",
  });

  function sessionFromRequest(request: FastifyRequest): AuthContext | null {
    const cached = requestSessions.get(request);
    if (cached) return cached;
    const rawToken = request.cookies[config.cookieName];
    if (!rawToken) return null;
    const session = store.getSessionByTokenDigest(sha256Hex(rawToken));
    if (session) requestSessions.set(request, session);
    return session;
  }

  function requireSession(
    request: FastifyRequest,
    reply: FastifyReply,
  ): AuthContext | null {
    const session = sessionFromRequest(request);
    if (session) return session;
    void reply
      .code(401)
      .send(errorBody("UNAUTHORIZED", "Authentication required", request.id));
    return null;
  }

  function originAllowed(request: FastifyRequest): boolean {
    return originMatchesConfig(
      request.headers.origin,
      config.publicOrigin,
      config.allowLan,
    );
  }

  function setSessionCookie(reply: FastifyReply, token: string): void {
    reply.setCookie(config.cookieName, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: config.cookieSecure,
      path: "/",
    });
  }

  function clearSessionCookie(reply: FastifyReply): void {
    reply.clearCookie(config.cookieName, {
      httpOnly: true,
      sameSite: "strict",
      secure: config.cookieSecure,
      path: "/",
    });
  }

  function displayFromRequest(request: FastifyRequest): DisplayContext | null {
    const cached = requestDisplays.get(request);
    if (cached) return cached;
    const rawToken = request.cookies[config.displayCookieName];
    if (!rawToken) return null;
    const session = displayStore.getDisplaySessionByTokenDigest(sha256Hex(rawToken));
    if (session) requestDisplays.set(request, session);
    return session;
  }

  function requireDisplay(
    request: FastifyRequest,
    reply: FastifyReply,
  ): DisplayContext | null {
    const session = displayFromRequest(request);
    if (session) {
      reply.header("Cache-Control", "no-store");
      return session;
    }
    if (request.cookies[config.displayCookieName]) {
      clearDisplayCookie(reply);
    }
    void reply
      .code(401)
      .send(errorBody("UNAUTHORIZED", "Display authentication required", request.id));
    return null;
  }

  function setDisplayCookie(
    reply: FastifyReply,
    token: string,
    maxAge: number,
  ): void {
    reply.setCookie(config.displayCookieName, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: config.cookieSecure,
      path: "/",
      maxAge,
    });
  }

  function clearDisplayCookie(reply: FastifyReply): void {
    reply.clearCookie(config.displayCookieName, {
      httpOnly: true,
      sameSite: "strict",
      secure: config.cookieSecure,
      path: "/",
    });
  }

  function displayInvalidate(
    householdId: string,
    reason: "work" | "people" | "reset" | "schedule" | "tasks",
  ): void {
    sync.broadcastDisplay(householdId, {
      type: "display_invalidate",
      householdId,
      reason,
      at: nowUtcIso(),
    });
  }


  function sessionBody(session: AuthContext, csrfToken: string) {
    return {
      member: {
        id: session.membershipId,
        displayName: session.displayName,
      },
      grants: session.grants,
      csrfToken,
      householdTimezone: session.timezone,
      householdDate: store.householdDateNow(session),
      activityGeneration: store.getActivityGeneration(session.householdId),
    };
  }

  function broadcast(
    session: AuthContext,
    resource:
      | "occurrence"
      | "routine"
      | "responsibility"
      | "proposal"
      | "personal_task"
      | "membership"
      | "group"
      | "school_calendar"
      | "family_order"
      | "activity_reset",
    resourceId: string,
    version?: number,
  ): void {
    sync.broadcast({
      type: "household_change",
      householdId: session.householdId,
      resource,
      resourceId,
      ...(version === undefined ? {} : { version }),
      at: nowUtcIso(),
    });
    if (resource === "personal_task") {
      if (displayStore.isHouseholdVisibleTask(resourceId, session.householdId)) {
        displayInvalidate(session.householdId, "tasks");
      }
      return;
    }
    if (resource === "activity_reset") {
      displayInvalidate(session.householdId, "reset");
      return;
    }
    if (
      resource === "membership" ||
      resource === "group" ||
      resource === "family_order"
    ) {
      displayInvalidate(session.householdId, "people");
      return;
    }
    if (resource === "school_calendar") {
      displayInvalidate(session.householdId, "schedule");
      return;
    }
    displayInvalidate(session.householdId, "work");
  }

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Request-Id", request.id);
    return payload;
  });

  app.addHook("preHandler", async (request, reply) => {
    const routePath = request.routeOptions.url;
    if (!routePath) return;
    if (!UNSAFE_METHODS.has(request.method)) return;

    if (AUTH_ORIGIN_REQUIRED.has(routePath)) {
      if (!originAllowed(request)) {
        return reply
          .code(403)
          .send(errorBody("ORIGIN", "Request origin is not allowed", request.id));
      }
      return;
    }

    if (CSRF_EXEMPT.has(routePath)) return;

    const session = requireSession(request, reply);
    if (!session) return reply;
    if (config.publicOrigin && !originAllowed(request)) {
      return reply
        .code(403)
        .send(errorBody("ORIGIN", "Request origin is not allowed", request.id));
    }

    const token = request.headers["x-csrf-token"];
    const tokenMatches =
      typeof token === "string" &&
      digestEquals(sha256Hex(token), sha256Hex(session.csrfSecret));
    if (!tokenMatches) {
      return reply
        .code(403)
        .send(errorBody("CSRF", "CSRF token is invalid", request.id));
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (reply.sent) return;
    return sendStoreError(reply, request.id, error);
  });

  app.get("/api/v1/health", async () => ({
    ok: true,
    evaluationMode: false,
  }));

  app.get("/api/v1/meta", async () => ({
    evaluationMode: false,
    banner:
      config.profile === "hosted"
        ? "Authentication is required. Use your household account to continue."
        : "LOCAL DEVELOPMENT — authentication is enabled; seeded accounts must still be claimed.",
    profile: config.profile,
    allowEvaluationHistoryClear: config.allowEvaluationHistoryClear,
  }));

  const authRateLimit =
    config.profile === "test"
      ? { max: 1_000, timeWindow: "1 minute" as const }
      : { max: 10, timeWindow: "1 minute" as const };
  const claimRateLimit =
    config.profile === "test"
      ? { max: 1_000, timeWindow: "1 minute" as const }
      : { max: 5, timeWindow: "1 minute" as const };

  app.post(
    "/api/v1/auth/login",
    { config: { rateLimit: authRateLimit } },
    async (request, reply) => {
      const parsed = LoginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(errorBody("VALIDATION", "Invalid login payload", request.id));
      }
      const result = await store.login(parsed.data.loginName, parsed.data.passphrase);
      if ("error" in result) {
        if (result.error === "throttled") {
          const retryAfter = result.retryAfterSec ?? 60;
          reply.header("Retry-After", retryAfter);
          return reply
            .code(429)
            .send(errorBody("THROTTLED", "Authentication temporarily unavailable", request.id));
        }
        return reply
          .code(401)
          .send(errorBody("UNAUTHORIZED", "Invalid login or passphrase", request.id));
      }
      setSessionCookie(reply, result.token);
      return sessionBody(result.context, result.csrfSecret);
    },
  );

  app.post(
    "/api/v1/auth/claim",
    { config: { rateLimit: claimRateLimit } },
    async (request, reply) => {
      const parsed = ClaimSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(errorBody("VALIDATION", "Invalid claim payload", request.id));
      }
      const result = await store.claim(parsed.data);
      setSessionCookie(reply, result.token);
      broadcast(result.context, "membership", result.context.membershipId);
      return sessionBody(result.context, result.csrfSecret);
    },
  );

  app.post("/api/v1/auth/logout", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    store.revokeSession(session.sessionId);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/api/v1/auth/session", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return sessionBody(session, session.csrfSecret);
  });

  app.post("/api/v1/enrollment/claims", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const parsed = IssueEnrollmentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid enrollment claim", request.id));
    }
    const claim = store.issueEnrollmentClaim(session, parsed.data);
    broadcast(session, "membership", claim.membershipId);
    return { claim };
  });

  app.get("/api/v1/memberships", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return { memberships: store.listMemberships(session.householdId) };
  });

  app.get("/api/v1/people", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return {
      people: store.listMemberships(session.householdId),
      familyOrderVersion: store.getFamilyOrderVersion(session.householdId),
    };
  });

  app.post("/api/v1/people", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const parsed = CreatePersonSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid person", request.id));
    }
    const person = store.createPerson(session, parsed.data);
    broadcast(session, "membership", person.id, person.version);
    // createPerson appends sort_order and bumps family_order_version — keep order
    // subscribers coherent with membership refreshes under shared e2e DBs.
    broadcast(
      session,
      "family_order",
      session.householdId,
      store.getFamilyOrderVersion(session.householdId),
    );
    return { person };
  });

  app.get("/api/v1/people/:membershipId", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const membershipId = (request.params as { membershipId: string }).membershipId;
    if (!UuidSchema.safeParse(membershipId).success) {
      return reply.code(400).send(errorBody("VALIDATION", "Invalid person id", request.id));
    }
    return { person: store.getPersonDetail(session, membershipId) };
  });

  app.patch("/api/v1/people/:membershipId", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const membershipId = (request.params as { membershipId: string }).membershipId;
    if (!UuidSchema.safeParse(membershipId).success) {
      return reply.code(400).send(errorBody("VALIDATION", "Invalid person id", request.id));
    }
    const parsed = UpdatePersonSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid person update", request.id));
    }
    const person = store.updatePerson(session, membershipId, parsed.data);
    broadcast(session, "membership", person.id, person.version);
    return { person };
  });

  app.put("/api/v1/people/order", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const parsed = SaveFamilyOrderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid family order", request.id));
    }
    const result = store.saveFamilyOrder(session, parsed.data);
    broadcast(session, "family_order", session.householdId, result.version);
    return result;
  });

  app.delete("/api/v1/people/:membershipId/setup", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const membershipId = (request.params as { membershipId: string }).membershipId;
    if (!UuidSchema.safeParse(membershipId).success) {
      return reply.code(400).send(errorBody("VALIDATION", "Invalid person id", request.id));
    }
    const result = store.cancelEnrollmentSetup(session, membershipId);
    broadcast(session, "membership", result.membershipId);
    return result;
  });

  app.get("/api/v1/groups", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return { groups: store.listGroups(session.householdId) };
  });

  app.post("/api/v1/groups", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const parsed = CreateGroupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid group", request.id));
    }
    const group = store.createGroup(session, parsed.data);
    broadcast(session, "group", group.id, group.version);
    return { group };
  });

  app.get("/api/v1/groups/:groupId", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const groupId = (request.params as { groupId: string }).groupId;
    if (!UuidSchema.safeParse(groupId).success) {
      return reply.code(400).send(errorBody("VALIDATION", "Invalid group id", request.id));
    }
    return { group: store.getGroup(session.householdId, groupId) };
  });

  app.patch("/api/v1/groups/:groupId", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const groupId = (request.params as { groupId: string }).groupId;
    if (!UuidSchema.safeParse(groupId).success) {
      return reply.code(400).send(errorBody("VALIDATION", "Invalid group id", request.id));
    }
    const parsed = UpdateGroupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid group update", request.id));
    }
    const group = store.updateGroup(session, groupId, parsed.data);
    broadcast(session, "group", group.id, group.version);
    return { group };
  });

  app.delete("/api/v1/groups/:groupId", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const groupId = (request.params as { groupId: string }).groupId;
    if (!UuidSchema.safeParse(groupId).success) {
      return reply.code(400).send(errorBody("VALIDATION", "Invalid group id", request.id));
    }
    const result = store.deleteGroup(session, groupId);
    broadcast(session, "group", groupId);
    return result;
  });

  app.get("/api/v1/routines", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const query = request.query as { includeArchived?: string };
    const includeArchived =
      query.includeArchived === "1" || query.includeArchived === "true";
    return {
      routines: store.listRoutines(session.householdId, { includeArchived }),
    };
  });

  app.get("/api/v1/routines/:definitionId", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { definitionId } = request.params as { definitionId: string };
    if (!UuidSchema.safeParse(definitionId).success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid routine id", request.id));
    }
    return {
      routine: store.getRoutineById(session.householdId, definitionId),
    };
  });

  app.post("/api/v1/routines", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const parsed = CreateRoutineSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid routine", request.id));
    }
    const routine = store.createRoutine(session, parsed.data);
    broadcast(session, "routine", routine.id);
    return { routine };
  });

  app.post("/api/v1/routines/:definitionId/revisions", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { definitionId } = request.params as { definitionId: string };
    if (!UuidSchema.safeParse(definitionId).success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid routine id", request.id));
    }
    const parsed = CreateRevisionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid revision", request.id));
    }
    const result = store.createRevision(session, definitionId, parsed.data);
    broadcast(session, "routine", definitionId);
    return result;
  });

  app.post("/api/v1/routines/:definitionId/archive", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { definitionId } = request.params as { definitionId: string };
    if (!UuidSchema.safeParse(definitionId).success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid routine id", request.id));
    }
    const parsed = ArchiveRoutineSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid archive request", request.id));
    }
    const routine = store.archiveRoutine(session, definitionId, parsed.data);
    broadcast(session, "routine", definitionId);
    return { routine };
  });

  app.post("/api/v1/routines/:definitionId/end", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { definitionId } = request.params as { definitionId: string };
    if (!UuidSchema.safeParse(definitionId).success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid routine id", request.id));
    }
    const parsed = EndRoutineSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid end request", request.id));
    }
    const result = store.endRoutine(session, definitionId, parsed.data);
    broadcast(session, "routine", definitionId);
    return result;
  });

  app.post("/api/v1/routines/:definitionId/delete", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { definitionId } = request.params as { definitionId: string };
    if (!UuidSchema.safeParse(definitionId).success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid routine id", request.id));
    }
    const parsed = DeleteRoutineSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid delete request", request.id));
    }
    const result = store.deleteRoutine(session, definitionId, parsed.data);
    broadcast(session, "routine", definitionId);
    return result;
  });

  app.post(
    "/api/v1/routines/:definitionId/schedule-entries/:scheduleEntryId/move",
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return;
      const { definitionId, scheduleEntryId } = request.params as {
        definitionId: string;
        scheduleEntryId: string;
      };
      if (
        !UuidSchema.safeParse(definitionId).success ||
        !UuidSchema.safeParse(scheduleEntryId).success
      ) {
        return reply
          .code(400)
          .send(errorBody("VALIDATION", "Invalid id", request.id));
      }
      const parsed = MoveScheduleEntrySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(errorBody("VALIDATION", "Invalid move request", request.id));
      }
      const result = store.moveScheduleEntry(
        session,
        definitionId,
        scheduleEntryId,
        parsed.data,
      );
      broadcast(session, "routine", definitionId);
      return result;
    },
  );

  app.post(
    "/api/v1/routines/:definitionId/schedule-entries/:scheduleEntryId/delete",
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return;
      const { definitionId, scheduleEntryId } = request.params as {
        definitionId: string;
        scheduleEntryId: string;
      };
      if (
        !UuidSchema.safeParse(definitionId).success ||
        !UuidSchema.safeParse(scheduleEntryId).success
      ) {
        return reply
          .code(400)
          .send(errorBody("VALIDATION", "Invalid id", request.id));
      }
      const parsed = DeleteScheduleEntrySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(errorBody("VALIDATION", "Invalid delete request", request.id));
      }
      const result = store.deleteScheduleEntry(
        session,
        definitionId,
        scheduleEntryId,
        parsed.data,
      );
      broadcast(session, "routine", definitionId);
      return result;
    },
  );

  app.get("/api/v1/responsibilities", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const query = request.query as { includeArchived?: string };
    const includeArchived =
      query.includeArchived === "1" || query.includeArchived === "true";
    return {
      responsibilities: store.listResponsibilities(session.householdId, {
        includeArchived,
      }),
    };
  });

  app.get("/api/v1/responsibilities/:definitionId", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { definitionId } = request.params as { definitionId: string };
    if (!UuidSchema.safeParse(definitionId).success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid responsibility id", request.id));
    }
    return {
      responsibility: store.getResponsibilityById(session.householdId, definitionId),
    };
  });

  app.post("/api/v1/responsibilities", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const parsed = CreateResponsibilitySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid responsibility", request.id));
    }
    const responsibility = store.createResponsibility(session, parsed.data);
    broadcast(session, "responsibility", responsibility.id);
    return { responsibility };
  });

  app.post(
    "/api/v1/responsibilities/:definitionId/revisions",
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return;
      const { definitionId } = request.params as { definitionId: string };
      if (!UuidSchema.safeParse(definitionId).success) {
        return reply
          .code(400)
          .send(errorBody("VALIDATION", "Invalid responsibility id", request.id));
      }
      const parsed = CreateResponsibilityRevisionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(errorBody("VALIDATION", "Invalid revision", request.id));
      }
      const result = store.createResponsibilityRevision(
        session,
        definitionId,
        parsed.data,
      );
      broadcast(session, "responsibility", definitionId);
      return result;
    },
  );

  app.post("/api/v1/responsibilities/:definitionId/end", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { definitionId } = request.params as { definitionId: string };
    if (!UuidSchema.safeParse(definitionId).success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid responsibility id", request.id));
    }
    const parsed = EndResponsibilitySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid end request", request.id));
    }
    const result = store.endResponsibility(session, definitionId, parsed.data);
    broadcast(session, "responsibility", definitionId);
    return result;
  });

  app.post(
    "/api/v1/responsibilities/:definitionId/delete",
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return;
      const { definitionId } = request.params as { definitionId: string };
      if (!UuidSchema.safeParse(definitionId).success) {
        return reply
          .code(400)
          .send(errorBody("VALIDATION", "Invalid responsibility id", request.id));
      }
      const parsed = DeleteResponsibilitySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(errorBody("VALIDATION", "Invalid delete request", request.id));
      }
      const result = store.deleteResponsibility(session, definitionId, parsed.data);
      broadcast(session, "responsibility", definitionId);
      return result;
    },
  );

  app.post(
    "/api/v1/responsibilities/:definitionId/schedule-entries/:scheduleEntryId/move",
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return;
      const { definitionId, scheduleEntryId } = request.params as {
        definitionId: string;
        scheduleEntryId: string;
      };
      if (
        !UuidSchema.safeParse(definitionId).success ||
        !UuidSchema.safeParse(scheduleEntryId).success
      ) {
        return reply
          .code(400)
          .send(errorBody("VALIDATION", "Invalid id", request.id));
      }
      const parsed = MoveScheduleEntrySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(errorBody("VALIDATION", "Invalid move request", request.id));
      }
      const result = store.moveResponsibilityScheduleEntry(
        session,
        definitionId,
        scheduleEntryId,
        parsed.data,
      );
      broadcast(session, "responsibility", definitionId);
      return result;
    },
  );

  app.post(
    "/api/v1/responsibilities/:definitionId/schedule-entries/:scheduleEntryId/delete",
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return;
      const { definitionId, scheduleEntryId } = request.params as {
        definitionId: string;
        scheduleEntryId: string;
      };
      if (
        !UuidSchema.safeParse(definitionId).success ||
        !UuidSchema.safeParse(scheduleEntryId).success
      ) {
        return reply
          .code(400)
          .send(errorBody("VALIDATION", "Invalid id", request.id));
      }
      const parsed = DeleteScheduleEntrySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(errorBody("VALIDATION", "Invalid delete request", request.id));
      }
      const result = store.deleteResponsibilityScheduleEntry(
        session,
        definitionId,
        scheduleEntryId,
        parsed.data,
      );
      broadcast(session, "responsibility", definitionId);
      return result;
    },
  );

  app.post("/api/v1/responsibilities/preview-draft", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const parsed = CreateResponsibilitySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid responsibility draft", request.id));
    }
    return {
      preview: store.previewDraftResponsibility(session, parsed.data, 7),
    };
  });

  app.get(
    "/api/v1/responsibilities/:definitionId/preview",
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return;
      const { definitionId } = request.params as { definitionId: string };
      if (!UuidSchema.safeParse(definitionId).success) {
        return reply
          .code(400)
          .send(errorBody("VALIDATION", "Invalid responsibility id", request.id));
      }
      return {
        preview: store.previewResponsibilityNextDays(session, definitionId, 7),
      };
    },
  );

  app.get("/api/v1/today", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const query = request.query as { date?: string };
    let date = store.householdDateNow(session);
    if (query.date) {
      const parsed = HouseholdDateSchema.safeParse(query.date);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(errorBody("VALIDATION", "Invalid date", request.id));
      }
      date = parsed.data;
    }
    return {
      householdDate: date,
      householdTimezone: session.timezone,
      activityGeneration: store.getActivityGeneration(session.householdId),
      occurrences: store.materializeForDate(session, date),
    };
  });

  app.get("/api/v1/history", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const query = request.query as {
      date?: string;
      from?: string;
      to?: string;
      personId?: string;
      routineId?: string;
      status?: string;
      kind?: string;
      workKind?: string;
    };
    if (query.personId && !UuidSchema.safeParse(query.personId).success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid person filter", request.id));
    }
    if (query.routineId && !UuidSchema.safeParse(query.routineId).success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid routine filter", request.id));
    }
    if (
      query.status !== undefined &&
      query.status !== "complete" &&
      query.status !== "incomplete"
    ) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid status filter", request.id));
    }
    const kindRaw = query.kind ?? query.workKind;
    let kind: "routine" | "responsibility" | undefined;
    if (kindRaw !== undefined) {
      const parsedKind = WorkKindSchema.safeParse(kindRaw);
      if (!parsedKind.success) {
        return reply
          .code(400)
          .send(errorBody("VALIDATION", "Invalid work kind filter", request.id));
      }
      kind = parsedKind.data;
    }
    return store.historySummaries(session, {
      date: query.date,
      from: query.from,
      to: query.to,
      personId: query.personId,
      routineId: query.routineId,
      status: query.status as "complete" | "incomplete" | undefined,
      kind,
    });
  });

  app.get("/api/v1/history/occurrences/:occurrenceId", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const occurrenceId = (request.params as { occurrenceId: string }).occurrenceId;
    if (!UuidSchema.safeParse(occurrenceId).success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid occurrence id", request.id));
    }
    return {
      occurrence: store.getHistoryOccurrenceDetail(session, occurrenceId),
      activityGeneration: store.getActivityGeneration(session.householdId),
    };
  });

  app.post("/api/v1/household/activity/clear", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    if (!config.allowEvaluationHistoryClear) {
      return reply
        .code(403)
        .send(
          errorBody(
            "FORBIDDEN",
            "Evaluation history clear is disabled",
            request.id,
          ),
        );
    }
    const parsed = ClearRoutineActivitySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid activity clear request", request.id));
    }
    const result = store.clearRoutineActivity(session, parsed.data);
    broadcast(
      session,
      "activity_reset",
      session.householdId,
      result.activityGeneration,
    );
    return result;
  });

  app.get("/api/v1/school-calendar", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return { calendar: store.getSchoolCalendar(session) };
  });

  app.put(
    "/api/v1/school-calendar",
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return;
      const parsed = SaveSchoolCalendarSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(errorBody("VALIDATION", "Invalid school calendar", request.id));
      }
      const calendar = store.saveSchoolCalendar(session, parsed.data);
      broadcast(session, "school_calendar", session.householdId, calendar.version);
      return { calendar };
    },
  );

  app.post(
    "/api/v1/occurrences/:occurrenceId/steps/:stepId/status",
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return;
      const params = request.params as { occurrenceId: string; stepId: string };
      const parsed = SetStepStatusSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(errorBody("VALIDATION", "Invalid status payload", request.id));
      }

      const delayMs = Number(request.headers["x-mutation-delay-ms"] ?? 0);
      if (config.profile !== "hosted" && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 10_000)));
      }

      const result = store.setStepStatus(
        session,
        params.occurrenceId,
        params.stepId,
        parsed.data,
      );
      broadcast(
        session,
        "occurrence",
        params.occurrenceId,
        result.occurrence.version,
      );
      return result;
    },
  );

  app.put("/api/v1/personal-layer", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const parsed = SavePersonalLayerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid personal layer", request.id));
    }
    const layer = store.savePersonalLayer(session, parsed.data);
    broadcast(session, "routine", layer.definitionId);
    return { layer };
  });

  app.get("/api/v1/personal-layer/preview", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const query = request.query as {
      membershipId?: string;
      date?: string;
      definitionId?: string;
    };
    const membershipId = query.membershipId ?? session.membershipId;
    const definitionId = query.definitionId;
    if (!definitionId || !UuidSchema.safeParse(definitionId).success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "definitionId is required", request.id));
    }
    const parsedDate = HouseholdDateSchema.safeParse(
      query.date ?? store.householdDateNow(session),
    );
    if (!parsedDate.success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid preview date", request.id));
    }
    return {
      preview: store.previewComposition(
        session,
        membershipId,
        definitionId,
        parsedDate.data,
      ),
    };
  });

  app.post("/api/v1/proposals", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const parsed = CreateProposalSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid proposal", request.id));
    }
    const proposal = store.createProposal(session, parsed.data);
    broadcast(session, "proposal", proposal.id);
    return { proposal };
  });

  app.get("/api/v1/proposals", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return { proposals: store.listProposals(session) };
  });

  app.post("/api/v1/proposals/:proposalId/decide", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { proposalId } = request.params as { proposalId: string };
    const parsed = DecideProposalSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid proposal decision", request.id));
    }
    const proposal = store.decideProposal(session, proposalId, parsed.data);
    broadcast(session, "proposal", proposal.id);
    if (proposal.personalRevisionId) {
      broadcast(session, "routine", proposal.personalRevisionId);
    }
    return { proposal };
  });

  app.post("/api/v1/personal-tasks", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const parsed = CreatePersonalTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid personal task", request.id));
    }
    const task = store.createTask(session, parsed.data);
    broadcast(session, "personal_task", task.id);
    return { task };
  });

  app.get("/api/v1/personal-tasks", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return { tasks: store.listTasks(session) };
  });

  app.post("/api/v1/personal-tasks/:taskId/status", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { taskId } = request.params as { taskId: string };
    const parsed = SetPersonalTaskStatusSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid task status", request.id));
    }
    const task = store.setTaskStatus(session, taskId, parsed.data);
    broadcast(session, "personal_task", task!.id);
    return { task };
  });


  app.get("/api/v1/displays", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return { displays: displayStore.listDisplays(session) };
  });

  app.post("/api/v1/displays", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const parsed = CreateDisplaySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid display create payload", request.id));
    }
    const result = displayStore.createDisplay(session, parsed.data);
    displayInvalidate(session.householdId, "people");
    return result;
  });

  app.post("/api/v1/displays/:displayId/enrollment", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { displayId } = request.params as { displayId: string };
    const parsed = DisplayConfigCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid enrollment payload", request.id));
    }
    return displayStore.issueEnrollment(session, displayId, parsed.data);
  });

  app.post("/api/v1/displays/:displayId/enrollment/cancel", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { displayId } = request.params as { displayId: string };
    const parsed = DisplayConfigCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid enrollment cancel payload", request.id));
    }
    return displayStore.cancelEnrollment(session, displayId, parsed.data);
  });

  app.post("/api/v1/displays/:displayId/revoke", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { displayId } = request.params as { displayId: string };
    const parsed = DisplayConfigCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid revoke payload", request.id));
    }
    const result = displayStore.revokeDisplay(session, displayId, parsed.data);
    sync.closeDisplay(displayId);
    displayInvalidate(session.householdId, "people");
    return result;
  });

  app.post(
    "/api/v1/display/claim",
    { config: { rateLimit: claimRateLimit } },
    async (request, reply) => {
      if (sessionFromRequest(request)) {
        return reply.code(409).send(
          errorBody(
            "CONFLICT",
            "Sign out of your household account or use a separate browser/profile before setting up a display",
            request.id,
          ),
        );
      }
      const parsed = ClaimDisplaySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(errorBody("VALIDATION", "Invalid display claim payload", request.id));
      }
      const existing = displayFromRequest(request);
      const result = displayStore.claimDisplayCode(parsed.data.code, {
        existingDisplayId: existing?.displayId ?? null,
      });
      if (existing && existing.displayId === result.context.displayId) {
        sync.closeDisplaySession(existing.sessionId);
      } else if (existing) {
        // claimDisplayCode already rejected cross-display; defensive
        sync.closeDisplay(result.context.displayId);
      }
      setDisplayCookie(
        reply,
        result.token,
        displayStore.sessionCookieMaxAge(result.context),
      );
      reply.header("Cache-Control", "no-store");
      return {
        displayId: result.context.displayId,
        label: result.context.label,
        householdId: result.context.householdId,
        timezone: result.context.timezone,
        absoluteExpiresAt: result.context.absoluteExpiresAt,
      };
    },
  );

  app.get("/api/v1/display/session", async (request, reply) => {
    const display = requireDisplay(request, reply);
    if (!display) return;
    return { session: displayStore.getDisplaySessionInfo(display) };
  });

  app.get("/api/v1/display/dashboard", async (request, reply) => {
    const display = requireDisplay(request, reply);
    if (!display) return;
    return { dashboard: displayStore.getDisplayDashboard(display) };
  });

  app.get("/api/v1/display/people/:membershipId", async (request, reply) => {
    const display = requireDisplay(request, reply);
    if (!display) return;
    const { membershipId } = request.params as { membershipId: string };
    if (!UuidSchema.safeParse(membershipId).success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid membership id", request.id));
    }
    return { person: displayStore.getDisplayPersonDetail(display, membershipId) };
  });

  app.get("/api/v1/display/occurrences/:occurrenceId", async (request, reply) => {
    const display = requireDisplay(request, reply);
    if (!display) return;
    const { occurrenceId } = request.params as { occurrenceId: string };
    if (!UuidSchema.safeParse(occurrenceId).success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid occurrence id", request.id));
    }
    return {
      occurrence: displayStore.getDisplayOccurrenceDetail(display, occurrenceId),
    };
  });

  app.get("/api/v1/display/sync", { websocket: true }, (socket, request) => {
    if (!originAllowed(request)) {
      socket.close(4403, "origin rejected");
      return;
    }
    const display = displayFromRequest(request);
    if (!display) {
      socket.close(4401, "unauthorized");
      return;
    }
    sync.addDisplay(
      {
        householdId: display.householdId,
        displayId: display.displayId,
        sessionId: display.sessionId,
      },
      socket,
    );
    const revalidate = setInterval(() => {
      const still = displayStore.getDisplaySessionByTokenDigest(
        sha256Hex(request.cookies[config.displayCookieName] ?? ""),
      );
      if (!still || still.sessionId !== display.sessionId) {
        try {
          socket.send(
            JSON.stringify({
              type: "display_invalidate",
              householdId: display.householdId,
              reason: "access_lost",
              at: nowUtcIso(),
            }),
          );
          socket.close(4401, "revoked");
        } catch {
          // closed
        }
        clearInterval(revalidate);
      }
    }, 30_000);
    if (typeof revalidate.unref === "function") revalidate.unref();
    socket.on("close", () => clearInterval(revalidate));
    socket.send(
      JSON.stringify({
        type: "display_invalidate",
        householdId: display.householdId,
        reason: "work",
        at: nowUtcIso(),
      }),
    );
  });

  app.get("/api/v1/sync", { websocket: true }, (socket, request) => {
    if (!originAllowed(request)) {
      socket.close(4403, "origin rejected");
      return;
    }
    const session = sessionFromRequest(request);
    if (!session) {
      socket.close(4401, "unauthorized");
      return;
    }
    sync.add(session.householdId, socket);
    socket.send(
      JSON.stringify({
        type: "household_change",
        householdId: session.householdId,
        resource: "routine",
        resourceId: "connected",
        at: nowUtcIso(),
      }),
    );
  });

  if (config.profile === "development" || config.profile === "test") {
    app.post("/api/v1/test/bootstrap-claim", async (request, reply) => {
      try {
        const issued = store.issueBootstrapClaim(config.householdTimezone);
        return { token: issued.token, expiresAt: issued.expiresAt };
      } catch (err) {
        return sendStoreError(reply, request.id, err);
      }
    });
  }

  if (fs.existsSync(config.clientDist)) {
    await app.register(fastifyStatic, {
      root: config.clientDist,
      wildcard: false,
    });
  }

  app.setNotFoundHandler((request, reply) => {
    if (
      fs.existsSync(config.clientDist) &&
      request.method === "GET" &&
      !request.url.startsWith("/api/")
    ) {
      return reply.sendFile("index.html");
    }
    return reply
      .code(404)
      .send(errorBody("NOT_FOUND", "Not found", request.id));
  });

  app.addHook("onClose", async () => {
    sync.close();
    db.close();
  });

  return { app, store, db, sync, config };
}

function sendStoreError(
  reply: FastifyReply,
  requestId: string,
  error: unknown,
) {
  const candidate = error as {
    code?: string;
    retryAfterSec?: number;
    statusCode?: number;
    conflictingScheduleEntryId?: string;
    occupiedDate?: string;
  };
  const rateLimited =
    candidate.statusCode === 429 || candidate.code === "FST_ERR_RATE_LIMIT";
  const knownCode =
    typeof candidate.code === "string" &&
    [
      "VALIDATION",
      "FORBIDDEN",
      "NOT_FOUND",
      "CONFLICT",
      "UNAUTHORIZED",
      "THROTTLED",
      "CSRF",
      "ORIGIN",
    ].includes(candidate.code);
  const code = rateLimited ? "THROTTLED" : knownCode ? candidate.code! : "INTERNAL";
  const message =
    rateLimited
      ? "Request rate limit exceeded"
      : knownCode && error instanceof Error
      ? error.message
      : "An unexpected error occurred";
  if (code === "THROTTLED" && candidate.retryAfterSec) {
    reply.header("Retry-After", candidate.retryAfterSec);
  }
  const details: Record<string, unknown> = {};
  if (typeof candidate.conflictingScheduleEntryId === "string") {
    details.conflictingScheduleEntryId = candidate.conflictingScheduleEntryId;
  }
  if (typeof candidate.occupiedDate === "string") {
    details.occupiedDate = candidate.occupiedDate;
  }
  return reply
    .code(statusForCode(code))
    .send(errorBody(code, message, requestId, details));
}
