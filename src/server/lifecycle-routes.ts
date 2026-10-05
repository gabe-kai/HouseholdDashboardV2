import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { nowUtcIso } from "../domain/time.js";
import {
  HouseholdResetSchema,
  OwnerSecretSchema,
  PasswordReauthenticateSchema,
  SetupAccountSchema,
  SetupHouseholdSchema,
  SetupInvitationExchangeSchema,
} from "../shared/schemas.js";
import type { AppConfig } from "./config.js";
import { digestEquals, sha256Hex } from "./crypto.js";
import {
  InstallationControl,
  ownerSecretDigestFromEnv,
  verifyOwnerSecret,
} from "./installation-control.js";
import type { LifecycleRuntime } from "./lifecycle-runtime.js";
import type { AuthContext } from "./store.js";
import type { SyncHub } from "./sync-hub.js";

type LifecycleRouteDeps = {
  config: AppConfig;
  runtime: LifecycleRuntime;
  sync: SyncHub;
  syncRuntimeRefs: () => void;
  originAllowed: (request: FastifyRequest) => boolean;
  errorBody: (
    code: string,
    message: string,
    requestId: string,
    details?: Record<string, unknown>,
  ) => Record<string, unknown>;
  sessionBody: (session: AuthContext, csrfToken: string) => Record<string, unknown>;
  setSessionCookie: (reply: FastifyReply, token: string) => void;
  clearSessionCookie: (reply: FastifyReply) => void;
  requireSession: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => AuthContext | null;
  trySession: (request: FastifyRequest) => AuthContext | null;
  getInstallationEpoch: () => number;
  getStore: () => import("./store.js").AppStore;
};

function ownerConfigured(config: AppConfig): boolean {
  return Boolean(config.installationOwnerSecret);
}

function currentOwnerDigest(config: AppConfig): string | null {
  if (!config.installationOwnerSecret) return null;
  return ownerSecretDigestFromEnv(config.installationOwnerSecret);
}

function setOwnerCookie(reply: FastifyReply, config: AppConfig, token: string): void {
  reply.setCookie(config.ownerCookieName, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.cookieSecure,
    path: "/",
  });
}

function clearOwnerCookie(reply: FastifyReply, config: AppConfig): void {
  reply.clearCookie(config.ownerCookieName, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.cookieSecure,
    path: "/",
  });
}

function setSetupCookie(reply: FastifyReply, config: AppConfig, token: string): void {
  reply.setCookie(config.setupCookieName, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.cookieSecure,
    path: "/",
  });
}

function setContinuationCookie(reply: FastifyReply, config: AppConfig, token: string): void {
  reply.setCookie(config.recoveryContinuationCookieName, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.cookieSecure,
    path: "/",
  });
}

function ownerSessionFromRequest(
  request: FastifyRequest,
  config: AppConfig,
  control: InstallationControl,
): { csrfSecret: string; tokenDigest: string } | null {
  const raw = request.cookies[config.ownerCookieName];
  const digest = currentOwnerDigest(config);
  if (!raw || !digest) return null;
  const row = control.getOwnerSessionByToken(raw, digest);
  if (!row) return null;
  return { csrfSecret: row.csrfSecret, tokenDigest: row.tokenDigest };
}

function requireOwnerSession(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: LifecycleRouteDeps,
): { csrfSecret: string; tokenDigest: string } | null {
  if (!ownerConfigured(deps.config)) {
    void reply
      .code(403)
      .send(deps.errorBody("FORBIDDEN", "Installation owner is not configured", request.id));
    return null;
  }
  const session = ownerSessionFromRequest(request, deps.config, deps.runtime.control);
  if (!session) {
    void reply
      .code(401)
      .send(deps.errorBody("UNAUTHORIZED", "Owner authentication required", request.id));
    return null;
  }
  return session;
}

function requireSetupSession(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: LifecycleRouteDeps,
): { csrfSecret: string } | null {
  const raw = request.cookies[deps.config.setupCookieName];
  if (!raw) {
    void reply
      .code(401)
      .send(deps.errorBody("UNAUTHORIZED", "Setup session required", request.id));
    return null;
  }
  const session = deps.runtime.control.getSetupSession(raw);
  if (!session) {
    void reply
      .code(401)
      .send(deps.errorBody("UNAUTHORIZED", "Setup session expired", request.id));
    return null;
  }
  return session;
}

