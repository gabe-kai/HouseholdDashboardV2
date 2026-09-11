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
  ClaimSchema,
  CreateGroupSchema,
  CreatePersonSchema,
  CreatePersonalTaskSchema,
  CreateProposalSchema,
  CreateRevisionSchema,
  CreateRoutineSchema,
  DecideProposalSchema,
  HouseholdDateSchema,
  IssueEnrollmentSchema,
  LoginSchema,
  SavePersonalLayerSchema,
  SetPersonalTaskStatusSchema,
  SetStepStatusSchema,
  UpdateGroupSchema,
  UpdatePersonSchema,
  UuidSchema,
} from "../shared/schemas.js";
import type { AppConfig } from "./config.js";
import { digestEquals, sha256Hex } from "./crypto.js";
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
]);
/** CSRF-exempt auth entry points still require an allowed Origin. */
const AUTH_ORIGIN_REQUIRED = new Set([
  "/api/v1/auth/login",
  "/api/v1/auth/claim",
]);

function errorBody(code: string, message: string, requestId: string) {
  return { code, message, requestId };
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
  const sync = new SyncHub();
  const requestSessions = new WeakMap<object, AuthContext>();

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
    };
  }

  function broadcast(
    session: AuthContext,
    resource:
      | "occurrence"
      | "routine"
      | "proposal"
      | "personal_task"
      | "membership"
      | "group",
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
    return { people: store.listMemberships(session.householdId) };
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
    return { routine: store.getRoutine(session.householdId) };
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
    broadcast(session, "routine", routine!.id);
    return { routine };
  });

  app.post("/api/v1/routines/:definitionId/revisions", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { definitionId } = request.params as { definitionId: string };
    const parsed = CreateRevisionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid revision", request.id));
    }
    const routine = store.createRevision(session, definitionId, parsed.data);
    broadcast(session, "routine", definitionId);
    return { routine };
  });

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
      occurrences: store.materializeForDate(session, date),
    };
  });

  app.get("/api/v1/history", async (request, reply) => {
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
      occurrences: store.historyForDate(session, date),
    };
  });

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
    const query = request.query as { membershipId?: string; date?: string };
    const membershipId = query.membershipId ?? session.membershipId;
    const parsedDate = HouseholdDateSchema.safeParse(
      query.date ?? store.householdDateNow(session),
    );
    if (!parsedDate.success) {
      return reply
        .code(400)
        .send(errorBody("VALIDATION", "Invalid preview date", request.id));
    }
    return {
      preview: store.previewComposition(session, membershipId, parsedDate.data),
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
        const issued = store.issueBootstrapClaim();
        return { token: issued.token, expiresAt: issued.expiresAt };
      } catch (err) {
        return sendStoreError(reply, request.id, err);
      }
    });
  }

  if ((config.isProduction || config.profile === "hosted") && fs.existsSync(config.clientDist)) {
    await app.register(fastifyStatic, {
      root: config.clientDist,
      wildcard: false,
    });
  }

  app.setNotFoundHandler((request, reply) => {
    if (
      (config.isProduction || config.profile === "hosted") &&
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
  return reply
    .code(statusForCode(code))
    .send(errorBody(code, message, requestId));
}
