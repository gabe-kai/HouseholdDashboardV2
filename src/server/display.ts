import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  buildHouseholdOverview,
  type HouseholdOverview,
} from "../domain/household-overview.js";
import {
  formatStepProgress,
  stepProgressCounts,
  workState,
  type StepProgressCounts,
  type WorkState,
} from "../domain/progress.js";
import {
  householdDateFromInstant,
  nowUtcIso,
  type HouseholdDate,
} from "../domain/time.js";
import type { OccurrenceView } from "../shared/schemas.js";
import {
  digestEquals,
  normalizeDisplayCode,
  randomBase32Code,
  randomToken,
  sha256Hex,
} from "./crypto.js";
import type { AppStore, AuthContext } from "./store.js";

export type DisplayContext = {
  sessionId: string;
  displayId: string;
  householdId: string;
  label: string;
  timezone: string;
  absoluteExpiresAt: string;
  lastSeenAt: string;
};

export type DisplayListItem = {
  id: string;
  label: string;
  configVersion: number;
  createdAt: string;
  revokedAt: string | null;
  hasActiveSession: boolean;
  hasOutstandingClaim: boolean;
  claimExpiresAt: string | null;
  lastSeenAt: string | null;
  absoluteExpiresAt: string | null;
};

export type DisplayCreateResult = {
  display: DisplayListItem;
  enrollment: {
    claimId: string;
    code: string;
    expiresAt: string;
    displayId: string;
    label: string;
  };
  configVersion: number;
};

export type DisplayEnrollmentResult = {
  claimId: string;
  code: string;
  expiresAt: string;
  displayId: string;
  label: string;
  configVersion: number;
  secretAlreadyIssued: boolean;
};

export type DisplayCancelResult = {
  displayId: string;
  configVersion: number;
  cancelled: boolean;
};

export type DisplayRevokeResult = {
  displayId: string;
  configVersion: number;
  revoked: boolean;
};

export type DisplayClaimResult = {
  token: string;
  context: DisplayContext;
  replaced: boolean;
};

export type DisplayPersonSummary = {
  membershipId: string;
  displayName: string;
  sortOrder: number;
  status: "pending" | "active";
  recurringState: WorkState | "No assigned work today";
  progress: StepProgressCounts | null;
  progressLabel: string | null;
  unfinished: Array<{
    occurrenceId: string;
    title: string;
    kind: "routine" | "responsibility";
  }>;
};

export type DisplayDashboard = {
  householdDate: HouseholdDate;
  timezone: string;
  serverTime: string;
  activityGeneration: number;
  byPerson: DisplayPersonSummary[];
  byWork: HouseholdOverview;
};

export type DisplayPersonDetail = {
  membershipId: string;
  displayName: string;
  sortOrder: number;
  status: "pending" | "active";
  recurringWork: Array<{
    occurrenceId: string;
    definitionId: string;
    title: string;
    kind: "routine" | "responsibility";
    daypart: string;
    completed: boolean;
    state: WorkState;
    progress: StepProgressCounts;
    progressLabel: string;
  }>;
  householdVisibleTasks: Array<{
    id: string;
    title: string;
    status: "open" | "completed";
    ownerMembershipId: string;
  }>;
};

export type DisplayOccurrenceDetail = {
  id: string;
  definitionId: string;
  title: string;
  kind: "routine" | "responsibility";
  daypart: string;
  householdDate: string;
  accountableMemberId: string | null;
  accountableMemberName: string;
  completed: boolean;
  state: WorkState;
  progress: StepProgressCounts;
  progressLabel: string;
  steps: Array<{
    id: string;
    text: string;
    status: string;
    obligation: string;
    position: number;
    source?: string;
  }>;
};

export type DisplaySessionInfo = {
  displayId: string;
  label: string;
  householdId: string;
  timezone: string;
  householdDate: HouseholdDate;
  serverTime: string;
  absoluteExpiresAt: string;
  lastSeenAt: string;
  activityGeneration: number;
};

type DisplayCommandKind =
  | "display_create"
  | "display_enrollment_issue"
  | "display_enrollment_cancel"
  | "display_revoke";

type StoreErrorCode =
  | "VALIDATION"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNAUTHORIZED";