export function registerLifecycleRoutes(app: FastifyInstance, deps: LifecycleRouteDeps): void {
  const ownerRateLimit =
    deps.config.profile === "test"
      ? { max: 1_000, timeWindow: "1 minute" as const }
      : { max: 10, timeWindow: "1 minute" as const };

  app.post(
    "/api/v1/owner/session",
    { config: { rateLimit: ownerRateLimit } },
    async (request, reply) => {
      if (!ownerConfigured(deps.config)) {
        return reply
          .code(403)
          .send(deps.errorBody("FORBIDDEN", "Installation owner is not configured", request.id));
      }
      if (!deps.originAllowed(request)) {
        return reply
          .code(403)
          .send(deps.errorBody("ORIGIN", "Origin is not allowed", request.id));
      }
      const parsed = OwnerSecretSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(deps.errorBody("VALIDATION", "Invalid owner secret payload", request.id));
      }
      const digest = currentOwnerDigest(deps.config)!;
      const throttleKey = `owner:${request.ip}`;
      const blocked = deps.runtime.control.ownerThrottleRemaining(throttleKey);
      if (blocked > 0) {
        reply.header("Retry-After", blocked);
        return reply
          .code(429)
          .send(deps.errorBody("THROTTLED", "Owner authentication temporarily unavailable", request.id));
      }
      if (!verifyOwnerSecret(parsed.data.secret, digest)) {
        const retryAfter = deps.runtime.control.recordOwnerFailure(throttleKey);
        if (retryAfter > 0) reply.header("Retry-After", retryAfter);
        return reply
          .code(401)
          .send(deps.errorBody("UNAUTHORIZED", "Invalid owner secret", request.id));
      }
      deps.runtime.control.clearOwnerThrottle(throttleKey);
      const session = deps.runtime.control.createOwnerSession(digest);
      setOwnerCookie(reply, deps.config, session.token);
      reply.header("Cache-Control", "no-store");
      return { csrfToken: session.csrfSecret };
    },
  );

  app.post("/api/v1/owner/logout", async (request, reply) => {
    const owner = ownerSessionFromRequest(request, deps.config, deps.runtime.control);
    if (owner) {
      deps.runtime.control.revokeOwnerSession(owner.tokenDigest);
    }
    clearOwnerCookie(reply, deps.config);
    reply.header("Cache-Control", "no-store");
    return { ok: true };
  });

  app.get("/api/v1/owner/session", async (request, reply) => {
    const owner = ownerSessionFromRequest(request, deps.config, deps.runtime.control);
    if (!owner) {
      return reply
        .code(401)
        .send(deps.errorBody("UNAUTHORIZED", "Owner authentication required", request.id));
    }
    reply.header("Cache-Control", "no-store");
    return { active: true, csrfToken: owner.csrfSecret };
  });

  app.post("/api/v1/owner/setup-invitation", async (request, reply) => {
    const owner = requireOwnerSession(request, reply, deps);
    if (!owner) return;
    const tokenHeader = request.headers["x-csrf-token"];
    if (
      typeof tokenHeader !== "string" ||
      !digestEquals(sha256Hex(tokenHeader), sha256Hex(owner.csrfSecret))
    ) {
      return reply
        .code(403)
        .send(deps.errorBody("CSRF", "CSRF token is invalid", request.id));
    }
    const digest = currentOwnerDigest(deps.config)!;
    const invitation = deps.runtime.control.createSetupInvitation(digest);
    reply.header("Cache-Control", "no-store");
    return { invitationToken: invitation.token, expiresAt: invitation.expiresAt };
  });

  app.post("/api/v1/setup/exchange", async (request, reply) => {
    if (!ownerConfigured(deps.config)) {
      return reply
        .code(403)
        .send(deps.errorBody("FORBIDDEN", "Installation owner is not configured", request.id));
    }
    if (!deps.originAllowed(request)) {
      return reply
        .code(403)
        .send(deps.errorBody("ORIGIN", "Origin is not allowed", request.id));
    }
    const parsed = SetupInvitationExchangeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(deps.errorBody("VALIDATION", "Invalid setup exchange payload", request.id));
    }
    const digest = currentOwnerDigest(deps.config)!;
    const consumed = deps.runtime.control.consumeSetupInvitation(
      parsed.data.invitationToken,
      digest,
    );
    if (!consumed) {
      return reply
        .code(401)
        .send(deps.errorBody("UNAUTHORIZED", "Setup invitation is invalid or expired", request.id));
    }
    const setupSession = deps.runtime.control.createSetupSession(consumed.invitationDigest);
    setSetupCookie(reply, deps.config, setupSession.token);
    reply.header("Cache-Control", "no-store");
    return { ok: true, csrfToken: setupSession.csrfSecret };
  });

  app.post("/api/v1/setup/account", async (request, reply) => {
    if (!ownerConfigured(deps.config)) {
      return reply
        .code(403)
        .send(deps.errorBody("FORBIDDEN", "Installation owner is not configured", request.id));
    }
    const setup = requireSetupSession(request, reply, deps);
    if (!setup) return;
    const parsed = SetupAccountSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(deps.errorBody("VALIDATION", "Invalid setup account payload", request.id));
    }
    const result = await deps.getStore().createFirstManagerForSetup({
      ...parsed.data,
      defaultTimezone: deps.config.householdTimezone,
      installationEpoch: deps.getInstallationEpoch(),
    });
    deps.runtime.control.revokeSetupSessions();
    deps.setSessionCookie(reply, result.token);
    reply.header("Cache-Control", "no-store");
    return deps.sessionBody(result.context, result.csrfSecret);
  });

  app.post("/api/v1/setup/household", async (request, reply) => {
    const session = deps.requireSession(request, reply);
    if (!session) return;
    const parsed = SetupHouseholdSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(deps.errorBody("VALIDATION", "Invalid setup household payload", request.id));
    }
    const result = deps.getStore().completeSetupHousehold(session, parsed.data);
    reply.header("Cache-Control", "no-store");
    return result;
  });

  app.get("/api/v1/setup/progress", async (request, reply) => {
    const session = deps.requireSession(request, reply);
    if (!session) return;
    const progress = deps.getStore().getSetupProgress(session.householdId);
    reply.header("Cache-Control", "no-store");
    return {
      householdId: session.householdId,
      accountCompletedAt: progress?.accountCompletedAt ?? null,
      householdCompletedAt: progress?.householdCompletedAt ?? null,
      setupRequired: deps.getStore().setupRequired(),
    };
  });

  app.post("/api/v1/auth/reauthenticate", async (request, reply) => {
    const session = deps.requireSession(request, reply);
    if (!session) return;
    const parsed = PasswordReauthenticateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(deps.errorBody("VALIDATION", "Invalid reauthentication payload", request.id));
    }
    await deps.getStore().confirmPasswordForSession(session.sessionId, parsed.data.passphrase);
    reply.header("Cache-Control", "no-store");
    return { ok: true, confirmedAt: nowUtcIso() };
  });

  app.post("/api/v1/household/reset", async (request, reply) => {
    const session = deps.requireSession(request, reply);
    if (!session) return;
    const parsed = HouseholdResetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(deps.errorBody("VALIDATION", "Invalid reset payload", request.id));
    }
    if (parsed.data.confirmationText !== "RESET") {
      return reply
        .code(400)
        .send(deps.errorBody("VALIDATION", "Confirmation text must be RESET", request.id));
    }
    if (!session.grants.includes("household.lifecycle.manage")) {
      return reply
        .code(403)
        .send(deps.errorBody("FORBIDDEN", "Required authority is missing", request.id));
    }
    if (!deps.getStore().passwordConfirmedRecently(session.sessionId)) {
      return reply
        .code(403)
        .send(deps.errorBody("FORBIDDEN", "Recent password confirmation required", request.id));
    }

    const sourceEpoch = deps.getInstallationEpoch();
    if (parsed.data.expectedEpoch !== sourceEpoch) {
      return reply
        .code(409)
        .send(
          deps.errorBody("CONFLICT", "Installation epoch changed; reload and try again", request.id, {
            installationEpoch: sourceEpoch,
          }),
        );
    }
    const payloadDigest = createHash("sha256")
      .update(`${parsed.data.mutationId}:${sourceEpoch}:RESET`)
      .digest("hex");
    const prior = deps.runtime.control.findCompletedOperationByPayload(
      "household_reset",
      payloadDigest,
      sourceEpoch,
    );
    if (prior?.responseJson) {
      reply.header("Cache-Control", "no-store");
      return JSON.parse(prior.responseJson) as Record<string, unknown>;
    }

    const operationId = randomUUID();
    deps.runtime.control.beginLifecycleOperation({
      id: operationId,
      kind: "household_reset",
      sourceEpoch,
      initiatorKind: "member",
      initiatorRef: session.membershipId,
      payloadDigest,
    });
    const continuation = deps.runtime.control.createRecoveryContinuation({
      operationId,
      sourceEpoch,
      initiatorRef: session.membershipId,
    });
    setContinuationCookie(reply, deps.config, continuation);

    deps.getStore().revokeAllSessionsAndClaims();
    deps.sync.closeAll();

    const replacement = await deps.runtime.replaceWithEmptyDatabase({
      operationId,
      sourceEpoch,
    });
    deps.syncRuntimeRefs();

    const response = {
      operationId,
      sourceEpoch,
      resultEpoch: replacement.resultEpoch,
      installationEpoch: replacement.resultEpoch,
      cleanupFailures: replacement.cleanupFailures,
      setupRequired: true,
    };
    deps.runtime.control.completeLifecycleOperation(
      operationId,
      replacement.resultEpoch,
      JSON.stringify(response),
    );
    reply.header("Cache-Control", "no-store");
    deps.clearSessionCookie(reply);
    return response;
  });

  app.get("/api/v1/lifecycle/operations/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    // Authorize before existence to keep principal denial deterministic (401/403).
    const owner = ownerSessionFromRequest(request, deps.config, deps.runtime.control);
    const contRaw = request.cookies[deps.config.recoveryContinuationCookieName];
    const cont =
      contRaw && deps.runtime.control.getRecoveryContinuation(contRaw);
    const member = deps.trySession(request);
    const allowed =
      owner ||
      (cont &&
        cont.operationId === id &&
        member &&
        member.membershipId === cont.initiatorRef);
    if (!allowed) {
      if (request.cookies[deps.config.cookieName] || contRaw) {
        return reply
          .code(403)
          .send(deps.errorBody("FORBIDDEN", "Operation status is restricted", request.id));
      }
      return reply
        .code(401)
        .send(deps.errorBody("UNAUTHORIZED", "Authentication required", request.id));
    }
    const operation = deps.runtime.control.getLifecycleOperation(id);
    if (!operation) {
      return reply
        .code(404)
        .send(deps.errorBody("NOT_FOUND", "Operation not found", request.id));
    }
    reply.header("Cache-Control", "no-store");
    return {
      id: operation.id,
      kind: operation.kind,
      status: operation.status,
      sourceEpoch: operation.sourceEpoch,
      resultEpoch: operation.resultEpoch,
      createdAt: operation.createdAt,
      completedAt: operation.completedAt,
      result: operation.responseJson ? JSON.parse(operation.responseJson) : null,
    };
  });

  app.post("/api/v1/owner/recover-manager-password", async (request, reply) => {
    const owner = requireOwnerSession(request, reply, deps);
    if (!owner) return;
    const body = request.body as {
      loginName?: string;
      newPassphrase?: string;
    };
    if (!body.loginName || !body.newPassphrase) {
      return reply
        .code(400)
        .send(deps.errorBody("VALIDATION", "Invalid recovery payload", request.id));
    }
    const tokenHeader = request.headers["x-csrf-token"];
    if (
      typeof tokenHeader !== "string" ||
      !digestEquals(sha256Hex(tokenHeader), sha256Hex(owner.csrfSecret))
    ) {
      return reply
        .code(403)
        .send(deps.errorBody("CSRF", "CSRF token is invalid", request.id));
    }
    const result = await deps.getStore().resetSoleManagerPassword({
      loginName: body.loginName,
      newPassphrase: body.newPassphrase,
    });
    reply.header("Cache-Control", "no-store");
    return { ok: true, membershipId: result.membershipId };
  });

  app.post("/api/v1/owner/establish-manager", async (request, reply) => {
    const owner = requireOwnerSession(request, reply, deps);
    if (!owner) return;
    const body = request.body as {
      loginName?: string;
      passphrase?: string;
      displayName?: string;
    };
    if (!body.loginName || !body.passphrase || !body.displayName) {
      return reply
        .code(400)
        .send(deps.errorBody("VALIDATION", "Invalid establish-manager payload", request.id));
    }
    const tokenHeader = request.headers["x-csrf-token"];
    if (
      typeof tokenHeader !== "string" ||
      !digestEquals(sha256Hex(tokenHeader), sha256Hex(owner.csrfSecret))
    ) {
      return reply
        .code(403)
        .send(deps.errorBody("CSRF", "CSRF token is invalid", request.id));
    }
    const result = await deps.getStore().establishManagerForRetainedHousehold({
      loginName: body.loginName,
      passphrase: body.passphrase,
      displayName: body.displayName,
      installationEpoch: deps.getInstallationEpoch(),
    });
    deps.setSessionCookie(reply, result.token);
    reply.header("Cache-Control", "no-store");
    return deps.sessionBody(result.context, result.csrfSecret);
  });
}
