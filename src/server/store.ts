import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { isOccurrenceComplete, assertStatusAllowed } from "../domain/completion.js";
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
import type {
  Capability,
  ObligationMeaning,
  OccurrenceView,
  StepStatus,
} from "../shared/schemas.js";
import { SEED } from "./seeds/evaluation.js";

type MemberRow = {
  id: string;
  household_id: string;
  display_name: string;
  capabilities_json: string;
};

export type SessionContext = {
  sessionId: string;
  householdId: string;
  memberId: string;
  displayName: string;
  capabilities: Capability[];
  timezone: string;
};

function parseCapabilities(json: string): Capability[] {
  return JSON.parse(json) as Capability[];
}

function hasCapability(ctx: SessionContext, cap: Capability): boolean {
  return ctx.capabilities.includes(cap);
}

export class AppStore {
  constructor(private readonly db: Database.Database) {}

  seed(timezone: string): void {
    const existing = this.db.prepare("SELECT id FROM households LIMIT 1").get();
    if (existing) return;

    const insertHousehold = this.db.prepare(
      "INSERT INTO households (id, name, timezone) VALUES (?, ?, ?)",
    );
    const insertMember = this.db.prepare(
      "INSERT INTO members (id, household_id, display_name, capabilities_json) VALUES (?, ?, ?, ?)",
    );

    const tx = this.db.transaction(() => {
      insertHousehold.run(SEED.household.id, SEED.household.name, timezone);
      for (const m of SEED.members) {
        insertMember.run(
          m.id,
          SEED.household.id,
          m.displayName,
          JSON.stringify([...m.capabilities]),
        );
      }
    });
    tx();
  }