const ENROLLMENT_MS = 10 * 60 * 1_000;
const DISPLAY_IDLE_MS = 90 * 24 * 60 * 60 * 1_000;
const DISPLAY_ABSOLUTE_MS = 365 * 24 * 60 * 60 * 1_000;

function fail(code: StoreErrorCode, message: string): never {
  throw Object.assign(new Error(message), { code });
}

function isoAt(date: Date): string {
  return date.toISOString();
}

/**
 * Display principal store operations. Uses AppStore for household-date
 * materialization; never constructs a member AuthContext.
 */
export class DisplayStore {
  /** Test-only: throw after claim consume, before session insert, to prove tx rollback. */
  private claimAfterConsumeHook: (() => void) | null = null;

  constructor(
    private readonly db: Database.Database,
    private readonly appStore: AppStore,
  ) {}

  setClaimAfterConsumeFailureHook(hook: (() => void) | null): void {
    this.claimAfterConsumeHook = hook;
  }

  createDisplay(
    ctx: AuthContext,
    input: { mutationId: string; label: string },
  ): DisplayCreateResult {
    this.requireDisplayManage(ctx);
    const label = input.label.trim();
    if (!label || label.length > 80) {
      fail("VALIDATION", "Display label must be between 1 and 80 characters");
    }

    const prior = this.readReceipt(input.mutationId, "display_create");
    if (prior) {
      return prior as DisplayCreateResult;
    }

    let result!: DisplayCreateResult;
    const tx = this.db.transaction(() => {
      const displayId = randomUUID();
      const now = new Date();
      const nowIso = isoAt(now);
      this.db
        .prepare(
          `INSERT INTO household_displays
           (id, household_id, label, created_by_membership_id, created_at, config_version, revoked_at)
           VALUES (?, ?, ?, ?, ?, 1, NULL)`,
        )
        .run(displayId, ctx.householdId, label, ctx.membershipId, nowIso);

      const enrollment = this.insertEnrollmentClaim(
        displayId,
        ctx.membershipId,
        now,
      );
      const display = this.getDisplayListItem(displayId)!;
      result = {
        display,
        enrollment: {
          claimId: enrollment.claimId,
          code: enrollment.code,
          expiresAt: enrollment.expiresAt,
          displayId,
          label,
        },
        configVersion: 1,
      };
      // Receipt omits plaintext code (recover via Generate new code).
      this.writeReceipt(input.mutationId, "display_create", ctx, displayId, {
        display,
        enrollment: {
          claimId: enrollment.claimId,
          expiresAt: enrollment.expiresAt,
          displayId,
          label,
          secretAlreadyIssued: true,
        },
        configVersion: 1,
      });
    });
    tx();
    return result;
  }

  listDisplays(ctx: AuthContext): DisplayListItem[] {
    this.requireDisplayManage(ctx);
    const rows = this.db
      .prepare(
        `SELECT id FROM household_displays
         WHERE household_id = ?
         ORDER BY created_at DESC, id`,
      )
      .all(ctx.householdId) as Array<{ id: string }>;
    return rows.map((row) => this.getDisplayListItem(row.id)!);
  }

  issueEnrollment(
    ctx: AuthContext,
    displayId: string,
    input: { mutationId: string; expectedConfigVersion: number },
  ): DisplayEnrollmentResult {
    this.requireDisplayManage(ctx);
    const prior = this.readReceipt(input.mutationId, "display_enrollment_issue");
    if (prior) {
      return prior as DisplayEnrollmentResult;
    }

    let result!: DisplayEnrollmentResult;
    const tx = this.db.transaction(() => {
      const display = this.requireActiveDisplay(displayId, ctx.householdId);
      if (display.config_version !== input.expectedConfigVersion) {
        fail("CONFLICT", "Display was updated elsewhere; refresh and try again");
      }
      const now = new Date();
      this.revokeOutstandingClaims(displayId, now);
      const enrollment = this.insertEnrollmentClaim(
        displayId,
        ctx.membershipId,
        now,
      );
      const safe = {
        claimId: enrollment.claimId,
        expiresAt: enrollment.expiresAt,
        displayId,
        label: display.label,
        configVersion: display.config_version,
        secretAlreadyIssued: true,
      };
      this.writeReceipt(
        input.mutationId,
        "display_enrollment_issue",
        ctx,
        displayId,
        safe,
      );
      result = {
        ...safe,
        secretAlreadyIssued: false,
        code: enrollment.code,
      };
    });
    tx();
    return result;
  }

