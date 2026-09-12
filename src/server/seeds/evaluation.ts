import type { GrantPreset } from "../../shared/schemas.js";

/**
 * Canonical explicit demo/test fixture — fictional only.
 * Applied by `npm run db:seed` or `AUTO_SEED=1` (opt-in). Never by normal bootstrap.
 */
export const SEED = {
  household: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Reed Household",
  },
  members: [
    {
      id: "22222222-2222-4222-8222-222222222201",
      displayName: "Morgan Reed",
      preset: "manager" as const satisfies GrantPreset,
    },
    {
      id: "22222222-2222-4222-8222-222222222202",
      displayName: "Avery Reed",
      preset: "direct_personalizer" as const satisfies GrantPreset,
    },
    {
      id: "22222222-2222-4222-8222-222222222203",
      displayName: "Jordan Reed",
      preset: "direct_personalizer" as const satisfies GrantPreset,
    },
    {
      id: "22222222-2222-4222-8222-222222222204",
      displayName: "Casey Reed",
      preset: "proposal_personalizer" as const satisfies GrantPreset,
    },
    {
      id: "22222222-2222-4222-8222-222222222205",
      displayName: "Taylor Reed",
      preset: "proposal_personalizer" as const satisfies GrantPreset,
    },
    {
      id: "22222222-2222-4222-8222-222222222206",
      displayName: "Rowan Reed",
      preset: "proposal_personalizer" as const satisfies GrantPreset,
    },
  ],
} as const;

export type FixtureMemberId = (typeof SEED.members)[number]["id"];

export const FIXTURE_MEMBER_IDS: readonly string[] = SEED.members.map((m) => m.id);

/** P0-001 legacy capability JSON derived from the member's grant preset. */
export function legacyCapabilitiesJson(preset: GrantPreset): string {
  return JSON.stringify(
    preset === "manager"
      ? ["manage_routine", "execute_own_occurrence"]
      : ["execute_own_occurrence"],
  );
}
