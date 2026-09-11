import type { Grant, GrantPreset } from "./schemas.js";

export const GRANT_PRESETS: Record<GrantPreset, Grant[]> = {
  manager: [
    "household.member.enroll",
    "household.structure.manage",
    "routine.shared.manage",
    "routine.proposal.decide",
    "routine.execute.own",
    "personal_task.create",
  ],
  direct_personalizer: [
    "routine.personalize.direct",
    "routine.execute.own",
    "personal_task.create",
  ],
  proposal_personalizer: [
    "routine.personalize.propose",
    "routine.execute.own",
    "personal_task.create",
  ],
};

export function mapLegacyCapabilities(capabilitiesJson: string): Grant[] {
  const caps = JSON.parse(capabilitiesJson) as string[];
  if (caps.includes("manage_routine")) {
    return [...GRANT_PRESETS.manager];
  }
  return [...GRANT_PRESETS.direct_personalizer];
}