  cancelEnrollment(
    ctx: AuthContext,
    displayId: string,
    input: { mutationId: string; expectedConfigVersion: number },
  ): DisplayCancelResult {
    this.requireDisplayManage(ctx);
    const prior = this.readReceipt(input.mutationId, "display_enrollment_cancel");
    if (prior) {
      return prior as DisplayCancelResult;
    }

    let result!: DisplayCancelResult;
    const tx = this.db.transaction(() => {
      const display = this.requireManagedDisplay(displayId, ctx.householdId);
      if (display.config_version !== input.expectedConfigVersion) {
        fail("CONFLICT", "Display was updated elsewhere; refresh and try again");
      }
      const now = new Date();
      const outstanding = this.revokeOutstandingClaims(displayId, now);
      result = {
        displayId,
        configVersion: display.config_version,
        cancelled: outstanding > 0,
      };
      this.writeReceipt(
        input.mutationId,
        "display_enrollment_cancel",
        ctx,
        displayId,
        result,
      );
    });
    tx();
    return result;
  }

  revokeDisplay(
    ctx: AuthContext,
    displayId: string,
    input: { mutationId: string; expectedConfigVersion: number },
  ): DisplayRevokeResult {
    this.requireDisplayManage(ctx);
    const prior = this.readReceipt(input.mutationId, "display_revoke");
    if (prior) {
      return prior as DisplayRevokeResult;
    }

    let result!: DisplayRevokeResult;
    const tx = this.db.transaction(() => {
      const display = this.requireManagedDisplay(displayId, ctx.householdId);
      if (display.config_version !== input.expectedConfigVersion) {
        fail("CONFLICT", "Display was updated elsewhere; refresh and try again");
      }
      const now = new Date();
      const nowIso = isoAt(now);
      const nextVersion = display.config_version + 1;
      this.db
        .prepare(
          `UPDATE household_displays
           SET revoked_at = COALESCE(revoked_at, ?), config_version = ?
           WHERE id = ?`,
        )
        .run(nowIso, nextVersion, displayId);
      this.revokeOutstandingClaims(displayId, now);
      this.revokeDisplaySessions(displayId, now);
      result = {
        displayId,
        configVersion: nextVersion,
        revoked: true,
      };
      this.writeReceipt(
        input.mutationId,
        "display_revoke",
        ctx,
        displayId,
        result,
      );
    });
    tx();
    return result;
  }

