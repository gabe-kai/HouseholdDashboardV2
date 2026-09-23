import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { isOccurrenceComplete, assertStatusAllowed } from "../domain/completion.js";
import { composeMorningRoutine } from "../domain/compose.js";
import {
  normalizeOptionalText,
  validateProfileFields,
} from "../domain/profile.js";
import {
  DEFAULT_APPLICABILITY,
  evaluateApplicability,
  isSchoolDayForDate,
  parseApplicability,
  ruleNeedsSchoolCalendar,
  serializeApplicability,
  type ApplicabilityRule,
} from "../domain/applicability.js";
import { validateSchoolCalendarDraft } from "../domain/school-calendar.js";
import {
  compareOccurrenceOrder,
  isBeforeArchiveCutoff,
  isDaypart,
  type Daypart,
} from "../domain/daypart.js";
import {
  isLockingStepStatus,
  isOccurrenceStarted,
} from "../domain/occurrence-lock.js";
import {
  intendedStructureMatches,
  normalizeDirectSources,
  resolveAccountableMembers,
  resolveParticipants,
  revisionIntervalActiveFrom,
  selectMembershipVersionForDate,
} from "../domain/participation.js";
import {
  selectScheduleEntryForDate,
} from "../domain/plan.js";
import {
  isDateApplicable,
  selectRevisionForDate,
  validateRoutineSteps,
} from "../domain/recurrence.js";
import {
  addHouseholdDays,
  compareHouseholdDates,
  householdDateFromInstant,
  isoWeekdayForHouseholdDate,
  isValidHouseholdDate,
  nowUtcIso,
  type HouseholdDate,
} from "../domain/time.js";
import { GRANT_PRESETS } from "../shared/grants.js";
import type {
  AccessState,
  ActivityClearResult,
  ClearRoutineActivityInput,
  FamilyOrderSaveResult,
  Grant,
  GrantPreset,
  GroupPublic,
  GroupRoutineReference,
  HistoryOccurrenceDetail,
  HistoryOccurrenceSummary,
  IntendedStructure,
  MemberPublic,
  ObligationMeaning,
  OccurrenceView,
  PersonClassification,
  PersonDetail,
  PlanRefineOutcome,
  ResponsibilityDefinitionPublic,
  ResponsibilityMutationResult,
  ResponsibilityPreviewDay,
  RoutineDefinitionPublic,
  RoutineMutationResult,
  RoutineRevisionPublic,
  ScheduleEntryPublic,
  SaveFamilyOrderInput,
  SaveSchoolCalendarInput,
  SchoolCalendarPublic,
  StepReportPublic,
  StepStatus,
  WorkKind,
} from "../shared/schemas.js";
import {
  digestEquals,
  hashPassphrase,
  randomToken,
  sha256Hex,
  verifyPassphrase,
} from "./crypto.js";
import { isCommonPassphrase } from "./password-blocklist.js";
import type { ComposedStep } from "../domain/responsibility-composition.js";
import type { AssignmentSpec, ScheduledAdditionSpec } from "../shared/schemas.js";
import {
  assignmentUsesGroup,
  insertResponsibilityPlan,
  loadResponsibilityPlan,
  normalizeAssignmentInput,
  normalizeScheduledAdditions,
  resolveResponsibilityComposition,
  shiftPlanAnchorsForBoundaryMove,
  updateResponsibilityPlan,
  validateResponsibilityPlan,
  type CompositionDeps,
  type StoredResponsibilityPlan,
} from "./responsibility-plan.js";
import {
  emptyRefineOutcome,
  loadScheduleEntryRows,
  mergeRefineOutcomes,
  reconcileDatesForRange,
  selectActiveEntryRowForDate,
  toScheduleEntryLike,
} from "./routine-plan.js";
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
  applicability?: ApplicabilityRule;
};

type RoutineInput = {
  mutationId: string;
  title: string;
  daypart: Daypart;
  assigneeMemberIds: string[];
  assigneeGroupIds: string[];
  weekdays: number[];
  steps: RoutineStepInput[];
  expectedVersion?: number;
};

type RevisionInput = RoutineInput & {
  effectiveDate?: string;
  mode?: "current" | "schedule";
  scheduleEntryId?: string;
};

type RoutineMutationKind =
  | "routine_create"
  | "routine_revision"
  | "routine_archive"
  | "routine_end"
  | "routine_delete"
  | "routine_schedule_move"
  | "routine_schedule_delete"
  | "responsibility_create"
  | "responsibility_revision"
  | "responsibility_end"
  | "responsibility_delete"
  | "responsibility_schedule_move"
  | "responsibility_schedule_delete";

type ResponsibilityInput = {
  mutationId: string;
  title: string;
  daypart: Daypart;
  accountableMemberId?: string;
  assignment?: AssignmentSpec;
  scheduledAdditions?: ScheduledAdditionSpec[];
  weekdays: number[];
  steps: RoutineStepInput[];
  expectedVersion?: number;
};

type ResponsibilityRevisionInput = ResponsibilityInput & {
  effectiveDate?: string;
  mode?: "current" | "schedule";
  scheduleEntryId?: string;
};

function sameMembershipSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort((x, y) => x.localeCompare(y));
  const right = [...b].sort((x, y) => x.localeCompare(y));
  return left.every((id, index) => id === right[index]);
}

function routinePayloadDigest(input: {
  definitionId?: string;
  title?: string;
  daypart?: Daypart;
  weekdays?: number[];
  steps?: RoutineStepInput[];
  assigneeMemberIds?: string[];
  assigneeGroupIds?: string[];
  effectiveDate?: string;
  expectedVersion?: number;
  mode?: string;
  scheduleEntryId?: string;
  startDate?: string;
}): string {
  const payload = {
    ...(input.definitionId ? { definitionId: input.definitionId } : {}),
    ...(input.title !== undefined ? { title: input.title.trim() } : {}),
    ...(input.daypart ? { daypart: input.daypart } : {}),
    ...(input.weekdays
      ? { weekdays: [...input.weekdays].sort((a, b) => a - b) }
      : {}),
    ...(input.steps
      ? {
          steps: input.steps.map((step) => ({
            text: step.text.trim(),
            obligation: step.obligation,
            ...(step.logicalItemId ? { logicalItemId: step.logicalItemId } : {}),
            ...(step.applicability ? { applicability: step.applicability } : {}),
          })),
        }
      : {}),
    assigneeMemberIds: [...(input.assigneeMemberIds ?? [])].sort((a, b) =>
      a.localeCompare(b),
    ),
    assigneeGroupIds: [...(input.assigneeGroupIds ?? [])].sort((a, b) =>
      a.localeCompare(b),
    ),
    ...(input.effectiveDate ? { effectiveDate: input.effectiveDate } : {}),
    ...(input.expectedVersion !== undefined
      ? { expectedVersion: input.expectedVersion }
      : {}),
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.scheduleEntryId ? { scheduleEntryId: input.scheduleEntryId } : {}),
    ...(input.startDate ? { startDate: input.startDate } : {}),
  };
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

type PersonalAdditionInput = {
  id?: string;
  text: string;
  obligation: ObligationMeaning;
  applicability?: ApplicabilityRule;
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
    applicability: ApplicabilityRule;
    anchorLogicalItemId: string | null;
    place: "before" | "after" | "end";
  }>;
};

function calendarPayloadDigest(input: SaveSchoolCalendarInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        expectedVersion: input.expectedVersion,
        years: input.years.map((year) => ({
          ...(year.id ? { id: year.id } : {}),
          startDate: year.startDate,
          endDate: year.endDate,
          usualWeekdays: [...new Set(year.usualWeekdays)].sort((a, b) => a - b),
          exceptions: year.exceptions.map((exception) => ({
            ...(exception.id ? { id: exception.id } : {}),
            name: exception.name.trim(),
            startDate: exception.startDate,
            endDate: exception.endDate,
          })),
        })),
      }),
      "utf8",
    )
    .digest("hex");
}

function familyOrderPayloadDigest(input: SaveFamilyOrderInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        expectedVersion: input.expectedVersion,
        membershipIds: input.membershipIds,
      }),
      "utf8",
    )
    .digest("hex");
}

function activityClearPayloadDigest(input: ClearRoutineActivityInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        expectedGeneration: input.expectedGeneration,
        ...(input.acknowledgedScope
          ? { acknowledgedScope: input.acknowledgedScope }
          : {}),
      }),
      "utf8",
    )
    .digest("hex");
}

function checklistMutationPayloadDigest(input: {
  occurrenceId: string;
  stepId: string;
  status: StepStatus;
  kind: WorkKind;
  intendedStructure?: IntendedStructure;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        occurrenceId: input.occurrenceId,
        stepId: input.stepId,
        status: input.status,
        kind: input.kind,
        ...(input.intendedStructure
          ? {
              intendedStructure: {
                revisionId: input.intendedStructure.revisionId,
                accountableMemberId: input.intendedStructure.accountableMemberId,
                stepLogicalIds: [...input.intendedStructure.stepLogicalIds],
                ...(input.intendedStructure.structureFingerprint
                  ? { structureFingerprint: input.intendedStructure.structureFingerprint }
                  : {}),
              },
            }
          : {}),
      }),
      "utf8",
    )
    .digest("hex");
}

function responsibilityToRoutineInput(input: ResponsibilityInput): RoutineInput {
  const fixedMemberId =
    input.accountableMemberId ??
    (input.assignment?.mode === "fixed" ? input.assignment.fixedMemberId : undefined);
  return {
    mutationId: input.mutationId,
    title: input.title,
    daypart: input.daypart,
    assigneeMemberIds: fixedMemberId ? [fixedMemberId] : [],
    assigneeGroupIds: [],
    weekdays: input.weekdays,
    steps: input.steps,
    expectedVersion: input.expectedVersion,
  };
}

function responsibilityRevisionToRoutineInput(
  input: ResponsibilityRevisionInput,
): RevisionInput {
  return {
    ...responsibilityToRoutineInput(input),
    effectiveDate: input.effectiveDate,
    mode: input.mode,
    scheduleEntryId: input.scheduleEntryId,
  };
}

const ACTIVITY_CLEARED_MESSAGE =
  "Routine history was cleared; refresh and try again";

