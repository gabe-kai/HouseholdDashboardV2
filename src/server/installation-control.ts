import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import DatabaseConstructor from "better-sqlite3";
import { repoRoot } from "./config.js";
import { digestEquals, randomToken, sha256Hex } from "./crypto.js";

const OWNER_IDLE_MS = 15 * 60 * 1000;
const OWNER_ABSOLUTE_MS = 60 * 60 * 1000;
const SETUP_INVITE_MS = 30 * 60 * 1000;
const SETUP_SESSION_MS = 30 * 60 * 1000;
const RECOVERY_CONT_MS = 60 * 60 * 1000;

export type InstallationState = {
  installationId: string;
  datasetEpoch: number;
  activeDbRelativePath: string;
  createdAt: string;
};

export type OwnerSessionRow = {
  tokenDigest: string;
  csrfSecret: string;
  ownerSecretDigest: string;
  createdAt: string;
  lastSeenAt: string;
  absoluteExpiresAt: string;
};

export type LifecycleOperationRow = {
  id: string;
  kind: string;
  status: "pending" | "completed" | "failed";
  sourceEpoch: number;
  resultEpoch: number | null;
  initiatorKind: string;
  initiatorRef: string;
  payloadDigest: string;
  responseJson: string | null;
  createdAt: string;
  completedAt: string | null;
};

function isoAt(d: Date): string {
  return d.toISOString();
}

function nowIso(): string {
  return new Date().toISOString();
}

const CONTROL_SCHEMA = `
CREATE TABLE IF NOT EXISTS installation_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  installation_id TEXT NOT NULL,
  dataset_epoch INTEGER NOT NULL,
  active_db_relative_path TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS owner_sessions (
  token_digest TEXT PRIMARY KEY,
  csrf_secret TEXT NOT NULL,
  owner_secret_digest TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS owner_throttle (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  blocked_until TEXT
);

CREATE TABLE IF NOT EXISTS setup_invitations (
  token_digest TEXT PRIMARY KEY,
  owner_secret_digest TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS setup_sessions (
  token_digest TEXT PRIMARY KEY,
  csrf_secret TEXT NOT NULL,
  invitation_digest TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS lifecycle_operations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  source_epoch INTEGER NOT NULL,
  result_epoch INTEGER,
  initiator_kind TEXT NOT NULL,
  initiator_ref TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  response_json TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS recovery_continuations (
  token_digest TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES lifecycle_operations(id),
  source_epoch INTEGER NOT NULL,
  initiator_ref TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
`;

export function resolveInstallationControlPath(configured?: string): string {
  const raw = configured ?? "runtime/installation-control.sqlite";
  return path.isAbsolute(raw) ? raw : path.resolve(repoRoot, raw);
}

export function ownerSecretDigestFromEnv(secret: string): string {
  return sha256Hex(secret);
}

export function verifyOwnerSecret(secret: string, expectedDigest: string): boolean {
  return digestEquals(sha256Hex(secret), expectedDigest);
}

export class InstallationControl {
  private db: Database.Database;

  private constructor(db: Database.Database) {
    this.db = db;
  }

