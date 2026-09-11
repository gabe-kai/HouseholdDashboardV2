import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { isOccurrenceComplete, assertStatusAllowed } from "../domain/completion.js";
import { composeMorningRoutine } from "../domain/compose.js";
import {
  isDateApplicable,
  selectRevisionForDate,
  validateRoutineSteps,
} from "../domain/recurrence.js";
import {
  addHouseholdDays,
  compareHouseholdDates,
  householdDateFromInstant,
  nowUtcIso,
  type HouseholdDate,
} from "../domain/time.js";
import { GRANT_PRESETS } from "../shared/grants.js";
import type {
  AccessState,
  Grant,
  GrantPreset,
  GroupPublic,
  MemberPublic,
  ObligationMeaning,
  OccurrenceView,
  PersonClassification,
  PersonDetail,
  StepStatus,
} from "../shared/schemas.js";
import {
  digestEquals,
  hashPassphrase,
  randomToken,
  sha256Hex,
  verifyPassphrase,
} from "./crypto.js";
import { isCommonPassphrase } from "./password-blocklist.js";
import { SEED } from "./seeds/evaluation.js";

export type AuthContext = {
  sessionId: string;
  userId: string;
  membershipId: string;
  householdId: string;
  displayName: string;
  grants: Grant[];
  timezone: string;
  csrfSecret: string;
};

type StoreErrorCode =
  | "VALIDATION"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNAUTHORIZED"
  | "THROTTLED";

type RoutineStepInput = {
  text: string;
  obligation: ObligationMeaning;
  logicalItemId?: string;
};

type RoutineInput = {
  title: string;
  assigneeMemberIds: string[];
  weekdays: number[];
  steps: RoutineStepInput[];
};

type PersonalAdditionInput = {
  id?: string;
  text: string;
  obligation: ObligationMeaning;
  anchorLogicalItemId?: string | null;
  place: "before" | "after" | "end";
};

type PersonalLayer = {
  id: string;
  membershipId: string;
  definitionId: string;
  effectiveDate: string;
  createdAt: string;
  additions: Array<{
    id: string;
    position: number;
    text: string;
    obligation: ObligationMeaning;
    anchorLogicalItemId: string | null;
    place: "before" | "after" | "end";
  }>;
};

const LOGIN_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IDLE_MS = 7 * 24 * 60 * 60 * 1_000;
const ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1_000;
const CLAIM_MS = 24 * 60 * 60 * 1_000;
const LOGIN_WINDOW_MS = 15 * 60 * 1_000;
const LOGIN_BLOCK_MS = 60 * 1_000;

const FIXTURE_MEMBERS = [
  {
    id: "22222222-2222-4222-8222-222222222201",
    displayName: "Morgan Reed",
    preset: "manager" as const,
  },
  {
    id: "22222222-2222-4222-8222-222222222202",
    displayName: "Avery Reed",
    preset: "direct_personalizer" as const,
  },
  {
    id: "22222222-2222-4222-8222-222222222203",
    displayName: "Jordan Reed",
    preset: "direct_personalizer" as const,
  },
  {
    id: "22222222-2222-4222-8222-222222222204",
    displayName: "Casey Reed",
    preset: "proposal_personalizer" as const,
  },
  {
    id: "22222222-2222-4222-8222-222222222205",
    displayName: "Taylor Reed",
    preset: "proposal_personalizer" as const,
  },
  {
    id: "22222222-2222-4222-8222-222222222206",
    displayName: "Rowan Reed",
    preset: "proposal_personalizer" as const,
  },
] as const;

function fail(code: StoreErrorCode, message: string, extra?: Record<string, unknown>): never {
  throw Object.assign(new Error(message), { code, ...extra });
}

function normalizedLogin(loginName: string): string {
  return loginName.trim().toLowerCase();
}

function legacyCapabilities(grants: Grant[]): string {
  return JSON.stringify(
    grants.includes("routine.shared.manage")
      ? ["manage_routine", "execute_own_occurrence"]
      : ["execute_own_occurrence"],
  );
}

function isValidHouseholdDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isoAt(date: Date): string {
  return date.toISOString();
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

export class AppStore {
  constructor(private readonly db: Database.Database) {}

  hasGrant(ctx: AuthContext, grant: Grant): boolean {
    return ctx.grants.includes(grant);
  }

  seed(timezone: string): void {
    if (this.db.prepare("SELECT 1 FROM households LIMIT 1").get()) return;

    const createdAt = nowUtcIso();
    const tx = this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO households (id, name, timezone) VALUES (?, ?, ?)")
        .run(SEED.household.id, "Reed Household", timezone);

      const insertMember = this.db.prepare(
        `INSERT INTO members (id, household_id, display_name, capabilities_json)
         VALUES (?, ?, ?, ?)`,
      );
      const insertMembership = this.db.prepare(
        `INSERT INTO household_memberships
         (id, household_id, user_id, display_name, status, created_at)
         VALUES (?, ?, NULL, ?, 'pending', ?)`,
      );
      const insertGrant = this.db.prepare(
        "INSERT INTO membership_grants (membership_id, grant_name) VALUES (?, ?)",
      );
      for (const member of FIXTURE_MEMBERS) {
        const grants = GRANT_PRESETS[member.preset];
        insertMember.run(
          member.id,
          SEED.household.id,
          member.displayName,
          legacyCapabilities(grants),
        );
        insertMembership.run(member.id, SEED.household.id, member.displayName, createdAt);
        for (const grant of grants) insertGrant.run(member.id, grant);
      }
    });
    tx();
  }

  getSessionByTokenDigest(digest: string): AuthContext | null {
    const row = this.db
      .prepare(
        `SELECT s.id session_id, s.user_id, s.membership_id, s.csrf_secret,
                s.created_at, s.last_seen_at, s.absolute_expires_at,
                hm.household_id, hm.display_name, h.timezone
         FROM auth_sessions s
         JOIN users u ON u.id = s.user_id AND u.disabled = 0
         JOIN household_memberships hm
           ON hm.id = s.membership_id AND hm.user_id = s.user_id AND hm.status = 'active'
         JOIN households h ON h.id = hm.household_id
         WHERE s.token_digest = ? AND s.revoked_at IS NULL`,
      )
      .get(digest) as
      | {
          session_id: string;
          user_id: string;
          membership_id: string;
          csrf_secret: string;
          created_at: string;
          last_seen_at: string;
          absolute_expires_at: string;
          household_id: string;
          display_name: string;
          timezone: string;
        }
      | undefined;
    if (!row) return null;

    const now = new Date();
    const idleExpired = now.getTime() - new Date(row.last_seen_at).getTime() > IDLE_MS;
    const absoluteExpired = now >= new Date(row.absolute_expires_at);
    if (idleExpired || absoluteExpired) {
      this.db
        .prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ?")
        .run(isoAt(now), row.session_id);
      return null;
    }

    this.db
      .prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?")
      .run(isoAt(now), row.session_id);
    return this.authContextFromRow(row);
  }

  createSession(
    userId: string,
    membershipId: string,
  ): { token: string; csrfSecret: string; context: AuthContext } {
    const row = this.db
      .prepare(
        `SELECT hm.household_id, hm.display_name, h.timezone
         FROM household_memberships hm
         JOIN users u ON u.id = hm.user_id AND u.disabled = 0
         JOIN households h ON h.id = hm.household_id
         WHERE hm.id = ? AND hm.user_id = ? AND hm.status = 'active'`,
      )
      .get(membershipId, userId) as
      | { household_id: string; display_name: string; timezone: string }
      | undefined;
    if (!row) fail("UNAUTHORIZED", "Authentication required");

    const token = randomToken();
    const csrfSecret = randomToken();
    const sessionId = randomUUID();
    const now = new Date();
    this.db
      .prepare(
        `INSERT INTO auth_sessions
         (id, user_id, membership_id, token_digest, csrf_secret, created_at,
          last_seen_at, absolute_expires_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        sessionId,
        userId,
        membershipId,
        sha256Hex(token),
        csrfSecret,
        isoAt(now),
        isoAt(now),
        isoAt(new Date(now.getTime() + ABSOLUTE_MS)),
      );

    return {
      token,
      csrfSecret,
      context: {
        sessionId,
        userId,
        membershipId,
        householdId: row.household_id,
        displayName: row.display_name,
        grants: this.grantsForMembership(membershipId),
        timezone: row.timezone,
        csrfSecret,
      },
    };
  }

  revokeSession(sessionId: string): void {
    this.db
      .prepare("UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?")
      .run(nowUtcIso(), sessionId);
  }

  revokeUserSessions(userId: string): void {
    this.db
      .prepare(
        "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?",
      )
      .run(nowUtcIso(), userId);
  }

  async login(
    loginName: string,
    passphrase: string,
    now = new Date(),
  ): Promise<
    | { token: string; csrfSecret: string; context: AuthContext }
    | { error: "auth" | "throttled"; retryAfterSec?: number }
  > {
    const key = normalizedLogin(loginName);
    const throttle = this.loginThrottle(key, now);
    if (throttle > 0) return { error: "throttled", retryAfterSec: throttle };

    const user = this.db
      .prepare(
        `SELECT u.id, u.disabled, c.passphrase_phc
         FROM users u
         JOIN user_credentials c ON c.user_id = u.id
         WHERE u.login_name = ?`,
      )
      .get(key) as
      | { id: string; disabled: number; passphrase_phc: string }
      | undefined;
    const valid =
      !!user &&
      user.disabled === 0 &&
      (await verifyPassphrase(user.passphrase_phc, passphrase));
    if (!valid || !user) {
      const retryAfterSec = this.recordLoginFailure(key, now);
      return retryAfterSec
        ? { error: "throttled", retryAfterSec }
        : { error: "auth" };
    }

    const memberships = this.db
      .prepare(
        `SELECT id FROM household_memberships
         WHERE user_id = ? AND status = 'active' ORDER BY created_at`,
      )
      .all(user.id) as Array<{ id: string }>;
    if (memberships.length !== 1) {
      const retryAfterSec = this.recordLoginFailure(key, now);
      return retryAfterSec
        ? { error: "throttled", retryAfterSec }
        : { error: "auth" };
    }

    this.db.prepare("DELETE FROM login_throttle WHERE key = ?").run(key);
    return this.createSession(user.id, memberships[0].id);
  }

  async claim(input: {
    claimToken: string;
    loginName: string;
    passphrase: string;
    displayName: string;
  }): Promise<{ token: string; csrfSecret: string; context: AuthContext }> {
    const loginName = normalizedLogin(input.loginName);
    if (!LOGIN_RE.test(loginName)) fail("VALIDATION", "Invalid login name");
    const policy = this.validatePassphrasePolicy(input.passphrase);
    if (!policy.ok) fail("VALIDATION", policy.message ?? "Invalid passphrase");
    const displayName = input.displayName.trim();
    if (!displayName || displayName.length > 80) {
      fail("VALIDATION", "Display name must be between 1 and 80 characters");
    }

    const digest = sha256Hex(input.claimToken);
    const claim = this.db
      .prepare(
        `SELECT * FROM enrollment_claims
         WHERE token_digest = ? AND consumed_at IS NULL AND revoked_at IS NULL`,
      )
      .get(digest) as
      | {
          id: string;
          household_id: string;
          membership_id: string | null;
          token_digest: string;
          preset: GrantPreset;
          expires_at: string;
        }
      | undefined;
    if (
      !claim ||
      !digestEquals(claim.token_digest, digest) ||
      new Date(claim.expires_at) <= new Date()
    ) {
      fail("UNAUTHORIZED", "Claim is invalid or expired");
    }

    const existingUser = this.db
      .prepare("SELECT 1 FROM users WHERE login_name = ?")
      .get(loginName);
    if (existingUser) fail("UNAUTHORIZED", "Claim could not be completed");

    const passphrasePhc = await hashPassphrase(input.passphrase);
    const userId = randomUUID();
    const membershipId = claim.membership_id ?? randomUUID();
    const createdAt = nowUtcIso();
    const grants = GRANT_PRESETS[claim.preset];

    const tx = this.db.transaction(() => {
      const fresh = this.db
        .prepare(
          `SELECT consumed_at, expires_at, revoked_at FROM enrollment_claims WHERE id = ?`,
        )
        .get(claim.id) as {
        consumed_at: string | null;
        expires_at: string;
        revoked_at: string | null;
      };
      if (
        fresh.consumed_at ||
        fresh.revoked_at ||
        new Date(fresh.expires_at) <= new Date()
      ) {
        fail("UNAUTHORIZED", "Claim is invalid or expired");
      }

      this.db
        .prepare("INSERT INTO users (id, login_name, created_at, disabled) VALUES (?, ?, ?, 0)")
        .run(userId, loginName, createdAt);
      this.db
        .prepare(
          "INSERT INTO user_credentials (user_id, passphrase_phc, updated_at) VALUES (?, ?, ?)",
        )
        .run(userId, passphrasePhc, createdAt);

      const existingMembership = this.db
        .prepare(
          `SELECT id FROM household_memberships
           WHERE id = ? AND household_id = ? AND user_id IS NULL AND status = 'pending'`,
        )
        .get(membershipId, claim.household_id);
      if (claim.membership_id && !existingMembership) {
        fail("CONFLICT", "Membership is no longer claimable");
      }
      if (existingMembership) {
        this.db
          .prepare(
            `UPDATE household_memberships
             SET user_id = ?, display_name = ?, status = 'active' WHERE id = ?`,
          )
          .run(userId, displayName, membershipId);
        this.db
          .prepare(
            "UPDATE members SET display_name = ?, capabilities_json = ? WHERE id = ?",
          )
          .run(displayName, legacyCapabilities(grants), membershipId);
      } else {
        this.insertCompatibleMembership(
          membershipId,
          claim.household_id,
          userId,
          displayName,
          "active",
          createdAt,
          grants,
        );
      }

      this.replaceGrants(membershipId, grants);
      this.db
        .prepare("UPDATE enrollment_claims SET consumed_at = ? WHERE id = ?")
        .run(createdAt, claim.id);
      this.db
        .prepare(
          `UPDATE enrollment_claims
           SET revoked_at = COALESCE(revoked_at, ?)
           WHERE membership_id = ? AND id != ? AND consumed_at IS NULL AND revoked_at IS NULL`,
        )
        .run(createdAt, membershipId, claim.id);
    });
    tx();
    return this.createSession(userId, membershipId);
  }

  issueBootstrapClaim(): { token: string; expiresAt: string } {
    const activeManager = this.db
      .prepare(
        `SELECT 1
         FROM household_memberships hm
         JOIN membership_grants mg ON mg.membership_id = hm.id
         JOIN users u ON u.id = hm.user_id AND u.disabled = 0
         WHERE hm.status = 'active' AND mg.grant_name = 'household.member.enroll'
         LIMIT 1`,
      )
      .get();
    if (activeManager) fail("CONFLICT", "An active manager already exists");

    let household = this.db
      .prepare("SELECT id FROM households ORDER BY id LIMIT 1")
      .get() as { id: string } | undefined;
    if (!household) {
      this.seed("UTC");
      household = { id: SEED.household.id };
    }
    const manager = this.db
      .prepare(
        `SELECT hm.id
         FROM household_memberships hm
         JOIN membership_grants mg ON mg.membership_id = hm.id
         WHERE hm.household_id = ? AND hm.status = 'pending'
           AND mg.grant_name = 'household.member.enroll'
         ORDER BY hm.created_at LIMIT 1`,
      )
      .get(household.id) as { id: string } | undefined;

    this.db
      .prepare(
        `UPDATE enrollment_claims SET consumed_at = ?
         WHERE kind = 'bootstrap' AND consumed_at IS NULL`,
      )
      .run(nowUtcIso());
    return this.insertClaim({
      householdId: household.id,
      membershipId: manager?.id ?? null,
      displayName: null,
      preset: "manager",
      creatorMembershipId: null,
      kind: "bootstrap",
    });
  }

  issueEnrollmentClaim(
    ctx: AuthContext,
    input: { mutationId: string; membershipId: string; preset: GrantPreset },
  ): {
    claimId: string;
    membershipId: string;
    expiresAt: string;
    accessState: AccessState;
    secretAlreadyIssued: boolean;
    token?: string;
  } {
    this.requireGrant(ctx, "household.member.enroll");
    if (!GRANT_PRESETS[input.preset]) fail("VALIDATION", "Invalid grant preset");

    const prior = this.readStructureReceipt(input.mutationId, "setup_issue");
    if (prior) {
      return prior as {
        claimId: string;
        membershipId: string;
        expiresAt: string;
        accessState: AccessState;
        secretAlreadyIssued: boolean;
      };
    }

    const membership = this.db
      .prepare(
        `SELECT id, display_name FROM household_memberships
         WHERE id = ? AND household_id = ? AND status = 'pending' AND user_id IS NULL`,
      )
      .get(input.membershipId, ctx.householdId) as
      | { id: string; display_name: string }
      | undefined;
    if (!membership) fail("NOT_FOUND", "Membership not found");

    let issued!: {
      claimId: string;
      membershipId: string;
      expiresAt: string;
      accessState: AccessState;
      secretAlreadyIssued: boolean;
      token?: string;
    };
    const tx = this.db.transaction(() => {
      const now = nowUtcIso();
      this.db
        .prepare(
          `UPDATE enrollment_claims
           SET revoked_at = COALESCE(revoked_at, ?)
           WHERE membership_id = ? AND consumed_at IS NULL AND revoked_at IS NULL`,
        )
        .run(now, input.membershipId);

      const claim = this.insertClaim({
        householdId: ctx.householdId,
        membershipId: input.membershipId,
        displayName: membership.display_name,
        preset: input.preset,
        creatorMembershipId: ctx.membershipId,
        kind: "enrollment",
      });
      const safe = {
        claimId: claim.claimId,
        membershipId: input.membershipId,
        expiresAt: claim.expiresAt,
        accessState: "setup_ready" as const,
        secretAlreadyIssued: true,
      };
      this.writeStructureReceipt(input.mutationId, "setup_issue", safe);
      issued = { ...safe, secretAlreadyIssued: false, token: claim.token };
    });
    tx();
    return issued;
  }

  cancelEnrollmentSetup(ctx: AuthContext, membershipId: string): {
    membershipId: string;
    accessState: AccessState;
  } {
    this.requireGrant(ctx, "household.member.enroll");
    const membership = this.db
      .prepare(
        `SELECT id FROM household_memberships
         WHERE id = ? AND household_id = ? AND status = 'pending' AND user_id IS NULL`,
      )
      .get(membershipId, ctx.householdId);
    if (!membership) fail("NOT_FOUND", "Membership not found");
    const now = nowUtcIso();
    this.db
      .prepare(
        `UPDATE enrollment_claims
         SET revoked_at = COALESCE(revoked_at, ?)
         WHERE membership_id = ? AND consumed_at IS NULL AND revoked_at IS NULL`,
      )
      .run(now, membershipId);
    return { membershipId, accessState: this.accessStateForMembership(membershipId) };
  }

  validatePassphrasePolicy(passphrase: string): { ok: boolean; message?: string } {
    const normalized = passphrase.normalize("NFC");
    const length = [...normalized].length;
    if (length < 15 || length > 128) {
      return { ok: false, message: "Passphrase must be between 15 and 128 characters" };
    }
    if (isCommonPassphrase(normalized)) {
      return { ok: false, message: "Choose a less common passphrase" };
    }
    return { ok: true };
  }

  householdDateNow(ctx: AuthContext, now = new Date()): HouseholdDate {
    return householdDateFromInstant(now, ctx.timezone);
  }

  listMemberships(householdId: string): MemberPublic[] {
    const rows = this.db
      .prepare(
        `SELECT id, display_name, status, classification, version
         FROM household_memberships
         WHERE household_id = ? ORDER BY display_name`,
      )
      .all(householdId) as Array<{
      id: string;
      display_name: string;
      status: "active" | "pending";
      classification: PersonClassification | null;
      version: number;
    }>;
    return rows.map((row) => this.toMemberPublic(row));
  }

  createPerson(
    ctx: AuthContext,
    input: {
      mutationId: string;
      displayName: string;
      classification: PersonClassification;
    },
  ): MemberPublic {
    this.requireGrant(ctx, "household.structure.manage");
    const prior = this.readStructureReceipt(input.mutationId, "person_create");
    if (prior) return prior as MemberPublic;

    const displayName = input.displayName.trim();
    if (!displayName || displayName.length > 80) {
      fail("VALIDATION", "Display name must be between 1 and 80 characters");
    }
    const id = randomUUID();
    const createdAt = nowUtcIso();
    const tx = this.db.transaction(() => {
      this.insertCompatibleMembership(
        id,
        ctx.householdId,
        null,
        displayName,
        "pending",
        createdAt,
        [],
      );
      this.db
        .prepare(
          `UPDATE household_memberships
           SET classification = ?, version = 1 WHERE id = ?`,
        )
        .run(input.classification, id);
    });
    tx();
    const person = this.requireMemberPublic(id, ctx.householdId);
    this.writeStructureReceipt(input.mutationId, "person_create", person);
    return person;
  }

  updatePerson(
    ctx: AuthContext,
    membershipId: string,
    input: {
      displayName: string;
      classification: PersonClassification | null;
      expectedVersion: number;
    },
  ): MemberPublic {
    this.requireGrant(ctx, "household.structure.manage");
    const displayName = input.displayName.trim();
    if (!displayName || displayName.length > 80) {
      fail("VALIDATION", "Display name must be between 1 and 80 characters");
    }
    const tx = this.db.transaction(() => {
      const current = this.db
        .prepare(
          `SELECT id, version FROM household_memberships
           WHERE id = ? AND household_id = ?`,
        )
        .get(membershipId, ctx.householdId) as
        | { id: string; version: number }
        | undefined;
      if (!current) fail("NOT_FOUND", "Person not found");
      if (current.version !== input.expectedVersion) {
        fail("CONFLICT", "Person was updated elsewhere; re-read and try again");
      }
      this.db
        .prepare(
          `UPDATE household_memberships
           SET display_name = ?, classification = ?, version = version + 1
           WHERE id = ?`,
        )
        .run(displayName, input.classification, membershipId);
      this.db
        .prepare("UPDATE members SET display_name = ? WHERE id = ?")
        .run(displayName, membershipId);
    });
    tx();
    return this.requireMemberPublic(membershipId, ctx.householdId);
  }

  getPersonDetail(ctx: AuthContext, membershipId: string): PersonDetail {
    const person = this.requireMemberPublic(membershipId, ctx.householdId);
    const groups = this.db
      .prepare(
        `SELECT g.id, g.name
         FROM household_groups g
         JOIN household_group_members gm ON gm.group_id = g.id
         WHERE g.household_id = ? AND gm.membership_id = ?
         ORDER BY lower(g.name)`,
      )
      .all(ctx.householdId, membershipId) as Array<{ id: string; name: string }>;
    const accessMeta = this.accessMetaForMembership(membershipId);
    return {
      ...person,
      groups,
      morningRoutine: this.currentDirectMorningRoutine(ctx, membershipId),
      access: accessMeta,
    };
  }

  listGroups(householdId: string): GroupPublic[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, version, created_at, updated_at
         FROM household_groups WHERE household_id = ? ORDER BY lower(name)`,
      )
      .all(householdId) as Array<{
      id: string;
      name: string;
      version: number;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((row) => this.toGroupPublic(row));
  }

  getGroup(householdId: string, groupId: string): GroupPublic {
    const row = this.db
      .prepare(
        `SELECT id, name, version, created_at, updated_at
         FROM household_groups WHERE id = ? AND household_id = ?`,
      )
      .get(groupId, householdId) as
      | {
          id: string;
          name: string;
          version: number;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) fail("NOT_FOUND", "Group not found");
    return this.toGroupPublic(row);
  }

  createGroup(
    ctx: AuthContext,
    input: { mutationId: string; name: string; membershipIds: string[] },
  ): GroupPublic {
    this.requireGrant(ctx, "household.structure.manage");
    const prior = this.readStructureReceipt(input.mutationId, "group_create");
    if (prior) return prior as GroupPublic;

    const name = input.name.trim();
    if (!name || name.length > 80) {
      fail("VALIDATION", "Group name must be between 1 and 80 characters");
    }
    const membershipIds = [...new Set(input.membershipIds)];
    const id = randomUUID();
    const now = nowUtcIso();
    const tx = this.db.transaction(() => {
      this.assertSameHouseholdMemberships(ctx.householdId, membershipIds);
      try {
        this.db
          .prepare(
            `INSERT INTO household_groups
             (id, household_id, name, version, created_at, updated_at)
             VALUES (?, ?, ?, 1, ?, ?)`,
          )
          .run(id, ctx.householdId, name, now, now);
      } catch (error) {
        if (isUniqueViolation(error)) {
          fail("CONFLICT", "A group with that name already exists");
        }
        throw error;
      }
      const insert = this.db.prepare(
        "INSERT INTO household_group_members (group_id, membership_id) VALUES (?, ?)",
      );
      for (const membershipId of membershipIds) insert.run(id, membershipId);
    });
    tx();
    const group = this.getGroup(ctx.householdId, id);
    this.writeStructureReceipt(input.mutationId, "group_create", group);
    return group;
  }

  updateGroup(
    ctx: AuthContext,
    groupId: string,
    input: { name: string; membershipIds: string[]; expectedVersion: number },
  ): GroupPublic {
    this.requireGrant(ctx, "household.structure.manage");
    const name = input.name.trim();
    if (!name || name.length > 80) {
      fail("VALIDATION", "Group name must be between 1 and 80 characters");
    }
    const membershipIds = [...new Set(input.membershipIds)];
    const now = nowUtcIso();
    const tx = this.db.transaction(() => {
      const current = this.db
        .prepare(
          `SELECT id, version FROM household_groups
           WHERE id = ? AND household_id = ?`,
        )
        .get(groupId, ctx.householdId) as
        | { id: string; version: number }
        | undefined;
      if (!current) fail("NOT_FOUND", "Group not found");
      if (current.version !== input.expectedVersion) {
        fail("CONFLICT", "Group was updated elsewhere; re-read and try again");
      }
      this.assertSameHouseholdMemberships(ctx.householdId, membershipIds);
      try {
        const result = this.db
          .prepare(
            `UPDATE household_groups
             SET name = ?, version = version + 1, updated_at = ?
             WHERE id = ? AND version = ?`,
          )
          .run(name, now, groupId, input.expectedVersion);
        if (result.changes !== 1) {
          fail("CONFLICT", "Group was updated elsewhere; re-read and try again");
        }
      } catch (error) {
        if (isUniqueViolation(error)) {
          fail("CONFLICT", "A group with that name already exists");
        }
        throw error;
      }
      this.db
        .prepare("DELETE FROM household_group_members WHERE group_id = ?")
        .run(groupId);
      const insert = this.db.prepare(
        "INSERT INTO household_group_members (group_id, membership_id) VALUES (?, ?)",
      );
      for (const membershipId of membershipIds) insert.run(groupId, membershipId);
    });
    tx();
    return this.getGroup(ctx.householdId, groupId);
  }

  deleteGroup(ctx: AuthContext, groupId: string): { ok: true } {
    this.requireGrant(ctx, "household.structure.manage");
    const tx = this.db.transaction(() => {
      const current = this.db
        .prepare(
          "SELECT id FROM household_groups WHERE id = ? AND household_id = ?",
        )
        .get(groupId, ctx.householdId);
      if (!current) fail("NOT_FOUND", "Group not found");
      this.db
        .prepare("DELETE FROM household_group_members WHERE group_id = ?")
        .run(groupId);
      this.db.prepare("DELETE FROM household_groups WHERE id = ?").run(groupId);
    });
    tx();
    return { ok: true };
  }

  getRoutine(householdId: string) {
    const definition = this.db
      .prepare("SELECT id, kind FROM routine_definitions WHERE household_id = ?")
      .get(householdId) as { id: string; kind: "morning" } | undefined;
    if (!definition) return null;
    const revisions = this.db
      .prepare(
        `SELECT id, effective_date, title, weekdays_json, created_at
         FROM routine_revisions WHERE definition_id = ? ORDER BY effective_date`,
      )
      .all(definition.id) as Array<{
      id: string;
      effective_date: string;
      title: string;
      weekdays_json: string;
      created_at: string;
    }>;
    return {
      id: definition.id,
      kind: definition.kind,
      revisions: revisions.map((revision) => ({
        id: revision.id,
        effectiveDate: revision.effective_date,
        title: revision.title,
        weekdays: JSON.parse(revision.weekdays_json) as number[],
        createdAt: revision.created_at,
        steps: this.revisionSteps(revision.id),
        assigneeMemberIds: this.revisionAssignees(revision.id),
      })),
    };
  }

  createRoutine(ctx: AuthContext, input: RoutineInput) {
    this.requireGrant(ctx, "routine.shared.manage");
    this.validateRoutineInput(ctx, input);
    if (this.getRoutine(ctx.householdId)) {
      fail("CONFLICT", "Household already has a Morning Routine");
    }
    const definitionId = randomUUID();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO routine_definitions (id, household_id, kind) VALUES (?, ?, 'morning')",
        )
        .run(definitionId, ctx.householdId);
      this.insertRevision(randomUUID(), definitionId, this.householdDateNow(ctx), input);
    });
    tx();
    return this.getRoutine(ctx.householdId);
  }

  createRevision(
    ctx: AuthContext,
    definitionId: string,
    input: RoutineInput & { effectiveDate?: string },
  ) {
    this.requireGrant(ctx, "routine.shared.manage");
    this.validateRoutineInput(ctx, input);
    if (
      !this.db
        .prepare("SELECT 1 FROM routine_definitions WHERE id = ? AND household_id = ?")
        .get(definitionId, ctx.householdId)
    ) {
      fail("NOT_FOUND", "Routine not found");
    }
    const minimum = addHouseholdDays(this.householdDateNow(ctx), 1);
    const effectiveDate = input.effectiveDate ?? minimum;
    if (
      !isValidHouseholdDate(effectiveDate) ||
      compareHouseholdDates(effectiveDate, minimum) < 0
    ) {
      fail("VALIDATION", "Revision must be effective no earlier than the next household day");
    }
    try {
      this.insertRevision(randomUUID(), definitionId, effectiveDate, input);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        fail("CONFLICT", "A revision already exists for that effective date");
      }
      throw error;
    }
    return this.getRoutine(ctx.householdId);
  }

  materializeForDate(ctx: AuthContext, householdDate: HouseholdDate): OccurrenceView[] {
    if (!isValidHouseholdDate(householdDate)) fail("VALIDATION", "Invalid household date");
    const routine = this.getRoutine(ctx.householdId);
    if (!routine) return [];
    const revision = selectRevisionForDate(routine.revisions, householdDate);
    if (!revision || !isDateApplicable(householdDate, revision.weekdays)) return [];

    const results: OccurrenceView[] = [];
    const tx = this.db.transaction(() => {
      for (const membershipId of revision.assigneeMemberIds) {
        results.push(
          this.ensureOccurrence(
            ctx.householdId,
            routine.id,
            revision,
            householdDate,
            membershipId,
          ),
        );
      }
    });
    tx();
    if (this.hasGrant(ctx, "routine.shared.manage")) return results;
    if (!this.hasGrant(ctx, "routine.execute.own")) return [];
    return results.filter((item) => item.accountableMemberId === ctx.membershipId);
  }

  setStepStatus(
    ctx: AuthContext,
    occurrenceId: string,
    stepId: string,
    input: { mutationId: string; status: StepStatus; performedAt: string },
  ) {
    const occurrence = this.db
      .prepare(
        `SELECT id, household_id, accountable_member_id
         FROM occurrences WHERE id = ?`,
      )
      .get(occurrenceId) as
      | { id: string; household_id: string; accountable_member_id: string }
      | undefined;
    if (!occurrence || occurrence.household_id !== ctx.householdId) {
      fail("NOT_FOUND", "Occurrence not found");
    }
    this.requireGrant(ctx, "routine.execute.own");
    if (occurrence.accountable_member_id !== ctx.membershipId) {
      fail("FORBIDDEN", "Cannot modify another member's occurrence");
    }
    const receipt = this.db
      .prepare("SELECT response_json FROM mutation_receipts WHERE mutation_id = ?")
      .get(input.mutationId) as { response_json: string } | undefined;
    if (receipt) {
      return JSON.parse(receipt.response_json) as {
        occurrence: OccurrenceView;
        report: Record<string, unknown>;
      };
    }
    const step = this.db
      .prepare(
        "SELECT id, obligation FROM occurrence_steps WHERE id = ? AND occurrence_id = ?",
      )
      .get(stepId, occurrenceId) as
      | { id: string; obligation: ObligationMeaning }
      | undefined;
    if (!step) fail("NOT_FOUND", "Step not found");
    try {
      assertStatusAllowed(step.obligation, input.status);
    } catch {
      fail("VALIDATION", "Status not allowed for this obligation");
    }
    if (Number.isNaN(new Date(input.performedAt).getTime()) || !input.performedAt.endsWith("Z")) {
      fail("VALIDATION", "Invalid performed instant");
    }

    const recordedAt = nowUtcIso();
    const reportId = randomUUID();
    const tx = this.db.transaction(() => {
      this.db
        .prepare("UPDATE occurrence_steps SET status = ? WHERE id = ?")
        .run(input.status, stepId);
      this.db
        .prepare("UPDATE occurrences SET version = version + 1 WHERE id = ?")
        .run(occurrenceId);
      this.db
        .prepare(
          `INSERT INTO step_reports
           (id, mutation_id, occurrence_id, occurrence_step_id, accountable_member_id,
            acting_member_id, performed_at, recorded_at, resulting_state)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          reportId,
          input.mutationId,
          occurrenceId,
          stepId,
          occurrence.accountable_member_id,
          ctx.membershipId,
          input.performedAt,
          recordedAt,
          input.status,
        );
      const payload = {
        occurrence: this.getOccurrenceById(occurrenceId)!,
        report: {
          id: reportId,
          mutationId: input.mutationId,
          occurrenceId,
          occurrenceStepId: stepId,
          accountableMemberId: occurrence.accountable_member_id,
          actingMemberId: ctx.membershipId,
          performedAt: input.performedAt,
          recordedAt,
          resultingState: input.status,
        },
      };
      this.db
        .prepare(
          "INSERT INTO mutation_receipts (mutation_id, response_json, created_at) VALUES (?, ?, ?)",
        )
        .run(input.mutationId, JSON.stringify(payload), recordedAt);
      return payload;
    });
    return tx();
  }

  historyForDate(ctx: AuthContext, householdDate: HouseholdDate): OccurrenceView[] {
    this.requireGrant(ctx, "routine.shared.manage");
    return this.materializeForDate(ctx, householdDate);
  }

  occurrenceSnapshotStructure(occurrenceId: string) {
    const occurrence = this.db
      .prepare(
        `SELECT id, revision_id, title, schedule_anchor, accountable_member_id, household_date
         FROM occurrences WHERE id = ?`,
      )
      .get(occurrenceId);
    if (!occurrence) return null;
    const steps = this.db
      .prepare(
        `SELECT position, text, obligation, source, logical_item_id
         FROM occurrence_steps WHERE occurrence_id = ? ORDER BY position`,
      )
      .all(occurrenceId);
    return { ...(occurrence as object), steps };
  }

  countStepReports(mutationId: string): number {
    return (
      this.db
        .prepare("SELECT COUNT(*) count FROM step_reports WHERE mutation_id = ?")
        .get(mutationId) as { count: number }
    ).count;
  }

  getOccurrenceById(occurrenceId: string): OccurrenceView | null {
    const row = this.db
      .prepare(
        `SELECT definition_id, household_date, accountable_member_id
         FROM occurrences WHERE id = ?`,
      )
      .get(occurrenceId) as
      | {
          definition_id: string;
          household_date: string;
          accountable_member_id: string;
        }
      | undefined;
    return row
      ? this.getOccurrenceView(
          row.definition_id,
          row.household_date,
          row.accountable_member_id,
        )
      : null;
  }

  savePersonalLayer(
    ctx: AuthContext,
    input: { additions: PersonalAdditionInput[]; effectiveDate?: string },
  ): PersonalLayer {
    this.requireGrant(ctx, "routine.personalize.direct");
    const routine = this.getRoutine(ctx.householdId);
    if (!routine) fail("NOT_FOUND", "Routine not found");
    const minimum = addHouseholdDays(this.householdDateNow(ctx), 1);
    const effectiveDate = input.effectiveDate ?? minimum;
    if (
      !isValidHouseholdDate(effectiveDate) ||
      compareHouseholdDates(effectiveDate, minimum) < 0
    ) {
      fail("VALIDATION", "Personal changes must be effective no earlier than tomorrow");
    }
    this.validatePersonalAdditions(input.additions);
    return this.insertPersonalLayer(
      ctx.membershipId,
      routine.id,
      effectiveDate,
      input.additions,
    );
  }

  getPersonalLayer(membershipId: string, date: string): PersonalLayer | null {
    const row = this.db
      .prepare(
        `SELECT id, membership_id, definition_id, effective_date, created_at
         FROM personal_routine_revisions
         WHERE membership_id = ? AND effective_date <= ?
         ORDER BY effective_date DESC LIMIT 1`,
      )
      .get(membershipId, date) as
      | {
          id: string;
          membership_id: string;
          definition_id: string;
          effective_date: string;
          created_at: string;
        }
      | undefined;
    if (!row) return null;
    const additions = this.db
      .prepare(
        `SELECT id, position, text, obligation, anchor_logical_item_id, place
         FROM personal_additions WHERE personal_revision_id = ? ORDER BY position`,
      )
      .all(row.id) as Array<{
      id: string;
      position: number;
      text: string;
      obligation: ObligationMeaning;
      anchor_logical_item_id: string | null;
      place: "before" | "after" | "end";
    }>;
    return {
      id: row.id,
      membershipId: row.membership_id,
      definitionId: row.definition_id,
      effectiveDate: row.effective_date,
      createdAt: row.created_at,
      additions: additions.map((addition) => ({
        id: addition.id,
        position: addition.position,
        text: addition.text,
        obligation: addition.obligation,
        anchorLogicalItemId: addition.anchor_logical_item_id,
        place: addition.place,
      })),
    };
  }

  previewComposition(ctx: AuthContext, membershipId: string, date: string) {
    this.authorizeMembershipView(ctx, membershipId);
    const routine = this.getRoutine(ctx.householdId);
    if (!routine) fail("NOT_FOUND", "Routine not found");
    const revision = selectRevisionForDate(routine.revisions, date);
    if (!revision) fail("NOT_FOUND", "No routine revision applies");
    const layer = this.getPersonalLayer(membershipId, date);
    return {
      householdDate: date,
      membershipId,
      definitionId: routine.id,
      revisionId: revision.id,
      personalRevisionId: layer?.id ?? null,
      title: revision.title,
      weekdays: revision.weekdays,
      steps: composeMorningRoutine(
        revision.steps.map((step) => ({
          logicalItemId: step.logicalItemId,
          text: step.text,
          obligation: step.obligation,
        })),
        layer?.additions.map((addition) => ({
          id: addition.id,
          text: addition.text,
          obligation: addition.obligation,
          anchorLogicalItemId: addition.anchorLogicalItemId,
          place: addition.place,
        })) ?? [],
      ).map((step, position) => ({ ...step, position })),
    };
  }

  createProposal(
    ctx: AuthContext,
    input: Omit<PersonalAdditionInput, "id">,
  ) {
    this.requireGrant(ctx, "routine.personalize.propose");
    this.validatePersonalAdditions([input]);
    const id = randomUUID();
    const proposedAt = nowUtcIso();
    this.db
      .prepare(
        `INSERT INTO routine_proposals
         (id, household_id, membership_id, text, obligation, anchor_logical_item_id,
          place, status, proposed_at, decided_at, decider_membership_id, personal_revision_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, NULL)`,
      )
      .run(
        id,
        ctx.householdId,
        ctx.membershipId,
        input.text.trim(),
        input.obligation,
        input.anchorLogicalItemId ?? null,
        input.place,
        proposedAt,
      );
    return this.getProposal(id)!;
  }

  listProposals(ctx: AuthContext) {
    const rows = this.hasGrant(ctx, "routine.proposal.decide")
      ? this.db
          .prepare(
            "SELECT id FROM routine_proposals WHERE household_id = ? ORDER BY proposed_at DESC",
          )
          .all(ctx.householdId)
      : this.db
          .prepare(
            `SELECT id FROM routine_proposals
             WHERE household_id = ? AND membership_id = ? ORDER BY proposed_at DESC`,
          )
          .all(ctx.householdId, ctx.membershipId);
    return (rows as Array<{ id: string }>).map((row) => this.getProposal(row.id)!);
  }

  decideProposal(
    ctx: AuthContext,
    proposalId: string,
    input: { decision: "approved" | "rejected" },
  ) {
    this.requireGrant(ctx, "routine.proposal.decide");
    const proposal = this.getProposal(proposalId);
    if (!proposal || proposal.householdId !== ctx.householdId) {
      fail("NOT_FOUND", "Proposal not found");
    }
    if (proposal.status !== "pending") {
      if (proposal.status === input.decision) return proposal;
      fail("CONFLICT", "Proposal has already been decided");
    }

    const decidedAt = nowUtcIso();
    const routine = this.getRoutine(ctx.householdId);
    if (!routine) fail("NOT_FOUND", "Routine not found");
    let personalRevisionId: string | null = null;
    const tx = this.db.transaction(() => {
      const current = this.getProposal(proposalId)!;
      if (current.status !== "pending") {
        if (current.status === input.decision) return;
        fail("CONFLICT", "Proposal has already been decided");
      }
      if (input.decision === "approved") {
        let effectiveDate = addHouseholdDays(this.householdDateNow(ctx), 1);
        while (
          this.db
            .prepare(
              `SELECT 1 FROM personal_routine_revisions
               WHERE membership_id = ? AND effective_date = ?`,
            )
            .get(proposal.membershipId, effectiveDate)
        ) {
          effectiveDate = addHouseholdDays(effectiveDate, 1);
        }
        const prior = this.getPersonalLayer(proposal.membershipId, effectiveDate);
        const layer = this.insertPersonalLayer(
          proposal.membershipId,
          routine.id,
          effectiveDate,
          [
            ...(prior?.additions ?? []),
            {
              id: randomUUID(),
              text: proposal.text,
              obligation: proposal.obligation,
              anchorLogicalItemId: proposal.anchorLogicalItemId,
              place: proposal.place,
            },
          ],
        );
        personalRevisionId = layer.id;
      }
      this.db
        .prepare(
          `UPDATE routine_proposals
           SET status = ?, decided_at = ?, decider_membership_id = ?, personal_revision_id = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(input.decision, decidedAt, ctx.membershipId, personalRevisionId, proposalId);
    });
    tx();
    return this.getProposal(proposalId)!;
  }

  createTask(
    ctx: AuthContext,
    input: { title: string; visibility: "private" | "household" },
  ) {
    this.requireGrant(ctx, "personal_task.create");
    const title = input.title.trim();
    if (!title || title.length > 200) fail("VALIDATION", "Invalid task title");
    if (input.visibility !== "private" && input.visibility !== "household") {
      fail("VALIDATION", "Invalid task visibility");
    }
    const id = randomUUID();
    const createdAt = nowUtcIso();
    this.db
      .prepare(
        `INSERT INTO personal_tasks
         (id, household_id, owner_membership_id, title, visibility, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
      )
      .run(
        id,
        ctx.householdId,
        ctx.membershipId,
        title,
        input.visibility,
        createdAt,
        createdAt,
      );
    return this.getTask(id)!;
  }

  listTasks(ctx: AuthContext) {
    const rows = this.db
      .prepare(
        `SELECT id FROM personal_tasks
         WHERE household_id = ?
           AND (owner_membership_id = ? OR visibility = 'household')
         ORDER BY created_at DESC`,
      )
      .all(ctx.householdId, ctx.membershipId) as Array<{ id: string }>;
    return rows.map((row) => this.getTask(row.id)!);
  }

  setTaskStatus(
    ctx: AuthContext,
    taskId: string,
    input: { mutationId: string; status: "open" | "completed" },
  ) {
    const task = this.getTask(taskId);
    if (!task || task.householdId !== ctx.householdId) fail("NOT_FOUND", "Task not found");
    if (task.ownerMembershipId !== ctx.membershipId) {
      fail("FORBIDDEN", "Only the task owner may change it");
    }
    const receipt = this.db
      .prepare("SELECT response_json FROM personal_task_mutations WHERE mutation_id = ?")
      .get(input.mutationId) as { response_json: string } | undefined;
    if (receipt) return JSON.parse(receipt.response_json) as ReturnType<AppStore["getTask"]>;
    if (input.status !== "open" && input.status !== "completed") {
      fail("VALIDATION", "Invalid task status");
    }
    const updatedAt = nowUtcIso();
    const tx = this.db.transaction(() => {
      this.db
        .prepare("UPDATE personal_tasks SET status = ?, updated_at = ? WHERE id = ?")
        .run(input.status, updatedAt, taskId);
      const response = this.getTask(taskId)!;
      this.db
        .prepare(
          `INSERT INTO personal_task_mutations
           (mutation_id, task_id, response_json, created_at) VALUES (?, ?, ?, ?)`,
        )
        .run(input.mutationId, taskId, JSON.stringify(response), updatedAt);
      return response;
    });
    return tx();
  }

  private authContextFromRow(row: {
    session_id: string;
    user_id: string;
    membership_id: string;
    household_id: string;
    display_name: string;
    timezone: string;
    csrf_secret: string;
  }): AuthContext {
    return {
      sessionId: row.session_id,
      userId: row.user_id,
      membershipId: row.membership_id,
      householdId: row.household_id,
      displayName: row.display_name,
      grants: this.grantsForMembership(row.membership_id),
      timezone: row.timezone,
      csrfSecret: row.csrf_secret,
    };
  }

  private grantsForMembership(membershipId: string): Grant[] {
    return (
      this.db
        .prepare(
          "SELECT grant_name FROM membership_grants WHERE membership_id = ? ORDER BY grant_name",
        )
        .all(membershipId) as Array<{ grant_name: Grant }>
    ).map((row) => row.grant_name);
  }

  private requireGrant(ctx: AuthContext, grant: Grant): void {
    if (!this.hasGrant(ctx, grant)) fail("FORBIDDEN", "Required authority is missing");
  }

  private replaceGrants(membershipId: string, grants: readonly Grant[]): void {
    this.db
      .prepare("DELETE FROM membership_grants WHERE membership_id = ?")
      .run(membershipId);
    const insert = this.db.prepare(
      "INSERT INTO membership_grants (membership_id, grant_name) VALUES (?, ?)",
    );
    for (const grant of grants) insert.run(membershipId, grant);
  }

  private insertCompatibleMembership(
    id: string,
    householdId: string,
    userId: string | null,
    displayName: string,
    status: "active" | "pending",
    createdAt: string,
    grants: readonly Grant[],
  ): void {
    this.db
      .prepare(
        `INSERT INTO members (id, household_id, display_name, capabilities_json)
         VALUES (?, ?, ?, ?)`,
      )
      .run(id, householdId, displayName, legacyCapabilities([...grants]));
    this.db
      .prepare(
        `INSERT INTO household_memberships
         (id, household_id, user_id, display_name, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, householdId, userId, displayName, status, createdAt);
    this.replaceGrants(id, grants);
  }

  private insertClaim(input: {
    householdId: string;
    membershipId: string | null;
    displayName: string | null;
    preset: GrantPreset;
    creatorMembershipId: string | null;
    kind: "bootstrap" | "enrollment";
  }): { claimId: string; token: string; expiresAt: string } {
    const token = randomToken();
    const claimId = randomUUID();
    const now = new Date();
    const expiresAt = isoAt(new Date(now.getTime() + CLAIM_MS));
    this.db
      .prepare(
        `INSERT INTO enrollment_claims
         (id, household_id, membership_id, token_digest, preset, display_name,
          created_by_membership_id, created_at, expires_at, consumed_at, kind, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
      )
      .run(
        claimId,
        input.householdId,
        input.membershipId,
        sha256Hex(token),
        input.preset,
        input.displayName,
        input.creatorMembershipId,
        isoAt(now),
        expiresAt,
        input.kind,
      );
    return { claimId, token, expiresAt };
  }

  private toMemberPublic(row: {
    id: string;
    display_name: string;
    status: "active" | "pending";
    classification: PersonClassification | null;
    version: number;
  }): MemberPublic {
    return {
      id: row.id,
      displayName: row.display_name,
      status: row.status,
      classification: row.classification,
      version: row.version,
      grants: this.grantsForMembership(row.id),
      accessState: this.accessStateForMembership(row.id),
    };
  }

  private requireMemberPublic(membershipId: string, householdId: string): MemberPublic {
    const row = this.db
      .prepare(
        `SELECT id, display_name, status, classification, version
         FROM household_memberships WHERE id = ? AND household_id = ?`,
      )
      .get(membershipId, householdId) as
      | {
          id: string;
          display_name: string;
          status: "active" | "pending";
          classification: PersonClassification | null;
          version: number;
        }
      | undefined;
    if (!row) fail("NOT_FOUND", "Person not found");
    return this.toMemberPublic(row);
  }

  private accessStateForMembership(membershipId: string): AccessState {
    return this.accessMetaForMembership(membershipId).state;
  }

  private accessMetaForMembership(membershipId: string): {
    state: AccessState;
    setupClaimId: string | null;
    setupCreatedAt: string | null;
    setupExpiresAt: string | null;
  } {
    const membership = this.db
      .prepare(
        `SELECT hm.user_id, u.disabled
         FROM household_memberships hm
         LEFT JOIN users u ON u.id = hm.user_id
         WHERE hm.id = ?`,
      )
      .get(membershipId) as
      | { user_id: string | null; disabled: number | null }
      | undefined;
    if (membership?.user_id && membership.disabled === 0) {
      return {
        state: "access_set_up",
        setupClaimId: null,
        setupCreatedAt: null,
        setupExpiresAt: null,
      };
    }

    const now = new Date();
    const actionable = this.db
      .prepare(
        `SELECT id, created_at, expires_at
         FROM enrollment_claims
         WHERE membership_id = ?
           AND kind = 'enrollment'
           AND consumed_at IS NULL
           AND revoked_at IS NULL
           AND expires_at > ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(membershipId, isoAt(now)) as
      | { id: string; created_at: string; expires_at: string }
      | undefined;
    if (actionable) {
      return {
        state: "setup_ready",
        setupClaimId: actionable.id,
        setupCreatedAt: actionable.created_at,
        setupExpiresAt: actionable.expires_at,
      };
    }

    const latest = this.db
      .prepare(
        `SELECT id, created_at, expires_at, consumed_at
         FROM enrollment_claims
         WHERE membership_id = ?
           AND kind = 'enrollment'
           AND revoked_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(membershipId) as
      | {
          id: string;
          created_at: string;
          expires_at: string;
          consumed_at: string | null;
        }
      | undefined;
    if (
      latest &&
      !latest.consumed_at &&
      new Date(latest.expires_at) <= now
    ) {
      return {
        state: "setup_expired",
        setupClaimId: latest.id,
        setupCreatedAt: latest.created_at,
        setupExpiresAt: latest.expires_at,
      };
    }
    return {
      state: "not_set_up",
      setupClaimId: null,
      setupCreatedAt: null,
      setupExpiresAt: null,
    };
  }

  private currentDirectMorningRoutine(
    ctx: AuthContext,
    membershipId: string,
  ): PersonDetail["morningRoutine"] {
    const definition = this.db
      .prepare("SELECT id FROM routine_definitions WHERE household_id = ?")
      .get(ctx.householdId) as { id: string } | undefined;
    if (!definition) {
      return {
        currentlyAssigned: false,
        revisionId: null,
        revisionTitle: null,
        effectiveDate: null,
      };
    }
    const revisions = this.db
      .prepare(
        `SELECT id, effective_date, title, weekdays_json
         FROM routine_revisions WHERE definition_id = ? ORDER BY effective_date`,
      )
      .all(definition.id) as Array<{
      id: string;
      effective_date: string;
      title: string;
      weekdays_json: string;
    }>;
    const householdDate = this.householdDateNow(ctx);
    const selected = selectRevisionForDate(
      revisions.map((revision) => ({
        id: revision.id,
        effectiveDate: revision.effective_date,
        weekdays: JSON.parse(revision.weekdays_json) as number[],
      })),
      householdDate,
    );
    if (!selected) {
      return {
        currentlyAssigned: false,
        revisionId: null,
        revisionTitle: null,
        effectiveDate: null,
      };
    }
    const assigned = !!this.db
      .prepare(
        "SELECT 1 FROM revision_assignees WHERE revision_id = ? AND member_id = ?",
      )
      .get(selected.id, membershipId);
    const revision = revisions.find((row) => row.id === selected.id)!;
    return {
      currentlyAssigned: assigned,
      revisionId: revision.id,
      revisionTitle: revision.title,
      effectiveDate: revision.effective_date,
    };
  }

  private toGroupPublic(row: {
    id: string;
    name: string;
    version: number;
    created_at: string;
    updated_at: string;
  }): GroupPublic {
    const membershipIds = (
      this.db
        .prepare(
          `SELECT membership_id FROM household_group_members
           WHERE group_id = ? ORDER BY membership_id`,
        )
        .all(row.id) as Array<{ membership_id: string }>
    ).map((entry) => entry.membership_id);
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      membershipIds,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private assertSameHouseholdMemberships(
    householdId: string,
    membershipIds: string[],
  ): void {
    for (const membershipId of membershipIds) {
      if (
        !this.db
          .prepare(
            "SELECT 1 FROM household_memberships WHERE id = ? AND household_id = ?",
          )
          .get(membershipId, householdId)
      ) {
        fail("NOT_FOUND", "Membership not found");
      }
    }
  }

  private readStructureReceipt(
    mutationId: string,
    kind: "person_create" | "group_create" | "setup_issue",
  ): unknown | null {
    const row = this.db
      .prepare(
        `SELECT response_json FROM structure_mutation_receipts
         WHERE mutation_id = ? AND kind = ?`,
      )
      .get(mutationId, kind) as { response_json: string } | undefined;
    return row ? (JSON.parse(row.response_json) as unknown) : null;
  }

  private writeStructureReceipt(
    mutationId: string,
    kind: "person_create" | "group_create" | "setup_issue",
    response: unknown,
  ): void {
    this.db
      .prepare(
        `INSERT INTO structure_mutation_receipts
         (mutation_id, kind, response_json, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(mutationId, kind, JSON.stringify(response), nowUtcIso());
  }

  private loginThrottle(key: string, now: Date): number {
    const row = this.db
      .prepare("SELECT blocked_until FROM login_throttle WHERE key = ?")
      .get(key) as { blocked_until: string | null } | undefined;
    if (!row?.blocked_until) return 0;
    const remaining = new Date(row.blocked_until).getTime() - now.getTime();
    return remaining > 0 ? Math.ceil(remaining / 1_000) : 0;
  }

  private recordLoginFailure(key: string, now: Date): number {
    const row = this.db
      .prepare(
        "SELECT fail_count, window_started_at FROM login_throttle WHERE key = ?",
      )
      .get(key) as
      | { fail_count: number; window_started_at: string }
      | undefined;
    const windowExpired =
      !row ||
      now.getTime() - new Date(row.window_started_at).getTime() >= LOGIN_WINDOW_MS;
    const count = windowExpired ? 1 : row.fail_count + 1;
    const windowStartedAt = windowExpired ? isoAt(now) : row.window_started_at;
    const blockedUntil =
      count >= 5 ? isoAt(new Date(now.getTime() + LOGIN_BLOCK_MS)) : null;
    this.db
      .prepare(
        `INSERT INTO login_throttle (key, fail_count, window_started_at, blocked_until)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           fail_count = excluded.fail_count,
           window_started_at = excluded.window_started_at,
           blocked_until = excluded.blocked_until`,
      )
      .run(key, count, windowStartedAt, blockedUntil);
    return blockedUntil ? Math.ceil(LOGIN_BLOCK_MS / 1_000) : 0;
  }

  private revisionSteps(revisionId: string) {
    return (
      this.db
        .prepare(
          `SELECT id, logical_item_id, position, text, obligation
           FROM revision_steps WHERE revision_id = ? ORDER BY position`,
        )
        .all(revisionId) as Array<{
        id: string;
        logical_item_id: string | null;
        position: number;
        text: string;
        obligation: ObligationMeaning;
      }>
    ).map((step) => ({
      id: step.id,
      logicalItemId: step.logical_item_id ?? step.id,
      position: step.position,
      text: step.text,
      obligation: step.obligation,
    }));
  }

  private revisionAssignees(revisionId: string): string[] {
    return (
      this.db
        .prepare(
          "SELECT member_id FROM revision_assignees WHERE revision_id = ? ORDER BY member_id",
        )
        .all(revisionId) as Array<{ member_id: string }>
    ).map((row) => row.member_id);
  }

  private validateRoutineInput(ctx: AuthContext, input: RoutineInput): void {
    const check = validateRoutineSteps(input.steps);
    if (!check.ok) fail("VALIDATION", check.message);
    if (!input.title.trim()) fail("VALIDATION", "Routine title is required");
    if (
      input.weekdays.length === 0 ||
      input.weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
    ) {
      fail("VALIDATION", "At least one valid weekday is required");
    }
    if (new Set(input.weekdays).size !== input.weekdays.length) {
      fail("VALIDATION", "Weekdays must be unique");
    }
    if (input.assigneeMemberIds.length === 0) {
      fail("VALIDATION", "At least one assignee is required");
    }
    const uniqueAssignees = new Set(input.assigneeMemberIds);
    if (uniqueAssignees.size !== input.assigneeMemberIds.length) {
      fail("VALIDATION", "Assignees must be unique");
    }
    for (const membershipId of uniqueAssignees) {
      if (
        !this.db
          .prepare(
            "SELECT 1 FROM household_memberships WHERE id = ? AND household_id = ?",
          )
          .get(membershipId, ctx.householdId)
      ) {
        fail("VALIDATION", "An assignee is not a household membership");
      }
    }
    const logicalIds = input.steps
      .map((step) => step.logicalItemId)
      .filter((id): id is string => !!id);
    if (new Set(logicalIds).size !== logicalIds.length) {
      fail("VALIDATION", "Shared logical item IDs must be unique");
    }
  }

  private insertRevision(
    revisionId: string,
    definitionId: string,
    effectiveDate: string,
    input: RoutineInput,
  ): void {
    const previousRevision = this.db
      .prepare(
        `SELECT id FROM routine_revisions
         WHERE definition_id = ? AND effective_date < ?
         ORDER BY effective_date DESC LIMIT 1`,
      )
      .get(definitionId, effectiveDate) as { id: string } | undefined;
    const previousSteps = previousRevision
      ? this.revisionSteps(previousRevision.id)
      : [];
    const usedLogicalIds = new Set(
      input.steps.map((step) => step.logicalItemId).filter((id): id is string => !!id),
    );
    const logicalIds = input.steps.map((step, position) => {
      if (step.logicalItemId) return step.logicalItemId;
      const samePosition = previousSteps[position];
      if (
        samePosition &&
        samePosition.text === step.text.trim() &&
        samePosition.obligation === step.obligation &&
        !usedLogicalIds.has(samePosition.logicalItemId)
      ) {
        usedLogicalIds.add(samePosition.logicalItemId);
        return samePosition.logicalItemId;
      }
      const sameContent = previousSteps.find(
        (candidate) =>
          candidate.text === step.text.trim() &&
          candidate.obligation === step.obligation &&
          !usedLogicalIds.has(candidate.logicalItemId),
      );
      const logicalId = sameContent?.logicalItemId ?? randomUUID();
      usedLogicalIds.add(logicalId);
      return logicalId;
    });
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO routine_revisions
           (id, definition_id, effective_date, title, weekdays_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          revisionId,
          definitionId,
          effectiveDate,
          input.title.trim(),
          JSON.stringify(input.weekdays),
          nowUtcIso(),
        );
      const insertStep = this.db.prepare(
        `INSERT INTO revision_steps
         (id, revision_id, position, text, obligation, logical_item_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      input.steps.forEach((step, position) => {
        const rowId = randomUUID();
        insertStep.run(
          rowId,
          revisionId,
          position,
          step.text.trim(),
          step.obligation,
          logicalIds[position],
        );
      });
      const insertAssignee = this.db.prepare(
        "INSERT INTO revision_assignees (revision_id, member_id) VALUES (?, ?)",
      );
      for (const memberId of input.assigneeMemberIds) {
        insertAssignee.run(revisionId, memberId);
      }
    });
    tx();
  }

  private ensureOccurrence(
    householdId: string,
    definitionId: string,
    revision: {
      id: string;
      title: string;
      steps: Array<{
        logicalItemId: string;
        text: string;
        obligation: ObligationMeaning;
      }>;
    },
    householdDate: string,
    membershipId: string,
  ): OccurrenceView {
    let occurrence = this.db
      .prepare(
        `SELECT id FROM occurrences
         WHERE definition_id = ? AND household_date = ? AND accountable_member_id = ?`,
      )
      .get(definitionId, householdDate, membershipId) as { id: string } | undefined;
    if (!occurrence) {
      const occurrenceId = randomUUID();
      this.db
        .prepare(
          `INSERT INTO occurrences
           (id, household_id, definition_id, revision_id, household_date,
            accountable_member_id, title, schedule_anchor, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'morning', 1)`,
        )
        .run(
          occurrenceId,
          householdId,
          definitionId,
          revision.id,
          householdDate,
          membershipId,
          revision.title,
        );
      const personal = this.getPersonalLayer(membershipId, householdDate);
      const composed = composeMorningRoutine(
        revision.steps.map((step) => ({
          logicalItemId: step.logicalItemId,
          text: step.text,
          obligation: step.obligation,
        })),
        personal?.additions.map((addition) => ({
          id: addition.id,
          text: addition.text,
          obligation: addition.obligation,
          anchorLogicalItemId: addition.anchorLogicalItemId,
          place: addition.place,
        })) ?? [],
      );
      const insert = this.db.prepare(
        `INSERT INTO occurrence_steps
         (id, occurrence_id, position, text, obligation, status, source, logical_item_id)
         VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
      );
      composed.forEach((step, position) => {
        insert.run(
          randomUUID(),
          occurrenceId,
          position,
          step.text,
          step.obligation,
          step.source,
          step.logicalItemId,
        );
      });
      occurrence = { id: occurrenceId };
    } else {
      const occurrenceId = occurrence.id;
      const existing = this.getOccurrenceById(occurrenceId)!;
      if (existing.steps.length === 0 && revision.steps.length > 0) {
        const personal = this.getPersonalLayer(membershipId, householdDate);
        const composed = composeMorningRoutine(
          revision.steps.map((step) => ({
            logicalItemId: step.logicalItemId,
            text: step.text,
            obligation: step.obligation,
          })),
          personal?.additions.map((addition) => ({
            id: addition.id,
            text: addition.text,
            obligation: addition.obligation,
            anchorLogicalItemId: addition.anchorLogicalItemId,
            place: addition.place,
          })) ?? [],
        );
        const insert = this.db.prepare(
          `INSERT INTO occurrence_steps
           (id, occurrence_id, position, text, obligation, status, source, logical_item_id)
           VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
        );
        composed.forEach((step, position) => {
          insert.run(
            randomUUID(),
            occurrenceId,
            position,
            step.text,
            step.obligation,
            step.source,
            step.logicalItemId,
          );
        });
      }
    }
    return this.getOccurrenceById(occurrence.id)!;
  }

  private getOccurrenceView(
    definitionId: string,
    householdDate: string,
    membershipId: string,
  ): OccurrenceView | null {
    const row = this.db
      .prepare(
        `SELECT o.id, o.definition_id, o.revision_id, o.household_date, o.title,
                o.accountable_member_id, o.version, hm.display_name
         FROM occurrences o
         JOIN household_memberships hm ON hm.id = o.accountable_member_id
         WHERE o.definition_id = ? AND o.household_date = ?
           AND o.accountable_member_id = ?`,
      )
      .get(definitionId, householdDate, membershipId) as
      | {
          id: string;
          definition_id: string;
          revision_id: string;
          household_date: string;
          title: string;
          accountable_member_id: string;
          version: number;
          display_name: string;
        }
      | undefined;
    if (!row) return null;
    const steps = this.db
      .prepare(
        `SELECT id, position, text, obligation, status, source, logical_item_id
         FROM occurrence_steps WHERE occurrence_id = ? ORDER BY position`,
      )
      .all(row.id) as Array<{
      id: string;
      position: number;
      text: string;
      obligation: ObligationMeaning;
      status: StepStatus;
      source: "shared" | "personal";
      logical_item_id: string | null;
    }>;
    return {
      id: row.id,
      definitionId: row.definition_id,
      revisionId: row.revision_id,
      householdDate: row.household_date,
      title: row.title,
      scheduleAnchor: "morning",
      accountableMemberId: row.accountable_member_id,
      accountableMemberName: row.display_name,
      version: row.version,
      completed: isOccurrenceComplete(steps),
      steps: steps.map((step) => ({
        id: step.id,
        position: step.position,
        text: step.text,
        obligation: step.obligation,
        status: step.status,
        source: step.source,
        logicalItemId: step.logical_item_id,
      })),
    };
  }

  private validatePersonalAdditions(additions: PersonalAdditionInput[]): void {
    const ids = additions.map((addition) => addition.id).filter((id): id is string => !!id);
    if (new Set(ids).size !== ids.length) fail("VALIDATION", "Addition IDs must be unique");
    for (const addition of additions) {
      if (!addition.text.trim()) fail("VALIDATION", "Personal item text is required");
      if (!["required", "as_needed", "optional"].includes(addition.obligation)) {
        fail("VALIDATION", "Invalid personal item obligation");
      }
      if (!["before", "after", "end"].includes(addition.place)) {
        fail("VALIDATION", "Invalid personal item placement");
      }
    }
  }

  private insertPersonalLayer(
    membershipId: string,
    definitionId: string,
    effectiveDate: string,
    additions: PersonalAdditionInput[],
  ): PersonalLayer {
    const existing = this.getPersonalLayer(membershipId, effectiveDate);
    if (existing?.effectiveDate === effectiveDate) {
      const same =
        existing.definitionId === definitionId &&
        existing.additions.length === additions.length &&
        existing.additions.every((saved, position) => {
          const requested = additions[position];
          return (
            (!requested.id || requested.id === saved.id) &&
            requested.text.trim() === saved.text &&
            requested.obligation === saved.obligation &&
            (requested.anchorLogicalItemId ?? null) === saved.anchorLogicalItemId &&
            requested.place === saved.place
          );
        });
      if (same) return existing;
      fail("CONFLICT", "A personal revision already exists for that effective date");
    }
    const revisionId = randomUUID();
    const createdAt = nowUtcIso();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO personal_routine_revisions
           (id, membership_id, definition_id, effective_date, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(revisionId, membershipId, definitionId, effectiveDate, createdAt);
      const insert = this.db.prepare(
        `INSERT INTO personal_additions
         (id, personal_revision_id, position, text, obligation,
          anchor_logical_item_id, place)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      additions.forEach((addition, position) => {
        insert.run(
          addition.id ?? randomUUID(),
          revisionId,
          position,
          addition.text.trim(),
          addition.obligation,
          addition.anchorLogicalItemId ?? null,
          addition.place,
        );
      });
    });
    try {
      tx();
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        fail("CONFLICT", "A personal revision already exists for that effective date");
      }
      throw error;
    }
    return this.getPersonalLayer(membershipId, effectiveDate)!;
  }

  private authorizeMembershipView(ctx: AuthContext, membershipId: string): void {
    const membership = this.db
      .prepare("SELECT household_id FROM household_memberships WHERE id = ?")
      .get(membershipId) as { household_id: string } | undefined;
    if (!membership || membership.household_id !== ctx.householdId) {
      fail("NOT_FOUND", "Membership not found");
    }
    if (
      membershipId !== ctx.membershipId &&
      !this.hasGrant(ctx, "routine.shared.manage")
    ) {
      fail("FORBIDDEN", "Cannot preview another member's routine");
    }
  }

  private getProposal(id: string) {
    const row = this.db
      .prepare("SELECT * FROM routine_proposals WHERE id = ?")
      .get(id) as
      | {
          id: string;
          household_id: string;
          membership_id: string;
          text: string;
          obligation: ObligationMeaning;
          anchor_logical_item_id: string | null;
          place: "before" | "after" | "end";
          status: "pending" | "approved" | "rejected";
          proposed_at: string;
          decided_at: string | null;
          decider_membership_id: string | null;
          personal_revision_id: string | null;
        }
      | undefined;
    return row
      ? {
          id: row.id,
          householdId: row.household_id,
          membershipId: row.membership_id,
          text: row.text,
          obligation: row.obligation,
          anchorLogicalItemId: row.anchor_logical_item_id,
          place: row.place,
          status: row.status,
          proposedAt: row.proposed_at,
          decidedAt: row.decided_at,
          deciderMembershipId: row.decider_membership_id,
          personalRevisionId: row.personal_revision_id,
        }
      : null;
  }

  private getTask(id: string) {
    const row = this.db
      .prepare("SELECT * FROM personal_tasks WHERE id = ?")
      .get(id) as
      | {
          id: string;
          household_id: string;
          owner_membership_id: string;
          title: string;
          visibility: "private" | "household";
          status: "open" | "completed";
          created_at: string;
          updated_at: string;
        }
      | undefined;
    return row
      ? {
          id: row.id,
          householdId: row.household_id,
          ownerMembershipId: row.owner_membership_id,
          title: row.title,
          visibility: row.visibility,
          status: row.status,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          completedAt: row.status === "completed" ? row.updated_at : null,
        }
      : null;
  }
}