const LOGIN_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const IDLE_MS = 7 * 24 * 60 * 60 * 1_000;
const ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1_000;
const CLAIM_MS = 24 * 60 * 60 * 1_000;
const LOGIN_WINDOW_MS = 15 * 60 * 1_000;
const LOGIN_BLOCK_MS = 60 * 1_000;

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

  /**
   * Test-only: invoked inside the calendar-save transaction after reconcile and
   * before the mutation receipt. Throwing rolls back calendar + occurrence writes.
   */
  private calendarSaveFailureHook: (() => void) | null = null;
  /** Test-only: after family-order writes, before receipt (AT5). */
  private familyOrderFailureHook: (() => void) | null = null;
  /** Test-only: after activity graph deletion, before reset receipt (AT11). */
  private clearActivityFailureHook: (() => void) | null = null;
  /** Test-only: after checklist writes, before mutation receipt (AT6). */
  private stepStatusFailureHook: (() => void) | null = null;
  /**
   * Test-only: after responsibility plan/reconcile writes, before mutation receipt
   * (P0-007B AT10). Throwing rolls back plan, occurrences, and receipt together.
   */
  private responsibilityPlanFailureHook: (() => void) | null = null;
  /**
   * Test-only: after group membership version + responsibility reconcile, before
   * return (P0-007B AT10). Throwing rolls back group + dependent occurrences.
   */
  private groupUpdateFailureHook: (() => void) | null = null;

  setCalendarSaveFailureHook(hook: (() => void) | null): void {
    this.calendarSaveFailureHook = hook;
  }

  setFamilyOrderFailureHook(hook: (() => void) | null): void {
    this.familyOrderFailureHook = hook;
  }

  setClearActivityFailureHook(hook: (() => void) | null): void {
    this.clearActivityFailureHook = hook;
  }

  setStepStatusFailureHook(hook: (() => void) | null): void {
    this.stepStatusFailureHook = hook;
  }

  setResponsibilityPlanFailureHook(hook: (() => void) | null): void {
    this.responsibilityPlanFailureHook = hook;
  }

  setGroupUpdateFailureHook(hook: (() => void) | null): void {
    this.groupUpdateFailureHook = hook;
  }

  hasGrant(ctx: AuthContext, grant: Grant): boolean {
    return ctx.grants.includes(grant);
  }

  seed(timezone: string): void {
    if (this.db.prepare("SELECT 1 FROM households LIMIT 1").get()) return;

    const createdAt = nowUtcIso();
    const tx = this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO households (id, name, timezone) VALUES (?, ?, ?)")
        .run(SEED.household.id, SEED.household.name, timezone);

      const insertMember = this.db.prepare(
        `INSERT INTO members (id, household_id, display_name, capabilities_json)
         VALUES (?, ?, ?, ?)`,
      );
      const insertMembership = this.db.prepare(
        `INSERT INTO household_memberships
         (id, household_id, user_id, display_name, status, created_at, sort_order)
         VALUES (?, ?, NULL, ?, 'pending', ?, ?)`,
      );
      const insertGrant = this.db.prepare(
        "INSERT INTO membership_grants (membership_id, grant_name) VALUES (?, ?)",
      );
      SEED.members.forEach((member, index) => {
        const grants = GRANT_PRESETS[member.preset];
        insertMember.run(
          member.id,
          SEED.household.id,
          member.displayName,
          legacyCapabilities(grants),
        );
        insertMembership.run(
          member.id,
          SEED.household.id,
          member.displayName,
          createdAt,
          index,
        );
        for (const grant of grants) insertGrant.run(member.id, grant);
      });
    });
    tx();
  }

  /** Create an empty household only — no demo people. Used by fixture-free bootstrap. */
  ensureEmptyHousehold(timezone: string): string {
    const existing = this.db
      .prepare("SELECT id FROM households ORDER BY id LIMIT 1")
      .get() as { id: string } | undefined;
    if (existing) return existing.id;
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO households (id, name, timezone) VALUES (?, ?, ?)")
      .run(id, "Household", timezone);
    return id;
  }

  issueBootstrapClaim(timezone = "UTC"): { token: string; expiresAt: string } {
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

    const householdId = this.ensureEmptyHousehold(timezone);

    // Prefer an existing pending enroll-capable membership (explicit demo seed),
    // otherwise issue a claim with no membership — claim creates the first manager.
    const manager = this.db
      .prepare(
        `SELECT hm.id
         FROM household_memberships hm
         JOIN membership_grants mg ON mg.membership_id = hm.id
         WHERE hm.household_id = ? AND hm.status = 'pending'
           AND mg.grant_name = 'household.member.enroll'
         ORDER BY hm.created_at LIMIT 1`,
      )
      .get(householdId) as { id: string } | undefined;

    this.db
      .prepare(
        `UPDATE enrollment_claims SET consumed_at = ?
         WHERE kind = 'bootstrap' AND consumed_at IS NULL`,
      )
      .run(nowUtcIso());
    return this.insertClaim({
      householdId,
      membershipId: manager?.id ?? null,
      displayName: null,
      preset: "manager",
      creatorMembershipId: null,
      kind: "bootstrap",
    });
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
             SET user_id = ?, display_name = ?, status = 'active',
                 version = version + 1
             WHERE id = ?`,
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
        this.db
          .prepare(
            `UPDATE households
             SET family_order_version = family_order_version + 1
             WHERE id = ?`,
          )
          .run(claim.household_id);
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
        `SELECT id, display_name, status, classification, version, sort_order
         FROM household_memberships
         WHERE household_id = ?
         ORDER BY sort_order, id`,
      )
      .all(householdId) as Array<{
      id: string;
      display_name: string;
      status: "active" | "pending";
      classification: PersonClassification | null;
      version: number;
      sort_order: number;
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
      const maxOrder = this.db
        .prepare(
          `SELECT COALESCE(MAX(sort_order), -1) AS max_order
           FROM household_memberships WHERE household_id = ?`,
        )
        .get(ctx.householdId) as { max_order: number };
      const sortOrder = maxOrder.max_order + 1;
      this.insertCompatibleMembership(
        id,
        ctx.householdId,
        null,
        displayName,
        "pending",
        createdAt,
        [],
        sortOrder,
      );
      this.db
        .prepare(
          `UPDATE household_memberships
           SET classification = ?, version = 1 WHERE id = ?`,
        )
        .run(input.classification, id);
      this.db
        .prepare(
          `UPDATE households
           SET family_order_version = family_order_version + 1
           WHERE id = ?`,
        )
        .run(ctx.householdId);
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
      fullName?: string | null;
      birthday?: string | null;
      email?: string | null;
      expectedVersion: number;
    },
  ): MemberPublic {
    this.requireGrant(ctx, "household.structure.manage");
    const today = this.householdDateNow(ctx);
    const issues = validateProfileFields({
      displayName: input.displayName,
      fullName: input.fullName,
      birthday: input.birthday,
      email: input.email,
      householdToday: today,
    });
    if (issues.length > 0) {
      fail("VALIDATION", issues[0]!.message, { validationIssues: issues });
    }
    const displayName = input.displayName.trim();
    const fullName =
      input.fullName === undefined ? undefined : normalizeOptionalText(input.fullName);
    const birthday =
      input.birthday === undefined ? undefined : normalizeOptionalText(input.birthday);
    const email =
      input.email === undefined ? undefined : normalizeOptionalText(input.email);

    const tx = this.db.transaction(() => {
      const current = this.db
        .prepare(
          `SELECT id, version, full_name, birthday, email FROM household_memberships
           WHERE id = ? AND household_id = ?`,
        )
        .get(membershipId, ctx.householdId) as
        | {
            id: string;
            version: number;
            full_name: string | null;
            birthday: string | null;
            email: string | null;
          }
        | undefined;
      if (!current) fail("NOT_FOUND", "Person not found");
      if (current.version !== input.expectedVersion) {
        fail("CONFLICT", "Person was updated elsewhere; re-read and try again");
      }
      const nextFullName = fullName === undefined ? current.full_name : fullName;
      const nextBirthday = birthday === undefined ? current.birthday : birthday;
      const nextEmail = email === undefined ? current.email : email;
      this.db
        .prepare(
          `UPDATE household_memberships
           SET display_name = ?, classification = ?, full_name = ?, birthday = ?,
               email = ?, version = version + 1
           WHERE id = ?`,
        )
        .run(
          displayName,
          input.classification,
          nextFullName,
          nextBirthday,
          nextEmail,
          membershipId,
        );
      this.db
        .prepare("UPDATE members SET display_name = ? WHERE id = ?")
        .run(displayName, membershipId);
    });
    tx();
    return this.requireMemberPublic(membershipId, ctx.householdId);
  }

  getPersonDetail(ctx: AuthContext, membershipId: string): PersonDetail {
    const person = this.requireMemberPublic(membershipId, ctx.householdId);
    const profile = this.db
      .prepare(
        `SELECT full_name, birthday, email FROM household_memberships
         WHERE id = ? AND household_id = ?`,
      )
      .get(membershipId, ctx.householdId) as
      | { full_name: string | null; birthday: string | null; email: string | null }
      | undefined;
    if (!profile) fail("NOT_FOUND", "Person not found");
    const groups = this.db
      .prepare(
        `SELECT g.id, g.name
         FROM household_groups g
         JOIN household_group_members gm ON gm.group_id = g.id
         WHERE g.household_id = ? AND gm.membership_id = ?
           AND g.deleted_at IS NULL
         ORDER BY lower(g.name)`,
      )
      .all(ctx.householdId, membershipId) as Array<{ id: string; name: string }>;
    const accessMeta = this.accessMetaForMembership(membershipId);
    const routines = this.personRoutineProjections(ctx, membershipId);
    const morningDef = routines.find((routine) => routine.daypart === "morning");
    let morningRoutine: PersonDetail["morningRoutine"] = {
      currentlyAssigned: false,
      revisionId: null,
      revisionTitle: null,
      effectiveDate: null,
    };
    if (morningDef) {
      const loaded = this.loadRoutineDefinition(ctx.householdId, morningDef.definitionId);
      const revision = loaded
        ? this.selectRevisionContentForDate(loaded, this.householdDateNow(ctx))
        : null;
      morningRoutine = {
        currentlyAssigned: morningDef.currentlyAssigned,
        revisionId: revision?.id ?? null,
        revisionTitle: morningDef.title,
        effectiveDate: morningDef.effectiveDate,
      };
    }
    return {
      ...person,
      fullName: profile.full_name,
      birthday: profile.birthday,
      email: profile.email,
      groups,
      routines,
      morningRoutine,
      access: accessMeta,
    };
  }

  listGroups(householdId: string): GroupPublic[] {
    const today = this.householdDateFor(householdId);
    const rows = this.db
      .prepare(
        `SELECT id, name, version, created_at, updated_at
         FROM household_groups
         WHERE household_id = ? AND deleted_at IS NULL
         ORDER BY lower(name)`,
      )
      .all(householdId) as Array<{
      id: string;
      name: string;
      version: number;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((row) => this.toGroupPublic(row, today));
  }

  getGroup(householdId: string, groupId: string): GroupPublic {
    const row = this.db
      .prepare(
        `SELECT id, name, version, created_at, updated_at
         FROM household_groups
         WHERE id = ? AND household_id = ? AND deleted_at IS NULL`,
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
    return this.toGroupPublic(row, this.householdDateFor(householdId));
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
    const effectiveDate = this.householdDateNow(ctx);
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
      const insertLive = this.db.prepare(
        "INSERT INTO household_group_members (group_id, membership_id) VALUES (?, ?)",
      );
      for (const membershipId of membershipIds) insertLive.run(id, membershipId);

      const versionId = `${id}:v1`;
      this.db
        .prepare(
          `INSERT INTO group_membership_versions
           (id, group_id, version, effective_date, created_at)
           VALUES (?, ?, 1, ?, ?)`,
        )
        .run(versionId, id, effectiveDate, now);
      const insertVersionMember = this.db.prepare(
        `INSERT INTO group_membership_version_members (version_id, membership_id)
         VALUES (?, ?)`,
      );
      for (const membershipId of membershipIds) {
        insertVersionMember.run(versionId, membershipId);
      }
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
    const today = this.householdDateNow(ctx);
    const tx = this.db.transaction(() => {
      const current = this.db
        .prepare(
          `SELECT id, name, version, deleted_at
           FROM household_groups
           WHERE id = ? AND household_id = ?`,
        )
        .get(groupId, ctx.householdId) as
        | { id: string; name: string; version: number; deleted_at: string | null }
        | undefined;
      if (!current || current.deleted_at) fail("NOT_FOUND", "Group not found");
      if (current.version !== input.expectedVersion) {
        fail("CONFLICT", "Group was updated elsewhere; re-read and try again");
      }
      this.assertSameHouseholdMemberships(ctx.householdId, membershipIds);

      const currentMembers = (
        this.db
          .prepare(
            `SELECT membership_id FROM household_group_members
             WHERE group_id = ? ORDER BY membership_id`,
          )
          .all(groupId) as Array<{ membership_id: string }>
      ).map((row) => row.membership_id);
      const membershipChanged = !sameMembershipSet(currentMembers, membershipIds);

      try {
        const result = this.db
          .prepare(
            `UPDATE household_groups
             SET name = ?, version = version + 1, updated_at = ?
             WHERE id = ? AND version = ? AND deleted_at IS NULL`,
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
      const insertLive = this.db.prepare(
        "INSERT INTO household_group_members (group_id, membership_id) VALUES (?, ?)",
      );
      for (const membershipId of membershipIds) insertLive.run(groupId, membershipId);

      if (membershipChanged) {
        const maxVersion = (
          this.db
            .prepare(
              `SELECT COALESCE(MAX(version), 0) AS max_version
               FROM group_membership_versions WHERE group_id = ?`,
            )
            .get(groupId) as { max_version: number }
        ).max_version;
        const nextVersion = maxVersion + 1;
        const versionId = randomUUID();
        const effectiveDate = addHouseholdDays(today, 1);
        this.db
          .prepare(
            `INSERT INTO group_membership_versions
             (id, group_id, version, effective_date, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(versionId, groupId, nextVersion, effectiveDate, now);
        const insertVersionMember = this.db.prepare(
          `INSERT INTO group_membership_version_members (version_id, membership_id)
           VALUES (?, ?)`,
        );
        for (const membershipId of membershipIds) {
          insertVersionMember.run(versionId, membershipId);
        }
        const reconcileFrom = addHouseholdDays(today, 1);
        for (const definitionId of this.findResponsibilitiesReferencingGroup(
          ctx.householdId,
          groupId,
        )) {
          this.reconcileOccurrenceRange(
            ctx.householdId,
            definitionId,
            reconcileFrom,
            null,
          );
        }
        this.groupUpdateFailureHook?.();
      }
    });
    tx();
    return this.getGroup(ctx.householdId, groupId);
  }

  deleteGroup(ctx: AuthContext, groupId: string): { ok: true } {
    this.requireGrant(ctx, "household.structure.manage");
    const today = this.householdDateNow(ctx);
    const tx = this.db.transaction(() => {
      const current = this.db
        .prepare(
          `SELECT id, deleted_at FROM household_groups
           WHERE id = ? AND household_id = ?`,
        )
        .get(groupId, ctx.householdId) as
        | { id: string; deleted_at: string | null }
        | undefined;
      if (!current || current.deleted_at) fail("NOT_FOUND", "Group not found");
      if (this.groupActivelyReferenced(groupId, today)) {
        fail(
          "CONFLICT",
          "Remove this group from routines before deleting it",
        );
      }
      this.db
        .prepare("DELETE FROM household_group_members WHERE group_id = ?")
        .run(groupId);
      this.db
        .prepare(
          `UPDATE household_groups
           SET deleted_at = ?, updated_at = ?, version = version + 1
           WHERE id = ?`,
        )
        .run(nowUtcIso(), nowUtcIso(), groupId);
    });
    tx();
    return { ok: true };
  }

  getSchoolCalendar(ctx: AuthContext): SchoolCalendarPublic {
    const current = this.db
      .prepare("SELECT version FROM household_calendars WHERE household_id = ?")
      .get(ctx.householdId) as { version: number } | undefined;
    if (!current || current.version === 0) {
      return {
        configured: false,
        version: 0,
        editionId: null,
        effectiveFrom: null,
        years: [],
      };
    }
    const edition = this.loadCalendarEditionByVersion(
      ctx.householdId,
      current.version,
    );
    if (!edition) fail("NOT_FOUND", "School calendar edition not found");
    return {
      configured: true,
      version: current.version,
      editionId: edition.id,
      effectiveFrom: edition.effectiveFrom,
      years: edition.years,
    };
  }

  saveSchoolCalendar(
    ctx: AuthContext,
    input: SaveSchoolCalendarInput,
  ): SchoolCalendarPublic {
    this.requireGrant(ctx, "household.schedule.manage");
    const digest = calendarPayloadDigest(input);
    const prior = this.db
      .prepare(
        `SELECT household_id, kind, payload_digest, response_json
         FROM calendar_mutation_receipts WHERE mutation_id = ?`,
      )
      .get(input.mutationId) as
      | {
          household_id: string;
          kind: string;
          payload_digest: string;
          response_json: string;
        }
      | undefined;
    if (prior) {
      if (
        prior.household_id !== ctx.householdId ||
        prior.kind !== "calendar_save" ||
        prior.payload_digest !== digest
      ) {
        fail("CONFLICT", "School calendar couldn't be updated");
      }
      return JSON.parse(prior.response_json) as SchoolCalendarPublic;
    }

    const issues = validateSchoolCalendarDraft(input.years);
    if (issues.length > 0) {
      fail("VALIDATION", issues[0]!.message, { validationIssues: issues });
    }
    const today = this.householdDateNow(ctx);
    const createdAt = nowUtcIso();
    const tx = this.db.transaction(() => {
      const current = this.db
        .prepare("SELECT version FROM household_calendars WHERE household_id = ?")
        .get(ctx.householdId) as { version: number } | undefined;
      const currentVersion = current?.version ?? 0;
      if (input.expectedVersion !== currentVersion) {
        fail("CONFLICT", "School calendar was updated elsewhere; reload and review");
      }
      const version = currentVersion + 1;
      const editionId = randomUUID();
      this.db
        .prepare(
          `INSERT INTO household_calendars (household_id, version, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(household_id) DO UPDATE SET
             version = excluded.version, updated_at = excluded.updated_at`,
        )
        .run(ctx.householdId, version, createdAt);
      this.db
        .prepare(
          `INSERT INTO school_calendar_editions
           (id, household_id, version, effective_from, created_at, mutation_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(editionId, ctx.householdId, version, today, createdAt, input.mutationId);
      const insertYear = this.db.prepare(
        `INSERT INTO school_years
         (id, edition_id, start_date, end_date, usual_weekdays_json, position)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const insertException = this.db.prepare(
        `INSERT INTO school_exceptions
         (id, year_id, name, start_date, end_date, position)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      input.years.forEach((year, position) => {
        // Each edition owns its own year/exception rows. Client-supplied ids are hints for
        // draft continuity only; reusing a prior edition's primary key would conflict.
        const yearId = randomUUID();
        insertYear.run(
          yearId,
          editionId,
          year.startDate,
          year.endDate,
          JSON.stringify([...new Set(year.usualWeekdays)].sort((a, b) => a - b)),
          position,
        );
        year.exceptions.forEach((exception, exceptionPosition) => {
          insertException.run(
            randomUUID(),
            yearId,
            exception.name.trim(),
            exception.startDate,
            exception.endDate,
            exceptionPosition,
          );
        });
      });

      const knownDates = this.db
        .prepare(
          `SELECT DISTINCT definition_id, household_date
           FROM occurrences
           WHERE household_id = ? AND household_date >= ?
           ORDER BY household_date`,
        )
        .all(ctx.householdId, today) as Array<{
        definition_id: string;
        household_date: string;
      }>;
      const definitionIds = [...new Set(knownDates.map((row) => row.definition_id))];
      const dateSet = new Set<string>([today, ...knownDates.map((row) => row.household_date)]);
      // School-night steps depend on D+1; clip predecessors at today.
      for (const date of [...dateSet]) {
        const predecessor = addHouseholdDays(date, -1);
        if (compareHouseholdDates(predecessor, today) >= 0) {
          dateSet.add(predecessor);
        }
      }
      const dates = [...dateSet].sort(compareHouseholdDates);
      for (const definitionId of definitionIds) {
        for (const householdDate of dates) {
          this.reconcileUnstartedOccurrencesForDate(
            ctx.householdId,
            definitionId,
            householdDate,
          );
        }
      }

      this.calendarSaveFailureHook?.();

      const result = this.getSchoolCalendar(ctx);
      this.db
        .prepare(
          `INSERT INTO calendar_mutation_receipts
           (mutation_id, household_id, kind, payload_digest, response_json, created_at)
           VALUES (?, ?, 'calendar_save', ?, ?, ?)`,
        )
        .run(
          input.mutationId,
          ctx.householdId,
          digest,
          JSON.stringify(result),
          createdAt,
        );
      return result;
    });
    return tx();
  }

  listRoutines(
    householdId: string,
    options?: { includeArchived?: boolean },
  ): RoutineDefinitionPublic[] {
    return this.listDefinitions(householdId, "routine", options);
  }

  listResponsibilities(
    householdId: string,
    options?: { includeArchived?: boolean },
  ): ResponsibilityDefinitionPublic[] {
    return this.listDefinitions(householdId, "responsibility", options);
  }

  listDefinitions(
    householdId: string,
    kind: WorkKind,
    options?: { includeArchived?: boolean },
  ): RoutineDefinitionPublic[] {
    const includeArchived = options?.includeArchived === true;
    const rows = this.db
      .prepare(
        `SELECT id FROM routine_definitions
         WHERE household_id = ?
           AND kind = ?
           AND deleted_at IS NULL
           ${includeArchived ? "" : "AND archived_at IS NULL AND ended_at IS NULL"}
         ORDER BY created_at, id`,
      )
      .all(householdId, kind) as Array<{ id: string }>;
    return rows
      .map((row) => this.loadRoutineDefinition(householdId, row.id))
      .filter((routine): routine is RoutineDefinitionPublic => routine !== null);
  }

  getRoutineById(householdId: string, definitionId: string): RoutineDefinitionPublic {
    const routine = this.loadRoutineDefinition(householdId, definitionId);
    if (!routine) fail("NOT_FOUND", "Routine not found");
    this.assertDefinitionKind(householdId, definitionId, "routine", "Routine not found");
    return routine;
  }

  getResponsibilityById(
    householdId: string,
    definitionId: string,
  ): ResponsibilityDefinitionPublic {
    const definition = this.loadRoutineDefinition(householdId, definitionId);
    if (!definition) fail("NOT_FOUND", "Responsibility not found");
    this.assertDefinitionKind(
      householdId,
      definitionId,
      "responsibility",
      "Responsibility not found",
    );
    return definition;
  }

  /**
   * Read-only next-N household dates preview. Never materializes or locks.
   * Started stored occurrences override plan owner/work for that day.
   */
  previewResponsibilityNextDays(
    ctx: AuthContext,
    definitionId: string,
    days = 7,
  ): ResponsibilityPreviewDay[] {
    this.assertDefinitionKind(
      ctx.householdId,
      definitionId,
      "responsibility",
      "Responsibility not found",
    );
    const definition = this.loadRoutineDefinition(ctx.householdId, definitionId);
    if (!definition) fail("NOT_FOUND", "Responsibility not found");

    const today = this.householdDateNow(ctx);
    const previewDays = Math.max(1, Math.min(days, 31));
    const results: ResponsibilityPreviewDay[] = [];

    for (let offset = 0; offset < previewDays; offset += 1) {
      const householdDate = addHouseholdDays(today, offset);
      const endMode = definition.endMode;
      const pastImmediateCutoff =
        endMode === "immediate" &&
        !isBeforeArchiveCutoff(householdDate, definition.archiveCutoffDate);
      const pastLegacyCutoff =
        endMode !== "immediate" &&
        !isBeforeArchiveCutoff(householdDate, definition.archiveCutoffDate);

      const stored = this.db
        .prepare(
          `SELECT id, revision_id, title, daypart, accountable_member_id, started_at, canceled_at
           FROM occurrences
           WHERE definition_id = ? AND household_date = ?
           LIMIT 1`,
        )
        .get(definitionId, householdDate) as
        | {
            id: string;
            revision_id: string;
            title: string;
            daypart: Daypart;
            accountable_member_id: string | null;
            started_at: string | null;
            canceled_at: string | null;
          }
        | undefined;

      if (stored && isOccurrenceStarted(stored.started_at)) {
        const name = stored.accountable_member_id
          ? (
              this.db
                .prepare(`SELECT display_name FROM household_memberships WHERE id = ?`)
                .get(stored.accountable_member_id) as
                | { display_name: string }
                | undefined
            )?.display_name ?? null
          : "Unassigned";
        const stepCount = (
          this.db
            .prepare(`SELECT COUNT(*) AS c FROM occurrence_steps WHERE occurrence_id = ?`)
            .get(stored.id) as { c: number }
        ).c;
        results.push({
          householdDate,
          applicable: true,
          accountableMemberId: stored.accountable_member_id,
          accountableMemberName: name,
          title: stored.title,
          daypart: stored.daypart,
          revisionId: stored.revision_id,
          startedProtected: true,
          occurrenceId: stored.id,
          stepCount,
        });
        continue;
      }

      if (pastLegacyCutoff || pastImmediateCutoff || definition.deletedAt) {
        results.push({
          householdDate,
          applicable: false,
          accountableMemberId: null,
          accountableMemberName: null,
          title: null,
          daypart: null,
          revisionId: null,
          startedProtected: false,
          occurrenceId: null,
        });
        continue;
      }

      const revision = this.selectRevisionContentForDate(definition, householdDate);
      const applicable =
        !!revision && isDateApplicable(householdDate, revision.weekdays);
      if (!applicable || !revision) {
        results.push({
          householdDate,
          applicable: false,
          accountableMemberId: null,
          accountableMemberName: null,
          title: null,
          daypart: null,
          revisionId: null,
          startedProtected: false,
          occurrenceId: null,
        });
        continue;
      }

      const composed = this.resolveCompositionForRevision(
        revision.id,
        householdDate,
        ctx.householdId,
      );
      const ownerId = composed?.accountableMemberId ?? null;
      const ownerName = ownerId
        ? (
            this.db
              .prepare(
                `SELECT display_name FROM household_memberships WHERE id = ?`,
              )
              .get(ownerId) as { display_name: string } | undefined
          )?.display_name ?? null
        : composed?.unassignedReason
          ? "Unassigned"
          : null;
      results.push({
        householdDate,
        applicable: composed?.applicable ?? true,
        accountableMemberId: ownerId,
        accountableMemberName: ownerName,
        title: revision.title,
        daypart: revision.daypart,
        revisionId: revision.id,
        startedProtected: false,
        occurrenceId: null,
        unassignedReason: composed?.unassignedReason ?? null,
        stepCount: composed?.steps.length ?? 0,
      });
    }

    return results;
  }

  /**
   * Read-only draft preview from unsaved input. Never materializes or locks.
   */
  previewDraftResponsibility(
    ctx: AuthContext,
    input: ResponsibilityInput,
    days = 7,
  ): ResponsibilityPreviewDay[] {
    this.requireGrant(ctx, "responsibility.manage");
    this.validateResponsibilityInput(ctx, input, { draft: true });
    const today = this.householdDateNow(ctx);
    const previewDays = Math.max(1, Math.min(days, 31));
    const draftRevisionId = "00000000-0000-0000-0000-000000000000";
    const plan = this.buildResponsibilityPlan(ctx, input, today);
    const baseSteps = input.steps.map((step, index) => ({
      logicalItemId: step.logicalItemId ?? `draft-step-${index}`,
      text: step.text.trim(),
      obligation: step.obligation,
    }));
    const results: ResponsibilityPreviewDay[] = [];
    for (let offset = 0; offset < previewDays; offset += 1) {
      const householdDate = addHouseholdDays(today, offset);
      const composed = resolveResponsibilityComposition(
        {
          householdDate,
          revisionId: draftRevisionId,
          parentWeekdays: input.weekdays,
          baseSteps,
          plan,
        },
        this.getCompositionDeps(ctx.householdId),
      );
      if (!composed.applicable) {
        results.push({
          householdDate,
          applicable: false,
          accountableMemberId: null,
          accountableMemberName: null,
          title: null,
          daypart: null,
          revisionId: null,
          startedProtected: false,
          occurrenceId: null,
        });
        continue;
      }
      const ownerId = composed.accountableMemberId;
      const ownerName = ownerId
        ? (
            this.db
              .prepare(
                `SELECT display_name FROM household_memberships WHERE id = ?`,
              )
              .get(ownerId) as { display_name: string } | undefined
          )?.display_name ?? null
        : composed.unassignedReason
          ? "Unassigned"
          : null;
      results.push({
        householdDate,
        applicable: true,
        accountableMemberId: ownerId,
        accountableMemberName: ownerName,
        title: input.title.trim(),
        daypart: input.daypart,
        revisionId: null,
        startedProtected: false,
        occurrenceId: null,
        unassignedReason: composed.unassignedReason,
        stepCount: composed.steps.length,
      });
    }
    return results;
  }

  createRoutine(ctx: AuthContext, input: RoutineInput): RoutineDefinitionPublic {
    this.requireGrant(ctx, "routine.shared.manage");
    const audienceInput: RoutineInput = {
      ...input,
      daypart: input.daypart,
      assigneeMemberIds: input.assigneeMemberIds ?? [],
      assigneeGroupIds: input.assigneeGroupIds ?? [],
    };

    const prior = this.findRoutineMutationReceipt(audienceInput.mutationId);
    if (prior) {
      const response = JSON.parse(prior.response_json) as RoutineDefinitionPublic;
      const effectiveDate =
        response.revisions[0]?.effectiveDate ?? this.householdDateNow(ctx);
      const digest = routinePayloadDigest({
        ...audienceInput,
        definitionId: prior.definition_id ?? response.id,
        effectiveDate,
      });
      if (
        prior.household_id !== ctx.householdId ||
        prior.kind !== "routine_create" ||
        prior.payload_digest !== digest
      ) {
        fail("CONFLICT", "Routine couldn't be updated");
      }
      return response;
    }

    this.validateRoutineInput(ctx, audienceInput);

    const definitionId = randomUUID();
    const effectiveDate = this.householdDateNow(ctx);
    const digest = routinePayloadDigest({
      ...audienceInput,
      definitionId,
      effectiveDate,
    });
    const normalized = this.normalizeRoutineAudience(
      ctx,
      this.withDefaultRoutineApplicability(audienceInput),
      effectiveDate,
    );
    this.requireCalendarForSchoolRules(ctx.householdId, normalized.steps);
    const createdAt = nowUtcIso();
    const revisionId = randomUUID();
    const scheduleEntryId = randomUUID();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO routine_definitions
             (id, household_id, version, archived_at, archive_cutoff_date, created_at, kind)
           VALUES (?, ?, 1, NULL, NULL, ?, 'routine')`,
        )
        .run(definitionId, ctx.householdId, createdAt);
      this.insertRevision(revisionId, definitionId, effectiveDate, normalized);
      this.insertScheduleEntry(
        scheduleEntryId,
        definitionId,
        effectiveDate,
        revisionId,
        createdAt,
      );
      const routine = this.getRoutineById(ctx.householdId, definitionId);
      this.writeRoutineMutationReceipt(
        audienceInput.mutationId,
        ctx.householdId,
        definitionId,
        "routine_create",
        digest,
        routine,
      );
      return routine;
    });
    return tx();
  }

  createResponsibility(
    ctx: AuthContext,
    input: ResponsibilityInput,
  ): ResponsibilityDefinitionPublic {
    this.requireGrant(ctx, "responsibility.manage");
    const audienceInput = responsibilityToRoutineInput(input);

    const prior = this.findRoutineMutationReceipt(input.mutationId);
    if (prior) {
      const response = JSON.parse(prior.response_json) as ResponsibilityDefinitionPublic;
      const effectiveDate =
        response.revisions[0]?.effectiveDate ?? this.householdDateNow(ctx);
      const digest = routinePayloadDigest({
        ...audienceInput,
        definitionId: prior.definition_id ?? response.id,
        effectiveDate,
      });
      if (
        prior.household_id !== ctx.householdId ||
        prior.kind !== "responsibility_create" ||
        prior.payload_digest !== digest
      ) {
        fail("CONFLICT", "Responsibility couldn't be updated");
      }
      return response;
    }

    this.validateResponsibilityInput(ctx, input);

    const definitionId = randomUUID();
    const effectiveDate = this.householdDateNow(ctx);
    const plan = this.buildResponsibilityPlan(ctx, input, effectiveDate);
    const digest = routinePayloadDigest({
      ...audienceInput,
      definitionId,
      effectiveDate,
    });
    const normalized = this.withDefaultRoutineApplicability(audienceInput);
    const createdAt = nowUtcIso();
    const revisionId = randomUUID();
    const scheduleEntryId = randomUUID();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO routine_definitions
             (id, household_id, version, archived_at, archive_cutoff_date, created_at, kind)
           VALUES (?, ?, 1, NULL, NULL, ?, 'responsibility')`,
        )
        .run(definitionId, ctx.householdId, createdAt);
      this.insertRevision(revisionId, definitionId, effectiveDate, normalized, plan);
      this.insertScheduleEntry(
        scheduleEntryId,
        definitionId,
        effectiveDate,
        revisionId,
        createdAt,
      );
      const responsibility = this.getResponsibilityById(ctx.householdId, definitionId);
      this.writeRoutineMutationReceipt(
        input.mutationId,
        ctx.householdId,
        definitionId,
        "responsibility_create",
        digest,
        responsibility,
      );
      return responsibility;
    });
    return tx();
  }

  createRevision(
    ctx: AuthContext,
    definitionId: string,
    input: RevisionInput,
  ): RoutineMutationResult {
    this.requireGrant(ctx, "routine.shared.manage");
    this.assertDefinitionKind(ctx.householdId, definitionId, "routine", "Routine not found");
    const audienceInput: RevisionInput = {
      ...input,
      assigneeMemberIds: input.assigneeMemberIds ?? [],
      assigneeGroupIds: input.assigneeGroupIds ?? [],
    };
    const mode = audienceInput.mode ?? "current";

    const prior = this.findRoutineMutationReceipt(audienceInput.mutationId);
    if (prior) {
      const response = JSON.parse(prior.response_json) as RoutineMutationResult;
      const routine = "routine" in response && response.routine
        ? response.routine
        : (response as unknown as RoutineDefinitionPublic);
      const effectiveDate =
        audienceInput.effectiveDate ??
        routine.revisions[routine.revisions.length - 1]?.effectiveDate;
      const digest = routinePayloadDigest({
        ...audienceInput,
        definitionId: prior.definition_id ?? definitionId,
        effectiveDate,
        mode,
        scheduleEntryId: audienceInput.scheduleEntryId,
      });
      if (
        prior.household_id !== ctx.householdId ||
        prior.kind !== "routine_revision" ||
        prior.payload_digest !== digest ||
        (prior.definition_id !== null && prior.definition_id !== definitionId)
      ) {
        fail("CONFLICT", "Routine couldn't be updated");
      }
      if ("routine" in response && response.routine) return response;
      return { routine };
    }

    this.validateRoutineInput(ctx, audienceInput);

    const definition = this.db
      .prepare(
        `SELECT id, version, archived_at, ended_at FROM routine_definitions
         WHERE id = ? AND household_id = ? AND deleted_at IS NULL`,
      )
      .get(definitionId, ctx.householdId) as
      | {
          id: string;
          version: number;
          archived_at: string | null;
          ended_at: string | null;
        }
      | undefined;
    if (!definition) fail("NOT_FOUND", "Routine not found");
    if (definition.archived_at || definition.ended_at) {
      fail("CONFLICT", "Archived routines cannot be revised");
    }
    if (
      audienceInput.expectedVersion !== undefined &&
      audienceInput.expectedVersion !== definition.version
    ) {
      fail("CONFLICT", "Routine was updated elsewhere; re-read and try again");
    }

    const today = this.householdDateNow(ctx);
    const effectiveDate = audienceInput.effectiveDate ?? today;

    const digest = routinePayloadDigest({
      ...audienceInput,
      definitionId,
      effectiveDate,
      mode,
      scheduleEntryId: audienceInput.scheduleEntryId,
    });

    if (!isValidHouseholdDate(effectiveDate)) {
      fail("VALIDATION", "Revision must be effective no earlier than today");
    }
    if (mode === "current" && compareHouseholdDates(effectiveDate, today) < 0) {
      fail("VALIDATION", "Revision must be effective no earlier than today");
    }
    if (mode === "schedule" && compareHouseholdDates(effectiveDate, today) <= 0) {
      fail("VALIDATION", "Scheduled changes must start after today");
    }
    const currentRoutine = this.loadRoutineDefinition(ctx.householdId, definitionId)!;
    const priorRevision =
      mode === "schedule" && audienceInput.scheduleEntryId
        ? currentRoutine.scheduleEntries.find(
            (entry) => entry.id === audienceInput.scheduleEntryId,
          )?.revision ?? null
        : this.selectRevisionContentForDate(currentRoutine, effectiveDate);
    this.rejectOmittedSharedApplicability(audienceInput.steps, priorRevision?.steps ?? []);
    const normalized = this.normalizeRoutineAudience(
      ctx,
      this.withDefaultRoutineApplicability(audienceInput),
      effectiveDate,
    );
    this.requireCalendarForSchoolRules(ctx.householdId, normalized.steps);

    try {
      const tx = this.db.transaction(() => {
        let refineOutcome: PlanRefineOutcome;
        if (mode === "schedule") {
          refineOutcome = this.applyScheduleRevision(
            ctx.householdId,
            definitionId,
            effectiveDate,
            normalized,
            audienceInput.scheduleEntryId,
          );
        } else {
          refineOutcome = this.applyCurrentRevision(
            ctx.householdId,
            definitionId,
            today,
            effectiveDate,
            normalized,
          );
        }
        this.db
          .prepare(
            "UPDATE routine_definitions SET version = version + 1 WHERE id = ?",
          )
          .run(definitionId);
        const routine = this.getRoutineById(ctx.householdId, definitionId);
        const result: RoutineMutationResult = { routine, refineOutcome };
        this.writeRoutineMutationReceipt(
          audienceInput.mutationId,
          ctx.householdId,
          definitionId,
          "routine_revision",
          digest,
          result,
        );
        return result;
      });
      return tx();
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        fail("CONFLICT", "A schedule entry already exists for that date");
      }
      throw error;
    }
  }

  createResponsibilityRevision(
    ctx: AuthContext,
    definitionId: string,
    input: ResponsibilityRevisionInput,
  ): ResponsibilityMutationResult {
    this.requireGrant(ctx, "responsibility.manage");
    this.assertDefinitionKind(
      ctx.householdId,
      definitionId,
      "responsibility",
      "Responsibility not found",
    );
    const audienceInput = responsibilityRevisionToRoutineInput(input);
    const mode = audienceInput.mode ?? "current";

    const prior = this.findRoutineMutationReceipt(input.mutationId);
    if (prior) {
      const response = JSON.parse(prior.response_json) as ResponsibilityMutationResult;
      const responsibility = response.responsibility;
      const effectiveDate =
        input.effectiveDate ??
        responsibility.revisions[responsibility.revisions.length - 1]?.effectiveDate;
      const digest = routinePayloadDigest({
        ...audienceInput,
        definitionId: prior.definition_id ?? definitionId,
        effectiveDate,
        mode,
        scheduleEntryId: input.scheduleEntryId,
      });
      if (
        prior.household_id !== ctx.householdId ||
        prior.kind !== "responsibility_revision" ||
        prior.payload_digest !== digest ||
        (prior.definition_id !== null && prior.definition_id !== definitionId)
      ) {
        fail("CONFLICT", "Responsibility couldn't be updated");
      }
      return response;
    }

    this.validateResponsibilityInput(ctx, input);

    const definition = this.db
      .prepare(
        `SELECT id, version, archived_at, ended_at FROM routine_definitions
         WHERE id = ? AND household_id = ? AND deleted_at IS NULL AND kind = 'responsibility'`,
      )
      .get(definitionId, ctx.householdId) as
      | {
          id: string;
          version: number;
          archived_at: string | null;
          ended_at: string | null;
        }
      | undefined;
    if (!definition) fail("NOT_FOUND", "Responsibility not found");
    if (definition.archived_at || definition.ended_at) {
      fail("CONFLICT", "Ended responsibilities cannot be revised");
    }
    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== definition.version
    ) {
      fail("CONFLICT", "Responsibility was updated elsewhere; re-read and try again");
    }

    const today = this.householdDateNow(ctx);
    const effectiveDate = input.effectiveDate ?? today;
    const digest = routinePayloadDigest({
      ...audienceInput,
      definitionId,
      effectiveDate,
      mode,
      scheduleEntryId: input.scheduleEntryId,
    });

    if (!isValidHouseholdDate(effectiveDate)) {
      fail("VALIDATION", "Revision must be effective no earlier than today");
    }
    if (mode === "current" && compareHouseholdDates(effectiveDate, today) < 0) {
      fail("VALIDATION", "Revision must be effective no earlier than today");
    }
    if (mode === "schedule" && compareHouseholdDates(effectiveDate, today) <= 0) {
      fail("VALIDATION", "Scheduled changes must start after today");
    }

    const normalized = this.withDefaultRoutineApplicability(audienceInput);
    const routineBefore = this.loadRoutineDefinition(ctx.householdId, definitionId)!;
    const previousRevision = this.selectRevisionContentForDate(routineBefore, effectiveDate);
    const plan = this.buildResponsibilityPlan(
      ctx,
      input,
      effectiveDate,
      previousRevision?.id,
    );

    try {
      const tx = this.db.transaction(() => {
        let refineOutcome: PlanRefineOutcome;
        if (mode === "schedule") {
          refineOutcome = this.applyScheduleRevision(
            ctx.householdId,
            definitionId,
            effectiveDate,
            normalized,
            input.scheduleEntryId,
          );
        } else {
          refineOutcome = this.applyCurrentRevision(
            ctx.householdId,
            definitionId,
            today,
            effectiveDate,
            normalized,
          );
        }
        const routineAfter = this.loadRoutineDefinition(ctx.householdId, definitionId)!;
        const newRevision = this.selectRevisionContentForDate(routineAfter, effectiveDate);
        if (newRevision) {
          insertResponsibilityPlan(this.db, newRevision.id, plan);
        }
        this.db
          .prepare(
            "UPDATE routine_definitions SET version = version + 1 WHERE id = ?",
          )
          .run(definitionId);
        const responsibility = this.getResponsibilityById(ctx.householdId, definitionId);
        const result: ResponsibilityMutationResult = {
          responsibility,
          refineOutcome,
        };
        this.responsibilityPlanFailureHook?.();
        this.writeRoutineMutationReceipt(
          input.mutationId,
          ctx.householdId,
          definitionId,
          "responsibility_revision",
          digest,
          result,
        );
        return result;
      });
      return tx();
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        fail("CONFLICT", "A schedule entry already exists for that date");
      }
      throw error;
    }
  }

  archiveRoutine(
    ctx: AuthContext,
    definitionId: string,
    input: { mutationId: string; expectedVersion: number },
  ): RoutineDefinitionPublic {
    this.requireGrant(ctx, "routine.shared.manage");
    this.assertDefinitionKind(ctx.householdId, definitionId, "routine", "Routine not found");

    const prior = this.findRoutineMutationReceipt(input.mutationId);
    if (prior) {
      const response = JSON.parse(prior.response_json) as RoutineDefinitionPublic;
      const digest = routinePayloadDigest({
        definitionId: prior.definition_id ?? definitionId,
        effectiveDate: response.archiveCutoffDate ?? undefined,
        expectedVersion: input.expectedVersion,
      });
      if (
        prior.household_id !== ctx.householdId ||
        prior.kind !== "routine_archive" ||
        prior.payload_digest !== digest ||
        (prior.definition_id !== null && prior.definition_id !== definitionId)
      ) {
        fail("CONFLICT", "Routine couldn't be updated");
      }
      return response;
    }

    const definition = this.db
      .prepare(
        `SELECT id, version, archived_at FROM routine_definitions
         WHERE id = ? AND household_id = ?`,
      )
      .get(definitionId, ctx.householdId) as
      | { id: string; version: number; archived_at: string | null }
      | undefined;
    if (!definition) fail("NOT_FOUND", "Routine not found");

    const archiveCutoffDate = addHouseholdDays(this.householdDateNow(ctx), 1);
    const digest = routinePayloadDigest({
      definitionId,
      effectiveDate: archiveCutoffDate,
      expectedVersion: input.expectedVersion,
    });

    if (definition.archived_at) {
      fail("CONFLICT", "Routine is already archived");
    }
    if (input.expectedVersion !== definition.version) {
      fail("CONFLICT", "Routine was updated elsewhere; re-read and try again");
    }

    const archivedAt = nowUtcIso();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE routine_definitions
           SET archived_at = ?, archive_cutoff_date = ?, ended_at = ?,
               end_mode = 'legacy_archive', version = version + 1
           WHERE id = ?`,
        )
        .run(archivedAt, archiveCutoffDate, archivedAt, definitionId);
      const routine = this.getRoutineById(ctx.householdId, definitionId);
      this.writeRoutineMutationReceipt(
        input.mutationId,
        ctx.householdId,
        definitionId,
        "routine_archive",
        digest,
        routine,
      );
      return routine;
    });
    return tx();
  }

  endRoutine(
    ctx: AuthContext,
    definitionId: string,
    input: { mutationId: string; expectedVersion: number },
  ): RoutineMutationResult {
    this.requireGrant(ctx, "routine.shared.manage");
    this.assertDefinitionKind(ctx.householdId, definitionId, "routine", "Routine not found");

    const prior = this.findRoutineMutationReceipt(input.mutationId);
    if (prior) {
      const response = JSON.parse(prior.response_json) as RoutineMutationResult;
      const digest = routinePayloadDigest({
        definitionId: prior.definition_id ?? definitionId,
        expectedVersion: input.expectedVersion,
        mode: "end",
      });
      if (
        prior.household_id !== ctx.householdId ||
        prior.kind !== "routine_end" ||
        prior.payload_digest !== digest ||
        (prior.definition_id !== null && prior.definition_id !== definitionId)
      ) {
        fail("CONFLICT", "Routine couldn't be updated");
      }
      return response;
    }

    const definition = this.db
      .prepare(
        `SELECT id, version, archived_at, ended_at FROM routine_definitions
         WHERE id = ? AND household_id = ? AND deleted_at IS NULL`,
      )
      .get(definitionId, ctx.householdId) as
      | {
          id: string;
          version: number;
          archived_at: string | null;
          ended_at: string | null;
        }
      | undefined;
    if (!definition) fail("NOT_FOUND", "Routine not found");
    if (definition.archived_at || definition.ended_at) {
      fail("CONFLICT", "Routine is already ended");
    }
    if (input.expectedVersion !== definition.version) {
      fail("CONFLICT", "Routine was updated elsewhere; re-read and try again");
    }

    const today = this.householdDateNow(ctx);
    const digest = routinePayloadDigest({
      definitionId,
      expectedVersion: input.expectedVersion,
      mode: "end",
    });
    const endedAt = nowUtcIso();

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE routine_definitions
           SET archived_at = ?, archive_cutoff_date = ?, ended_at = ?,
               end_mode = 'immediate', version = version + 1
           WHERE id = ?`,
        )
        .run(endedAt, today, endedAt, definitionId);

      // Cancel future/active schedule entries that start today or later.
      this.db
        .prepare(
          `UPDATE routine_schedule_entries
           SET canceled_at = ?
           WHERE definition_id = ? AND canceled_at IS NULL AND start_date >= ?`,
        )
        .run(endedAt, definitionId, today);

      const refineOutcome = this.reconcileOccurrenceRange(
        ctx.householdId,
        definitionId,
        today,
        null,
        { cancelAllUnstarted: true },
      );

      const routine = this.getRoutineById(ctx.householdId, definitionId);
      const result: RoutineMutationResult = { routine, refineOutcome };
      this.writeRoutineMutationReceipt(
        input.mutationId,
        ctx.householdId,
        definitionId,
        "routine_end",
        digest,
        result,
      );
      return result;
    });
    return tx();
  }

  deleteRoutine(
    ctx: AuthContext,
    definitionId: string,
    input: { mutationId: string; expectedVersion: number },
  ): { deleted: true; definitionId: string } {
    this.requireGrant(ctx, "routine.shared.manage");
    this.assertDefinitionKind(ctx.householdId, definitionId, "routine", "Routine not found");

    const prior = this.findRoutineMutationReceipt(input.mutationId);
    if (prior) {
      const response = JSON.parse(prior.response_json) as {
        deleted: true;
        definitionId: string;
      };
      const digest = routinePayloadDigest({
        definitionId: prior.definition_id ?? definitionId,
        expectedVersion: input.expectedVersion,
        mode: "delete",
      });
      if (
        prior.household_id !== ctx.householdId ||
        prior.kind !== "routine_delete" ||
        prior.payload_digest !== digest ||
        (prior.definition_id !== null && prior.definition_id !== definitionId)
      ) {
        fail("CONFLICT", "Routine couldn't be updated");
      }
      return response;
    }

    const definition = this.db
      .prepare(
        `SELECT id, version FROM routine_definitions
         WHERE id = ? AND household_id = ? AND deleted_at IS NULL`,
      )
      .get(definitionId, ctx.householdId) as
      | { id: string; version: number }
      | undefined;
    if (!definition) fail("NOT_FOUND", "Routine not found");
    if (input.expectedVersion !== definition.version) {
      fail("CONFLICT", "Routine was updated elsewhere; re-read and try again");
    }

    const digest = routinePayloadDigest({
      definitionId,
      expectedVersion: input.expectedVersion,
      mode: "delete",
    });

    const started = this.db
      .prepare(
        `SELECT 1 FROM occurrences
         WHERE definition_id = ? AND started_at IS NOT NULL LIMIT 1`,
      )
      .get(definitionId);
    if (started) {
      fail("CONFLICT", "This routine has started work and cannot be deleted");
    }
    const reports = this.db
      .prepare(
        `SELECT 1 FROM step_reports sr
         JOIN occurrences o ON o.id = sr.occurrence_id
         WHERE o.definition_id = ? LIMIT 1`,
      )
      .get(definitionId);
    if (reports) {
      fail("CONFLICT", "This routine has execution history and cannot be deleted");
    }
    const personal = this.db
      .prepare(
        `SELECT 1 FROM personal_routine_revisions WHERE definition_id = ? LIMIT 1`,
      )
      .get(definitionId);
    if (personal) {
      fail("CONFLICT", "This routine has personal layers and cannot be deleted");
    }
    const proposals = this.db
      .prepare(
        `SELECT 1 FROM routine_proposals WHERE definition_id = ? LIMIT 1`,
      )
      .get(definitionId);
    if (proposals) {
      fail("CONFLICT", "This routine has proposals and cannot be deleted");
    }

    const result = { deleted: true as const, definitionId };
    const tx = this.db.transaction(() => {
      const occIds = (
        this.db
          .prepare(`SELECT id FROM occurrences WHERE definition_id = ?`)
          .all(definitionId) as Array<{ id: string }>
      ).map((r) => r.id);
      for (const occId of occIds) {
        this.db.prepare("DELETE FROM occurrence_steps WHERE occurrence_id = ?").run(occId);
      }
      this.db.prepare("DELETE FROM occurrences WHERE definition_id = ?").run(definitionId);

      const revIds = (
        this.db
          .prepare(`SELECT id FROM routine_revisions WHERE definition_id = ?`)
          .all(definitionId) as Array<{ id: string }>
      ).map((r) => r.id);
      for (const revId of revIds) {
        this.db.prepare("DELETE FROM revision_steps WHERE revision_id = ?").run(revId);
        this.db.prepare("DELETE FROM revision_assignees WHERE revision_id = ?").run(revId);
        this.db
          .prepare("DELETE FROM revision_group_sources WHERE revision_id = ?")
          .run(revId);
      }
      this.db
        .prepare("DELETE FROM routine_schedule_entries WHERE definition_id = ?")
        .run(definitionId);
      this.db.prepare("DELETE FROM routine_revisions WHERE definition_id = ?").run(definitionId);
      this.db.prepare("DELETE FROM routine_definitions WHERE id = ?").run(definitionId);

      this.writeRoutineMutationReceipt(
        input.mutationId,
        ctx.householdId,
        definitionId,
        "routine_delete",
        digest,
        result,
      );
      return result;
    });
    return tx();
  }

  endResponsibility(
    ctx: AuthContext,
    definitionId: string,
    input: { mutationId: string; expectedVersion: number },
  ): ResponsibilityMutationResult {
    this.requireGrant(ctx, "responsibility.manage");
    this.assertDefinitionKind(
      ctx.householdId,
      definitionId,
      "responsibility",
      "Responsibility not found",
    );

    const prior = this.findRoutineMutationReceipt(input.mutationId);
    if (prior) {
      const response = JSON.parse(prior.response_json) as ResponsibilityMutationResult;
      const digest = routinePayloadDigest({
        definitionId: prior.definition_id ?? definitionId,
        expectedVersion: input.expectedVersion,
        mode: "end",
      });
      if (
        prior.household_id !== ctx.householdId ||
        prior.kind !== "responsibility_end" ||
        prior.payload_digest !== digest ||
        (prior.definition_id !== null && prior.definition_id !== definitionId)
      ) {
        fail("CONFLICT", "Responsibility couldn't be updated");
      }
      return response;
    }

    const definition = this.db
      .prepare(
        `SELECT id, version, archived_at, ended_at FROM routine_definitions
         WHERE id = ? AND household_id = ? AND deleted_at IS NULL AND kind = 'responsibility'`,
      )
      .get(definitionId, ctx.householdId) as
      | {
          id: string;
          version: number;
          archived_at: string | null;
          ended_at: string | null;
        }
      | undefined;
    if (!definition) fail("NOT_FOUND", "Responsibility not found");
    if (definition.archived_at || definition.ended_at) {
      fail("CONFLICT", "Responsibility is already ended");
    }
    if (input.expectedVersion !== definition.version) {
      fail("CONFLICT", "Responsibility was updated elsewhere; re-read and try again");
    }

    const today = this.householdDateNow(ctx);
    const digest = routinePayloadDigest({
      definitionId,
      expectedVersion: input.expectedVersion,
      mode: "end",
    });
    const endedAt = nowUtcIso();

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE routine_definitions
           SET archived_at = ?, archive_cutoff_date = ?, ended_at = ?,
               end_mode = 'immediate', version = version + 1
           WHERE id = ?`,
        )
        .run(endedAt, today, endedAt, definitionId);
      this.db
        .prepare(
          `UPDATE routine_schedule_entries
           SET canceled_at = ?
           WHERE definition_id = ? AND canceled_at IS NULL AND start_date >= ?`,
        )
        .run(endedAt, definitionId, today);
      const refineOutcome = this.reconcileOccurrenceRange(
        ctx.householdId,
        definitionId,
        today,
        null,
        { cancelAllUnstarted: true },
      );
      const responsibility = this.getResponsibilityById(ctx.householdId, definitionId);
      const result: ResponsibilityMutationResult = { responsibility, refineOutcome };
      this.writeRoutineMutationReceipt(
        input.mutationId,
        ctx.householdId,
        definitionId,
        "responsibility_end",
        digest,
        result,
      );
      return result;
    });
    return tx();
  }

  deleteResponsibility(
    ctx: AuthContext,
    definitionId: string,
    input: { mutationId: string; expectedVersion: number },
  ): { deleted: true; definitionId: string } {
    this.requireGrant(ctx, "responsibility.manage");
    this.assertDefinitionKind(
      ctx.householdId,
      definitionId,
      "responsibility",
      "Responsibility not found",
    );

    const prior = this.findRoutineMutationReceipt(input.mutationId);
    if (prior) {
      const response = JSON.parse(prior.response_json) as {
        deleted: true;
        definitionId: string;
      };
      const digest = routinePayloadDigest({
        definitionId: prior.definition_id ?? definitionId,
        expectedVersion: input.expectedVersion,
        mode: "delete",
      });
      if (
        prior.household_id !== ctx.householdId ||
        prior.kind !== "responsibility_delete" ||
        prior.payload_digest !== digest ||
        (prior.definition_id !== null && prior.definition_id !== definitionId)
      ) {
        fail("CONFLICT", "Responsibility couldn't be updated");
      }
      return response;
    }

    const definition = this.db
      .prepare(
        `SELECT id, version FROM routine_definitions
         WHERE id = ? AND household_id = ? AND deleted_at IS NULL AND kind = 'responsibility'`,
      )
      .get(definitionId, ctx.householdId) as
      | { id: string; version: number }
      | undefined;
    if (!definition) fail("NOT_FOUND", "Responsibility not found");
    if (input.expectedVersion !== definition.version) {
      fail("CONFLICT", "Responsibility was updated elsewhere; re-read and try again");
    }

    const digest = routinePayloadDigest({
      definitionId,
      expectedVersion: input.expectedVersion,
      mode: "delete",
    });

    const started = this.db
      .prepare(
        `SELECT 1 FROM occurrences
         WHERE definition_id = ? AND started_at IS NOT NULL LIMIT 1`,
      )
      .get(definitionId);
    if (started) {
      fail("CONFLICT", "This responsibility has started work and cannot be deleted");
    }
    const reports = this.db
      .prepare(
        `SELECT 1 FROM step_reports sr
         JOIN occurrences o ON o.id = sr.occurrence_id
         WHERE o.definition_id = ? LIMIT 1`,
      )
      .get(definitionId);
    if (reports) {
      fail(
        "CONFLICT",
        "This responsibility has execution history and cannot be deleted",
      );
    }
    // Stricter than routines: any prior-date occurrence history blocks Delete.
    const today = this.householdDateNow(ctx);
    const priorDateHistory = this.db
      .prepare(
        `SELECT 1 FROM occurrences
         WHERE definition_id = ? AND household_date < ? LIMIT 1`,
      )
      .get(definitionId, today);
    if (priorDateHistory) {
      fail(
        "CONFLICT",
        "This responsibility has prior-date history and cannot be deleted",
      );
    }

    const result = { deleted: true as const, definitionId };
    const tx = this.db.transaction(() => {
      const occIds = (
        this.db
          .prepare(`SELECT id FROM occurrences WHERE definition_id = ?`)
          .all(definitionId) as Array<{ id: string }>
      ).map((r) => r.id);
      for (const occId of occIds) {
        this.db.prepare("DELETE FROM occurrence_steps WHERE occurrence_id = ?").run(occId);
      }
      this.db.prepare("DELETE FROM occurrences WHERE definition_id = ?").run(definitionId);
      const revIds = (
        this.db
          .prepare(`SELECT id FROM routine_revisions WHERE definition_id = ?`)
          .all(definitionId) as Array<{ id: string }>
      ).map((r) => r.id);
      for (const revId of revIds) {
        this.db.prepare("DELETE FROM revision_steps WHERE revision_id = ?").run(revId);
        this.db.prepare("DELETE FROM revision_assignees WHERE revision_id = ?").run(revId);
        this.db
          .prepare("DELETE FROM revision_group_sources WHERE revision_id = ?")
          .run(revId);
      }
      this.db
        .prepare("DELETE FROM routine_schedule_entries WHERE definition_id = ?")
        .run(definitionId);
      this.db.prepare("DELETE FROM routine_revisions WHERE definition_id = ?").run(definitionId);
      this.db.prepare("DELETE FROM routine_definitions WHERE id = ?").run(definitionId);
      this.writeRoutineMutationReceipt(
        input.mutationId,
        ctx.householdId,
        definitionId,
        "responsibility_delete",
        digest,
        result,
      );
      return result;
    });
    return tx();
  }

  moveScheduleEntry(
    ctx: AuthContext,
    definitionId: string,
    scheduleEntryId: string,
    input: { mutationId: string; expectedVersion: number; startDate: string },
  ): RoutineMutationResult {
    this.requireGrant(ctx, "routine.shared.manage");
    this.assertDefinitionKind(ctx.householdId, definitionId, "routine", "Routine not found");

    const prior = this.findRoutineMutationReceipt(input.mutationId);
    if (prior) {
      const response = JSON.parse(prior.response_json) as RoutineMutationResult;
      const digest = routinePayloadDigest({
        definitionId: prior.definition_id ?? definitionId,
        expectedVersion: input.expectedVersion,
        scheduleEntryId,
        startDate: input.startDate,
        mode: "schedule_move",
      });
      if (
        prior.household_id !== ctx.householdId ||
        prior.kind !== "routine_schedule_move" ||
        prior.payload_digest !== digest ||
        (prior.definition_id !== null && prior.definition_id !== definitionId)
      ) {
        fail("CONFLICT", "Routine couldn't be updated");
      }
      return response;
    }

    const today = this.householdDateNow(ctx);
    if (!isValidHouseholdDate(input.startDate)) {
      fail("VALIDATION", "Invalid start date");
    }
    if (compareHouseholdDates(input.startDate, today) < 0) {
      fail("VALIDATION", "Cannot move a schedule entry to a past date");
    }

    const definition = this.requireEditableDefinition(
      ctx.householdId,
      definitionId,
      input.expectedVersion,
    );
    void definition;

    const digest = routinePayloadDigest({
      definitionId,
      expectedVersion: input.expectedVersion,
      scheduleEntryId,
      startDate: input.startDate,
      mode: "schedule_move",
    });

    try {
      const tx = this.db.transaction(() => {
        const entry = this.db
          .prepare(
            `SELECT id, start_date, revision_id, canceled_at
             FROM routine_schedule_entries
             WHERE id = ? AND definition_id = ?`,
          )
          .get(scheduleEntryId, definitionId) as
          | {
              id: string;
              start_date: string;
              revision_id: string;
              canceled_at: string | null;
            }
          | undefined;
        if (!entry || entry.canceled_at) fail("NOT_FOUND", "Schedule entry not found");
        if (compareHouseholdDates(entry.start_date, today) <= 0) {
          fail("CONFLICT", "Cannot move the current schedule entry");
        }
        const oldStart = entry.start_date;
        const moveToToday = compareHouseholdDates(input.startDate, today) === 0;

        if (moveToToday) {
          // Promote upcoming content to the current plan; cancel the upcoming entry.
          const rows = loadScheduleEntryRows(this.db, definitionId);
          const current = selectActiveEntryRowForDate(rows, today);
          if (!current) fail("CONFLICT", "Current schedule entry not found");
          this.db
            .prepare(
              `UPDATE routine_schedule_entries SET revision_id = ? WHERE id = ?`,
            )
            .run(entry.revision_id, current.id);
          this.db
            .prepare(
              `UPDATE routine_schedule_entries SET canceled_at = ? WHERE id = ?`,
            )
            .run(nowUtcIso(), scheduleEntryId);
        } else {
          const occupied = loadScheduleEntryRows(this.db, definitionId).find(
            (row) =>
              row.canceled_at == null &&
              row.id !== scheduleEntryId &&
              row.start_date === input.startDate,
          );
          if (occupied) {
            fail("CONFLICT", "A schedule entry already exists for that date", {
              conflictingScheduleEntryId: occupied.id,
              occupiedDate: input.startDate,
            });
          }
          this.db
            .prepare(
              `UPDATE routine_schedule_entries SET start_date = ? WHERE id = ?`,
            )
            .run(input.startDate, scheduleEntryId);
        }

        this.db
          .prepare(
            "UPDATE routine_definitions SET version = version + 1 WHERE id = ?",
          )
          .run(definitionId);

        const entries = loadScheduleEntryRows(this.db, definitionId).map(
          toScheduleEntryLike,
        );
        const vacatedFrom = compareHouseholdDates(oldStart, input.startDate) < 0
          ? oldStart
          : input.startDate;
        const refineA = this.reconcileGovernedRange(
          ctx.householdId,
          definitionId,
          vacatedFrom,
          entries,
        );
        const otherFrom =
          vacatedFrom === oldStart ? input.startDate : oldStart;
        const refineB =
          otherFrom !== vacatedFrom
            ? this.reconcileGovernedRange(
                ctx.householdId,
                definitionId,
                otherFrom,
                entries,
              )
            : emptyRefineOutcome(vacatedFrom, refineA.untilDateExclusive);
        const refineOutcome = mergeRefineOutcomes(refineA, {
          updated: refineB.updatedMemberIds,
          protected: refineB.protectedMemberIds,
          excluded: refineB.excludedMemberIds,
        });

        const routine = this.getRoutineById(ctx.householdId, definitionId);
        const result: RoutineMutationResult = { routine, refineOutcome };
        this.writeRoutineMutationReceipt(
          input.mutationId,
          ctx.householdId,
          definitionId,
          "routine_schedule_move",
          digest,
          result,
        );
        return result;
      });
      return tx();
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        fail("CONFLICT", "A schedule entry already exists for that date");
      }
      throw error;
    }
  }

  deleteScheduleEntry(
    ctx: AuthContext,
    definitionId: string,
    scheduleEntryId: string,
    input: { mutationId: string; expectedVersion: number },
  ): RoutineMutationResult {
    this.requireGrant(ctx, "routine.shared.manage");
    this.assertDefinitionKind(ctx.householdId, definitionId, "routine", "Routine not found");

    const prior = this.findRoutineMutationReceipt(input.mutationId);
    if (prior) {
      const response = JSON.parse(prior.response_json) as RoutineMutationResult;
      const digest = routinePayloadDigest({
        definitionId: prior.definition_id ?? definitionId,
        expectedVersion: input.expectedVersion,
        scheduleEntryId,
        mode: "schedule_delete",
      });
      if (
        prior.household_id !== ctx.householdId ||
        prior.kind !== "routine_schedule_delete" ||
        prior.payload_digest !== digest ||
        (prior.definition_id !== null && prior.definition_id !== definitionId)
      ) {
        fail("CONFLICT", "Routine couldn't be updated");
      }
      return response;
    }

    this.requireEditableDefinition(
      ctx.householdId,
      definitionId,
      input.expectedVersion,
    );
    const today = this.householdDateNow(ctx);
    const digest = routinePayloadDigest({
      definitionId,
      expectedVersion: input.expectedVersion,
      scheduleEntryId,
      mode: "schedule_delete",
    });
    const canceledAt = nowUtcIso();

    const tx = this.db.transaction(() => {
      const entry = this.db
        .prepare(
          `SELECT id, start_date, canceled_at
           FROM routine_schedule_entries
           WHERE id = ? AND definition_id = ?`,
        )
        .get(scheduleEntryId, definitionId) as
        | { id: string; start_date: string; canceled_at: string | null }
        | undefined;
      if (!entry || entry.canceled_at) fail("NOT_FOUND", "Schedule entry not found");
      if (compareHouseholdDates(entry.start_date, today) <= 0) {
        fail("CONFLICT", "Cannot delete the current schedule entry");
      }

      this.db
        .prepare(
          `UPDATE routine_schedule_entries SET canceled_at = ? WHERE id = ?`,
        )
        .run(canceledAt, scheduleEntryId);
      this.db
        .prepare(
          "UPDATE routine_definitions SET version = version + 1 WHERE id = ?",
        )
        .run(definitionId);

      const entries = loadScheduleEntryRows(this.db, definitionId).map(
        toScheduleEntryLike,
      );
      const refineOutcome = this.reconcileGovernedRange(
        ctx.householdId,
        definitionId,
        entry.start_date,
        entries,
      );

      const routine = this.getRoutineById(ctx.householdId, definitionId);
      const result: RoutineMutationResult = { routine, refineOutcome };
      this.writeRoutineMutationReceipt(
        input.mutationId,
        ctx.householdId,
        definitionId,
        "routine_schedule_delete",
        digest,
        result,
      );
      return result;
    });
    return tx();
  }

  moveResponsibilityScheduleEntry(
    ctx: AuthContext,
    definitionId: string,
    scheduleEntryId: string,
    input: { mutationId: string; expectedVersion: number; startDate: string },
  ): ResponsibilityMutationResult {
    this.requireGrant(ctx, "responsibility.manage");
    this.assertDefinitionKind(
      ctx.householdId,
      definitionId,
      "responsibility",
      "Responsibility not found",
    );

    const prior = this.findRoutineMutationReceipt(input.mutationId);
    if (prior) {
      const response = JSON.parse(prior.response_json) as ResponsibilityMutationResult;
      const digest = routinePayloadDigest({
        definitionId: prior.definition_id ?? definitionId,
        expectedVersion: input.expectedVersion,
        scheduleEntryId,
        startDate: input.startDate,
        mode: "schedule_move",
      });
      if (
        prior.household_id !== ctx.householdId ||
        prior.kind !== "responsibility_schedule_move" ||
        prior.payload_digest !== digest ||
        (prior.definition_id !== null && prior.definition_id !== definitionId)
      ) {
        fail("CONFLICT", "Responsibility couldn't be updated");
      }
      return response;
    }

    const today = this.householdDateNow(ctx);
    if (!isValidHouseholdDate(input.startDate)) {
      fail("VALIDATION", "Invalid start date");
    }
    if (compareHouseholdDates(input.startDate, today) < 0) {
      fail("VALIDATION", "Cannot move a schedule entry to a past date");
    }

    this.requireEditableDefinition(
      ctx.householdId,
      definitionId,
      input.expectedVersion,
    );

    const digest = routinePayloadDigest({
      definitionId,
      expectedVersion: input.expectedVersion,
      scheduleEntryId,
      startDate: input.startDate,
      mode: "schedule_move",
    });

    try {
      const tx = this.db.transaction(() => {
        const entry = this.db
          .prepare(
            `SELECT id, start_date, revision_id, canceled_at
             FROM routine_schedule_entries
             WHERE id = ? AND definition_id = ?`,
          )
          .get(scheduleEntryId, definitionId) as
          | {
              id: string;
              start_date: string;
              revision_id: string;
              canceled_at: string | null;
            }
          | undefined;
        if (!entry || entry.canceled_at) fail("NOT_FOUND", "Schedule entry not found");
        if (compareHouseholdDates(entry.start_date, today) <= 0) {
          fail("CONFLICT", "Cannot move the current schedule entry");
        }
        const oldStart = entry.start_date;
        const moveToToday = compareHouseholdDates(input.startDate, today) === 0;

        if (moveToToday) {
          const rows = loadScheduleEntryRows(this.db, definitionId);
          const current = selectActiveEntryRowForDate(rows, today);
          if (!current) fail("CONFLICT", "Current schedule entry not found");
          this.db
            .prepare(
              `UPDATE routine_schedule_entries SET revision_id = ? WHERE id = ?`,
            )
            .run(entry.revision_id, current.id);
          this.db
            .prepare(
              `UPDATE routine_schedule_entries SET canceled_at = ? WHERE id = ?`,
            )
            .run(nowUtcIso(), scheduleEntryId);
        } else {
          const occupied = loadScheduleEntryRows(this.db, definitionId).find(
            (row) =>
              row.canceled_at == null &&
              row.id !== scheduleEntryId &&
              row.start_date === input.startDate,
          );
          if (occupied) {
            fail("CONFLICT", "A schedule entry already exists for that date", {
              conflictingScheduleEntryId: occupied.id,
              occupiedDate: input.startDate,
            });
          }
          this.db
            .prepare(
              `UPDATE routine_schedule_entries SET start_date = ? WHERE id = ?`,
            )
            .run(input.startDate, scheduleEntryId);

          // Moving a boundary that introduced a cycle moves that cycle's anchors with it.
          const plan = loadResponsibilityPlan(this.db, entry.revision_id);
          if (plan) {
            const shifted = shiftPlanAnchorsForBoundaryMove(
              plan,
              oldStart,
              input.startDate,
            );
            if (
              shifted.assignment.anchorDate !== plan.assignment.anchorDate ||
              JSON.stringify(shifted.scheduledAdditions) !==
                JSON.stringify(plan.scheduledAdditions)
            ) {
              updateResponsibilityPlan(this.db, entry.revision_id, shifted);
            }
          }
          const revision = this.db
            .prepare(
              `SELECT effective_date FROM routine_revisions WHERE id = ?`,
            )
            .get(entry.revision_id) as { effective_date: string } | undefined;
          if (revision?.effective_date === oldStart) {
            this.db
              .prepare(
                `UPDATE routine_revisions SET effective_date = ? WHERE id = ?`,
              )
              .run(input.startDate, entry.revision_id);
          }
        }

        this.db
          .prepare(
            "UPDATE routine_definitions SET version = version + 1 WHERE id = ?",
          )
          .run(definitionId);

        const entries = loadScheduleEntryRows(this.db, definitionId).map(
          toScheduleEntryLike,
        );
        const vacatedFrom = compareHouseholdDates(oldStart, input.startDate) < 0
          ? oldStart
          : input.startDate;
        const refineA = this.reconcileGovernedRange(
          ctx.householdId,
          definitionId,
          vacatedFrom,
          entries,
        );
        const otherFrom =
          vacatedFrom === oldStart ? input.startDate : oldStart;
        const refineB =
          otherFrom !== vacatedFrom
            ? this.reconcileGovernedRange(
                ctx.householdId,
                definitionId,
                otherFrom,
                entries,
              )
            : emptyRefineOutcome(vacatedFrom, refineA.untilDateExclusive);
        const refineOutcome = mergeRefineOutcomes(refineA, {
          updated: refineB.updatedMemberIds,
          protected: refineB.protectedMemberIds,
          excluded: refineB.excludedMemberIds,
        });

        const responsibility = this.getResponsibilityById(ctx.householdId, definitionId);
        const result: ResponsibilityMutationResult = {
          responsibility,
          refineOutcome,
        };
        this.writeRoutineMutationReceipt(
          input.mutationId,
          ctx.householdId,
          definitionId,
          "responsibility_schedule_move",
          digest,
          result,
        );
        return result;
      });
      return tx();
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        fail("CONFLICT", "A schedule entry already exists for that date");
      }
      throw error;
    }
  }

  deleteResponsibilityScheduleEntry(
    ctx: AuthContext,
    definitionId: string,
    scheduleEntryId: string,
    input: { mutationId: string; expectedVersion: number },
  ): ResponsibilityMutationResult {
    this.requireGrant(ctx, "responsibility.manage");
    this.assertDefinitionKind(
      ctx.householdId,
      definitionId,
      "responsibility",
      "Responsibility not found",
    );

    const prior = this.findRoutineMutationReceipt(input.mutationId);
    if (prior) {
      const response = JSON.parse(prior.response_json) as ResponsibilityMutationResult;
      const digest = routinePayloadDigest({
        definitionId: prior.definition_id ?? definitionId,
        expectedVersion: input.expectedVersion,
        scheduleEntryId,
        mode: "schedule_delete",
      });
      if (
        prior.household_id !== ctx.householdId ||
        prior.kind !== "responsibility_schedule_delete" ||
        prior.payload_digest !== digest ||
        (prior.definition_id !== null && prior.definition_id !== definitionId)
      ) {
        fail("CONFLICT", "Responsibility couldn't be updated");
      }
      return response;
    }

    this.requireEditableDefinition(
      ctx.householdId,
      definitionId,
      input.expectedVersion,
    );
    const today = this.householdDateNow(ctx);
    const digest = routinePayloadDigest({
      definitionId,
      expectedVersion: input.expectedVersion,
      scheduleEntryId,
      mode: "schedule_delete",
    });
    const canceledAt = nowUtcIso();

    const tx = this.db.transaction(() => {
      const entry = this.db
        .prepare(
          `SELECT id, start_date, canceled_at
           FROM routine_schedule_entries
           WHERE id = ? AND definition_id = ?`,
        )
        .get(scheduleEntryId, definitionId) as
        | { id: string; start_date: string; canceled_at: string | null }
        | undefined;
      if (!entry || entry.canceled_at) fail("NOT_FOUND", "Schedule entry not found");
      if (compareHouseholdDates(entry.start_date, today) <= 0) {
        fail("CONFLICT", "Cannot delete the current schedule entry");
      }

      this.db
        .prepare(
          `UPDATE routine_schedule_entries SET canceled_at = ? WHERE id = ?`,
        )
        .run(canceledAt, scheduleEntryId);
      this.db
        .prepare(
          "UPDATE routine_definitions SET version = version + 1 WHERE id = ?",
        )
        .run(definitionId);

      const entries = loadScheduleEntryRows(this.db, definitionId).map(
        toScheduleEntryLike,
      );
      const refineOutcome = this.reconcileGovernedRange(
        ctx.householdId,
        definitionId,
        entry.start_date,
        entries,
      );

      const responsibility = this.getResponsibilityById(ctx.householdId, definitionId);
      const result: ResponsibilityMutationResult = {
        responsibility,
        refineOutcome,
      };
      this.writeRoutineMutationReceipt(
        input.mutationId,
        ctx.householdId,
        definitionId,
        "responsibility_schedule_delete",
        digest,
        result,
      );
      return result;
    });
    return tx();
  }

  materializeForDate(ctx: AuthContext, householdDate: HouseholdDate): OccurrenceView[] {
    if (!isValidHouseholdDate(householdDate)) fail("VALIDATION", "Invalid household date");
    const floor = this.getActivityResetFloor(ctx.householdId);
    if (floor && compareHouseholdDates(householdDate, floor) < 0) {
      return [];
    }
    const canManageRoutine = this.hasGrant(ctx, "routine.shared.manage");
    const canExecuteRoutine = this.hasGrant(ctx, "routine.execute.own");
    const canManageResponsibility = this.hasGrant(ctx, "responsibility.manage");
    const canExecuteResponsibility = this.hasGrant(ctx, "responsibility.execute.own");
    if (
      !canManageRoutine &&
      !canExecuteRoutine &&
      !canManageResponsibility &&
      !canExecuteResponsibility
    ) {
      return [];
    }

    const definitions = [
      ...this.listDefinitions(ctx.householdId, "routine", { includeArchived: true }),
      ...this.listDefinitions(ctx.householdId, "responsibility", {
        includeArchived: true,
      }),
    ];
    const results: OccurrenceView[] = [];
    const tx = this.db.transaction(() => {
      for (const definition of definitions) {
        if (definition.deletedAt) continue;
        const kind = definition.kind ?? "routine";

        const endMode = definition.endMode;
        const pastImmediateCutoff =
          endMode === "immediate" &&
          !isBeforeArchiveCutoff(householdDate, definition.archiveCutoffDate);
        const pastLegacyCutoff =
          endMode !== "immediate" &&
          !isBeforeArchiveCutoff(householdDate, definition.archiveCutoffDate);
        if (pastLegacyCutoff) continue;

        const revision = this.selectRevisionContentForDate(definition, householdDate);
        const revisionView = revision
          ? {
              id: revision.id,
              title: revision.title,
              daypart: revision.daypart,
              steps: revision.steps,
            }
          : null;

        if (kind === "responsibility") {
          const composed =
            revision &&
            revisionView &&
            !pastImmediateCutoff
              ? this.resolveCompositionForRevision(
                  revision.id,
                  householdDate,
                  ctx.householdId,
                )
              : null;
          const canCreateNew =
            !!composed?.applicable && !!revisionView;

          const existing = this.db
            .prepare(
              `SELECT accountable_member_id, started_at, canceled_at
               FROM occurrences
               WHERE definition_id = ? AND household_date = ?
               LIMIT 1`,
            )
            .get(definition.id, householdDate) as
            | {
                accountable_member_id: string | null;
                started_at: string | null;
                canceled_at: string | null;
              }
            | undefined;

          if (existing && isOccurrenceStarted(existing.started_at)) {
            const view = this.getOccurrenceView(
              definition.id,
              householdDate,
              null,
              "responsibility",
            );
            if (view && !(view.steps.length === 0 && !view.startedAt)) {
              results.push(view);
            }
            continue;
          }

          if (existing?.canceled_at && !isOccurrenceStarted(existing.started_at)) {
            if (!canCreateNew || !revisionView) continue;
          }

          if (!canCreateNew || !revisionView) {
            if (
              existing &&
              !existing.canceled_at &&
              !isOccurrenceStarted(existing.started_at) &&
              revisionView
            ) {
              // Non-applicable day: leave stored unstarted alone; Today omits it.
            }
            continue;
          }

          const view = this.ensureResponsibilityOccurrence(
            ctx.householdId,
            definition.id,
            revisionView,
            householdDate,
            composed!,
          );
          if (view.steps.length === 0 && !view.startedAt) continue;
          results.push(view);
          continue;
        }

        const planParticipants = new Set<string>();
        let canCreateNew = false;
        if (
          revision &&
          isDateApplicable(householdDate, revision.weekdays) &&
          !pastImmediateCutoff
        ) {
          canCreateNew = true;
          for (const membershipId of resolveAccountableMembers("routine", {
            directMemberIds: revision.assigneeMemberIds,
            groupMemberIdSets: revision.assigneeGroupIds.map((groupId) =>
              this.groupMembersOnDate(groupId, householdDate),
            ),
          })) {
            planParticipants.add(membershipId);
          }
        }

        const existingRows = this.db
          .prepare(
            `SELECT accountable_member_id, started_at, canceled_at
             FROM occurrences
             WHERE definition_id = ? AND household_date = ?`,
          )
          .all(definition.id, householdDate) as Array<{
          accountable_member_id: string;
          started_at: string | null;
          canceled_at: string | null;
        }>;

        const memberIds = new Set<string>(planParticipants);
        for (const row of existingRows) {
          if (isOccurrenceStarted(row.started_at)) {
            memberIds.add(row.accountable_member_id);
          } else if (row.canceled_at) {
            memberIds.delete(row.accountable_member_id);
          }
        }

        for (const membershipId of memberIds) {
          const existing = existingRows.find(
            (r) => r.accountable_member_id === membershipId,
          );
          if (existing?.canceled_at && !isOccurrenceStarted(existing.started_at)) {
            continue;
          }
          if (
            !existing &&
            (!canCreateNew || !planParticipants.has(membershipId) || !revisionView)
          ) {
            continue;
          }
          if (!revisionView && existing && isOccurrenceStarted(existing.started_at)) {
            const view = this.getOccurrenceView(
              definition.id,
              householdDate,
              membershipId,
            );
            if (view) results.push(view);
            continue;
          }
          if (!revisionView) continue;
          const view = this.ensureOccurrence(
            ctx.householdId,
            definition.id,
            revisionView,
            householdDate,
            membershipId,
            "routine",
          );
          if (view.steps.length === 0 && !view.startedAt) continue;
          results.push(view);
        }
      }
    });
    tx();
    results.sort(compareOccurrenceOrder);
    return results.filter((item) => {
      if (item.kind === "responsibility") {
        if (canManageResponsibility) return true;
        return (
          canExecuteResponsibility &&
          item.accountableMemberId !== null &&
          item.accountableMemberId === ctx.membershipId
        );
      }
      if (canManageRoutine) return true;
      return canExecuteRoutine && item.accountableMemberId === ctx.membershipId;
    });
  }

  setStepStatus(
    ctx: AuthContext,
    occurrenceId: string,
    stepId: string,
    input: {
      mutationId: string;
      status: StepStatus;
      performedAt: string;
      activityGeneration?: number;
      kind?: WorkKind;
      intendedStructure?: IntendedStructure;
    },
  ) {
    if (Number.isNaN(new Date(input.performedAt).getTime()) || !input.performedAt.endsWith("Z")) {
      fail("VALIDATION", "Invalid performed instant");
    }

    const recordedAt = nowUtcIso();
    const reportId = randomUUID();

    const tx = this.db.transaction(() => {
      const occurrence = this.db
        .prepare(
          `SELECT o.id, o.household_id, o.accountable_member_id, o.household_date,
                  o.revision_id, o.definition_id, o.started_at, o.canceled_at,
                  o.structure_fingerprint,
                  o.kind AS occurrence_kind, d.kind AS definition_kind,
                  d.archive_cutoff_date, d.end_mode, d.ended_at
           FROM occurrences o
           JOIN routine_definitions d ON d.id = o.definition_id
           WHERE o.id = ?`,
        )
        .get(occurrenceId) as
        | {
            id: string;
            household_id: string;
            accountable_member_id: string | null;
            household_date: string;
            revision_id: string;
            definition_id: string;
            started_at: string | null;
            canceled_at: string | null;
            structure_fingerprint: string | null;
            occurrence_kind: string | null;
            definition_kind: string | null;
            archive_cutoff_date: string | null;
            end_mode: string | null;
            ended_at: string | null;
          }
        | undefined;
      if (!occurrence || occurrence.household_id !== ctx.householdId) {
        fail("NOT_FOUND", "Occurrence not found");
      }
      const occurrenceKind: WorkKind =
        occurrence.occurrence_kind === "responsibility" ||
        occurrence.definition_kind === "responsibility"
          ? "responsibility"
          : "routine";
      if (input.kind && input.kind !== occurrenceKind) {
        fail("CONFLICT", "Checklist kind does not match this occurrence");
      }
      if (occurrenceKind === "responsibility") {
        this.requireGrant(ctx, "responsibility.execute.own");
      } else {
        this.requireGrant(ctx, "routine.execute.own");
      }
      if (occurrenceKind === "responsibility" && !occurrence.accountable_member_id) {
        fail("FORBIDDEN", "Unassigned responsibilities cannot be completed");
      }
      if (occurrence.accountable_member_id !== ctx.membershipId) {
        fail("FORBIDDEN", "Cannot modify another member's occurrence");
      }

      this.assertActivityGeneration(ctx.householdId, input.activityGeneration);
      const activityGeneration = this.getActivityGeneration(ctx.householdId);

      const today = this.householdDateNow(ctx);
      if (compareHouseholdDates(occurrence.household_date, today) > 0) {
        fail("VALIDATION", "This checklist isn't available yet");
      }
      if (
        occurrence.canceled_at &&
        !isOccurrenceStarted(occurrence.started_at)
      ) {
        fail("FORBIDDEN", "This checklist was canceled");
      }
      if (
        occurrence.end_mode === "immediate" &&
        occurrence.ended_at &&
        !isOccurrenceStarted(occurrence.started_at) &&
        !isBeforeArchiveCutoff(
          occurrence.household_date,
          occurrence.archive_cutoff_date,
        )
      ) {
        fail("FORBIDDEN", "This checklist is no longer available for that day");
      }
      if (
        occurrence.end_mode !== "immediate" &&
        !isBeforeArchiveCutoff(
          occurrence.household_date,
          occurrence.archive_cutoff_date,
        )
      ) {
        fail("FORBIDDEN", "This checklist is no longer available for that day");
      }
      const started = isOccurrenceStarted(occurrence.started_at);
      if (!started) {
        if (occurrenceKind === "responsibility") {
          const composed = this.resolveCompositionForRevision(
            occurrence.revision_id,
            occurrence.household_date,
            ctx.householdId,
          );
          if (composed) {
            if (composed.accountableMemberId !== occurrence.accountable_member_id) {
              fail(
                "FORBIDDEN",
                "This person is no longer accountable for that day",
              );
            }
          } else {
            const owners = resolveAccountableMembers("responsibility", {
              directMemberIds: this.revisionAssignees(occurrence.revision_id),
              groupMemberIdSets: [],
            });
            if (!owners.includes(occurrence.accountable_member_id)) {
              fail(
                "FORBIDDEN",
                "This person is no longer accountable for that day",
              );
            }
          }
        } else {
          const participants = this.resolveParticipantsForRevision(
            occurrence.revision_id,
            occurrence.household_date,
          );
          if (!participants.includes(occurrence.accountable_member_id)) {
            fail(
              "FORBIDDEN",
              "This person is no longer on this routine for that day",
            );
          }
        }
      }

      if (occurrenceKind === "responsibility") {
        if (!input.intendedStructure) {
          fail("VALIDATION", "Intended structure is required for responsibilities");
        }
        const stepLogicalIds = (
          this.db
            .prepare(
              `SELECT logical_item_id FROM occurrence_steps
               WHERE occurrence_id = ? AND source = 'shared'
               ORDER BY position`,
            )
            .all(occurrenceId) as Array<{ logical_item_id: string | null }>
        ).map((row) => row.logical_item_id);
        if (
          !intendedStructureMatches(input.intendedStructure, {
            revisionId: occurrence.revision_id,
            accountableMemberId: occurrence.accountable_member_id,
            stepLogicalIds,
            structureFingerprint: occurrence.structure_fingerprint,
          })
        ) {
          fail("CONFLICT", "This checklist changed; refresh and try again");
        }
      }

      const digest = checklistMutationPayloadDigest({
        occurrenceId,
        stepId,
        status: input.status,
        kind: occurrenceKind,
        ...(input.intendedStructure
          ? { intendedStructure: input.intendedStructure }
          : {}),
      });

      const receipt = this.db
        .prepare(
          `SELECT household_id, occurrence_id, occurrence_step_id, actor_membership_id,
                  kind, resulting_state, activity_generation, payload_digest, response_json
           FROM mutation_receipts WHERE mutation_id = ?`,
        )
        .get(input.mutationId) as
        | {
            household_id: string | null;
            occurrence_id: string | null;
            occurrence_step_id: string | null;
            actor_membership_id: string | null;
            kind: string | null;
            resulting_state: string | null;
            activity_generation: number | null;
            payload_digest: string | null;
            response_json: string;
          }
        | undefined;
      if (receipt) {
        const bound =
          receipt.household_id === ctx.householdId &&
          receipt.occurrence_id === occurrenceId &&
          receipt.occurrence_step_id === stepId &&
          receipt.actor_membership_id === ctx.membershipId &&
          receipt.kind === occurrenceKind &&
          receipt.resulting_state === input.status &&
          receipt.payload_digest === digest &&
          (receipt.activity_generation === null ||
            receipt.activity_generation === activityGeneration);
        if (!bound) {
          fail("CONFLICT", "Mutation id already used for a different checklist command");
        }
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

      const performerMemberId =
        occurrenceKind === "responsibility" ? ctx.membershipId : null;

      this.db
        .prepare("UPDATE occurrence_steps SET status = ? WHERE id = ?")
        .run(input.status, stepId);
      if (isLockingStepStatus(input.status)) {
        this.db
          .prepare(
            `UPDATE occurrences
             SET started_at = COALESCE(started_at, ?), version = version + 1
             WHERE id = ?`,
          )
          .run(recordedAt, occurrenceId);
      } else {
        this.db
          .prepare("UPDATE occurrences SET version = version + 1 WHERE id = ?")
          .run(occurrenceId);
      }
      this.db
        .prepare(
          `INSERT INTO step_reports
           (id, mutation_id, occurrence_id, occurrence_step_id, accountable_member_id,
            acting_member_id, performer_member_id, performed_at, recorded_at, resulting_state)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          reportId,
          input.mutationId,
          occurrenceId,
          stepId,
          occurrence.accountable_member_id,
          ctx.membershipId,
          performerMemberId,
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
          performerMemberId,
          performedAt: input.performedAt,
          recordedAt,
          resultingState: input.status,
        },
      };
      this.stepStatusFailureHook?.();
      this.db
        .prepare(
          `INSERT INTO mutation_receipts
           (mutation_id, response_json, created_at, household_id, occurrence_id,
            occurrence_step_id, actor_membership_id, kind, resulting_state,
            activity_generation, payload_digest)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.mutationId,
          JSON.stringify(payload),
          recordedAt,
          ctx.householdId,
          occurrenceId,
          stepId,
          ctx.membershipId,
          occurrenceKind,
          input.status,
          activityGeneration,
          digest,
        );
      return payload;
    });
    return tx();
  }

  historyForDate(ctx: AuthContext, householdDate: HouseholdDate): OccurrenceView[] {
    this.requireHistoryAccess(ctx);
    if (!isValidHouseholdDate(householdDate)) fail("VALIDATION", "Invalid household date");
    const today = this.householdDateNow(ctx);
    if (compareHouseholdDates(householdDate, today) > 0) {
      fail(
        "VALIDATION",
        "Future dates are outside History; use Preview for expectations",
      );
    }
    return this.loadStoredHistoryOccurrences(
      ctx.householdId,
      householdDate,
      this.authorizedHistoryKinds(ctx),
    );
  }

  historySummaries(
    ctx: AuthContext,
    input: {
      date?: string;
      from?: string;
      to?: string;
      personId?: string;
      routineId?: string;
      status?: "complete" | "incomplete";
      kind?: WorkKind;
      workKind?: WorkKind;
    },
  ): {
    householdDate?: string;
    from?: string;
    to?: string;
    activityGeneration: number;
    occurrences: HistoryOccurrenceSummary[];
  } {
    this.requireHistoryAccess(ctx);
    const today = this.householdDateNow(ctx);
    const dates = this.resolveHistoryDates(today, input);
    const kindFilter = input.kind ?? input.workKind;
    const allowedKinds = this.authorizedHistoryKinds(ctx, kindFilter);
    const results: HistoryOccurrenceSummary[] = [];
    for (const householdDate of dates) {
      for (const view of this.loadStoredHistoryOccurrences(
        ctx.householdId,
        householdDate,
        allowedKinds,
      )) {
        if (input.personId && view.accountableMemberId !== input.personId) continue;
        if (input.routineId && view.definitionId !== input.routineId) continue;
        if (input.status === "complete" && !view.completed) continue;
        if (input.status === "incomplete" && view.completed) continue;
        results.push(this.toHistorySummary(view));
      }
    }
    const activityGeneration = this.getActivityGeneration(ctx.householdId);
    if (input.date || (!input.from && !input.to)) {
      return {
        householdDate: dates[0]!,
        activityGeneration,
        occurrences: results,
      };
    }
    return {
      from: dates[dates.length - 1]!,
      to: dates[0]!,
      activityGeneration,
      occurrences: results,
    };
  }

  getHistoryOccurrenceDetail(
    ctx: AuthContext,
    occurrenceId: string,
  ): HistoryOccurrenceDetail {
    this.requireHistoryAccess(ctx);
    const row = this.db
      .prepare(
        `SELECT o.id, o.household_id, o.definition_id, o.household_date,
                o.accountable_member_id, o.kind AS occurrence_kind, d.kind AS definition_kind
         FROM occurrences o
         JOIN routine_definitions d ON d.id = o.definition_id
         WHERE o.id = ?`,
      )
      .get(occurrenceId) as
      | {
          id: string;
          household_id: string;
          definition_id: string;
          household_date: string;
          accountable_member_id: string | null;
          occurrence_kind: string | null;
          definition_kind: string | null;
        }
      | undefined;
    if (!row || row.household_id !== ctx.householdId) {
      fail("NOT_FOUND", "Occurrence not found");
    }
    const kind: WorkKind =
      row.occurrence_kind === "responsibility" ||
      row.definition_kind === "responsibility"
        ? "responsibility"
        : "routine";
    const allowed = this.authorizedHistoryKinds(ctx);
    if (!allowed.includes(kind)) {
      fail("NOT_FOUND", "Occurrence not found");
    }
    const view = this.getOccurrenceView(
      row.definition_id,
      row.household_date,
      row.accountable_member_id,
      kind,
    );
    if (!view) fail("NOT_FOUND", "Occurrence not found");
    return {
      ...view,
      reports: this.listStepReports(occurrenceId),
    };
  }

  listStepReports(occurrenceId: string): StepReportPublic[] {
    const rows = this.db
      .prepare(
        `SELECT sr.id, sr.mutation_id, sr.occurrence_id, sr.occurrence_step_id,
                sr.accountable_member_id, sr.acting_member_id, sr.performer_member_id,
                sr.performed_at, sr.recorded_at, sr.resulting_state,
                hm.display_name AS acting_name
         FROM step_reports sr
         LEFT JOIN household_memberships hm ON hm.id = sr.acting_member_id
         WHERE sr.occurrence_id = ?
         ORDER BY sr.recorded_at, sr.id`,
      )
      .all(occurrenceId) as Array<{
      id: string;
      mutation_id: string;
      occurrence_id: string;
      occurrence_step_id: string;
      accountable_member_id: string;
      acting_member_id: string;
      performer_member_id: string | null;
      performed_at: string;
      recorded_at: string;
      resulting_state: StepStatus;
      acting_name: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      mutationId: row.mutation_id,
      occurrenceId: row.occurrence_id,
      occurrenceStepId: row.occurrence_step_id,
      accountableMemberId: row.accountable_member_id,
      actingMemberId: row.acting_member_id,
      actingMemberName: row.acting_name,
      performerMemberId: row.performer_member_id ?? null,
      performedAt: row.performed_at,
      recordedAt: row.recorded_at,
      resultingState: row.resulting_state,
    }));
  }

  getActivityGeneration(householdId: string): number {
    const row = this.db
      .prepare("SELECT activity_generation FROM households WHERE id = ?")
      .get(householdId) as { activity_generation: number } | undefined;
    return row?.activity_generation ?? 0;
  }

  getActivityResetFloor(householdId: string): string | null {
    const row = this.db
      .prepare("SELECT activity_reset_floor FROM households WHERE id = ?")
      .get(householdId) as { activity_reset_floor: string | null } | undefined;
    return row?.activity_reset_floor ?? null;
  }

  getFamilyOrderVersion(householdId: string): number {
    const row = this.db
      .prepare("SELECT family_order_version FROM households WHERE id = ?")
      .get(householdId) as { family_order_version: number } | undefined;
    return row?.family_order_version ?? 0;
  }

  saveFamilyOrder(
    ctx: AuthContext,
    input: SaveFamilyOrderInput,
  ): FamilyOrderSaveResult {
    this.requireGrant(ctx, "household.structure.manage");
    const digest = familyOrderPayloadDigest(input);
    const prior = this.db
      .prepare(
        `SELECT household_id, kind, payload_digest, response_json
         FROM family_order_mutation_receipts WHERE mutation_id = ?`,
      )
      .get(input.mutationId) as
      | {
          household_id: string;
          kind: string;
          payload_digest: string;
          response_json: string;
        }
      | undefined;
    if (prior) {
      if (
        prior.household_id !== ctx.householdId ||
        prior.kind !== "family_order_save" ||
        prior.payload_digest !== digest
      ) {
        fail("CONFLICT", "Family order couldn't be updated");
      }
      return JSON.parse(prior.response_json) as FamilyOrderSaveResult;
    }

    const tx = this.db.transaction(() => {
      const currentVersion = this.getFamilyOrderVersion(ctx.householdId);
      if (input.expectedVersion !== currentVersion) {
        fail("CONFLICT", "Family order was updated elsewhere; re-read and try again");
      }
      const existing = this.db
        .prepare(
          `SELECT id FROM household_memberships WHERE household_id = ? ORDER BY id`,
        )
        .all(ctx.householdId) as Array<{ id: string }>;
      const existingIds = new Set(existing.map((row) => row.id));
      if (input.membershipIds.length !== existingIds.size) {
        fail("VALIDATION", "Family order must include every household person exactly once");
      }
      const seen = new Set<string>();
      for (const membershipId of input.membershipIds) {
        if (seen.has(membershipId)) {
          fail("VALIDATION", "Family order contains duplicate people");
        }
        seen.add(membershipId);
        if (!existingIds.has(membershipId)) {
          fail("VALIDATION", "Family order includes an unknown person");
        }
      }
      const update = this.db.prepare(
        `UPDATE household_memberships SET sort_order = ? WHERE id = ? AND household_id = ?`,
      );
      input.membershipIds.forEach((membershipId, index) => {
        update.run(index, membershipId, ctx.householdId);
      });
      const version = currentVersion + 1;
      this.db
        .prepare(
          `UPDATE households SET family_order_version = ? WHERE id = ?`,
        )
        .run(version, ctx.householdId);

      this.familyOrderFailureHook?.();

      const result: FamilyOrderSaveResult = {
        version,
        people: this.listMemberships(ctx.householdId),
      };
      this.db
        .prepare(
          `INSERT INTO family_order_mutation_receipts
           (mutation_id, household_id, kind, payload_digest, response_json, created_at)
           VALUES (?, ?, 'family_order_save', ?, ?, ?)`,
        )
        .run(
          input.mutationId,
          ctx.householdId,
          digest,
          JSON.stringify(result),
          nowUtcIso(),
        );
      return result;
    });
    return tx();
  }

  clearRoutineActivity(
    ctx: AuthContext,
    input: ClearRoutineActivityInput,
  ): ActivityClearResult {
    this.requireGrant(ctx, "household.activity.clear");
    const digest = activityClearPayloadDigest(input);
    const prior = this.db
      .prepare(
        `SELECT household_id, kind, payload_digest, actor_membership_id, response_json
         FROM activity_reset_receipts WHERE mutation_id = ?`,
      )
      .get(input.mutationId) as
      | {
          household_id: string;
          kind: string;
          payload_digest: string;
          actor_membership_id: string;
          response_json: string;
        }
      | undefined;
    if (prior) {
      if (
        prior.household_id !== ctx.householdId ||
        prior.kind !== "activity_clear" ||
        prior.payload_digest !== digest ||
        prior.actor_membership_id !== ctx.membershipId
      ) {
        fail("CONFLICT", "Routine activity clear couldn't be completed");
      }
      return JSON.parse(prior.response_json) as ActivityClearResult;
    }

    const createdAt = nowUtcIso();
    const tx = this.db.transaction(() => {
      const currentGeneration = this.getActivityGeneration(ctx.householdId);
      if (input.expectedGeneration !== currentGeneration) {
        fail(
          "CONFLICT",
          "Routine activity was cleared elsewhere; refresh and try again",
        );
      }

      if (input.acknowledgedScope !== "routines_and_responsibilities") {
        const responsibilityDefinition = this.db
          .prepare(
            `SELECT 1 FROM routine_definitions
             WHERE household_id = ? AND kind = 'responsibility' LIMIT 1`,
          )
          .get(ctx.householdId);
        const responsibilityOccurrence = this.db
          .prepare(
            `SELECT 1 FROM occurrences
             WHERE household_id = ? AND kind = 'responsibility' LIMIT 1`,
          )
          .get(ctx.householdId);
        if (responsibilityDefinition || responsibilityOccurrence) {
          fail(
            "CONFLICT",
            "Confirm clearing routines and responsibilities",
          );
        }
      }

      const occurrences = (
        this.db
          .prepare(`SELECT COUNT(*) AS count FROM occurrences WHERE household_id = ?`)
          .get(ctx.householdId) as { count: number }
      ).count;
      const occurrenceSteps = (
        this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM occurrence_steps
             WHERE occurrence_id IN (SELECT id FROM occurrences WHERE household_id = ?)`,
          )
          .get(ctx.householdId) as { count: number }
      ).count;
      const stepReports = (
        this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM step_reports
             WHERE occurrence_id IN (SELECT id FROM occurrences WHERE household_id = ?)`,
          )
          .get(ctx.householdId) as { count: number }
      ).count;
      const mutationReceipts = (
        this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM mutation_receipts
             WHERE household_id = ?
                OR occurrence_id IN (
                     SELECT id FROM occurrences WHERE household_id = ?
                   )`,
          )
          .get(ctx.householdId, ctx.householdId) as { count: number }
      ).count;

      this.db
        .prepare(
          `DELETE FROM step_reports
           WHERE occurrence_id IN (SELECT id FROM occurrences WHERE household_id = ?)`,
        )
        .run(ctx.householdId);
      this.db
        .prepare(
          `DELETE FROM occurrence_steps
           WHERE occurrence_id IN (SELECT id FROM occurrences WHERE household_id = ?)`,
        )
        .run(ctx.householdId);
      this.db
        .prepare(
          `DELETE FROM mutation_receipts
           WHERE household_id = ?
              OR occurrence_id IN (
                   SELECT id FROM occurrences WHERE household_id = ?
                 )`,
        )
        .run(ctx.householdId, ctx.householdId);
      this.db
        .prepare(`DELETE FROM occurrences WHERE household_id = ?`)
        .run(ctx.householdId);

      const resultGeneration = currentGeneration + 1;
      const resetFloor = this.householdDateNow(ctx);
      this.db
        .prepare(
          `UPDATE households
           SET activity_generation = ?, activity_reset_floor = ?
           WHERE id = ?`,
        )
        .run(resultGeneration, resetFloor, ctx.householdId);

      this.clearActivityFailureHook?.();

      const result: ActivityClearResult = {
        activityGeneration: resultGeneration,
        activityResetFloor: resetFloor,
        counts: {
          occurrences,
          occurrenceSteps,
          stepReports,
          mutationReceipts,
        },
      };
      this.db
        .prepare(
          `INSERT INTO activity_reset_receipts
           (mutation_id, household_id, kind, payload_digest, actor_membership_id,
            expected_generation, result_generation, reset_floor, counts_json,
            response_json, created_at, acknowledged_scope)
           VALUES (?, ?, 'activity_clear', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.mutationId,
          ctx.householdId,
          digest,
          ctx.membershipId,
          input.expectedGeneration,
          resultGeneration,
          resetFloor,
          JSON.stringify(result.counts),
          JSON.stringify(result),
          createdAt,
          input.acknowledgedScope ?? null,
        );
      return result;
    });
    return tx();
  }

  occurrenceSnapshotStructure(occurrenceId: string) {
    const occurrence = this.db
      .prepare(
        `SELECT id, revision_id, title, daypart, accountable_member_id, household_date
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
        `SELECT definition_id, household_date, accountable_member_id, kind
         FROM occurrences WHERE id = ?`,
      )
      .get(occurrenceId) as
      | {
          definition_id: string;
          household_date: string;
          accountable_member_id: string | null;
          kind: string | null;
        }
      | undefined;
    if (!row) return null;
    if (row.kind === "responsibility") {
      return this.getOccurrenceView(
        row.definition_id,
        row.household_date,
        null,
        "responsibility",
      );
    }
    if (!row.accountable_member_id) return null;
    return this.getOccurrenceView(
      row.definition_id,
      row.household_date,
      row.accountable_member_id,
      "routine",
    );
  }

  savePersonalLayer(
    ctx: AuthContext,
    input: {
      definitionId: string;
      additions: PersonalAdditionInput[];
      effectiveDate?: string;
    },
  ): PersonalLayer {
    this.requireGrant(ctx, "routine.personalize.direct");
    this.assertDefinitionKind(
      ctx.householdId,
      input.definitionId,
      "routine",
      "Routine not found",
    );
    const routine = this.loadRoutineDefinition(ctx.householdId, input.definitionId);
    if (!routine) fail("NOT_FOUND", "Routine not found");
    if (routine.archived) {
      fail("CONFLICT", "Archived routines cannot accept personal changes");
    }
    const minimum = addHouseholdDays(this.householdDateNow(ctx), 1);
    const effectiveDate = input.effectiveDate ?? minimum;
    if (
      !isValidHouseholdDate(effectiveDate) ||
      compareHouseholdDates(effectiveDate, minimum) < 0
    ) {
      fail("VALIDATION", "Personal changes must be effective no earlier than tomorrow");
    }
    this.validatePersonalAdditions(input.additions);
    this.requireCalendarForSchoolRules(ctx.householdId, input.additions);
    return this.insertPersonalLayer(
      ctx.membershipId,
      routine.id,
      effectiveDate,
      input.additions,
    );
  }

  getPersonalLayer(
    membershipId: string,
    definitionId: string,
    date: string,
  ): PersonalLayer | null {
    const row = this.db
      .prepare(
        `SELECT id, membership_id, definition_id, effective_date, created_at
         FROM personal_routine_revisions
         WHERE membership_id = ? AND definition_id = ? AND effective_date <= ?
         ORDER BY effective_date DESC LIMIT 1`,
      )
      .get(membershipId, definitionId, date) as
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
        `SELECT id, position, text, obligation, anchor_logical_item_id, place, applicability_json
         FROM personal_additions WHERE personal_revision_id = ? ORDER BY position`,
      )
      .all(row.id) as Array<{
      id: string;
      position: number;
      text: string;
      obligation: ObligationMeaning;
      anchor_logical_item_id: string | null;
      place: "before" | "after" | "end";
      applicability_json: string | null;
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
        applicability: parseApplicability(addition.applicability_json),
        anchorLogicalItemId: addition.anchor_logical_item_id,
        place: addition.place,
      })),
    };
  }

  previewComposition(
    ctx: AuthContext,
    membershipId: string,
    definitionId: string,
    date: string,
  ) {
    this.authorizeMembershipView(ctx, membershipId);
    this.assertDefinitionKind(
      ctx.householdId,
      definitionId,
      "routine",
      "Routine not found",
    );
    const routine = this.loadRoutineDefinition(ctx.householdId, definitionId);
    if (!routine) fail("NOT_FOUND", "Routine not found");
    if (!isBeforeArchiveCutoff(date, routine.archiveCutoffDate)) {
      fail("VALIDATION", "This routine is archived for that date");
    }
    const revision = this.selectRevisionContentForDate(routine, date);
    if (!revision) fail("NOT_FOUND", "No routine revision applies");
    const layer = this.getPersonalLayer(membershipId, definitionId, date);
    const composed = composeMorningRoutine(
      revision.steps.map((step) => ({
        logicalItemId: step.logicalItemId,
        text: step.text,
        obligation: step.obligation,
        applicability: step.applicability ?? DEFAULT_APPLICABILITY,
      })),
      layer?.additions.map((addition) => ({
        id: addition.id,
        text: addition.text,
        obligation: addition.obligation,
        applicability: addition.applicability ?? DEFAULT_APPLICABILITY,
        anchorLogicalItemId: addition.anchorLogicalItemId,
        place: addition.place,
      })) ?? [],
    );
    const runs = isDateApplicable(date, revision.weekdays);
    const edition = this.loadCalendarEditionForDate(ctx.householdId, date);
    const calendarShape =
      edition.years.length > 0
        ? {
            years: edition.years.map((y) => ({
              startDate: y.startDate,
              endDate: y.endDate,
              usualWeekdays: y.usualWeekdays,
              exceptions: y.exceptions,
            })),
          }
        : null;
    const iso = isoWeekdayForHouseholdDate(date);
    const nextDate = addHouseholdDays(date, 1);
    const nextIso = isoWeekdayForHouseholdDate(nextDate);
    const schoolToday = isSchoolDayForDate(date, calendarShape, iso);
    const schoolTomorrow = isSchoolDayForDate(nextDate, calendarShape, nextIso);
    const evaluated = composed.map((step, position) => {
      const decision = evaluateApplicability({
        rule: step.applicability,
        date,
        isoWeekday: iso,
        nextDate,
        nextIsoWeekday: nextIso,
        schoolToday,
        schoolTomorrow,
      });
      return {
        position,
        text: step.text,
        obligation: step.obligation,
        source: step.source,
        logicalItemId: step.logicalItemId,
        applicability: step.applicability,
        included: runs && decision.include,
        reason: !runs
          ? "Routine does not run on this date"
          : decision.reason,
        unresolved: !runs ? false : "unresolved" in decision && decision.unresolved === true,
      };
    });
    const included = evaluated.filter((step) => step.included);
    const excluded = evaluated.filter((step) => !step.included);
    const unresolvedContext = evaluated.some((step) => step.unresolved);
    let message: string | null = null;
    if (!runs) {
      message = "This routine does not run for that date.";
    } else if (unresolvedContext) {
      message = "School calendar is not set up for school-dependent steps.";
    } else if (included.length === 0) {
      message = "No steps apply on this date";
    }
    return {
      householdDate: date,
      membershipId,
      definitionId: routine.id,
      revisionId: revision.id,
      personalRevisionId: layer?.id ?? null,
      title: revision.title,
      daypart: revision.daypart,
      weekdays: revision.weekdays,
      runs,
      unresolvedContext,
      message,
      steps: included,
      excludedSteps: excluded,
    };
  }

  createProposal(
    ctx: AuthContext,
    input: Omit<PersonalAdditionInput, "id"> & { definitionId: string },
  ) {
    this.requireGrant(ctx, "routine.personalize.propose");
    this.validatePersonalAdditions([input]);
    this.requireCalendarForSchoolRules(ctx.householdId, [input]);
    this.assertDefinitionKind(
      ctx.householdId,
      input.definitionId,
      "routine",
      "Routine not found",
    );
    const routine = this.loadRoutineDefinition(ctx.householdId, input.definitionId);
    if (!routine) fail("NOT_FOUND", "Routine not found");
    if (routine.archived) {
      fail("CONFLICT", "Archived routines cannot accept new proposals");
    }
    const id = randomUUID();
    const proposedAt = nowUtcIso();
    this.db
      .prepare(
        `INSERT INTO routine_proposals
         (id, household_id, membership_id, definition_id, association_status,
          text, obligation, anchor_logical_item_id,
          place, status, proposed_at, decided_at, decider_membership_id, personal_revision_id,
          applicability_json)
         VALUES (?, ?, ?, ?, 'resolved', ?, ?, ?, ?, 'pending', ?, NULL, NULL, NULL, ?)`,
      )
      .run(
        id,
        ctx.householdId,
        ctx.membershipId,
        input.definitionId,
        input.text.trim(),
        input.obligation,
        input.anchorLogicalItemId ?? null,
        input.place,
        proposedAt,
        serializeApplicability(input.applicability ?? DEFAULT_APPLICABILITY),
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
    if (!proposal.definitionId || proposal.associationStatus === "unresolved") {
      if (input.decision === "approved") {
        fail("CONFLICT", "This proposal is not linked to a routine");
      }
    }
    const routine = proposal.definitionId
      ? this.loadRoutineDefinition(ctx.householdId, proposal.definitionId)
      : null;
    if (input.decision === "approved") {
      if (!routine || !proposal.definitionId) fail("NOT_FOUND", "Routine not found");
      this.assertDefinitionKind(
        ctx.householdId,
        proposal.definitionId,
        "routine",
        "Routine not found",
      );
      if (routine.archived) {
        fail("CONFLICT", "Archived routines cannot accept approved proposals");
      }
    }
    let personalRevisionId: string | null = null;
    const tx = this.db.transaction(() => {
      const current = this.getProposal(proposalId)!;
      if (current.status !== "pending") {
        if (current.status === input.decision) return;
        fail("CONFLICT", "Proposal has already been decided");
      }
      if (input.decision === "approved") {
        const definitionId = proposal.definitionId!;
        let effectiveDate = addHouseholdDays(this.householdDateNow(ctx), 1);
        while (
          this.db
            .prepare(
              `SELECT 1 FROM personal_routine_revisions
               WHERE membership_id = ? AND definition_id = ? AND effective_date = ?`,
            )
            .get(proposal.membershipId, definitionId, effectiveDate)
        ) {
          effectiveDate = addHouseholdDays(effectiveDate, 1);
        }
        const prior = this.getPersonalLayer(
          proposal.membershipId,
          definitionId,
          effectiveDate,
        );
        const layer = this.insertPersonalLayer(
          proposal.membershipId,
          definitionId,
          effectiveDate,
          [
            ...(prior?.additions ?? []),
            {
              id: randomUUID(),
              text: proposal.text,
              obligation: proposal.obligation,
              applicability: proposal.applicability ?? DEFAULT_APPLICABILITY,
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

  private requireHistoryAccess(ctx: AuthContext): void {
    if (
      !this.hasGrant(ctx, "routine.shared.manage") &&
      !this.hasGrant(ctx, "responsibility.manage")
    ) {
      fail("FORBIDDEN", "Required authority is missing");
    }
  }

  private authorizedHistoryKinds(
    ctx: AuthContext,
    kindFilter?: WorkKind,
  ): WorkKind[] {
    const allowed: WorkKind[] = [];
    if (this.hasGrant(ctx, "routine.shared.manage")) allowed.push("routine");
    if (this.hasGrant(ctx, "responsibility.manage")) {
      allowed.push("responsibility");
    }
    if (!kindFilter) return allowed;
    return allowed.includes(kindFilter) ? [kindFilter] : [];
  }

  private assertActivityGeneration(
    householdId: string,
    activityGeneration: number | undefined,
  ): void {
    const current = this.getActivityGeneration(householdId);
    if (activityGeneration === undefined) {
      if (current !== 0) fail("CONFLICT", ACTIVITY_CLEARED_MESSAGE);
      return;
    }
    if (activityGeneration !== current) {
      fail("CONFLICT", ACTIVITY_CLEARED_MESSAGE);
    }
  }

  private resolveHistoryDates(
    today: HouseholdDate,
    input: { date?: string; from?: string; to?: string },
  ): HouseholdDate[] {
    if (input.date && (input.from || input.to)) {
      fail("VALIDATION", "Use either date or from/to, not both");
    }
    if (input.from || input.to) {
      if (!input.from || !input.to) {
        fail("VALIDATION", "Both from and to are required for a History range");
      }
      if (!isValidHouseholdDate(input.from) || !isValidHouseholdDate(input.to)) {
        fail("VALIDATION", "Invalid History date range");
      }
      if (compareHouseholdDates(input.from, input.to) > 0) {
        fail("VALIDATION", "History range from must be on or before to");
      }
      if (compareHouseholdDates(input.to, today) > 0) {
        fail(
          "VALIDATION",
          "Future dates are outside History; use routine Preview for expectations",
        );
      }
      const span =
        Math.round(
          (Date.parse(`${input.to}T00:00:00Z`) - Date.parse(`${input.from}T00:00:00Z`)) /
            86_400_000,
        ) + 1;
      if (span > 31) {
        fail("VALIDATION", "History range cannot exceed 31 days");
      }
      const dates: HouseholdDate[] = [];
      let cursor = input.to;
      while (compareHouseholdDates(cursor, input.from) >= 0) {
        dates.push(cursor);
        if (cursor === input.from) break;
        cursor = addHouseholdDays(cursor, -1);
      }
      return dates;
    }
    const date = input.date ?? today;
    if (!isValidHouseholdDate(date)) fail("VALIDATION", "Invalid date");
    if (compareHouseholdDates(date, today) > 0) {
      fail(
        "VALIDATION",
        "Future dates are outside History; use routine Preview for expectations",
      );
    }
    return [date];
  }

  private loadStoredHistoryOccurrences(
    householdId: string,
    householdDate: HouseholdDate,
    allowedKinds: WorkKind[] = ["routine", "responsibility"],
  ): OccurrenceView[] {
    if (allowedKinds.length === 0) return [];
    const rows = this.db
      .prepare(
        `SELECT o.definition_id, o.accountable_member_id, o.kind,
                COALESCE(hm.sort_order, 2147483647) AS sort_order
         FROM occurrences o
         LEFT JOIN household_memberships hm ON hm.id = o.accountable_member_id
         WHERE o.household_id = ? AND o.household_date = ?
           AND (o.canceled_at IS NULL OR o.started_at IS NOT NULL)
         ORDER BY sort_order, COALESCE(hm.id, ''), o.definition_id`,
      )
      .all(householdId, householdDate) as Array<{
      definition_id: string;
      accountable_member_id: string | null;
      kind: string | null;
      sort_order: number;
    }>;
    const allowed = new Set(allowedKinds);
    const results: OccurrenceView[] = [];
    for (const row of rows) {
      const kind: WorkKind =
        row.kind === "responsibility" ? "responsibility" : "routine";
      if (!allowed.has(kind)) continue;
      // Routines require an owner; responsibilities may be explicitly Unassigned.
      if (kind === "routine" && !row.accountable_member_id) continue;
      const view = this.getOccurrenceView(
        row.definition_id,
        householdDate,
        row.accountable_member_id,
        kind,
      );
      if (!view) continue;
      // Same omit rule as Today: empty unstarted rows are not historically visible.
      if (view.steps.length === 0 && !view.startedAt) continue;
      results.push(view);
    }
    results.sort((a, b) => {
      const orderA =
        rows.find((row) => row.accountable_member_id === a.accountableMemberId)
          ?.sort_order ?? 2147483647;
      const orderB =
        rows.find((row) => row.accountable_member_id === b.accountableMemberId)
          ?.sort_order ?? 2147483647;
      if (orderA !== orderB) return orderA - orderB;
      return compareOccurrenceOrder(a, b);
    });
    return results;
  }

  private toHistorySummary(view: OccurrenceView): HistoryOccurrenceSummary {
    let completed = 0;
    let notNeeded = 0;
    let open = 0;
    for (const step of view.steps) {
      if (step.status === "completed") completed += 1;
      else if (step.status === "not_needed") notNeeded += 1;
      else open += 1;
    }
    return {
      id: view.id,
      definitionId: view.definitionId,
      title: view.title,
      daypart: view.daypart,
      accountableMemberId: view.accountableMemberId,
      accountableMemberName: view.accountableMemberName,
      householdDate: view.householdDate,
      completed: view.completed,
      startedAt: view.startedAt,
      kind: view.kind,
      counts: { completed, notNeeded, open },
    };
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
    sortOrder?: number,
  ): void {
    const order =
      sortOrder ??
      (
        this.db
          .prepare(
            `SELECT COALESCE(MAX(sort_order), -1) AS max_order
             FROM household_memberships WHERE household_id = ?`,
          )
          .get(householdId) as { max_order: number }
      ).max_order + 1;
    this.db
      .prepare(
        `INSERT INTO members (id, household_id, display_name, capabilities_json)
         VALUES (?, ?, ?, ?)`,
      )
      .run(id, householdId, displayName, legacyCapabilities([...grants]));
    this.db
      .prepare(
        `INSERT INTO household_memberships
         (id, household_id, user_id, display_name, status, created_at, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, householdId, userId, displayName, status, createdAt, order);
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
    sort_order: number;
  }): MemberPublic {
    return {
      id: row.id,
      displayName: row.display_name,
      status: row.status,
      classification: row.classification,
      version: row.version,
      sortOrder: row.sort_order,
      grants: this.grantsForMembership(row.id),
      accessState: this.accessStateForMembership(row.id),
    };
  }

  private requireMemberPublic(membershipId: string, householdId: string): MemberPublic {
    const row = this.db
      .prepare(
        `SELECT id, display_name, status, classification, version, sort_order
         FROM household_memberships WHERE id = ? AND household_id = ?`,
      )
      .get(membershipId, householdId) as
      | {
          id: string;
          display_name: string;
          status: "active" | "pending";
          classification: PersonClassification | null;
          version: number;
          sort_order: number;
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

  private personRoutineProjections(
    ctx: AuthContext,
    membershipId: string,
  ): PersonDetail["routines"] {
    const today = this.householdDateNow(ctx);
    const definitions = this.listRoutines(ctx.householdId, { includeArchived: true });
    const results: PersonDetail["routines"] = [];
    for (const definition of definitions) {
      if (!isBeforeArchiveCutoff(today, definition.archiveCutoffDate)) continue;
      const revision = this.selectRevisionContentForDate(definition, today);
      if (!revision) continue;
      const direct = revision.assigneeMemberIds.includes(membershipId);
      const viaGroup = revision.assigneeGroupIds.some((groupId) =>
        this.groupMembersOnDate(groupId, today).includes(membershipId),
      );
      if (!direct && !viaGroup) continue;
      const source: "direct" | "group" | "both" =
        direct && viaGroup ? "both" : direct ? "direct" : "group";
      results.push({
        definitionId: definition.id,
        title: revision.title,
        daypart: revision.daypart,
        currentlyAssigned: true,
        source,
        effectiveDate: revision.effectiveDate,
      });
    }
    return results;
  }

  private toGroupPublic(
    row: {
      id: string;
      name: string;
      version: number;
      created_at: string;
      updated_at: string;
    },
    today: HouseholdDate,
  ): GroupPublic {
    const membershipIds = (
      this.db
        .prepare(
          `SELECT membership_id FROM household_group_members
           WHERE group_id = ? ORDER BY membership_id`,
        )
        .all(row.id) as Array<{ membership_id: string }>
    ).map((entry) => entry.membership_id);
    const effectiveMembershipIds = this.groupMembersOnDate(row.id, today);
    const pending =
      !sameMembershipSet(membershipIds, effectiveMembershipIds)
        ? this.nextMembershipEffectDate(row.id, today)
        : null;
    const usedByRoutines = this.listGroupRoutineReferences(row.id, today);
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      membershipIds,
      effectiveMembershipIds,
      membershipPendingFromDate: pending,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      usedByRoutines,
      usedByMorningRoutine: usedByRoutines.length > 0,
      routineEffectFromDate:
        usedByRoutines.length > 0 ? addHouseholdDays(today, 1) : null,
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
          `SELECT id, logical_item_id, position, text, obligation, applicability_json
           FROM revision_steps WHERE revision_id = ? ORDER BY position`,
        )
        .all(revisionId) as Array<{
        id: string;
        logical_item_id: string | null;
        position: number;
        text: string;
        obligation: ObligationMeaning;
        applicability_json: string | null;
      }>
    ).map((step) => ({
      id: step.id,
      logicalItemId: step.logical_item_id ?? step.id,
      position: step.position,
      text: step.text,
      obligation: step.obligation,
      applicability: parseApplicability(step.applicability_json),
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

  private revisionGroupSources(revisionId: string): string[] {
    return (
      this.db
        .prepare(
          `SELECT group_id FROM revision_group_sources
           WHERE revision_id = ? ORDER BY group_id`,
        )
        .all(revisionId) as Array<{ group_id: string }>
    ).map((row) => row.group_id);
  }

  private householdTimezone(householdId: string): string {
    const row = this.db
      .prepare("SELECT timezone FROM households WHERE id = ?")
      .get(householdId) as { timezone: string } | undefined;
    return row?.timezone ?? "UTC";
  }

  private householdDateFor(householdId: string, now = new Date()): HouseholdDate {
    return householdDateFromInstant(now, this.householdTimezone(householdId));
  }

  private nextMembershipEffectDate(
    groupId: string,
    today: HouseholdDate,
  ): HouseholdDate | null {
    const row = this.db
      .prepare(
        `SELECT MIN(effective_date) AS effect_date
         FROM group_membership_versions
         WHERE group_id = ? AND effective_date > ?`,
      )
      .get(groupId, today) as { effect_date: string | null } | undefined;
    return (row?.effect_date as HouseholdDate | null) ?? addHouseholdDays(today, 1);
  }

  private groupMembersOnDate(groupId: string, date: HouseholdDate): string[] {
    const versions = (
      this.db
        .prepare(
          `SELECT id, version, effective_date
           FROM group_membership_versions WHERE group_id = ?`,
        )
        .all(groupId) as Array<{ id: string; version: number; effective_date: string }>
    ).map((row) => ({
      id: row.id,
      version: row.version,
      effectiveDate: row.effective_date as HouseholdDate,
    }));
    const selected = selectMembershipVersionForDate(versions, date);
    if (!selected) {
      return (
        this.db
          .prepare(
            `SELECT membership_id FROM household_group_members
             WHERE group_id = ? ORDER BY membership_id`,
          )
          .all(groupId) as Array<{ membership_id: string }>
      ).map((row) => row.membership_id);
    }
    return (
      this.db
        .prepare(
          `SELECT membership_id FROM group_membership_version_members
           WHERE version_id = ? ORDER BY membership_id`,
        )
        .all(selected.id) as Array<{ membership_id: string }>
    ).map((row) => row.membership_id);
  }

  private resolveParticipantsForRevision(
    revisionId: string,
    date: HouseholdDate,
  ): string[] {
    const directMemberIds = this.revisionAssignees(revisionId);
    const groupMemberIdSets = this.revisionGroupSources(revisionId).map((groupId) =>
      this.groupMembersOnDate(groupId, date),
    );
    return resolveParticipants({ directMemberIds, groupMemberIdSets });
  }

  private groupActivelyReferenced(groupId: string, today: HouseholdDate): boolean {
    return this.listGroupRoutineReferences(groupId, today).length > 0;
  }

  private listGroupRoutineReferences(
    groupId: string,
    today: HouseholdDate,
  ): GroupRoutineReference[] {
    const revisions = this.db
      .prepare(
        `SELECT rr.id, rr.definition_id, rr.effective_date, rr.title, rr.daypart,
                d.archived_at, d.archive_cutoff_date
         FROM revision_group_sources rgs
         JOIN routine_revisions rr ON rr.id = rgs.revision_id
         JOIN routine_definitions d ON d.id = rr.definition_id
         WHERE rgs.group_id = ?
         ORDER BY rr.definition_id, rr.effective_date`,
      )
      .all(groupId) as Array<{
      id: string;
      definition_id: string;
      effective_date: string;
      title: string;
      daypart: Daypart;
      archived_at: string | null;
      archive_cutoff_date: string | null;
    }>;

    const byDefinition = new Map<string, GroupRoutineReference>();
    for (const revision of revisions) {
      if (!isBeforeArchiveCutoff(today, revision.archive_cutoff_date)) {
        continue;
      }
      const next = this.db
        .prepare(
          `SELECT effective_date FROM routine_revisions
           WHERE definition_id = ? AND effective_date > ?
           ORDER BY effective_date ASC LIMIT 1`,
        )
        .get(revision.definition_id, revision.effective_date) as
        | { effective_date: string }
        | undefined;
      if (
        !revisionIntervalActiveFrom(
          revision.effective_date,
          next?.effective_date ?? null,
          today,
        )
      ) {
        continue;
      }
      byDefinition.set(revision.definition_id, {
        definitionId: revision.definition_id,
        title: revision.title,
        daypart: revision.daypart,
        archived: revision.archived_at !== null,
        effectFromDate: revision.effective_date,
      });
    }

    const planRows = this.db
      .prepare(
        `SELECT rr.id, rr.definition_id, rr.effective_date, rr.title, rr.daypart,
                d.archived_at, d.archive_cutoff_date,
                rrp.assignment_json, rrp.scheduled_additions_json
         FROM revision_responsibility_plans rrp
         JOIN routine_revisions rr ON rr.id = rrp.revision_id
         JOIN routine_definitions d ON d.id = rr.definition_id
         WHERE d.kind = 'responsibility' AND d.deleted_at IS NULL
         ORDER BY rr.definition_id, rr.effective_date`,
      )
      .all() as Array<{
      id: string;
      definition_id: string;
      effective_date: string;
      title: string;
      daypart: Daypart;
      archived_at: string | null;
      archive_cutoff_date: string | null;
      assignment_json: string;
      scheduled_additions_json: string;
    }>;

    for (const revision of planRows) {
      const plan: StoredResponsibilityPlan = {
        assignment: JSON.parse(revision.assignment_json) as AssignmentSpec,
        scheduledAdditions: JSON.parse(
          revision.scheduled_additions_json,
        ) as ScheduledAdditionSpec[],
      };
      if (!assignmentUsesGroup(plan).includes(groupId)) continue;
      if (!isBeforeArchiveCutoff(today, revision.archive_cutoff_date)) {
        continue;
      }
      const next = this.db
        .prepare(
          `SELECT effective_date FROM routine_revisions
           WHERE definition_id = ? AND effective_date > ?
           ORDER BY effective_date ASC LIMIT 1`,
        )
        .get(revision.definition_id, revision.effective_date) as
        | { effective_date: string }
        | undefined;
      if (
        !revisionIntervalActiveFrom(
          revision.effective_date,
          next?.effective_date ?? null,
          today,
        )
      ) {
        continue;
      }
      byDefinition.set(revision.definition_id, {
        definitionId: revision.definition_id,
        title: revision.title,
        daypart: revision.daypart,
        archived: revision.archived_at !== null,
        effectFromDate: revision.effective_date,
      });
    }

    return [...byDefinition.values()].sort((a, b) =>
      a.definitionId.localeCompare(b.definitionId),
    );
  }

  private normalizeRoutineAudience(
    ctx: AuthContext,
    input: RoutineInput,
    effectiveDate: HouseholdDate,
  ): RoutineInput {
    const assigneeGroupIds = [...new Set(input.assigneeGroupIds)].sort((a, b) =>
      a.localeCompare(b),
    );
    const groupMemberIdSets = assigneeGroupIds.map((groupId) =>
      this.groupMembersOnDate(groupId, effectiveDate),
    );
    const assigneeMemberIds = normalizeDirectSources({
      directMemberIds: input.assigneeMemberIds,
      groupMemberIdSets,
    });
    return {
      ...input,
      assigneeMemberIds,
      assigneeGroupIds,
    };
  }

  private nextFreeRevisionDate(
    definitionId: string,
    minimum: HouseholdDate,
  ): HouseholdDate {
    let effectiveDate = minimum;
    while (
      this.db
        .prepare(
          `SELECT 1 FROM routine_revisions
           WHERE definition_id = ? AND effective_date = ?`,
        )
        .get(definitionId, effectiveDate)
    ) {
      effectiveDate = addHouseholdDays(effectiveDate, 1);
    }
    return effectiveDate;
  }

  private loadRoutineDefinition(
    householdId: string,
    definitionId: string,
  ): RoutineDefinitionPublic | null {
    const definition = this.db
      .prepare(
        `SELECT id, version, kind, archived_at, archive_cutoff_date,
                ended_at, end_mode, deleted_at
         FROM routine_definitions
         WHERE id = ? AND household_id = ?`,
      )
      .get(definitionId, householdId) as
      | {
          id: string;
          version: number;
          kind: string | null;
          archived_at: string | null;
          archive_cutoff_date: string | null;
          ended_at: string | null;
          end_mode: "legacy_archive" | "immediate" | null;
          deleted_at: string | null;
        }
      | undefined;
    if (!definition) return null;
    const today = this.householdDateFor(householdId);
    const revisions = this.db
      .prepare(
        `SELECT id, effective_date, title, weekdays_json, daypart, created_at
         FROM routine_revisions WHERE definition_id = ?
         ORDER BY effective_date, created_at`,
      )
      .all(definition.id) as Array<{
      id: string;
      effective_date: string;
      title: string;
      weekdays_json: string;
      daypart: Daypart;
      created_at: string;
    }>;
    const definitionKind =
      definition.kind === "responsibility" ? "responsibility" : "routine";
    const revisionPublics: RoutineRevisionPublic[] = revisions.map((revision) =>
      this.toRevisionPublic(revision, today, definitionKind),
    );
    const revisionById = new Map(revisionPublics.map((r) => [r.id, r]));
    const scheduleRows = loadScheduleEntryRows(this.db, definition.id);
    const scheduleEntries: ScheduleEntryPublic[] = scheduleRows
      .filter((row) => row.canceled_at == null)
      .map((row) => {
        const revision =
          revisionById.get(row.revision_id) ??
          this.loadRevisionPublicById(row.revision_id, today);
        return {
          id: row.id,
          startDate: row.start_date,
          revisionId: row.revision_id,
          canceledAt: row.canceled_at,
          revision,
        };
      });
    return {
      id: definition.id,
      version: definition.version,
      kind: definition.kind === "responsibility" ? "responsibility" : "routine",
      archived: definition.archived_at !== null || definition.ended_at !== null,
      archiveCutoffDate: definition.archive_cutoff_date,
      archivedAt: definition.archived_at,
      ended: definition.ended_at !== null,
      endMode: definition.end_mode,
      endedAt: definition.ended_at,
      deletedAt: definition.deleted_at,
      scheduleEntries,
      revisions: revisionPublics,
    };
  }

  private toRevisionPublic(
    revision: {
      id: string;
      effective_date: string;
      title: string;
      weekdays_json: string;
      daypart: Daypart;
      created_at: string;
    },
    today: string,
    definitionKind: WorkKind = "routine",
  ): RoutineRevisionPublic {
    const assigneeMemberIds = this.revisionAssignees(revision.id);
    const assigneeGroupIds = this.revisionGroupSources(revision.id);
    const todaySets = assigneeGroupIds.map((groupId) =>
      this.groupMembersOnDate(groupId, today),
    );
    const tomorrow = addHouseholdDays(today, 1);
    const tomorrowSets = assigneeGroupIds.map((groupId) =>
      this.groupMembersOnDate(groupId, tomorrow),
    );
    const resolvedMemberIds = resolveParticipants({
      directMemberIds: assigneeMemberIds,
      groupMemberIdSets: todaySets,
    });
    const upcomingResolvedMemberIds = resolveParticipants({
      directMemberIds: assigneeMemberIds,
      groupMemberIdSets: tomorrowSets,
    });
    const upcomingDiffers = !sameMembershipSet(
      resolvedMemberIds,
      upcomingResolvedMemberIds,
    );
    const base: RoutineRevisionPublic = {
      id: revision.id,
      effectiveDate: revision.effective_date,
      title: revision.title,
      daypart: revision.daypart,
      weekdays: JSON.parse(revision.weekdays_json) as number[],
      createdAt: revision.created_at,
      steps: this.revisionSteps(revision.id),
      assigneeMemberIds,
      assigneeGroupIds,
      resolvedMemberIds,
      upcomingResolvedMemberIds: upcomingDiffers
        ? upcomingResolvedMemberIds
        : undefined,
      upcomingParticipationFromDate: upcomingDiffers ? tomorrow : null,
    };
    if (definitionKind === "responsibility") {
      const plan = loadResponsibilityPlan(this.db, revision.id);
      if (plan) {
        return {
          ...base,
          assignment: plan.assignment,
          scheduledAdditions: plan.scheduledAdditions,
        };
      }
    }
    return base;
  }

  private loadRevisionPublicById(
    revisionId: string,
    today: string,
    definitionKind: WorkKind = "routine",
  ): RoutineRevisionPublic {
    const revision = this.db
      .prepare(
        `SELECT id, effective_date, title, weekdays_json, daypart, created_at
         FROM routine_revisions WHERE id = ?`,
      )
      .get(revisionId) as
      | {
          id: string;
          effective_date: string;
          title: string;
          weekdays_json: string;
          daypart: Daypart;
          created_at: string;
        }
      | undefined;
    if (!revision) fail("NOT_FOUND", "Revision not found");
    return this.toRevisionPublic(revision, today, definitionKind);
  }

  /** Prefer schedule-entry selection; fall back to legacy revision effective_date. */
  private selectRevisionContentForDate(
    routine: RoutineDefinitionPublic,
    householdDate: string,
  ): RoutineRevisionPublic | null {
    if (routine.scheduleEntries.length > 0) {
      const entry = selectScheduleEntryForDate(
        routine.scheduleEntries,
        householdDate,
      );
      if (!entry) return null;
      return (
        routine.revisions.find((r) => r.id === entry.revisionId) ??
        entry.revision ??
        null
      );
    }
    return selectRevisionForDate(routine.revisions, householdDate);
  }

  private findRoutineMutationReceipt(mutationId: string): {
    household_id: string;
    definition_id: string | null;
    kind: string;
    payload_digest: string;
    response_json: string;
  } | null {
    const row = this.db
      .prepare(
        `SELECT household_id, definition_id, kind, payload_digest, response_json
         FROM routine_mutation_receipts WHERE mutation_id = ?`,
      )
      .get(mutationId) as
      | {
          household_id: string;
          definition_id: string | null;
          kind: string;
          payload_digest: string;
          response_json: string;
        }
      | undefined;
    return row ?? null;
  }

  private readRoutineMutationReceipt(
    mutationId: string,
    householdId: string,
    definitionId: string | null,
    kind: RoutineMutationKind,
    digest: string,
  ): RoutineDefinitionPublic | null {
    const row = this.findRoutineMutationReceipt(mutationId);
    if (!row) return null;
    if (
      row.household_id !== householdId ||
      row.kind !== kind ||
      row.payload_digest !== digest ||
      (definitionId !== null &&
        row.definition_id !== null &&
        row.definition_id !== definitionId)
    ) {
      fail("CONFLICT", "Routine couldn't be updated");
    }
    return JSON.parse(row.response_json) as RoutineDefinitionPublic;
  }

  private writeRoutineMutationReceipt(
    mutationId: string,
    householdId: string,
    definitionId: string | null,
    kind: RoutineMutationKind,
    digest: string,
    response: unknown,
  ): void {
    try {
      this.db
        .prepare(
          `INSERT INTO routine_mutation_receipts
           (mutation_id, household_id, definition_id, kind, payload_digest, response_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          mutationId,
          householdId,
          definitionId,
          kind,
          digest,
          JSON.stringify(response),
          nowUtcIso(),
        );
    } catch (error) {
      if (
        error instanceof Error &&
        /CHECK constraint failed/i.test(error.message)
      ) {
        fail(
          "CONFLICT",
          "Routine couldn't be updated; apply pending database migrations and retry",
        );
      }
      throw error;
    }
  }

  private getDefinitionKind(
    householdId: string,
    definitionId: string,
  ): WorkKind | null {
    const row = this.db
      .prepare(
        `SELECT kind FROM routine_definitions
         WHERE id = ? AND household_id = ? AND deleted_at IS NULL`,
      )
      .get(definitionId, householdId) as { kind: string } | undefined;
    if (!row) return null;
    return row.kind === "responsibility" ? "responsibility" : "routine";
  }

  private assertDefinitionKind(
    householdId: string,
    definitionId: string,
    expectedKind: WorkKind,
    notFoundMessage: string,
  ): void {
    const kind = this.getDefinitionKind(householdId, definitionId);
    if (kind !== expectedKind) {
      fail("NOT_FOUND", notFoundMessage);
    }
  }

  private validateRoutineInput(ctx: AuthContext, input: RoutineInput): void {
    const check = validateRoutineSteps(input.steps);
    if (!check.ok) fail("VALIDATION", check.message);
    if (!input.title.trim()) fail("VALIDATION", "Routine title is required");
    if (!isDaypart(input.daypart)) fail("VALIDATION", "Invalid daypart");
    if (
      input.weekdays.length === 0 ||
      input.weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
    ) {
      fail("VALIDATION", "At least one valid weekday is required");
    }
    if (new Set(input.weekdays).size !== input.weekdays.length) {
      fail("VALIDATION", "Weekdays must be unique");
    }
    const assigneeMemberIds = input.assigneeMemberIds ?? [];
    const assigneeGroupIds = input.assigneeGroupIds ?? [];
    if (assigneeMemberIds.length === 0 && assigneeGroupIds.length === 0) {
      fail("VALIDATION", "At least one person or group is required");
    }
    const uniqueAssignees = new Set(assigneeMemberIds);
    if (uniqueAssignees.size !== assigneeMemberIds.length) {
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
    const uniqueGroups = new Set(assigneeGroupIds);
    if (uniqueGroups.size !== assigneeGroupIds.length) {
      fail("VALIDATION", "Groups must be unique");
    }
    for (const groupId of uniqueGroups) {
      if (
        !this.db
          .prepare(
            `SELECT 1 FROM household_groups
             WHERE id = ? AND household_id = ? AND deleted_at IS NULL`,
          )
          .get(groupId, ctx.householdId)
      ) {
        fail("VALIDATION", "A selected group was not found");
      }
    }
    const logicalIds = input.steps
      .map((step) => step.logicalItemId)
      .filter((id): id is string => !!id);
    if (new Set(logicalIds).size !== logicalIds.length) {
      fail("VALIDATION", "Shared logical item IDs must be unique");
    }
  }

  private validateResponsibilityInput(
    ctx: AuthContext,
    input: ResponsibilityInput,
    options?: { draft?: boolean },
  ): void {
    const check = validateRoutineSteps(input.steps);
    if (!check.ok) fail("VALIDATION", check.message);
    if (!input.title.trim()) fail("VALIDATION", "Responsibility title is required");
    if (!isDaypart(input.daypart)) fail("VALIDATION", "Invalid daypart");
    if (
      input.weekdays.length === 0 ||
      input.weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
    ) {
      fail("VALIDATION", "At least one valid weekday is required");
    }
    if (new Set(input.weekdays).size !== input.weekdays.length) {
      fail("VALIDATION", "Weekdays must be unique");
    }
    if (!input.assignment && !input.accountableMemberId) {
      fail("VALIDATION", "Either assignment or accountableMemberId is required");
    }
    for (const step of input.steps) {
      const rule = step.applicability;
      if (rule && rule.kind !== "every_time") {
        fail(
          "VALIDATION",
          "Responsibility steps must use every-time applicability",
        );
      }
    }
    const logicalIds = input.steps
      .map((step) => step.logicalItemId)
      .filter((id): id is string => !!id);
    if (new Set(logicalIds).size !== logicalIds.length) {
      fail("VALIDATION", "Shared logical item IDs must be unique");
    }
    const effectiveDate = options?.draft
      ? this.householdDateNow(ctx)
      : (input as ResponsibilityRevisionInput).effectiveDate ??
        this.householdDateNow(ctx);
    try {
      this.buildResponsibilityPlan(ctx, input, effectiveDate);
    } catch (error) {
      if (error instanceof Error && (error as { code?: string }).code === "VALIDATION") {
        fail("VALIDATION", error.message);
      }
      throw error;
    }
  }

  private buildResponsibilityPlan(
    ctx: AuthContext,
    input: ResponsibilityInput,
    effectiveDate: HouseholdDate,
    previousRevisionId?: string | null,
  ): StoredResponsibilityPlan {
    const previous = previousRevisionId
      ? loadResponsibilityPlan(this.db, previousRevisionId)
      : null;
    const assignment = normalizeAssignmentInput(input, effectiveDate);
    const scheduledAdditions = normalizeScheduledAdditions(
      input.scheduledAdditions,
      previous?.scheduledAdditions ?? [],
    );
    const plan = { assignment, scheduledAdditions };
    validateResponsibilityPlan(
      {
        householdId: ctx.householdId,
        parentWeekdays: input.weekdays,
        effectiveDate,
      },
      plan,
      (memberId) => this.membershipExists(ctx.householdId, memberId),
      (groupId) => this.groupExists(ctx.householdId, groupId),
    );
    return plan;
  }

  private membershipExists(householdId: string, memberId: string): boolean {
    return !!this.db
      .prepare(
        "SELECT 1 FROM household_memberships WHERE id = ? AND household_id = ?",
      )
      .get(memberId, householdId);
  }

  private groupExists(householdId: string, groupId: string): boolean {
    return !!this.db
      .prepare(
        `SELECT 1 FROM household_groups
         WHERE id = ? AND household_id = ? AND deleted_at IS NULL`,
      )
      .get(groupId, householdId);
  }

  private getCompositionDeps(householdId: string): CompositionDeps {
    return {
      groupMembersOnDate: (groupId, date) => this.groupMembersOnDate(groupId, date),
      memberFirstAdmission: (groupId, memberId) =>
        this.memberFirstAdmission(groupId, memberId),
      isMemberEligible: (memberId, date) =>
        this.isMemberEligible(householdId, memberId, date),
    };
  }

  private memberFirstAdmission(
    groupId: string,
    memberId: string,
  ): HouseholdDate | null {
    const row = this.db
      .prepare(
        `SELECT MIN(gmv.effective_date) AS first_date
         FROM group_membership_version_members gmvm
         JOIN group_membership_versions gmv ON gmv.id = gmvm.version_id
         WHERE gmv.group_id = ? AND gmvm.membership_id = ?`,
      )
      .get(groupId, memberId) as { first_date: string | null } | undefined;
    return (row?.first_date as HouseholdDate | null) ?? null;
  }

  private isMemberEligible(
    householdId: string,
    memberId: string,
    _date: HouseholdDate,
  ): boolean {
    return this.membershipExists(householdId, memberId);
  }

  private resolveCompositionForRevision(
    revisionId: string,
    householdDate: HouseholdDate,
    householdId: string,
  ) {
    const plan = loadResponsibilityPlan(this.db, revisionId);
    if (!plan) return null;
    const revisionRow = this.db
      .prepare(`SELECT weekdays_json FROM routine_revisions WHERE id = ?`)
      .get(revisionId) as { weekdays_json: string } | undefined;
    if (!revisionRow) return null;
    const parentWeekdays = JSON.parse(revisionRow.weekdays_json) as number[];
    const baseSteps = this.revisionSteps(revisionId).map((step) => ({
      logicalItemId: step.logicalItemId,
      text: step.text,
      obligation: step.obligation,
    }));
    return resolveResponsibilityComposition(
      {
        householdDate,
        revisionId,
        parentWeekdays,
        baseSteps,
        plan,
      },
      this.getCompositionDeps(householdId),
    );
  }

  private findResponsibilitiesReferencingGroup(
    householdId: string,
    groupId: string,
  ): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT rr.definition_id, rrp.assignment_json, rrp.scheduled_additions_json
         FROM revision_responsibility_plans rrp
         JOIN routine_revisions rr ON rr.id = rrp.revision_id
         JOIN routine_definitions d ON d.id = rr.definition_id
         WHERE d.household_id = ? AND d.kind = 'responsibility' AND d.deleted_at IS NULL`,
      )
      .all(householdId) as Array<{
      definition_id: string;
      assignment_json: string;
      scheduled_additions_json: string;
    }>;
    const definitionIds = new Set<string>();
    for (const row of rows) {
      const plan: StoredResponsibilityPlan = {
        assignment: JSON.parse(row.assignment_json) as AssignmentSpec,
        scheduledAdditions: JSON.parse(
          row.scheduled_additions_json,
        ) as ScheduledAdditionSpec[],
      };
      if (assignmentUsesGroup(plan).includes(groupId)) {
        definitionIds.add(row.definition_id);
      }
    }
    return [...definitionIds];
  }

  private resolveRevisionLogicalIds(
    steps: RoutineStepInput[],
    previousSteps: Array<{
      logicalItemId: string;
      text: string;
      obligation: ObligationMeaning;
    }>,
  ): string[] {
    const usedLogicalIds = new Set(
      steps.map((step) => step.logicalItemId).filter((id): id is string => !!id),
    );
    return steps.map((step, position) => {
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
  }

  private writeRevisionChildren(
    revisionId: string,
    input: RoutineInput,
    logicalIds: string[],
  ): void {
    const insertStep = this.db.prepare(
      `INSERT INTO revision_steps
       (id, revision_id, position, text, obligation, logical_item_id, applicability_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    input.steps.forEach((step, position) => {
      insertStep.run(
        randomUUID(),
        revisionId,
        position,
        step.text.trim(),
        step.obligation,
        logicalIds[position],
        serializeApplicability(step.applicability ?? DEFAULT_APPLICABILITY),
      );
    });
    const insertAssignee = this.db.prepare(
      "INSERT INTO revision_assignees (revision_id, member_id) VALUES (?, ?)",
    );
    for (const memberId of input.assigneeMemberIds) {
      insertAssignee.run(revisionId, memberId);
    }
    const insertGroup = this.db.prepare(
      "INSERT INTO revision_group_sources (revision_id, group_id) VALUES (?, ?)",
    );
    for (const groupId of input.assigneeGroupIds) {
      insertGroup.run(revisionId, groupId);
    }
  }

  /** Insert immutable revision content (never mutate existing revision rows). */
  private insertImmutableRevision(
    definitionId: string,
    effectiveDate: string,
    input: RoutineInput,
    previousRevisionId?: string | null,
  ): string {
    const previousSteps = previousRevisionId
      ? this.revisionSteps(previousRevisionId)
      : (() => {
          const previousRevision = this.db
            .prepare(
              `SELECT id FROM routine_revisions
               WHERE definition_id = ?
               ORDER BY effective_date DESC, created_at DESC LIMIT 1`,
            )
            .get(definitionId) as { id: string } | undefined;
          return previousRevision ? this.revisionSteps(previousRevision.id) : [];
        })();
    const logicalIds = this.resolveRevisionLogicalIds(input.steps, previousSteps);
    const revisionId = randomUUID();
    this.db
      .prepare(
        `INSERT INTO routine_revisions
         (id, definition_id, effective_date, title, weekdays_json, daypart, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        revisionId,
        definitionId,
        effectiveDate,
        input.title.trim(),
        JSON.stringify(input.weekdays),
        input.daypart,
        nowUtcIso(),
      );
    this.writeRevisionChildren(revisionId, input, logicalIds);
    return revisionId;
  }

  private insertScheduleEntry(
    id: string,
    definitionId: string,
    startDate: string,
    revisionId: string,
    createdAt = nowUtcIso(),
  ): void {
    this.db
      .prepare(
        `INSERT INTO routine_schedule_entries
         (id, definition_id, start_date, revision_id, canceled_at, created_at)
         VALUES (?, ?, ?, ?, NULL, ?)`,
      )
      .run(id, definitionId, startDate, revisionId, createdAt);
  }

  private requireEditableDefinition(
    householdId: string,
    definitionId: string,
    expectedVersion: number,
  ): { id: string; version: number } {
    const definition = this.db
      .prepare(
        `SELECT id, version, archived_at, ended_at FROM routine_definitions
         WHERE id = ? AND household_id = ? AND deleted_at IS NULL`,
      )
      .get(definitionId, householdId) as
      | {
          id: string;
          version: number;
          archived_at: string | null;
          ended_at: string | null;
        }
      | undefined;
    if (!definition) fail("NOT_FOUND", "Routine not found");
    if (definition.archived_at || definition.ended_at) {
      fail("CONFLICT", "Archived routines cannot be revised");
    }
    if (expectedVersion !== definition.version) {
      fail("CONFLICT", "Routine was updated elsewhere; re-read and try again");
    }
    return definition;
  }

  private applyCurrentRevision(
    householdId: string,
    definitionId: string,
    today: string,
    fromDate: string,
    input: RoutineInput,
  ): PlanRefineOutcome {
    const rows = loadScheduleEntryRows(this.db, definitionId);
    let current = selectActiveEntryRowForDate(rows, today);
    if (!current) {
      // Seed a current entry if migration/create missed one.
      const revisionId = this.insertImmutableRevision(definitionId, fromDate, input);
      const entryId = randomUUID();
      this.insertScheduleEntry(entryId, definitionId, fromDate, revisionId);
      current = {
        id: entryId,
        definition_id: definitionId,
        start_date: fromDate,
        revision_id: revisionId,
        canceled_at: null,
        created_at: nowUtcIso(),
      };
    } else {
      const revisionId = this.insertImmutableRevision(
        definitionId,
        fromDate,
        input,
        current.revision_id,
      );
      this.db
        .prepare(
          `UPDATE routine_schedule_entries SET revision_id = ? WHERE id = ?`,
        )
        .run(revisionId, current.id);
    }
    const entries = loadScheduleEntryRows(this.db, definitionId).map(
      toScheduleEntryLike,
    );
    return this.reconcileGovernedRange(householdId, definitionId, fromDate, entries);
  }

  private applyScheduleRevision(
    householdId: string,
    definitionId: string,
    startDate: string,
    input: RoutineInput,
    scheduleEntryId?: string,
  ): PlanRefineOutcome {
    const rows = loadScheduleEntryRows(this.db, definitionId);
    if (scheduleEntryId) {
      const existing = rows.find((r) => r.id === scheduleEntryId);
      if (!existing || existing.canceled_at) {
        fail("NOT_FOUND", "Schedule entry not found");
      }
      const revisionId = this.insertImmutableRevision(
        definitionId,
        existing.start_date,
        input,
        existing.revision_id,
      );
      this.db
        .prepare(
          `UPDATE routine_schedule_entries SET revision_id = ? WHERE id = ?`,
        )
        .run(revisionId, existing.id);
      const entries = loadScheduleEntryRows(this.db, definitionId).map(
        toScheduleEntryLike,
      );
      return this.reconcileGovernedRange(
        householdId,
        definitionId,
        existing.start_date,
        entries,
      );
    }

    const conflict = rows.find(
      (r) => r.canceled_at == null && r.start_date === startDate,
    );
    if (conflict) {
      fail("CONFLICT", "A schedule entry already exists for that date", {
        conflictingScheduleEntryId: conflict.id,
        occupiedDate: startDate,
      });
    }

    const revisionId = this.insertImmutableRevision(definitionId, startDate, input);
    this.insertScheduleEntry(randomUUID(), definitionId, startDate, revisionId);
    const entries = loadScheduleEntryRows(this.db, definitionId).map(
      toScheduleEntryLike,
    );
    return this.reconcileGovernedRange(
      householdId,
      definitionId,
      startDate,
      entries,
    );
  }

  private reconcileGovernedRange(
    householdId: string,
    definitionId: string,
    fromDate: string,
    entries: ReturnType<typeof toScheduleEntryLike>[],
  ): PlanRefineOutcome {
    const { dates, untilDateExclusive } = reconcileDatesForRange(
      this.db,
      definitionId,
      fromDate,
      entries,
    );
    let outcome = emptyRefineOutcome(fromDate, untilDateExclusive);
    for (const date of dates) {
      const day = this.reconcileUnstartedOccurrencesForDate(
        householdId,
        definitionId,
        date,
      );
      outcome = mergeRefineOutcomes(outcome, {
        updated: day.updated,
        protected: day.protected,
        excluded: day.excluded,
      });
    }
    return outcome;
  }

  private reconcileOccurrenceRange(
    householdId: string,
    definitionId: string,
    fromDate: string,
    untilDateExclusive: string | null,
    options?: { cancelAllUnstarted?: boolean },
  ): PlanRefineOutcome {
    const known = this.db
      .prepare(
        `SELECT DISTINCT household_date AS d FROM occurrences
         WHERE definition_id = ? AND household_date >= ?
         ${untilDateExclusive ? "AND household_date < ?" : ""}
         ORDER BY household_date`,
      )
      .all(
        ...(untilDateExclusive
          ? [definitionId, fromDate, untilDateExclusive]
          : [definitionId, fromDate]),
      ) as Array<{ d: string }>;
    const dates = [
      ...new Set([fromDate, ...known.map((r) => r.d)]),
    ].sort(compareHouseholdDates);
    let outcome = emptyRefineOutcome(fromDate, untilDateExclusive);
    for (const date of dates) {
      if (
        untilDateExclusive &&
        compareHouseholdDates(date, untilDateExclusive) >= 0
      ) {
        continue;
      }
      const day = options?.cancelAllUnstarted
        ? this.cancelUnstartedOccurrencesForDate(householdId, definitionId, date)
        : this.reconcileUnstartedOccurrencesForDate(
            householdId,
            definitionId,
            date,
          );
      outcome = mergeRefineOutcomes(outcome, {
        updated: day.updated,
        protected: day.protected,
        excluded: day.excluded,
      });
    }
    return outcome;
  }

  private cancelUnstartedOccurrencesForDate(
    householdId: string,
    definitionId: string,
    householdDate: HouseholdDate,
  ): { updated: string[]; protected: string[]; excluded: string[] } {
    const updated: string[] = [];
    const protectedIds: string[] = [];
    const excluded: string[] = [];
    const canceledAt = nowUtcIso();
    const rows = this.db
      .prepare(
        `SELECT id, accountable_member_id, started_at, canceled_at FROM occurrences
         WHERE household_id = ? AND definition_id = ? AND household_date = ?`,
      )
      .all(householdId, definitionId, householdDate) as Array<{
      id: string;
      accountable_member_id: string;
      started_at: string | null;
      canceled_at: string | null;
    }>;
    for (const row of rows) {
      if (isOccurrenceStarted(row.started_at)) {
        protectedIds.push(row.accountable_member_id);
        continue;
      }
      if (!row.canceled_at) {
        this.db
          .prepare(`UPDATE occurrences SET canceled_at = ?, version = version + 1 WHERE id = ?`)
          .run(canceledAt, row.id);
        excluded.push(row.accountable_member_id);
      }
    }
    return { updated, protected: protectedIds, excluded };
  }

  private insertRevision(
    revisionId: string,
    definitionId: string,
    effectiveDate: string,
    input: RoutineInput,
    responsibilityPlan?: StoredResponsibilityPlan,
  ): void {
    const previousRevision = this.db
      .prepare(
        `SELECT id FROM routine_revisions
         WHERE definition_id = ? AND effective_date < ?
         ORDER BY effective_date DESC, created_at DESC LIMIT 1`,
      )
      .get(definitionId, effectiveDate) as { id: string } | undefined;
    const previousSteps = previousRevision
      ? this.revisionSteps(previousRevision.id)
      : [];
    const logicalIds = this.resolveRevisionLogicalIds(input.steps, previousSteps);
    this.db
      .prepare(
        `INSERT INTO routine_revisions
         (id, definition_id, effective_date, title, weekdays_json, daypart, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        revisionId,
        definitionId,
        effectiveDate,
        input.title.trim(),
        JSON.stringify(input.weekdays),
        input.daypart,
        nowUtcIso(),
      );
    this.writeRevisionChildren(revisionId, input, logicalIds);
    if (responsibilityPlan) {
      insertResponsibilityPlan(this.db, revisionId, responsibilityPlan);
    }
  }

  /**
   * Reconcile unstarted occurrences for a definition×date to the revision
   * active on that date via schedule entries. Started occurrences stay frozen.
   * Responsibilities keep one row per date and update accountable_member_id in place.
   */
  private reconcileUnstartedOccurrencesForDate(
    householdId: string,
    definitionId: string,
    householdDate: HouseholdDate,
  ): { updated: string[]; protected: string[]; excluded: string[] } {
    const updated: string[] = [];
    const protectedIds: string[] = [];
    const excluded: string[] = [];
    const routine = this.loadRoutineDefinition(householdId, definitionId);
    if (!routine) return { updated, protected: protectedIds, excluded };

    const kind = routine.kind ?? "routine";
    const revision = this.selectRevisionContentForDate(routine, householdDate);
    if (!revision) return { updated, protected: protectedIds, excluded };

    const revisionView = {
      id: revision.id,
      title: revision.title,
      daypart: revision.daypart,
      steps: revision.steps,
    };
    const applicable = isDateApplicable(householdDate, revision.weekdays);
    const canceledAt = nowUtcIso();

    if (kind === "responsibility") {
      const composed = applicable
        ? this.resolveCompositionForRevision(
            revision.id,
            householdDate,
            householdId,
          )
        : null;
      const planOwner = composed?.accountableMemberId ?? null;

      const rows = this.db
        .prepare(
          `SELECT id, accountable_member_id, started_at, canceled_at FROM occurrences
           WHERE household_id = ? AND definition_id = ? AND household_date = ?`,
        )
        .all(householdId, definitionId, householdDate) as Array<{
        id: string;
        accountable_member_id: string | null;
        started_at: string | null;
        canceled_at: string | null;
      }>;

      for (const row of rows) {
        if (isOccurrenceStarted(row.started_at)) {
          if (row.accountable_member_id) {
            protectedIds.push(row.accountable_member_id);
          }
          continue;
        }
        if (!composed?.applicable) {
          if (!row.canceled_at) {
            this.db
              .prepare(
                `UPDATE occurrences SET canceled_at = ?, version = version + 1 WHERE id = ?`,
              )
              .run(canceledAt, row.id);
            excluded.push(row.accountable_member_id ?? "unassigned");
          }
          continue;
        }
        if (row.canceled_at) {
          this.db
            .prepare(`UPDATE occurrences SET canceled_at = NULL WHERE id = ?`)
            .run(row.id);
        }
        this.rewriteUnstartedOccurrence(
          row.id,
          revisionView,
          planOwner,
          definitionId,
          householdDate,
          "responsibility",
          composed,
        );
        updated.push(planOwner ?? "unassigned");
      }

      if (composed?.applicable && rows.length === 0) {
        this.ensureResponsibilityOccurrence(
          householdId,
          definitionId,
          revisionView,
          householdDate,
          composed,
        );
        updated.push(planOwner ?? "unassigned");
      }

      return { updated, protected: protectedIds, excluded };
    }

    const participants = new Set(
      resolveAccountableMembers("routine", {
        directMemberIds: revision.assigneeMemberIds,
        groupMemberIdSets: revision.assigneeGroupIds.map((groupId) =>
          this.groupMembersOnDate(groupId, householdDate),
        ),
      }),
    );

    const rows = this.db
      .prepare(
        `SELECT id, accountable_member_id, started_at, canceled_at FROM occurrences
         WHERE household_id = ? AND definition_id = ? AND household_date = ?`,
      )
      .all(householdId, definitionId, householdDate) as Array<{
      id: string;
      accountable_member_id: string;
      started_at: string | null;
      canceled_at: string | null;
    }>;

    for (const row of rows) {
      if (isOccurrenceStarted(row.started_at)) {
        protectedIds.push(row.accountable_member_id);
        continue;
      }
      if (!participants.has(row.accountable_member_id)) {
        if (!row.canceled_at) {
          this.db
            .prepare(
              `UPDATE occurrences SET canceled_at = ?, version = version + 1 WHERE id = ?`,
            )
            .run(canceledAt, row.id);
          excluded.push(row.accountable_member_id);
        }
        continue;
      }
      if (row.canceled_at) {
        this.db
          .prepare(`UPDATE occurrences SET canceled_at = NULL WHERE id = ?`)
          .run(row.id);
      }
      this.rewriteUnstartedOccurrence(
        row.id,
        revisionView,
        row.accountable_member_id,
        definitionId,
        householdDate,
      );
      updated.push(row.accountable_member_id);
    }

    // Include missing eligible participants (when date is applicable).
    if (applicable) {
      for (const membershipId of participants) {
        const exists = rows.some((r) => r.accountable_member_id === membershipId);
        if (!exists) {
          this.ensureOccurrence(
            householdId,
            definitionId,
            revisionView,
            householdDate,
            membershipId,
            "routine",
          );
          updated.push(membershipId);
        }
      }
    }

    return { updated, protected: protectedIds, excluded };
  }

  private insertOccurrenceSteps(
    occurrenceId: string,
    revision: {
      steps: Array<{
        logicalItemId: string;
        text: string;
        obligation: ObligationMeaning;
        applicability?: ApplicabilityRule;
      }>;
    },
    membershipId: string,
    definitionId: string,
    householdDate: string,
    kind: WorkKind = "routine",
  ): void {
    const personal =
      kind === "routine"
        ? this.getPersonalLayer(membershipId, definitionId, householdDate)
        : null;
    const composed = composeMorningRoutine(
      revision.steps.map((step) => ({
        logicalItemId: step.logicalItemId,
        text: step.text,
        obligation: step.obligation,
        applicability: step.applicability ?? DEFAULT_APPLICABILITY,
      })),
      personal?.additions.map((addition) => ({
        id: addition.id,
        text: addition.text,
        obligation: addition.obligation,
        applicability:
          (addition as { applicability?: ApplicabilityRule }).applicability ??
          DEFAULT_APPLICABILITY,
        anchorLogicalItemId: addition.anchorLogicalItemId,
        place: addition.place,
      })) ?? [],
    );

    const householdId = (
      this.db
        .prepare(`SELECT household_id FROM occurrences WHERE id = ?`)
        .get(occurrenceId) as { household_id: string } | undefined
    )?.household_id;
    const edition = householdId
      ? this.loadCalendarEditionForDate(householdId, householdDate)
      : { editionId: null as string | null, provenance: "legacy" as const, years: [] };
    const iso = isoWeekdayForHouseholdDate(householdDate);
    const nextDate = addHouseholdDays(householdDate, 1);
    const nextIso = isoWeekdayForHouseholdDate(nextDate);
    const calendarShape =
      edition.years.length > 0
        ? {
            years: edition.years.map((y) => ({
              startDate: y.startDate,
              endDate: y.endDate,
              usualWeekdays: y.usualWeekdays,
              exceptions: y.exceptions,
            })),
          }
        : null;
    const schoolToday = isSchoolDayForDate(householdDate, calendarShape, iso);
    const schoolTomorrow = isSchoolDayForDate(nextDate, calendarShape, nextIso);

    const insert = this.db.prepare(
      `INSERT INTO occurrence_steps
       (id, occurrence_id, position, text, obligation, status, source, logical_item_id,
        applicability_json, applicability_reason)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
    );
    let position = 0;
    for (const step of composed) {
      const decision = evaluateApplicability({
        rule: step.applicability,
        date: householdDate,
        isoWeekday: iso,
        nextDate,
        nextIsoWeekday: nextIso,
        schoolToday,
        schoolTomorrow,
      });
      if (!decision.include) continue;
      insert.run(
        randomUUID(),
        occurrenceId,
        position,
        step.text,
        step.obligation,
        step.source,
        step.logicalItemId,
        serializeApplicability(step.applicability),
        decision.reason,
      );
      position += 1;
    }

    this.db
      .prepare(
        `UPDATE occurrences
         SET calendar_edition_id = ?, calendar_provenance = ?
         WHERE id = ?`,
      )
      .run(
        edition.editionId,
        edition.provenance,
        occurrenceId,
      );
  }

  private loadCalendarEditionByVersion(householdId: string, version: number) {
    const edition = this.db
      .prepare(
        `SELECT id, effective_from FROM school_calendar_editions
         WHERE household_id = ? AND version = ?`,
      )
      .get(householdId, version) as
      | { id: string; effective_from: string }
      | undefined;
    if (!edition) return null;
    return {
      id: edition.id,
      effectiveFrom: edition.effective_from,
      years: this.loadYearsForEdition(edition.id),
    };
  }

  private loadCalendarEditionForDate(householdId: string, householdDate: string) {
    const edition = this.db
      .prepare(
        `SELECT id FROM school_calendar_editions
         WHERE household_id = ? AND effective_from <= ?
         ORDER BY effective_from DESC, version DESC LIMIT 1`,
      )
      .get(householdId, householdDate) as { id: string } | undefined;
    if (!edition) {
      const any = this.db
        .prepare(
          `SELECT COUNT(*) AS c FROM school_calendar_editions WHERE household_id = ?`,
        )
        .get(householdId) as { c: number };
      return {
        editionId: null as string | null,
        provenance: (any.c > 0 ? "unconfigured" : "legacy") as
          | "legacy"
          | "unconfigured"
          | "edition",
        years: [] as Array<{
          startDate: string;
          endDate: string;
          usualWeekdays: number[];
          exceptions: Array<{ startDate: string; endDate: string }>;
        }>,
      };
    }
    const years = this.loadYearsForEdition(edition.id);
    return {
      editionId: edition.id,
      provenance: "edition" as const,
      years: years.map((y) => ({
        startDate: y.startDate,
        endDate: y.endDate,
        usualWeekdays: y.usualWeekdays,
        exceptions: y.exceptions.map((ex) => ({
          startDate: ex.startDate,
          endDate: ex.endDate,
        })),
      })),
    };
  }

  private loadYearsForEdition(editionId: string) {
    const years = this.db
      .prepare(
        `SELECT id, start_date, end_date, usual_weekdays_json
         FROM school_years WHERE edition_id = ? ORDER BY position`,
      )
      .all(editionId) as Array<{
      id: string;
      start_date: string;
      end_date: string;
      usual_weekdays_json: string;
    }>;
    return years.map((year) => {
      const exceptions = this.db
        .prepare(
          `SELECT id, name, start_date, end_date FROM school_exceptions
           WHERE year_id = ? ORDER BY position`,
        )
        .all(year.id) as Array<{
        id: string;
        name: string;
        start_date: string;
        end_date: string;
      }>;
      return {
        id: year.id,
        startDate: year.start_date,
        endDate: year.end_date,
        usualWeekdays: JSON.parse(year.usual_weekdays_json) as number[],
        exceptions: exceptions.map((ex) => ({
          id: ex.id,
          name: ex.name,
          startDate: ex.start_date,
          endDate: ex.end_date,
        })),
      };
    });
  }

  private rewriteUnstartedOccurrence(
    occurrenceId: string,
    revision: {
      id: string;
      title: string;
      daypart: Daypart;
      steps: Array<{
        logicalItemId: string;
        text: string;
        obligation: ObligationMeaning;
      }>;
    },
    membershipId: string | null,
    definitionId: string,
    householdDate: string,
    kind: WorkKind = "routine",
    composed?: ReturnType<typeof resolveResponsibilityComposition>,
    newAccountableMemberId?: string | null,
  ): void {
    const accountableMemberId =
      newAccountableMemberId !== undefined ? newAccountableMemberId : membershipId;
    this.db
      .prepare(
        `UPDATE occurrences
         SET revision_id = ?, title = ?, daypart = ?,
             accountable_member_id = ?, version = version + 1,
             structure_fingerprint = ?, unassigned_reason = ?
         WHERE id = ?`,
      )
      .run(
        revision.id,
        revision.title,
        revision.daypart,
        accountableMemberId,
        kind === "responsibility" ? (composed?.structureFingerprint ?? null) : null,
        kind === "responsibility" ? (composed?.unassignedReason ?? null) : null,
        occurrenceId,
      );
    this.db
      .prepare("DELETE FROM occurrence_steps WHERE occurrence_id = ?")
      .run(occurrenceId);
    if (kind === "responsibility" && composed) {
      this.insertComposedResponsibilitySteps(occurrenceId, composed.steps);
    } else {
      this.insertOccurrenceSteps(
        occurrenceId,
        revision,
        accountableMemberId ?? "",
        definitionId,
        householdDate,
        kind,
      );
    }
  }

  private ensureResponsibilityOccurrence(
    householdId: string,
    definitionId: string,
    revision: {
      id: string;
      title: string;
      daypart: Daypart;
      steps: Array<{
        logicalItemId: string;
        text: string;
        obligation: ObligationMeaning;
      }>;
    },
    householdDate: string,
    composed: ReturnType<typeof resolveResponsibilityComposition>,
  ): OccurrenceView {
    const floor = this.getActivityResetFloor(householdId);
    if (floor && compareHouseholdDates(householdDate, floor) < 0) {
      fail("FORBIDDEN", ACTIVITY_CLEARED_MESSAGE);
    }
    let occurrence = this.db
      .prepare(
        `SELECT id, revision_id, started_at, canceled_at, accountable_member_id
         FROM occurrences
         WHERE definition_id = ? AND household_date = ?`,
      )
      .get(definitionId, householdDate) as
      | {
          id: string;
          revision_id: string;
          started_at: string | null;
          canceled_at: string | null;
          accountable_member_id: string | null;
        }
      | undefined;
    if (occurrence?.canceled_at && !isOccurrenceStarted(occurrence.started_at)) {
      this.db
        .prepare(`UPDATE occurrences SET canceled_at = NULL WHERE id = ?`)
        .run(occurrence.id);
      occurrence = { ...occurrence, canceled_at: null };
    }
    const ownerId = composed.accountableMemberId;
    if (!occurrence) {
      const occurrenceId = randomUUID();
      this.db
        .prepare(
          `INSERT INTO occurrences
           (id, household_id, definition_id, revision_id, household_date,
            accountable_member_id, title, daypart, version, started_at, kind,
            structure_fingerprint, unassigned_reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, 'responsibility', ?, ?)`,
        )
        .run(
          occurrenceId,
          householdId,
          definitionId,
          revision.id,
          householdDate,
          ownerId,
          revision.title,
          revision.daypart,
          composed.structureFingerprint,
          composed.unassignedReason,
        );
      this.insertComposedResponsibilitySteps(occurrenceId, composed.steps);
      occurrence = {
        id: occurrenceId,
        revision_id: revision.id,
        started_at: null,
        canceled_at: null,
        accountable_member_id: ownerId,
      };
    } else if (isOccurrenceStarted(occurrence.started_at)) {
      // Frozen structure — never reinsert filtered-out or empty-evaluated steps.
    } else {
      const rowMeta = this.db
        .prepare(
          `SELECT title, daypart, structure_fingerprint FROM occurrences WHERE id = ?`,
        )
        .get(occurrence.id) as {
        title: string;
        daypart: Daypart;
        structure_fingerprint: string | null;
      };
      const stale =
        occurrence.revision_id !== revision.id ||
        rowMeta.title !== revision.title ||
        rowMeta.daypart !== revision.daypart ||
        occurrence.accountable_member_id !== ownerId ||
        rowMeta.structure_fingerprint !== composed.structureFingerprint;
      if (stale) {
        this.rewriteUnstartedOccurrence(
          occurrence.id,
          revision,
          ownerId,
          definitionId,
          householdDate,
          "responsibility",
          composed,
        );
      }
    }
    return this.getOccurrenceById(occurrence!.id)!;
  }

  private insertComposedResponsibilitySteps(
    occurrenceId: string,
    steps: ComposedStep[],
  ): void {
    const insert = this.db.prepare(
      `INSERT INTO occurrence_steps
       (id, occurrence_id, position, text, obligation, status, source, logical_item_id,
        applicability_json, applicability_reason, addition_id, addition_heading)
       VALUES (?, ?, ?, ?, ?, 'open', 'shared', ?, ?, NULL, ?, ?)`,
    );
    steps.forEach((step, position) => {
      insert.run(
        randomUUID(),
        occurrenceId,
        position,
        step.text,
        step.obligation,
        step.logicalItemId,
        serializeApplicability(DEFAULT_APPLICABILITY),
        step.additionId,
        step.additionHeading,
      );
    });
    const householdId = (
      this.db
        .prepare(`SELECT household_id, household_date FROM occurrences WHERE id = ?`)
        .get(occurrenceId) as
        | { household_id: string; household_date: string }
        | undefined
    );
    if (householdId) {
      const edition = this.loadCalendarEditionForDate(
        householdId.household_id,
        householdId.household_date,
      );
      this.db
        .prepare(
          `UPDATE occurrences
           SET calendar_edition_id = ?, calendar_provenance = ?
           WHERE id = ?`,
        )
        .run(edition.editionId, edition.provenance, occurrenceId);
    }
  }

  private ensureOccurrence(
    householdId: string,
    definitionId: string,
    revision: {
      id: string;
      title: string;
      daypart: Daypart;
      steps: Array<{
        logicalItemId: string;
        text: string;
        obligation: ObligationMeaning;
      }>;
    },
    householdDate: string,
    membershipId: string,
    kind: WorkKind = "routine",
  ): OccurrenceView {
    const floor = this.getActivityResetFloor(householdId);
    if (floor && compareHouseholdDates(householdDate, floor) < 0) {
      fail("FORBIDDEN", ACTIVITY_CLEARED_MESSAGE);
    }
    let occurrence =
      kind === "responsibility"
        ? (this.db
            .prepare(
              `SELECT id, revision_id, started_at, canceled_at, accountable_member_id
               FROM occurrences
               WHERE definition_id = ? AND household_date = ?`,
            )
            .get(definitionId, householdDate) as
            | {
                id: string;
                revision_id: string;
                started_at: string | null;
                canceled_at: string | null;
                accountable_member_id: string;
              }
            | undefined)
        : (this.db
            .prepare(
              `SELECT id, revision_id, started_at, canceled_at, accountable_member_id
               FROM occurrences
               WHERE definition_id = ? AND household_date = ? AND accountable_member_id = ?`,
            )
            .get(definitionId, householdDate, membershipId) as
            | {
                id: string;
                revision_id: string;
                started_at: string | null;
                canceled_at: string | null;
                accountable_member_id: string;
              }
            | undefined);
    if (occurrence?.canceled_at && !isOccurrenceStarted(occurrence.started_at)) {
      // Reactivate soft-canceled unstarted row when participant is included again.
      this.db
        .prepare(`UPDATE occurrences SET canceled_at = NULL WHERE id = ?`)
        .run(occurrence.id);
      occurrence = { ...occurrence, canceled_at: null };
    }
    if (
      occurrence &&
      kind === "responsibility" &&
      !isOccurrenceStarted(occurrence.started_at) &&
      occurrence.accountable_member_id !== membershipId
    ) {
      this.db
        .prepare(
          `UPDATE occurrences
           SET accountable_member_id = ?, version = version + 1
           WHERE id = ?`,
        )
        .run(membershipId, occurrence.id);
      occurrence = { ...occurrence, accountable_member_id: membershipId };
    }
    if (!occurrence) {
      const occurrenceId = randomUUID();
      this.db
        .prepare(
          `INSERT INTO occurrences
           (id, household_id, definition_id, revision_id, household_date,
            accountable_member_id, title, daypart, version, started_at, kind)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?)`,
        )
        .run(
          occurrenceId,
          householdId,
          definitionId,
          revision.id,
          householdDate,
          membershipId,
          revision.title,
          revision.daypart,
          kind,
        );
      this.insertOccurrenceSteps(
        occurrenceId,
        revision,
        membershipId,
        definitionId,
        householdDate,
        kind,
      );
      occurrence = {
        id: occurrenceId,
        revision_id: revision.id,
        started_at: null,
        canceled_at: null,
        accountable_member_id: membershipId,
      };
    } else if (isOccurrenceStarted(occurrence.started_at)) {
      // Frozen structure — never reinsert filtered-out or empty-evaluated steps.
    } else {
      // Unstarted: whole-structure reconcile when stale.
      const rowMeta = this.db
        .prepare("SELECT title, daypart FROM occurrences WHERE id = ?")
        .get(occurrence.id) as { title: string; daypart: Daypart };
      const stale =
        occurrence.revision_id !== revision.id ||
        rowMeta.title !== revision.title ||
        rowMeta.daypart !== revision.daypart ||
        !this.occurrenceSharedStepsMatchRevision(
          occurrence.id,
          revision.steps,
          householdId,
          householdDate,
        );
      if (stale) {
        this.rewriteUnstartedOccurrence(
          occurrence.id,
          revision,
          membershipId,
          definitionId,
          householdDate,
        );
      }
      // Filtered-empty is a valid evaluated result — do not empty-list repair.
    }
    return this.getOccurrenceById(occurrence!.id)!;
  }

  private occurrenceSharedStepsMatchRevision(
    occurrenceId: string,
    revisionSteps: Array<{
      logicalItemId: string;
      text: string;
      obligation: ObligationMeaning;
      applicability?: ApplicabilityRule;
    }>,
    householdId: string,
    householdDate: string,
  ): boolean {
    const shared = this.db
      .prepare(
        `SELECT logical_item_id, text, obligation, applicability_json
         FROM occurrence_steps
         WHERE occurrence_id = ? AND source = 'shared'
         ORDER BY position`,
      )
      .all(occurrenceId) as Array<{
      logical_item_id: string | null;
      text: string;
      obligation: ObligationMeaning;
      applicability_json: string | null;
    }>;

    const edition = this.loadCalendarEditionForDate(householdId, householdDate);
    const iso = isoWeekdayForHouseholdDate(householdDate);
    const nextDate = addHouseholdDays(householdDate, 1);
    const nextIso = isoWeekdayForHouseholdDate(nextDate);
    const calendarShape =
      edition.years.length > 0
        ? {
            years: edition.years.map((y) => ({
              startDate: y.startDate,
              endDate: y.endDate,
              usualWeekdays: y.usualWeekdays,
              exceptions: y.exceptions,
            })),
          }
        : null;
    const schoolToday = isSchoolDayForDate(householdDate, calendarShape, iso);
    const schoolTomorrow = isSchoolDayForDate(nextDate, calendarShape, nextIso);
    const expected = revisionSteps.filter((step) => {
      const decision = evaluateApplicability({
        rule: step.applicability ?? DEFAULT_APPLICABILITY,
        date: householdDate,
        isoWeekday: iso,
        nextDate,
        nextIsoWeekday: nextIso,
        schoolToday,
        schoolTomorrow,
      });
      return decision.include;
    });

    if (shared.length !== expected.length) return false;
    return shared.every(
      (row, index) =>
        row.logical_item_id === expected[index]!.logicalItemId &&
        row.text === expected[index]!.text &&
        row.obligation === expected[index]!.obligation &&
        serializeApplicability(parseApplicability(row.applicability_json)) ===
          serializeApplicability(expected[index]!.applicability ?? DEFAULT_APPLICABILITY),
    );
  }

  private getOccurrenceView(
    definitionId: string,
    householdDate: string,
    membershipId: string | null,
    kindHint: WorkKind = "routine",
  ): OccurrenceView | null {
    const row =
      kindHint === "responsibility"
        ? (this.db
            .prepare(
              `SELECT o.id, o.definition_id, o.revision_id, o.household_date, o.title,
                      o.daypart, o.accountable_member_id, o.version, o.started_at,
                      o.kind AS occurrence_kind, d.kind AS definition_kind,
                      hm.display_name
               FROM occurrences o
               JOIN routine_definitions d ON d.id = o.definition_id
               LEFT JOIN household_memberships hm ON hm.id = o.accountable_member_id
               WHERE o.definition_id = ? AND o.household_date = ?
                 AND o.kind = 'responsibility'`,
            )
            .get(definitionId, householdDate) as
            | {
                id: string;
                definition_id: string;
                revision_id: string;
                household_date: string;
                title: string;
                daypart: Daypart;
                accountable_member_id: string | null;
                version: number;
                started_at: string | null;
                occurrence_kind: string | null;
                definition_kind: string | null;
                display_name: string | null;
              }
            | undefined)
        : (this.db
            .prepare(
              `SELECT o.id, o.definition_id, o.revision_id, o.household_date, o.title,
                      o.daypart, o.accountable_member_id, o.version, o.started_at,
                      o.kind AS occurrence_kind, d.kind AS definition_kind,
                      hm.display_name
               FROM occurrences o
               JOIN household_memberships hm ON hm.id = o.accountable_member_id
               JOIN routine_definitions d ON d.id = o.definition_id
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
                daypart: Daypart;
                accountable_member_id: string | null;
                version: number;
                started_at: string | null;
                occurrence_kind: string | null;
                definition_kind: string | null;
                display_name: string | null;
              }
            | undefined);
    if (!row) return null;
    const steps = this.db
      .prepare(
        `SELECT id, position, text, obligation, status, source, logical_item_id,
                applicability_json, applicability_reason
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
      applicability_json: string | null;
      applicability_reason: string | null;
    }>;
    const meta = this.db
      .prepare(
        `SELECT calendar_edition_id, calendar_provenance FROM occurrences WHERE id = ?`,
      )
      .get(row.id) as
      | { calendar_edition_id: string | null; calendar_provenance: string }
      | undefined;
    const kind: WorkKind =
      row.occurrence_kind === "responsibility" ||
      row.definition_kind === "responsibility"
        ? "responsibility"
        : "routine";
    return {
      id: row.id,
      definitionId: row.definition_id,
      revisionId: row.revision_id,
      householdDate: row.household_date,
      title: row.title,
      daypart: row.daypart,
      scheduleAnchor: row.daypart,
      accountableMemberId: row.accountable_member_id,
      accountableMemberName: row.display_name ?? "Unassigned",
      version: row.version,
      startedAt: row.started_at,
      completed: isOccurrenceComplete(steps),
      kind,
      calendarEditionId: meta?.calendar_edition_id ?? null,
      calendarProvenance: (meta?.calendar_provenance as
        | "legacy"
        | "unconfigured"
        | "edition"
        | undefined) ?? "legacy",
      steps: steps.map((step) => ({
        id: step.id,
        position: step.position,
        text: step.text,
        obligation: step.obligation,
        status: step.status,
        source: step.source,
        logicalItemId: step.logical_item_id,
        applicability: parseApplicability(step.applicability_json),
        applicabilityReason: step.applicability_reason,
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
    const existing = this.getPersonalLayer(membershipId, definitionId, effectiveDate);
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
            requested.place === saved.place &&
            serializeApplicability(requested.applicability ?? DEFAULT_APPLICABILITY) ===
              serializeApplicability(saved.applicability ?? DEFAULT_APPLICABILITY)
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
          anchor_logical_item_id, place, applicability_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
          serializeApplicability(addition.applicability ?? DEFAULT_APPLICABILITY),
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
    return this.getPersonalLayer(membershipId, definitionId, effectiveDate)!;
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
          definition_id: string | null;
          association_status: "resolved" | "unresolved";
          text: string;
          obligation: ObligationMeaning;
          anchor_logical_item_id: string | null;
          place: "before" | "after" | "end";
          status: "pending" | "approved" | "rejected";
          proposed_at: string;
          decided_at: string | null;
          decider_membership_id: string | null;
          personal_revision_id: string | null;
          applicability_json: string | null;
        }
      | undefined;
    return row
      ? {
          id: row.id,
          householdId: row.household_id,
          membershipId: row.membership_id,
          definitionId: row.definition_id,
          associationStatus: row.association_status,
          text: row.text,
          obligation: row.obligation,
          applicability: parseApplicability(row.applicability_json),
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

  private withDefaultRoutineApplicability(input: RoutineInput): RoutineInput {
    return {
      ...input,
      steps: input.steps.map((step) => ({
        ...step,
        applicability: step.applicability ?? DEFAULT_APPLICABILITY,
      })),
    };
  }

  private rejectOmittedSharedApplicability(
    incoming: RoutineStepInput[],
    priorSteps: Array<{ logicalItemId: string; applicability?: ApplicabilityRule }>,
  ): void {
    for (const prior of priorSteps) {
      const next = incoming.find(
        (step) => step.logicalItemId && step.logicalItemId === prior.logicalItemId,
      );
      if (!next) continue;
      const priorRule = prior.applicability ?? DEFAULT_APPLICABILITY;
      if (priorRule.kind !== "every_time" && next.applicability === undefined) {
        fail(
          "VALIDATION",
          "Reload and review: this step has a school or day rule that cannot be cleared by an older client.",
        );
      }
    }
  }

  private requireCalendarForSchoolRules(
    householdId: string,
    steps: Array<{ applicability?: ApplicabilityRule }>,
  ): void {
    const needs = steps.some((step) =>
      ruleNeedsSchoolCalendar(step.applicability ?? DEFAULT_APPLICABILITY),
    );
    if (!needs) return;
    const header = this.db
      .prepare(`SELECT version FROM household_calendars WHERE household_id = ?`)
      .get(householdId) as { version: number } | undefined;
    if (!header || header.version === 0) {
      fail(
        "VALIDATION",
        "Set up School calendar in Household before saving school-day or school-night steps.",
      );
    }
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