  static open(controlPath: string): InstallationControl {
    fs.mkdirSync(path.dirname(controlPath), { recursive: true });
    const db = new DatabaseConstructor(controlPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    const control = new InstallationControl(db);
    control.db.exec(CONTROL_SCHEMA);
    return control;
  }

  close(): void {
    this.db.close();
  }

  /** Adopt configured household DB path without wiping data (epoch 1 when new). */
  ensureAdopt(activeDbRelativePath: string): InstallationState {
    const existing = this.db
      .prepare(
        `SELECT installation_id, dataset_epoch, active_db_relative_path, created_at
         FROM installation_state WHERE id = 1`,
      )
      .get() as
      | {
          installation_id: string;
          dataset_epoch: number;
          active_db_relative_path: string;
          created_at: string;
        }
      | undefined;
    if (existing) {
      return {
        installationId: existing.installation_id,
        datasetEpoch: existing.dataset_epoch,
        activeDbRelativePath: existing.active_db_relative_path,
        createdAt: existing.created_at,
      };
    }
    const installationId = randomUUID();
    const createdAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO installation_state
         (id, installation_id, dataset_epoch, active_db_relative_path, created_at)
         VALUES (1, ?, 1, ?, ?)`,
      )
      .run(installationId, activeDbRelativePath, createdAt);
    return {
      installationId,
      datasetEpoch: 1,
      activeDbRelativePath,
      createdAt,
    };
  }

  getState(): InstallationState {
    const row = this.db
      .prepare(
        `SELECT installation_id AS installationId, dataset_epoch AS datasetEpoch,
                active_db_relative_path AS activeDbRelativePath, created_at AS createdAt
         FROM installation_state WHERE id = 1`,
      )
      .get() as InstallationState | undefined;
    if (!row) throw new Error("Installation control is uninitialized");
    return row;
  }

  activateCandidate(nextEpoch: number, activeDbRelativePath: string): void {
    this.db
      .prepare(
        `UPDATE installation_state
         SET dataset_epoch = ?, active_db_relative_path = ?
         WHERE id = 1`,
      )
      .run(nextEpoch, activeDbRelativePath);
  }

  createOwnerSession(ownerSecretDigest: string): { token: string; csrfSecret: string } {
    this.revokeOwnerSessions();
    const token = randomToken();
    const csrfSecret = randomToken();
    const now = new Date();
    this.db
      .prepare(
        `INSERT INTO owner_sessions
         (token_digest, csrf_secret, owner_secret_digest, created_at, last_seen_at,
          absolute_expires_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        sha256Hex(token),
        csrfSecret,
        ownerSecretDigest,
        isoAt(now),
        isoAt(now),
        isoAt(new Date(now.getTime() + OWNER_ABSOLUTE_MS)),
      );
    return { token, csrfSecret };
  }

  getOwnerSessionByToken(
    token: string,
    currentOwnerSecretDigest: string,
  ): OwnerSessionRow | null {
    const digest = sha256Hex(token);
    const row = this.db
      .prepare(
        `SELECT token_digest AS tokenDigest, csrf_secret AS csrfSecret,
                owner_secret_digest AS ownerSecretDigest, created_at AS createdAt,
                last_seen_at AS lastSeenAt, absolute_expires_at AS absoluteExpiresAt
         FROM owner_sessions
         WHERE token_digest = ? AND revoked_at IS NULL`,
      )
      .get(digest) as OwnerSessionRow | undefined;
    if (!row) return null;
    if (!digestEquals(row.ownerSecretDigest, currentOwnerSecretDigest)) {
      this.db
        .prepare(`UPDATE owner_sessions SET revoked_at = ? WHERE token_digest = ?`)
        .run(nowIso(), digest);
      return null;
    }
    const now = new Date();
    const idleExpired =
      now.getTime() - new Date(row.lastSeenAt).getTime() > OWNER_IDLE_MS;
    const absoluteExpired = now >= new Date(row.absoluteExpiresAt);
    if (idleExpired || absoluteExpired) {
      this.db
        .prepare(`UPDATE owner_sessions SET revoked_at = ? WHERE token_digest = ?`)
        .run(isoAt(now), digest);
      return null;
    }
    this.db
      .prepare(`UPDATE owner_sessions SET last_seen_at = ? WHERE token_digest = ?`)
      .run(isoAt(now), digest);
    return row;
  }

  revokeOwnerSession(tokenDigest: string): void {
    this.db
      .prepare(
        `UPDATE owner_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE token_digest = ?`,
      )
      .run(nowIso(), tokenDigest);
  }

  revokeOwnerSessions(): void {
    this.db
      .prepare(`UPDATE owner_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE revoked_at IS NULL`)
      .run(nowIso());
  }

  revokeSetupInvitations(): void {
    this.db
      .prepare(
        `UPDATE setup_invitations SET revoked_at = COALESCE(revoked_at, ?)
         WHERE consumed_at IS NULL AND revoked_at IS NULL`,
      )
      .run(nowIso());
  }

  createSetupInvitation(ownerSecretDigest: string): { token: string; expiresAt: string } {
    this.revokeSetupInvitations();
    const token = randomToken(32);
    const now = new Date();
    const expiresAt = isoAt(new Date(now.getTime() + SETUP_INVITE_MS));
    this.db
      .prepare(
        `INSERT INTO setup_invitations
         (token_digest, owner_secret_digest, created_at, expires_at, consumed_at, revoked_at)
         VALUES (?, ?, ?, ?, NULL, NULL)`,
      )
      .run(sha256Hex(token), ownerSecretDigest, isoAt(now), expiresAt);
    return { token, expiresAt };
  }

  consumeSetupInvitation(
    invitationToken: string,
    currentOwnerSecretDigest: string,
  ): { invitationDigest: string } | null {
    const digest = sha256Hex(invitationToken);
    const row = this.db
      .prepare(
        `SELECT token_digest, owner_secret_digest, expires_at, consumed_at, revoked_at
         FROM setup_invitations WHERE token_digest = ?`,
      )
      .get(digest) as
      | {
          token_digest: string;
          owner_secret_digest: string;
          expires_at: string;
          consumed_at: string | null;
          revoked_at: string | null;
        }
      | undefined;
    if (!row || row.consumed_at || row.revoked_at) return null;
    if (!digestEquals(row.owner_secret_digest, currentOwnerSecretDigest)) return null;
    if (new Date() >= new Date(row.expires_at)) return null;
    const consumedAt = nowIso();
    const updated = this.db
      .prepare(
        `UPDATE setup_invitations SET consumed_at = ?
         WHERE token_digest = ? AND consumed_at IS NULL AND revoked_at IS NULL`,
      )
      .run(consumedAt, digest);
    if (updated.changes !== 1) return null;
    return { invitationDigest: digest };
  }

  createSetupSession(invitationDigest: string): { token: string; csrfSecret: string } {
    const token = randomToken();
    const csrfSecret = randomToken();
    const now = new Date();
    this.db
      .prepare(
        `INSERT INTO setup_sessions
         (token_digest, csrf_secret, invitation_digest, created_at, expires_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        sha256Hex(token),
        csrfSecret,
        invitationDigest,
        isoAt(now),
        isoAt(new Date(now.getTime() + SETUP_SESSION_MS)),
      );
    return { token, csrfSecret };
  }

  getSetupSession(token: string): { csrfSecret: string } | null {
    const digest = sha256Hex(token);
    const row = this.db
      .prepare(
        `SELECT csrf_secret, expires_at, revoked_at FROM setup_sessions WHERE token_digest = ?`,
      )
      .get(digest) as
      | { csrf_secret: string; expires_at: string; revoked_at: string | null }
      | undefined;
    if (!row || row.revoked_at) return null;
    if (new Date() >= new Date(row.expires_at)) {
      this.db
        .prepare(`UPDATE setup_sessions SET revoked_at = ? WHERE token_digest = ?`)
        .run(nowIso(), digest);
      return null;
    }
    return { csrfSecret: row.csrf_secret };
  }

  revokeSetupSessions(): void {
    this.db
      .prepare(
        `UPDATE setup_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE revoked_at IS NULL`,
      )
      .run(nowIso());
  }

  recordOwnerFailure(key: string): number {
    const now = new Date();
    const row = this.db
      .prepare(`SELECT failures, blocked_until FROM owner_throttle WHERE key = ?`)
      .get(key) as { failures: number; blocked_until: string | null } | undefined;
    const failures = (row?.failures ?? 0) + 1;
    let blockedUntil: string | null = null;
    let retryAfterSec = 0;
    if (failures >= 5) {
      blockedUntil = isoAt(new Date(now.getTime() + 60_000));
      retryAfterSec = 60;
    } else if (failures >= 3) {
      blockedUntil = isoAt(new Date(now.getTime() + 15_000));
      retryAfterSec = 15;
    }
    this.db
      .prepare(
        `INSERT INTO owner_throttle (key, failures, blocked_until) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET failures = excluded.failures, blocked_until = excluded.blocked_until`,
      )
      .run(key, failures, blockedUntil);
    return retryAfterSec;
  }

  ownerThrottleRemaining(key: string): number {
    const row = this.db
      .prepare(`SELECT blocked_until FROM owner_throttle WHERE key = ?`)
      .get(key) as { blocked_until: string | null } | undefined;
    if (!row?.blocked_until) return 0;
    const remaining = Math.ceil(
      (new Date(row.blocked_until).getTime() - Date.now()) / 1000,
    );
    return remaining > 0 ? remaining : 0;
  }

  clearOwnerThrottle(key: string): void {
    this.db.prepare(`DELETE FROM owner_throttle WHERE key = ?`).run(key);
  }

  beginLifecycleOperation(input: {
    id: string;
    kind: string;
    sourceEpoch: number;
    initiatorKind: string;
    initiatorRef: string;
    payloadDigest: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO lifecycle_operations
         (id, kind, status, source_epoch, result_epoch, initiator_kind, initiator_ref,
          payload_digest, response_json, created_at, completed_at)
         VALUES (?, ?, 'pending', ?, NULL, ?, ?, ?, NULL, ?, NULL)`,
      )
      .run(
        input.id,
        input.kind,
        input.sourceEpoch,
        input.initiatorKind,
        input.initiatorRef,
        input.payloadDigest,
        nowIso(),
      );
  }

  completeLifecycleOperation(
    id: string,
    resultEpoch: number,
    responseJson: string,
  ): void {
    this.db
      .prepare(
        `UPDATE lifecycle_operations
         SET status = 'completed', result_epoch = ?, response_json = ?, completed_at = ?
         WHERE id = ?`,
      )
      .run(resultEpoch, responseJson, nowIso(), id);
  }

  failLifecycleOperation(id: string, responseJson: string): void {
    this.db
      .prepare(
        `UPDATE lifecycle_operations
         SET status = 'failed', response_json = ?, completed_at = ?
         WHERE id = ?`,
      )
      .run(responseJson, nowIso(), id);
  }

  getLifecycleOperation(id: string): LifecycleOperationRow | null {
    const row = this.db
      .prepare(
        `SELECT id, kind, status, source_epoch AS sourceEpoch, result_epoch AS resultEpoch,
                initiator_kind AS initiatorKind, initiator_ref AS initiatorRef,
                payload_digest AS payloadDigest, response_json AS responseJson,
                created_at AS createdAt, completed_at AS completedAt
         FROM lifecycle_operations WHERE id = ?`,
      )
      .get(id) as LifecycleOperationRow | undefined;
    return row ?? null;
  }

  findCompletedOperationByPayload(
    kind: string,
    payloadDigest: string,
    sourceEpoch: number,
  ): LifecycleOperationRow | null {
    const row = this.db
      .prepare(
        `SELECT id, kind, status, source_epoch AS sourceEpoch, result_epoch AS resultEpoch,
                initiator_kind AS initiatorKind, initiator_ref AS initiatorRef,
                payload_digest AS payloadDigest, response_json AS responseJson,
                created_at AS createdAt, completed_at AS completedAt
         FROM lifecycle_operations
         WHERE kind = ? AND payload_digest = ? AND source_epoch = ? AND status = 'completed'
         ORDER BY completed_at DESC LIMIT 1`,
      )
      .get(kind, payloadDigest, sourceEpoch) as LifecycleOperationRow | undefined;
    return row ?? null;
  }

  createRecoveryContinuation(input: {
    operationId: string;
    sourceEpoch: number;
    initiatorRef: string;
  }): string {
    const token = randomToken(32);
    const expiresAt = isoAt(new Date(Date.now() + RECOVERY_CONT_MS));
    this.db
      .prepare(
        `INSERT INTO recovery_continuations
         (token_digest, operation_id, source_epoch, initiator_ref, expires_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, NULL)`,
      )
      .run(sha256Hex(token), input.operationId, input.sourceEpoch, input.initiatorRef, expiresAt);
    return token;
  }

  getRecoveryContinuation(token: string): {
    operationId: string;
    sourceEpoch: number;
    initiatorRef: string;
  } | null {
    const digest = sha256Hex(token);
    const row = this.db
      .prepare(
        `SELECT operation_id, source_epoch, initiator_ref, expires_at, revoked_at
         FROM recovery_continuations WHERE token_digest = ?`,
      )
      .get(digest) as
      | {
          operation_id: string;
          source_epoch: number;
          initiator_ref: string;
          expires_at: string;
          revoked_at: string | null;
        }
      | undefined;
    if (!row || row.revoked_at) return null;
    if (new Date() >= new Date(row.expires_at)) return null;
    return {
      operationId: row.operation_id,
      sourceEpoch: row.source_epoch,
      initiatorRef: row.initiator_ref,
    };
  }

  revokeRecoveryContinuationsForOperation(operationId: string): void {
    this.db
      .prepare(
        `UPDATE recovery_continuations SET revoked_at = COALESCE(revoked_at, ?)
         WHERE operation_id = ?`,
      )
      .run(nowIso(), operationId);
  }
}

export function relativeDbPathFromConfig(configuredDbPath: string): string {
  const absolute = path.isAbsolute(configuredDbPath)
    ? configuredDbPath
    : path.resolve(repoRoot, configuredDbPath);
  return path.relative(repoRoot, absolute).split(path.sep).join("/");
}

export function resolveActiveDbAbsolutePath(relativePath: string): string {
  return path.resolve(repoRoot, relativePath);
}
