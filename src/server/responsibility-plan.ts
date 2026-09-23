import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { ObligationMeaning } from "../shared/schemas.js";
import {
  buildGroupBackedRing,
  type RingResolver,
} from "../domain/responsibility-assignment.js";
import {
  composeResponsibilityForDate,
  findOwnerSettingOverlap,
  validateAdditionWeekdays,
} from "../domain/responsibility-composition.js";
import type { AssignmentSpec, ScheduledAdditionSpec } from "../shared/schemas.js";
import { compareHouseholdDates, type HouseholdDate } from "../domain/time.js";

export type StoredResponsibilityPlan = {
  assignment: AssignmentSpec;
  scheduledAdditions: ScheduledAdditionSpec[];
};

export type ResponsibilityPlanInput = {
  assignment: AssignmentSpec;
  scheduledAdditions?: ScheduledAdditionSpec[];
};

const DEFAULT_ASSIGNMENT = (anchorDate: string, fixedMemberId: string): AssignmentSpec => ({
  mode: "fixed",
  anchorDate,
  fixedMemberId,
  cycleOrder: [],
  weeklyMap: {},
  excludedMemberIds: [],
  savedRingOrder: [],
});

export function normalizeAssignmentInput(
  input: {
    accountableMemberId?: string;
    assignment?: AssignmentSpec;
  },
  anchorDate: HouseholdDate,
): AssignmentSpec {
  if (input.assignment) return input.assignment;
  if (input.accountableMemberId) {
    return DEFAULT_ASSIGNMENT(anchorDate, input.accountableMemberId);
  }
  throw new Error("assignment or accountableMemberId required");
}

export function loadResponsibilityPlan(
  db: Database.Database,
  revisionId: string,
): StoredResponsibilityPlan | null {
  const row = db
    .prepare(
      `SELECT assignment_json, scheduled_additions_json
       FROM revision_responsibility_plans WHERE revision_id = ?`,
    )
    .get(revisionId) as
    | { assignment_json: string; scheduled_additions_json: string }
    | undefined;
  if (!row) return null;
  const assignment = JSON.parse(row.assignment_json) as AssignmentSpec;
  const raw = JSON.parse(row.scheduled_additions_json) as ScheduledAdditionSpec[];
  const scheduledAdditions = raw
    .map((addition, index) => ({ ...addition, position: addition.position ?? index }))
    .sort((a, b) => a.position - b.position);
  return { assignment, scheduledAdditions };
}

export function insertResponsibilityPlan(
  db: Database.Database,
  revisionId: string,
  plan: StoredResponsibilityPlan,
): void {
  db.prepare(
    `INSERT INTO revision_responsibility_plans
       (revision_id, assignment_json, scheduled_additions_json)
     VALUES (?, ?, ?)`,
  ).run(revisionId, JSON.stringify(plan.assignment), JSON.stringify(plan.scheduledAdditions));
}

/** When a schedule boundary that introduced a cycle moves, keep that cycle's anchors with it. */
export function shiftPlanAnchorsForBoundaryMove(
  plan: StoredResponsibilityPlan,
  oldBoundaryDate: HouseholdDate,
  newBoundaryDate: HouseholdDate,
): StoredResponsibilityPlan {
  if (oldBoundaryDate === newBoundaryDate) return plan;
  const shift = (assignment: AssignmentSpec | undefined): AssignmentSpec | undefined => {
    if (!assignment) return assignment;
    if (assignment.anchorDate !== oldBoundaryDate) return assignment;
    return { ...assignment, anchorDate: newBoundaryDate };
  };
  return {
    assignment: shift(plan.assignment)!,
    scheduledAdditions: plan.scheduledAdditions.map((addition) => ({
      ...addition,
      assignment: shift(addition.assignment),
    })),
  };
}

export function updateResponsibilityPlan(
  db: Database.Database,
  revisionId: string,
  plan: StoredResponsibilityPlan,
): void {
  db.prepare(
    `UPDATE revision_responsibility_plans
     SET assignment_json = ?, scheduled_additions_json = ?
     WHERE revision_id = ?`,
  ).run(JSON.stringify(plan.assignment), JSON.stringify(plan.scheduledAdditions), revisionId);
}

export function normalizeScheduledAdditions(
  additions: ScheduledAdditionSpec[] | undefined,
  _previous: ScheduledAdditionSpec[],
): ScheduledAdditionSpec[] {
  return (additions ?? []).map((addition, index) => ({
    ...addition,
    id: addition.id ?? randomUUID(),
    position: addition.position ?? index,
    steps: addition.steps.map((step) => ({
      ...step,
      logicalItemId: step.logicalItemId ?? randomUUID(),
    })),
  }));
}

export type PlanValidationContext = {
  householdId: string;
  parentWeekdays: number[];
  effectiveDate: HouseholdDate;
};

