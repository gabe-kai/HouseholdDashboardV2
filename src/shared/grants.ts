import type { Grant, GrantPreset } from "./schemas.js";

/** Essential manager continuity (D-053): enrollment + structure + access + lifecycle. */
export const ESSENTIAL_MANAGER_GRANTS: readonly Grant[] = [
  "household.member.enroll",
  "household.structure.manage",
  "household.access.manage",
  "household.lifecycle.manage",
] as const;

export const MEMBER_DEFAULT_GRANTS: readonly Grant[] = [
  "routine.personalize.propose",
  "routine.execute.own",
  "responsibility.execute.own",
  "personal_task.create",
] as const;

export const MEMBER_DIRECT_GRANTS: readonly Grant[] = [
  "routine.personalize.direct",
  "routine.execute.own",
  "responsibility.execute.own",
  "personal_task.create",
] as const;

/** Closed secondary capabilities editable in the Permissions editor. */
export const SECONDARY_EDITABLE_GRANTS: readonly Grant[] = [
  "household.member.enroll",
  "household.display.manage",
  "household.structure.manage",
  "household.lifecycle.manage",
  "household.access.manage",
  "household.member.remove",
  "household.schedule.manage",
  "household.activity.clear",
  "routine.shared.manage",
  "routine.proposal.decide",
  "responsibility.manage",
] as const;

export const GRANT_PRESETS: Record<GrantPreset, Grant[]> = {
  manager: [
    "household.member.enroll",
    "household.display.manage",
    "household.structure.manage",
    "household.lifecycle.manage",
    "household.access.manage",
    "household.member.remove",
    "household.schedule.manage",
    "household.activity.clear",
    "routine.shared.manage",
    "routine.proposal.decide",
    "routine.execute.own",
    "responsibility.manage",
    "responsibility.execute.own",
    "personal_task.create",
  ],
  direct_personalizer: [...MEMBER_DIRECT_GRANTS],
  proposal_personalizer: [...MEMBER_DEFAULT_GRANTS],
};

export function mapLegacyCapabilities(capabilitiesJson: string): Grant[] {
  const caps = JSON.parse(capabilitiesJson) as string[];
  if (caps.includes("manage_routine")) {
    return [...GRANT_PRESETS.manager];
  }
  return [...GRANT_PRESETS.direct_personalizer];
}

export function hasAllGrants(
  grants: readonly string[],
  required: readonly string[],
): boolean {
  const set = new Set(grants);
  return required.every((g) => set.has(g));
}

export function isEssentialManagerGrants(grants: readonly string[]): boolean {
  return hasAllGrants(grants, ESSENTIAL_MANAGER_GRANTS);
}

export type DerivedRoleLabel = "manager" | "member" | "customized";

export function deriveRoleLabel(grants: readonly string[]): DerivedRoleLabel {
  const set = new Set(grants);
  const managerSet = new Set(GRANT_PRESETS.manager);
  const memberDefault = new Set(MEMBER_DEFAULT_GRANTS);
  const memberDirect = new Set(MEMBER_DIRECT_GRANTS);

  const sameAs = (target: Set<string>) =>
    set.size === target.size && [...set].every((g) => target.has(g));

  if (sameAs(managerSet)) return "manager";
  if (sameAs(memberDefault) || sameAs(memberDirect)) return "member";
  // Full manager bundle (order-insensitive) already handled; essential-only custom
  // manager edits that stay within the closed manager set still label as manager.
  if (
    isEssentialManagerGrants(grants) &&
    [...set].every((g) => managerSet.has(g as Grant))
  ) {
    return "manager";
  }
  if (
    set.has("routine.execute.own") &&
    set.has("responsibility.execute.own") &&
    set.has("personal_task.create") &&
    (set.has("routine.personalize.propose") !== set.has("routine.personalize.direct")) &&
    !set.has("household.member.enroll") &&
    !set.has("household.structure.manage") &&
    !set.has("household.access.manage")
  ) {
    return "member";
  }
  return "customized";
}

export function memberModeFromGrants(
  grants: readonly string[],
): "approval" | "direct" | null {
  const hasPropose = grants.includes("routine.personalize.propose");
  const hasDirect = grants.includes("routine.personalize.direct");
  if (hasDirect && !hasPropose) return "direct";
  if (hasPropose && !hasDirect) return "approval";
  return null;
}

/** Build Member grants for approval or direct personalization (mutually exclusive). */
export function buildMemberGrants(mode: "approval" | "direct"): Grant[] {
  return mode === "direct" ? [...MEMBER_DIRECT_GRANTS] : [...MEMBER_DEFAULT_GRANTS];
}

export function buildManagerGrants(): Grant[] {
  return [...GRANT_PRESETS.manager];
}

/**
 * Merge a role base with secondary grant toggles. Unknown legacy grants outside
 * the closed editor set are preserved unchanged.
 */
export function mergePermissionGrants(input: {
  role: "manager" | "member";
  memberMode?: "approval" | "direct";
  secondaryGrants: readonly string[];
  priorGrants: readonly string[];
  knownGrants: readonly string[];
}): string[] {
  const base =
    input.role === "manager"
      ? buildManagerGrants()
      : buildMemberGrants(input.memberMode ?? "approval");
  const known = new Set(input.knownGrants);
  const secondaryAllowed = new Set(SECONDARY_EDITABLE_GRANTS);
  const secondary = input.secondaryGrants.filter((g) => secondaryAllowed.has(g as Grant));
  const preservedLegacy = input.priorGrants.filter((g) => !known.has(g));
  const merged = new Set<string>([...base, ...secondary, ...preservedLegacy]);
  // Member role: strip exclusive opposite personalize mode.
  if (input.role === "member") {
    if (input.memberMode === "direct") merged.delete("routine.personalize.propose");
    else merged.delete("routine.personalize.direct");
  }
  return [...merged].sort();
}
