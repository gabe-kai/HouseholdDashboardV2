import { createHash } from "node:crypto";
import type {
  AssignmentSpec,
  ObligationMeaning,
  ScheduledAdditionSpec,
} from "../shared/schemas.js";
import {
  resolveAssignmentOwner,
  type AssignmentResolution,
  type MemberEligibility,
  type RingResolver,
} from "./responsibility-assignment.js";
import { isDateApplicable } from "./recurrence.js";
import type { HouseholdDate } from "./time.js";

export type { ScheduledAdditionSpec };

export type ComposedStep = {
  logicalItemId: string;
  text: string;
  obligation: ObligationMeaning;
  additionId: string | null;
  additionHeading: string | null;
  source: "base" | "addition";
};

export type CompositionResult = {
  applicable: boolean;
  accountableMemberId: string | null;
  unassignedReason: string | null;
  steps: ComposedStep[];
  structureFingerprint: string;
  applicableAdditionIds: string[];
};

export type OverlapConflict = {
  additionAId: string;
  additionAName: string;
  additionBId: string;
  additionBName: string;
  weekdays: number[];
};

function intersectWeekdays(a: number[], b: number[]): number[] {
  const setB = new Set(b);
  return a.filter((d) => setB.has(d));
}

export function findOwnerSettingOverlap(
  parentWeekdays: number[],
  additions: ScheduledAdditionSpec[],
): OverlapConflict | null {
  const ownerSetting = additions.filter((a) => !a.inheritAssignment);
  for (let i = 0; i < ownerSetting.length; i += 1) {
    for (let j = i + 1; j < ownerSetting.length; j += 1) {
      const left = ownerSetting[i]!;
      const right = ownerSetting[j]!;
      const leftDays = intersectWeekdays(parentWeekdays, left.weekdays);
      const overlap = intersectWeekdays(leftDays, right.weekdays);
      if (overlap.length > 0) {
        return {
          additionAId: left.id ?? left.name,
          additionAName: left.name,
          additionBId: right.id ?? right.name,
          additionBName: right.name,
          weekdays: overlap,
        };
      }
    }
  }
  return null;
}

export function validateAdditionWeekdays(
  parentWeekdays: number[],
  addition: ScheduledAdditionSpec,
): string | null {
  const overlap = intersectWeekdays(parentWeekdays, addition.weekdays);
  if (overlap.length === 0) {
    return `Scheduled work "${addition.name}" does not overlap parent recurrence`;
  }
  return null;
}

function fingerprintParts(
  revisionId: string,
  ownerId: string | null,
  steps: ComposedStep[],
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        revisionId,
        ownerId,
        steps: steps.map((s) => ({
          logicalItemId: s.logicalItemId,
          text: s.text,
          obligation: s.obligation,
          additionId: s.additionId,
          additionHeading: s.additionHeading,
        })),
      }),
      "utf8",
    )
    .digest("hex");
}

export function composeResponsibilityForDate(input: {
  householdDate: HouseholdDate;
  revisionId: string;
  parentWeekdays: number[];
  baseSteps: Array<{
    logicalItemId: string;
    text: string;
    obligation: ObligationMeaning;
  }>;
  baseAssignment: AssignmentSpec;
  additions: ScheduledAdditionSpec[];
  resolveRing: RingResolver;
  isEligible: MemberEligibility;
}): CompositionResult {
  const {
    householdDate,
    revisionId,
    parentWeekdays,
    baseSteps,
    baseAssignment,
    additions,
    resolveRing,
    isEligible,
  } = input;

  if (!isDateApplicable(householdDate, parentWeekdays)) {
    return {
      applicable: false,
      accountableMemberId: null,
      unassignedReason: null,
      steps: [],
      structureFingerprint: fingerprintParts(revisionId, null, []),
      applicableAdditionIds: [],
    };
  }

  const baseOwner: AssignmentResolution = resolveAssignmentOwner(
    householdDate,
    parentWeekdays,
    baseAssignment,
    resolveRing,
    isEligible,
  );

  const sortedAdditions = [...additions].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );
  const applicableAdditions = sortedAdditions.filter((addition) =>
    isDateApplicable(householdDate, intersectWeekdays(parentWeekdays, addition.weekdays)),
  );

  let finalOwner = baseOwner.accountableMemberId;
  let unassignedReason = baseOwner.unassignedReason;

  const ownerOverride = applicableAdditions.find((a) => !a.inheritAssignment);
  if (ownerOverride?.assignment) {
    const additionWeekdays = intersectWeekdays(parentWeekdays, ownerOverride.weekdays);
    const override = resolveAssignmentOwner(
      householdDate,
      additionWeekdays,
      ownerOverride.assignment,
      resolveRing,
      isEligible,
    );
    finalOwner = override.accountableMemberId;
    unassignedReason = override.unassignedReason;
  }

  const steps: ComposedStep[] = baseSteps.map((step) => ({
    logicalItemId: step.logicalItemId,
    text: step.text,
    obligation: step.obligation,
    additionId: null,
    additionHeading: null,
    source: "base",
  }));

  for (const addition of applicableAdditions) {
    for (const step of addition.steps) {
      steps.push({
        logicalItemId: step.logicalItemId ?? step.text,
        text: step.text,
        obligation: step.obligation,
        additionId: addition.id ?? null,
        additionHeading: addition.name,
        source: "addition",
      });
    }
  }

  return {
    applicable: true,
    accountableMemberId: finalOwner,
    unassignedReason: finalOwner ? null : unassignedReason,
    steps,
    structureFingerprint: fingerprintParts(revisionId, finalOwner, steps),
    applicableAdditionIds: applicableAdditions
      .map((a) => a.id)
      .filter((id): id is string => typeof id === "string"),
  };
}
