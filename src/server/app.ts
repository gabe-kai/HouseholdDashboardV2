import fs from "node:fs";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { randomUUID } from "node:crypto";
import {
  CreateRevisionSchema,
  CreateRoutineSchema,
  CreateSessionSchema,
  HouseholdDateSchema,
  SetStepStatusSchema,
} from "../shared/schemas.js";
import { nowUtcIso } from "../domain/time.js";
import type { AppConfig } from "./config.js";
import { migrate, openDatabase, resolveDbPath } from "./db.js";
import { AppStore } from "./store.js";
import { SyncHub } from "./sync-hub.js";

const SESSION_COOKIE = "hd_eval_session";

function errorBody(code: string, message: string, requestId: string) {
  return { code, message, requestId };
}

function statusForCode(code: string): number {
  if (code === "FORBIDDEN") return 403;
  if (code === "NOT_FOUND") return 404;
  if (code === "CONFLICT") return 409;
  if (code === "UNAUTHORIZED") return 401;
  return 400;
}

export async function buildApp(config: AppConfig) {
  const db = openDatabase(resolveDbPath(config.dbPath));
  migrate(db);
  const store = new AppStore(db);
  store.seed(config.householdTimezone);
  const sync = new SyncHub();

  const app = Fastify({
    logger: {
      level: "info",
      redact: ["req.headers.cookie"],
    },
    genReqId: () => randomUUID(),
    bodyLimit: 64 * 1024,
  });

  await app.register(cookie);
  await app.register(websocket);

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Request-Id", request.id);
    return payload;
  });

  app.get("/api/v1/health", async () => ({
    ok: true,
    evaluationMode: true,
    allowLan: config.allowLan,
  }));

  app.get("/api/v1/meta", async () => ({
    evaluationMode: true,
    banner:
      "EVALUATION BUILD — profile selection is not secure individual login. Trusted-LAN only when explicitly enabled.",
    allowLan: config.allowLan,
    bindHost: config.host,
  }));

  app.get("/api/v1/members", async () => ({ members: store.listMembers() }));

  app.post("/api/v1/session", async (request, reply) => {
    const parsed = CreateSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(errorBody("VALIDATION", "Invalid session payload", request.id));
    }
    try {
      const session = store.createSession(parsed.data.memberId);
      reply.setCookie(SESSION_COOKIE, session.sessionId, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: config.cookieSecure,
      });
      return {
        member: {
          id: session.memberId,
          displayName: session.displayName,
          capabilities: session.capabilities,
        },
        householdTimezone: session.timezone,
        evaluationMode: true,
      };
    } catch (err) {
      return sendStoreError(reply, request.id, err);
    }
  });

  app.get("/api/v1/session", async (request, reply) => {
    const session = store.getSession(request.cookies[SESSION_COOKIE]);
    if (!session) {
      return reply.code(401).send(errorBody("UNAUTHORIZED", "No evaluation session", request.id));
    }
    return {
      member: {
        id: session.memberId,
        displayName: session.displayName,
        capabilities: session.capabilities,
      },
      householdTimezone: session.timezone,
      evaluationMode: true,
      householdDate: store.householdDateNow(session),
    };
  });

  app.delete("/api/v1/session", async (request, reply) => {
    const id = request.cookies[SESSION_COOKIE];
    if (id) store.deleteSession(id);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  function requireSession(
    request: { cookies: Record<string, string | undefined>; id: string },
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  ) {
    const session = store.getSession(request.cookies[SESSION_COOKIE]);
    if (!session) {
      reply.code(401).send(errorBody("UNAUTHORIZED", "No evaluation session", request.id));
      return null;
    }
    return session;
  }

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
      return reply.code(400).send(errorBody("VALIDATION", "Invalid routine", request.id));
    }
    try {
      const routine = store.createRoutine(session, parsed.data);
      sync.broadcast({
        type: "household_change",
        householdId: session.householdId,
        resource: "routine",
        resourceId: routine!.id,
        at: nowUtcIso(),
      });
      return { routine };
    } catch (err) {
      return sendStoreError(reply, request.id, err);
    }
  });

  app.post("/api/v1/routines/:definitionId/revisions", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const params = request.params as { definitionId: string };
    const parsed = CreateRevisionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(errorBody("VALIDATION", "Invalid revision", request.id));
    }
    try {
      const routine = store.createRevision(session, params.definitionId, parsed.data);
      sync.broadcast({
        type: "household_change",
        householdId: session.householdId,
        resource: "routine",
        resourceId: params.definitionId,
        at: nowUtcIso(),
      });
      return { routine };
    } catch (err) {
      return sendStoreError(reply, request.id, err);
    }
  });

  app.get("/api/v1/today", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const query = request.query as { date?: string };
    let date = store.householdDateNow(session);
    if (query.date) {
      const parsed = HouseholdDateSchema.safeParse(query.date);
      if (!parsed.success) {
        return reply.code(400).send(errorBody("VALIDATION", "Invalid date", request.id));
      }
      date = parsed.data;
    }
    const occurrences = store.materializeForDate(session, date);
    return {
      householdDate: date,
      householdTimezone: session.timezone,
      occurrences,
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
        return reply.code(400).send(errorBody("VALIDATION", "Invalid date", request.id));
      }
      date = parsed.data;
    }
    try {
      const occurrences = store.historyForDate(session, date);
      return { householdDate: date, occurrences };
    } catch (err) {
      return sendStoreError(reply, request.id, err);
    }
  });

  app.post("/api/v1/occurrences/:occurrenceId/steps/:stepId/status", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const params = request.params as { occurrenceId: string; stepId: string };
    const parsed = SetStepStatusSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(errorBody("VALIDATION", "Invalid status payload", request.id));
    }

    const delayMs = Number(request.headers["x-mutation-delay-ms"] ?? 0);
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }

    try {
      const result = store.setStepStatus(session, params.occurrenceId, params.stepId, parsed.data);
      sync.broadcast({
        type: "household_change",
        householdId: session.householdId,
        resource: "occurrence",
        resourceId: params.occurrenceId,
        version: result.occurrence.version,
        at: nowUtcIso(),
      });
      return result;
    } catch (err) {
      return sendStoreError(reply, request.id, err);
    }
  });

  app.get("/api/v1/sync", { websocket: true }, (socket, request) => {
    const session = store.getSession(request.cookies[SESSION_COOKIE]);
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

  if (config.isProduction && fs.existsSync(config.clientDist)) {
    await app.register(fastifyStatic, {
      root: config.clientDist,
      wildcard: false,
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send(errorBody("NOT_FOUND", "Not found", request.id));
    });
  }

  app.addHook("onClose", async () => {
    db.close();
  });

  return { app, store, db, sync, config };
}

function sendStoreError(
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  requestId: string,
  err: unknown,
) {
  const code = (err as { code?: string }).code ?? "ERROR";
  const message = err instanceof Error ? err.message : "Error";
  return reply.code(statusForCode(code)).send(errorBody(code, message, requestId));
}