  listMembers(): Array<{ id: string; displayName: string; capabilities: Capability[] }> {
    const rows = this.db
      .prepare("SELECT id, display_name, capabilities_json FROM members ORDER BY display_name")
      .all() as MemberRow[];
    return rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      capabilities: parseCapabilities(r.capabilities_json),
    }));
  }

  createSession(memberId: string): SessionContext {
    const member = this.db
      .prepare("SELECT * FROM members WHERE id = ?")
      .get(memberId) as MemberRow | undefined;
    if (!member) {
      throw Object.assign(new Error("Unknown member"), { code: "NOT_FOUND" });
    }
    const household = this.db
      .prepare("SELECT timezone FROM households WHERE id = ?")
      .get(member.household_id) as { timezone: string };

    // One active session token per browser selection; rotate id.
    const sessionId = randomUUID();
    this.db
      .prepare("INSERT INTO sessions (id, household_id, member_id, created_at) VALUES (?, ?, ?, ?)")
      .run(sessionId, member.household_id, member.id, nowUtcIso());

    return {
      sessionId,
      householdId: member.household_id,
      memberId: member.id,
      displayName: member.display_name,
      capabilities: parseCapabilities(member.capabilities_json),
      timezone: household.timezone,
    };
  }

  getSession(sessionId: string | undefined): SessionContext | null {
    if (!sessionId) return null;
    const row = this.db
      .prepare(
        `SELECT s.id as session_id, s.household_id, s.member_id, m.display_name, m.capabilities_json, h.timezone
         FROM sessions s
         JOIN members m ON m.id = s.member_id
         JOIN households h ON h.id = s.household_id
         WHERE s.id = ?`,
      )
      .get(sessionId) as
      | {
          session_id: string;
          household_id: string;
          member_id: string;
          display_name: string;
          capabilities_json: string;
          timezone: string;
        }
      | undefined;
    if (!row) return null;
    return {
      sessionId: row.session_id,
      householdId: row.household_id,
      memberId: row.member_id,
      displayName: row.display_name,
      capabilities: parseCapabilities(row.capabilities_json),
      timezone: row.timezone,
    };
  }

  deleteSession(sessionId: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }

  householdDateNow(ctx: SessionContext, now = new Date()): HouseholdDate {
    return householdDateFromInstant(now, ctx.timezone);
  }

  getRoutine(householdId: string) {
    const def = this.db
      .prepare("SELECT * FROM routine_definitions WHERE household_id = ?")
      .get(householdId) as { id: string; kind: string } | undefined;
    if (!def) return null;

    const revisions = this.db
      .prepare(
        "SELECT id, effective_date, title, weekdays_json, created_at FROM routine_revisions WHERE definition_id = ? ORDER BY effective_date",
      )
      .all(def.id) as Array<{
      id: string;
      effective_date: string;
      title: string;
      weekdays_json: string;
      created_at: string;
    }>;

    return {
      id: def.id,
      kind: def.kind as "morning",
      revisions: revisions.map((r) => ({
        id: r.id,
        effectiveDate: r.effective_date,
        title: r.title,
        weekdays: JSON.parse(r.weekdays_json) as number[],
        createdAt: r.created_at,
        steps: this.revisionSteps(r.id),
        assigneeMemberIds: this.revisionAssignees(r.id),
      })),
    };
  }

  private revisionSteps(revisionId: string) {
    return (
      this.db
        .prepare(
          "SELECT id, position, text, obligation FROM revision_steps WHERE revision_id = ? ORDER BY position",
        )
        .all(revisionId) as Array<{
        id: string;
        position: number;
        text: string;
        obligation: ObligationMeaning;
      }>
    ).map((s) => ({
      id: s.id,
      position: s.position,
      text: s.text,
      obligation: s.obligation,
    }));
  }

  private revisionAssignees(revisionId: string): string[] {
    return (
      this.db
        .prepare("SELECT member_id FROM revision_assignees WHERE revision_id = ?")
        .all(revisionId) as Array<{ member_id: string }>
    ).map((r) => r.member_id);
  }

  createRoutine(
    ctx: SessionContext,
    input: {
      title: string;
      assigneeMemberIds: string[];
      weekdays: number[];
      steps: Array<{ text: string; obligation: ObligationMeaning }>;
    },
  ) {
    if (!hasCapability(ctx, "manage_routine")) {
      throw Object.assign(new Error("Parent capability required"), { code: "FORBIDDEN" });
    }
    const stepCheck = validateRoutineSteps(input.steps);
    if (!stepCheck.ok) {
      throw Object.assign(new Error(stepCheck.message), { code: "VALIDATION" });
    }
    if (this.getRoutine(ctx.householdId)) {
      throw Object.assign(new Error("Household already has a Morning Routine"), {
        code: "CONFLICT",
      });
    }

    const today = this.householdDateNow(ctx);
    const definitionId = randomUUID();
    const revisionId = randomUUID();

    const tx = this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO routine_definitions (id, household_id, kind) VALUES (?, ?, 'morning')")
        .run(definitionId, ctx.householdId);
      this.insertRevision(revisionId, definitionId, today, input);
    });
    tx();
    return this.getRoutine(ctx.householdId);
  }

  createRevision(
    ctx: SessionContext,
    definitionId: string,
    input: {
      title: string;
      assigneeMemberIds: string[];
      weekdays: number[];
      steps: Array<{ text: string; obligation: ObligationMeaning }>;
      effectiveDate?: string;
    },
  ) {
    if (!hasCapability(ctx, "manage_routine")) {
      throw Object.assign(new Error("Parent capability required"), { code: "FORBIDDEN" });
    }
    const stepCheck = validateRoutineSteps(input.steps);
    if (!stepCheck.ok) {
      throw Object.assign(new Error(stepCheck.message), { code: "VALIDATION" });
    }

    const def = this.db
      .prepare("SELECT * FROM routine_definitions WHERE id = ? AND household_id = ?")
      .get(definitionId, ctx.householdId) as { id: string } | undefined;
    if (!def) {
      throw Object.assign(new Error("Routine not found"), { code: "NOT_FOUND" });
    }

    const today = this.householdDateNow(ctx);
    const minEffective = addHouseholdDays(today, 1);
    const effectiveDate = input.effectiveDate ?? minEffective;
    if (compareHouseholdDates(effectiveDate, minEffective) < 0) {
      throw Object.assign(new Error("Revision must be effective no earlier than the next household day"), {
        code: "VALIDATION",
      });
    }

    const revisionId = randomUUID();
    try {
      this.insertRevision(revisionId, definitionId, effectiveDate, input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("UNIQUE")) {
        throw Object.assign(new Error("A revision already exists for that effective date"), {
          code: "CONFLICT",
        });
      }
      throw err;
    }
    return this.getRoutine(ctx.householdId);
  }

  private insertRevision(
    revisionId: string,
    definitionId: string,
    effectiveDate: string,
    input: {
      title: string;
      assigneeMemberIds: string[];
      weekdays: number[];
      steps: Array<{ text: string; obligation: ObligationMeaning }>;
    },
  ) {
    this.db
      .prepare(
        `INSERT INTO routine_revisions (id, definition_id, effective_date, title, weekdays_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        revisionId,
        definitionId,
        effectiveDate,
        input.title,
        JSON.stringify(input.weekdays),
        nowUtcIso(),
      );

    const insertStep = this.db.prepare(
      `INSERT INTO revision_steps (id, revision_id, position, text, obligation) VALUES (?, ?, ?, ?, ?)`,
    );
    input.steps.forEach((step, index) => {
      insertStep.run(randomUUID(), revisionId, index, step.text.trim(), step.obligation);
    });

    const insertAssignee = this.db.prepare(
      `INSERT INTO revision_assignees (revision_id, member_id) VALUES (?, ?)`,
    );
    for (const memberId of input.assigneeMemberIds) {
      insertAssignee.run(revisionId, memberId);
    }
  }

  materializeForDate(ctx: SessionContext, householdDate: HouseholdDate): OccurrenceView[] {
    const routine = this.getRoutine(ctx.householdId);
    if (!routine) return [];

    const revision = selectRevisionForDate(
      routine.revisions.map((r) => ({
        id: r.id,
        effectiveDate: r.effectiveDate,
        weekdays: r.weekdays,
        title: r.title,
        steps: r.steps,
        assigneeMemberIds: r.assigneeMemberIds,
      })),
      householdDate,
    );
    if (!revision || !isDateApplicable(householdDate, revision.weekdays)) {
      return [];
    }

    const fullRevision = routine.revisions.find((r) => r.id === revision.id)!;
    const results: OccurrenceView[] = [];

    const tx = this.db.transaction(() => {
      for (const memberId of fullRevision.assigneeMemberIds) {
        results.push(this.ensureOccurrence(ctx.householdId, routine.id, fullRevision, householdDate, memberId));
      }
    });
    tx();

    if (hasCapability(ctx, "manage_routine")) {
      return results;
    }
    return results.filter((o) => o.accountableMemberId === ctx.memberId);
  }

  private ensureOccurrence(
    householdId: string,
    definitionId: string,
    revision: {
      id: string;
      title: string;
      steps: Array<{ text: string; obligation: ObligationMeaning; position: number }>;
    },
    householdDate: HouseholdDate,
    accountableMemberId: string,
  ): OccurrenceView {
    const existing = this.db
      .prepare(
        `SELECT id FROM occurrences
         WHERE definition_id = ? AND household_date = ? AND accountable_member_id = ?`,
      )
      .get(definitionId, householdDate, accountableMemberId) as { id: string } | undefined;

    if (!existing) {
      const occurrenceId = randomUUID();
      this.db
        .prepare(
          `INSERT INTO occurrences
           (id, household_id, definition_id, revision_id, household_date, accountable_member_id, title, schedule_anchor, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'morning', 1)`,
        )
        .run(
          occurrenceId,
          householdId,
          definitionId,
          revision.id,
          householdDate,
          accountableMemberId,
          revision.title,
        );

      const insertStep = this.db.prepare(
        `INSERT INTO occurrence_steps (id, occurrence_id, position, text, obligation, status)
         VALUES (?, ?, ?, ?, ?, 'open')`,
      );
      revision.steps.forEach((step, index) => {
        insertStep.run(randomUUID(), occurrenceId, index, step.text, step.obligation);
      });
    }

    return this.getOccurrenceView(
      definitionId,
      householdDate,
      accountableMemberId,
    )!;
  }

  private getOccurrenceView(
    definitionId: string,
    householdDate: string,
    accountableMemberId: string,
  ): OccurrenceView | null {
    const row = this.db
      .prepare(
        `SELECT o.*, m.display_name
         FROM occurrences o
         JOIN members m ON m.id = o.accountable_member_id
         WHERE o.definition_id = ? AND o.household_date = ? AND o.accountable_member_id = ?`,
      )
      .get(definitionId, householdDate, accountableMemberId) as
      | {
          id: string;
          definition_id: string;
          revision_id: string;
          household_date: string;
          title: string;
          accountable_member_id: string;
          display_name: string;
          version: number;
        }
      | undefined;
    if (!row) return null;

    const steps = this.db
      .prepare(
        `SELECT id, position, text, obligation, status FROM occurrence_steps
         WHERE occurrence_id = ? ORDER BY position`,
      )
      .all(row.id) as Array<{
      id: string;
      position: number;
      text: string;
      obligation: ObligationMeaning;
      status: StepStatus;
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
      steps: steps.map((s) => ({
        id: s.id,
        position: s.position,
        text: s.text,
        obligation: s.obligation,
        status: s.status,
      })),
    };
  }

  getOccurrenceById(occurrenceId: string): OccurrenceView | null {
    const row = this.db
      .prepare(
        `SELECT o.*, m.display_name
         FROM occurrences o
         JOIN members m ON m.id = o.accountable_member_id
         WHERE o.id = ?`,
      )
      .get(occurrenceId) as
      | {
          id: string;
          definition_id: string;
          revision_id: string;
          household_date: string;
          title: string;
          accountable_member_id: string;
          display_name: string;
          version: number;
        }
      | undefined;
    if (!row) return null;
    return this.getOccurrenceView(row.definition_id, row.household_date, row.accountable_member_id);
  }

  setStepStatus(
    ctx: SessionContext,
    occurrenceId: string,
    stepId: string,
    input: { mutationId: string; status: StepStatus; performedAt: string },
  ) {
    const receipt = this.db
      .prepare("SELECT response_json FROM mutation_receipts WHERE mutation_id = ?")
      .get(input.mutationId) as { response_json: string } | undefined;
    if (receipt) {
      return JSON.parse(receipt.response_json) as {
        occurrence: OccurrenceView;
        report: Record<string, unknown>;
      };
    }

    const occurrence = this.db
      .prepare("SELECT * FROM occurrences WHERE id = ?")
      .get(occurrenceId) as
      | {
          id: string;
          household_id: string;
          accountable_member_id: string;
          version: number;
        }
      | undefined;
    if (!occurrence || occurrence.household_id !== ctx.householdId) {
      throw Object.assign(new Error("Occurrence not found"), { code: "NOT_FOUND" });
    }

    if (hasCapability(ctx, "manage_routine") && !hasCapability(ctx, "execute_own_occurrence")) {
      throw Object.assign(new Error("Parents observe; they do not complete child work in this slice"), {
        code: "FORBIDDEN",
      });
    }
    if (!hasCapability(ctx, "execute_own_occurrence")) {
      throw Object.assign(new Error("Execution capability required"), { code: "FORBIDDEN" });
    }
    if (occurrence.accountable_member_id !== ctx.memberId) {
      throw Object.assign(new Error("Cannot modify another member's occurrence"), {
        code: "FORBIDDEN",
      });
    }

    const step = this.db
      .prepare("SELECT * FROM occurrence_steps WHERE id = ? AND occurrence_id = ?")
      .get(stepId, occurrenceId) as
      | {
          id: string;
          obligation: ObligationMeaning;
          status: StepStatus;
        }
      | undefined;
    if (!step) {
      throw Object.assign(new Error("Step not found"), { code: "NOT_FOUND" });
    }

    try {
      assertStatusAllowed(step.obligation, input.status);
    } catch {
      throw Object.assign(new Error("Status not allowed for this obligation"), {
        code: "VALIDATION",
      });
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
           (id, mutation_id, occurrence_id, occurrence_step_id, accountable_member_id, acting_member_id, performed_at, recorded_at, resulting_state)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          reportId,
          input.mutationId,
          occurrenceId,
          stepId,
          occurrence.accountable_member_id,
          ctx.memberId,
          input.performedAt,
          recordedAt,
          input.status,
        );

      const view = this.getOccurrenceById(occurrenceId)!;
      const payload = {
        occurrence: view,
        report: {
          id: reportId,
          mutationId: input.mutationId,
          occurrenceId,
          occurrenceStepId: stepId,
          accountableMemberId: occurrence.accountable_member_id,
          actingMemberId: ctx.memberId,
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

  countStepReports(mutationId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as c FROM step_reports WHERE mutation_id = ?")
      .get(mutationId) as { c: number };
    return row.c;
  }

  historyForDate(ctx: SessionContext, householdDate: HouseholdDate): OccurrenceView[] {
    if (!hasCapability(ctx, "manage_routine")) {
      throw Object.assign(new Error("Parent capability required"), { code: "FORBIDDEN" });
    }
    return this.materializeForDate(ctx, householdDate);
  }

  occurrenceSnapshotStructure(occurrenceId: string) {
    const occ = this.db
      .prepare(
        `SELECT id, revision_id, title, schedule_anchor, accountable_member_id, household_date
         FROM occurrences WHERE id = ?`,
      )
      .get(occurrenceId) as
      | {
          id: string;
          revision_id: string;
          title: string;
          schedule_anchor: string;
          accountable_member_id: string;
          household_date: string;
        }
      | undefined;
    if (!occ) return null;
    const steps = this.db
      .prepare(
        `SELECT position, text, obligation FROM occurrence_steps WHERE occurrence_id = ? ORDER BY position`,
      )
      .all(occurrenceId);
    return { ...occ, steps };
  }
}