export function validateResponsibilityPlan(
  ctx: PlanValidationContext,
  plan: StoredResponsibilityPlan,
  membershipExists: (memberId: string) => boolean,
  groupExists: (groupId: string) => boolean,
): void {
  const { assignment, scheduledAdditions } = plan;
  if (assignment.mode === "fixed") {
    if (!assignment.fixedMemberId) throw Object.assign(new Error("Fixed assignment requires a person"), { code: "VALIDATION" });
    if (!membershipExists(assignment.fixedMemberId)) {
      throw Object.assign(new Error("Fixed assignee is not a household membership"), { code: "VALIDATION" });
    }
  }
  if (assignment.mode === "take_turns") {
    const order = assignment.cycleOrder ?? [];
    if (!assignment.sourceGroupId && order.length === 0) {
      throw Object.assign(new Error("Take turns requires people or a group"), { code: "VALIDATION" });
    }
    if (new Set(order).size !== order.length) {
      throw Object.assign(new Error("Each person may appear once in the turn order"), { code: "VALIDATION" });
    }
    for (const id of order) {
      if (!membershipExists(id)) {
        throw Object.assign(new Error("Turn order includes an unknown membership"), { code: "VALIDATION" });
      }
    }
  }
  if (assignment.mode === "weekly") {
    const map = assignment.weeklyMap ?? {};
    for (let day = 1; day <= 7; day += 1) {
      if (!map[day]) {
        throw Object.assign(new Error("Weekly pattern must assign all seven weekdays"), { code: "VALIDATION" });
      }
      if (!membershipExists(map[day]!)) {
        throw Object.assign(new Error("Weekly pattern includes an unknown membership"), { code: "VALIDATION" });
      }
    }
  }
  if (assignment.sourceGroupId && !groupExists(assignment.sourceGroupId)) {
    throw Object.assign(new Error("Assignment group not found"), { code: "VALIDATION" });
  }
  for (const addition of scheduledAdditions) {
    const err = validateAdditionWeekdays(ctx.parentWeekdays, addition);
    if (err) throw Object.assign(new Error(err), { code: "VALIDATION" });
    if (!addition.inheritAssignment && !addition.assignment) {
      throw Object.assign(new Error(`Scheduled work "${addition.name}" needs its own assignment`), {
        code: "VALIDATION",
      });
    }
  }
  const overlap = findOwnerSettingOverlap(ctx.parentWeekdays, scheduledAdditions);
  if (overlap) {
    throw Object.assign(
      new Error(
        `Scheduled work "${overlap.additionAName}" and "${overlap.additionBName}" both set ownership on overlapping days`,
      ),
      { code: "VALIDATION", overlap },
    );
  }
}

export type CompositionDeps = {
  groupMembersOnDate: (groupId: string, date: HouseholdDate) => string[];
  memberFirstAdmission: (groupId: string, memberId: string) => HouseholdDate | null;
  isMemberEligible: (memberId: string, date: HouseholdDate) => boolean;
};

function makeRingResolver(deps: CompositionDeps): RingResolver {
  return (date, spec) => {
    if (spec.mode === "take_turns" && spec.cycleOrder?.length) {
      return spec.cycleOrder;
    }
    if (spec.sourceGroupId) {
      const members = deps.groupMembersOnDate(spec.sourceGroupId, date);
      return buildGroupBackedRing(
        date,
        spec.savedRingOrder ?? [],
        members,
        (memberId) => deps.memberFirstAdmission(spec.sourceGroupId!, memberId),
      );
    }
    return spec.savedRingOrder ?? spec.cycleOrder ?? [];
  };
}

export function resolveResponsibilityComposition(
  input: {
    householdDate: HouseholdDate;
    revisionId: string;
    parentWeekdays: number[];
    baseSteps: Array<{
      logicalItemId: string;
      text: string;
      obligation: ObligationMeaning;
    }>;
    plan: StoredResponsibilityPlan;
  },
  deps: CompositionDeps,
) {
  return composeResponsibilityForDate({
    ...input,
    baseAssignment: input.plan.assignment,
    additions: input.plan.scheduledAdditions,
    resolveRing: makeRingResolver(deps),
    isEligible: deps.isMemberEligible,
  });
}

export function assignmentUsesGroup(plan: StoredResponsibilityPlan): string[] {
  const ids = new Set<string>();
  if (plan.assignment.sourceGroupId) ids.add(plan.assignment.sourceGroupId);
  for (const addition of plan.scheduledAdditions) {
    if (addition.assignment?.sourceGroupId) ids.add(addition.assignment.sourceGroupId);
  }
  return [...ids];
}

export function isPlanEffectiveOnOrAfter(planAnchor: HouseholdDate, date: HouseholdDate): boolean {
  return compareHouseholdDates(date, planAnchor) >= 0;
}