  /**
   * Redeem a setup code. Caller must ensure no human session is present.
   * Concurrent claims: only one winner via atomic consumed_at update.
   */
  claimDisplayCode(
    code: string,
    options?: { existingDisplayId?: string | null },
  ): DisplayClaimResult {
    const normalized = normalizeDisplayCode(code);
    if (!/^[A-Z2-7]{16}$/.test(normalized)) {
      fail("UNAUTHORIZED", "Invalid or expired setup code");
    }
    const digest = sha256Hex(normalized);

    let result!: DisplayClaimResult;
    const tx = this.db.transaction(() => {
      const claim = this.db
        .prepare(
          `SELECT c.id, c.display_id, c.code_digest, c.issued_by_membership_id,
                  c.expires_at, c.consumed_at, c.revoked_at,
                  d.household_id, d.label, d.revoked_at AS display_revoked_at,
                  d.config_version, h.timezone
           FROM display_enrollment_claims c
           JOIN household_displays d ON d.id = c.display_id
           JOIN households h ON h.id = d.household_id
           WHERE c.code_digest = ?`,
        )
        .get(digest) as
        | {
            id: string;
            display_id: string;
            code_digest: string;
            issued_by_membership_id: string;
            expires_at: string;
            consumed_at: string | null;
            revoked_at: string | null;
            household_id: string;
            label: string;
            display_revoked_at: string | null;
            config_version: number;
            timezone: string;
          }
        | undefined;

      if (
        !claim ||
        !digestEquals(claim.code_digest, digest) ||
        claim.consumed_at ||
        claim.revoked_at ||
        claim.display_revoked_at ||
        new Date(claim.expires_at) <= new Date()
      ) {
        fail("UNAUTHORIZED", "Invalid or expired setup code");
      }

      if (
        options?.existingDisplayId &&
        options.existingDisplayId !== claim.display_id
      ) {
        fail(
          "CONFLICT",
          "This display is already enrolled; revoke it before switching",
        );
      }

      if (!this.issuerStillAuthorized(claim.issued_by_membership_id, claim.household_id)) {
        fail("UNAUTHORIZED", "Invalid or expired setup code");
      }

      const now = new Date();
      const consume = this.db
        .prepare(
          `UPDATE display_enrollment_claims
           SET consumed_at = ?
           WHERE id = ? AND consumed_at IS NULL AND revoked_at IS NULL`,
        )
        .run(isoAt(now), claim.id);
      if (consume.changes !== 1) {
        fail("UNAUTHORIZED", "Invalid or expired setup code");
      }

      // Test seam: failure here must roll back consume with the session insert.
      this.claimAfterConsumeHook?.();

      // Successful claim invalidates prior sessions for this display.
      this.revokeDisplaySessions(claim.display_id, now);
      const nextVersion = claim.config_version + 1;
      this.db
        .prepare(
          `UPDATE household_displays SET config_version = ? WHERE id = ?`,
        )
        .run(nextVersion, claim.display_id);

      const token = randomToken(32);
      const sessionId = randomUUID();
      const absoluteExpiresAt = isoAt(
        new Date(now.getTime() + DISPLAY_ABSOLUTE_MS),
      );
      this.db
        .prepare(
          `INSERT INTO display_sessions
           (id, display_id, token_digest, created_at, last_seen_at, absolute_expires_at, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          sessionId,
          claim.display_id,
          sha256Hex(token),
          isoAt(now),
          isoAt(now),
          absoluteExpiresAt,
        );

      result = {
        token,
        replaced: Boolean(options?.existingDisplayId),
        context: {
          sessionId,
          displayId: claim.display_id,
          householdId: claim.household_id,
          label: claim.label,
          timezone: claim.timezone,
          absoluteExpiresAt,
          lastSeenAt: isoAt(now),
        },
      };
    });
    tx();
    return result;
  }

  getDisplaySessionByTokenDigest(digest: string): DisplayContext | null {
    const row = this.db
      .prepare(
        `SELECT s.id AS session_id, s.display_id, s.created_at, s.last_seen_at,
                s.absolute_expires_at, d.household_id, d.label, d.revoked_at AS display_revoked_at,
                h.timezone
         FROM display_sessions s
         JOIN household_displays d ON d.id = s.display_id
         JOIN households h ON h.id = d.household_id
         WHERE s.token_digest = ? AND s.revoked_at IS NULL`,
      )
      .get(digest) as
      | {
          session_id: string;
          display_id: string;
          created_at: string;
          last_seen_at: string;
          absolute_expires_at: string;
          household_id: string;
          label: string;
          display_revoked_at: string | null;
          timezone: string;
        }
      | undefined;
    if (!row || row.display_revoked_at) return null;

    const now = new Date();
    const idleExpired =
      now.getTime() - new Date(row.last_seen_at).getTime() > DISPLAY_IDLE_MS;
    const absoluteExpired = now >= new Date(row.absolute_expires_at);
    if (idleExpired || absoluteExpired) {
      this.db
        .prepare(
          "UPDATE display_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?",
        )
        .run(isoAt(now), row.session_id);
      return null;
    }

    this.db
      .prepare("UPDATE display_sessions SET last_seen_at = ? WHERE id = ?")
      .run(isoAt(now), row.session_id);

    return {
      sessionId: row.session_id,
      displayId: row.display_id,
      householdId: row.household_id,
      label: row.label,
      timezone: row.timezone,
      absoluteExpiresAt: row.absolute_expires_at,
      lastSeenAt: isoAt(now),
    };
  }

  revokeDisplaySessions(displayId: string, now = new Date()): number {
    const result = this.db
      .prepare(
        `UPDATE display_sessions
         SET revoked_at = COALESCE(revoked_at, ?)
         WHERE display_id = ? AND revoked_at IS NULL`,
      )
      .run(isoAt(now), displayId);
    return result.changes;
  }

  /** Cookie Max-Age in seconds from remaining absolute lifetime (minimum 0). */
  sessionCookieMaxAge(ctx: DisplayContext, now = new Date()): number {
    const remainingMs =
      new Date(ctx.absoluteExpiresAt).getTime() - now.getTime();
    return Math.max(0, Math.floor(remainingMs / 1_000));
  }

  materializeCurrentDayForHousehold(householdId: string): OccurrenceView[] {
    const timezone = this.householdTimezone(householdId);
    const today = householdDateFromInstant(new Date(), timezone);
    return this.appStore.materializeHouseholdDate(householdId, today);
  }

  getDisplaySessionInfo(ctx: DisplayContext): DisplaySessionInfo {
    return {
      displayId: ctx.displayId,
      label: ctx.label,
      householdId: ctx.householdId,
      timezone: ctx.timezone,
      householdDate: householdDateFromInstant(new Date(), ctx.timezone),
      serverTime: nowUtcIso(),
      absoluteExpiresAt: ctx.absoluteExpiresAt,
      lastSeenAt: ctx.lastSeenAt,
      activityGeneration: this.appStore.getActivityGeneration(ctx.householdId),
    };
  }

  getDisplayDashboard(ctx: DisplayContext): DisplayDashboard {
    const occurrences = this.materializeCurrentDayForHousehold(ctx.householdId);
    const people = this.listHouseholdPeople(ctx.householdId);
    const byWork = buildHouseholdOverview(occurrences);
    const byPerson = people.map((person) => {
      const mine = occurrences.filter(
        (occurrence) => occurrence.accountableMemberId === person.id,
      );
      if (mine.length === 0) {
        return {
          membershipId: person.id,
          displayName: person.displayName,
          sortOrder: person.sortOrder,
          status: person.status,
          recurringState: "No assigned work today" as const,
          progress: null,
          progressLabel: null,
          unfinished: [],
        };
      }
      const flatSteps = mine.flatMap((occurrence) => occurrence.steps);
      const progress = stepProgressCounts(flatSteps);
      const allComplete = mine.every((occurrence) => occurrence.completed);
      const anyBegun = mine.some(
        (occurrence) =>
          occurrence.completed ||
          occurrence.startedAt ||
          occurrence.steps.some((step) => step.status !== "open"),
      );
      const recurringState: WorkState = allComplete
        ? "Complete"
        : anyBegun
          ? "In progress"
          : "Not started";
      return {
        membershipId: person.id,
        displayName: person.displayName,
        sortOrder: person.sortOrder,
        status: person.status,
        recurringState,
        progress,
        progressLabel: formatStepProgress(progress),
        unfinished: mine
          .filter((occurrence) => !occurrence.completed)
          .map((occurrence) => ({
            occurrenceId: occurrence.id,
            title: occurrence.title,
            kind: occurrence.kind,
          })),
      };
    });

    return {
      householdDate: householdDateFromInstant(new Date(), ctx.timezone),
      timezone: ctx.timezone,
      serverTime: nowUtcIso(),
      activityGeneration: this.appStore.getActivityGeneration(ctx.householdId),
      byPerson,
      byWork,
    };
  }

  getDisplayPersonDetail(
    ctx: DisplayContext,
    membershipId: string,
  ): DisplayPersonDetail {
    const person = this.listHouseholdPeople(ctx.householdId).find(
      (entry) => entry.id === membershipId,
    );
    if (!person) fail("NOT_FOUND", "Person not found");

    const occurrences = this.materializeCurrentDayForHousehold(ctx.householdId);
    const recurringWork = occurrences
      .filter((occurrence) => occurrence.accountableMemberId === membershipId)
      .map((occurrence) => {
        const progress = stepProgressCounts(occurrence.steps);
        return {
          occurrenceId: occurrence.id,
          definitionId: occurrence.definitionId,
          title: occurrence.title,
          kind: occurrence.kind,
          daypart: occurrence.daypart,
          completed: occurrence.completed,
          state: workState(occurrence),
          progress,
          progressLabel: formatStepProgress(progress),
        };
      });

    const householdVisibleTasks = (
      this.db
        .prepare(
          `SELECT id, title, status, owner_membership_id
           FROM personal_tasks
           WHERE household_id = ?
             AND owner_membership_id = ?
             AND visibility = 'household'
           ORDER BY
             CASE status WHEN 'open' THEN 0 ELSE 1 END,
             updated_at DESC`,
        )
        .all(ctx.householdId, membershipId) as Array<{
        id: string;
        title: string;
        status: "open" | "completed";
        owner_membership_id: string;
      }>
    ).map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      ownerMembershipId: row.owner_membership_id,
    }));

    return {
      membershipId: person.id,
      displayName: person.displayName,
      sortOrder: person.sortOrder,
      status: person.status,
      recurringWork,
      householdVisibleTasks,
    };
  }

  getDisplayOccurrenceDetail(
    ctx: DisplayContext,
    occurrenceId: string,
  ): DisplayOccurrenceDetail {
    const occurrences = this.materializeCurrentDayForHousehold(ctx.householdId);
    const occurrence = occurrences.find((item) => item.id === occurrenceId);
    if (!occurrence) fail("NOT_FOUND", "Occurrence not found");

    const progress = stepProgressCounts(occurrence.steps);
    return {
      id: occurrence.id,
      definitionId: occurrence.definitionId,
      title: occurrence.title,
      kind: occurrence.kind,
      daypart: occurrence.daypart,
      householdDate: occurrence.householdDate,
      accountableMemberId: occurrence.accountableMemberId,
      accountableMemberName: occurrence.accountableMemberName,
      completed: occurrence.completed,
      state: workState(occurrence),
      progress,
      progressLabel: formatStepProgress(progress),
      steps: occurrence.steps.map((step, index) => ({
        id: step.id,
        text: step.text,
        status: step.status,
        obligation: step.obligation,
        position: index,
        ...(step.source ? { source: step.source } : {}),
      })),
    };
  }

  /** Whether a personal task mutation should invalidate displays (never private). */
  isHouseholdVisibleTask(taskId: string, householdId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS ok FROM personal_tasks
         WHERE id = ? AND household_id = ? AND visibility = 'household'`,
      )
      .get(taskId, householdId) as { ok: number } | undefined;
    return Boolean(row);
  }

  private requireDisplayManage(ctx: AuthContext): void {
    if (!this.appStore.hasGrant(ctx, "household.display.manage")) {
      fail("FORBIDDEN", "Required authority is missing");
    }
  }

  private issuerStillAuthorized(
    membershipId: string,
    householdId: string,
  ): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS ok
         FROM household_memberships hm
         JOIN membership_grants mg
           ON mg.membership_id = hm.id
          AND mg.grant_name = 'household.display.manage'
         WHERE hm.id = ?
           AND hm.household_id = ?
           AND hm.status = 'active'`,
      )
      .get(membershipId, householdId) as { ok: number } | undefined;
    return Boolean(row);
  }

  private requireActiveDisplay(
    displayId: string,
    householdId: string,
  ): { id: string; label: string; config_version: number } {
    const row = this.db
      .prepare(
        `SELECT id, label, config_version FROM household_displays
         WHERE id = ? AND household_id = ? AND revoked_at IS NULL`,
      )
      .get(displayId, householdId) as
      | { id: string; label: string; config_version: number }
      | undefined;
    if (!row) fail("NOT_FOUND", "Display not found");
    return row;
  }

  private requireManagedDisplay(
    displayId: string,
    householdId: string,
  ): {
    id: string;
    label: string;
    config_version: number;
    revoked_at: string | null;
  } {
    const row = this.db
      .prepare(
        `SELECT id, label, config_version, revoked_at FROM household_displays
         WHERE id = ? AND household_id = ?`,
      )
      .get(displayId, householdId) as
      | {
          id: string;
          label: string;
          config_version: number;
          revoked_at: string | null;
        }
      | undefined;
    if (!row) fail("NOT_FOUND", "Display not found");
    return row;
  }

  private insertEnrollmentClaim(
    displayId: string,
    issuedByMembershipId: string,
    now: Date,
  ): { claimId: string; code: string; expiresAt: string } {
    const claimId = randomUUID();
    const code = randomBase32Code(16);
    const expiresAt = isoAt(new Date(now.getTime() + ENROLLMENT_MS));
    this.db
      .prepare(
        `INSERT INTO display_enrollment_claims
         (id, display_id, code_digest, issued_by_membership_id, created_at, expires_at, consumed_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .run(
        claimId,
        displayId,
        sha256Hex(code),
        issuedByMembershipId,
        isoAt(now),
        expiresAt,
      );
    return { claimId, code, expiresAt };
  }

  private revokeOutstandingClaims(displayId: string, now: Date): number {
    return this.db
      .prepare(
        `UPDATE display_enrollment_claims
         SET revoked_at = COALESCE(revoked_at, ?)
         WHERE display_id = ?
           AND consumed_at IS NULL
           AND revoked_at IS NULL`,
      )
      .run(isoAt(now), displayId).changes;
  }

  private getDisplayListItem(displayId: string): DisplayListItem | null {
    const row = this.db
      .prepare(
        `SELECT id, label, config_version, created_at, revoked_at
         FROM household_displays WHERE id = ?`,
      )
      .get(displayId) as
      | {
          id: string;
          label: string;
          config_version: number;
          created_at: string;
          revoked_at: string | null;
        }
      | undefined;
    if (!row) return null;

    const session = this.db
      .prepare(
        `SELECT last_seen_at, absolute_expires_at FROM display_sessions
         WHERE display_id = ? AND revoked_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(displayId) as
      | { last_seen_at: string; absolute_expires_at: string }
      | undefined;

    const claim = this.db
      .prepare(
        `SELECT expires_at FROM display_enrollment_claims
         WHERE display_id = ?
           AND consumed_at IS NULL
           AND revoked_at IS NULL
           AND expires_at > ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(displayId, nowUtcIso()) as { expires_at: string } | undefined;

    return {
      id: row.id,
      label: row.label,
      configVersion: row.config_version,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
      hasActiveSession: Boolean(session) && !row.revoked_at,
      hasOutstandingClaim: Boolean(claim),
      claimExpiresAt: claim?.expires_at ?? null,
      lastSeenAt: session?.last_seen_at ?? null,
      absoluteExpiresAt: session?.absolute_expires_at ?? null,
    };
  }

  private listHouseholdPeople(householdId: string): Array<{
    id: string;
    displayName: string;
    sortOrder: number;
    status: "pending" | "active";
  }> {
    return (
      this.db
        .prepare(
          `SELECT id, display_name, sort_order, status
           FROM household_memberships
           WHERE household_id = ?
           ORDER BY sort_order, id`,
        )
        .all(householdId) as Array<{
        id: string;
        display_name: string;
        sort_order: number;
        status: "pending" | "active";
      }>
    ).map((row) => ({
      id: row.id,
      displayName: row.display_name,
      sortOrder: row.sort_order,
      status: row.status,
    }));
  }

  private householdTimezone(householdId: string): string {
    const row = this.db
      .prepare("SELECT timezone FROM households WHERE id = ?")
      .get(householdId) as { timezone: string } | undefined;
    if (!row) fail("NOT_FOUND", "Household not found");
    return row.timezone;
  }

  private readReceipt(
    mutationId: string,
    kind: DisplayCommandKind,
  ): unknown | null {
    const row = this.db
      .prepare(
        `SELECT response_json FROM display_command_receipts
         WHERE mutation_id = ? AND kind = ?`,
      )
      .get(mutationId, kind) as { response_json: string } | undefined;
    return row ? (JSON.parse(row.response_json) as unknown) : null;
  }

  private writeReceipt(
    mutationId: string,
    kind: DisplayCommandKind,
    ctx: AuthContext,
    displayId: string | null,
    response: unknown,
  ): void {
    this.db
      .prepare(
        `INSERT INTO display_command_receipts
         (mutation_id, kind, household_id, actor_membership_id, display_id, response_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        mutationId,
        kind,
        ctx.householdId,
        ctx.membershipId,
        displayId,
        JSON.stringify(response),
        nowUtcIso(),
      );
  }
}
