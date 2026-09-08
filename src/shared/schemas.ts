import { z } from "zod";

export const ObligationMeaningSchema = z.enum(["required", "as_needed", "optional"]);
export type ObligationMeaning = z.infer<typeof ObligationMeaningSchema>;

export const StepStatusSchema = z.enum(["open", "completed", "not_needed"]);
export type StepStatus = z.infer<typeof StepStatusSchema>;

export const IsoWeekdaySchema = z.number().int().min(1).max(7);
export type IsoWeekday = z.infer<typeof IsoWeekdaySchema>;

export const HouseholdDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const InstantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T.*Z$/, "Expected UTC ISO-8601 ending in Z");

export const UuidSchema = z.string().uuid();

export const GrantSchema = z.enum([
  "household.member.enroll",
  "routine.shared.manage",
  "routine.personalize.direct",
  "routine.personalize.propose",
  "routine.proposal.decide",
  "routine.execute.own",
  "personal_task.create",
]);
export type Grant = z.infer<typeof GrantSchema>;

export const GrantPresetSchema = z.enum([
  "manager",
  "direct_personalizer",
  "proposal_personalizer",
]);
export type GrantPreset = z.infer<typeof GrantPresetSchema>;

export const LoginNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{2,63}$/, "Invalid login name");

export const PassphraseSchema = z.string().min(15).max(128);

export const ChecklistStepInputSchema = z.object({
  text: z.string().trim().min(1),
  obligation: ObligationMeaningSchema,
  logicalItemId: UuidSchema.optional(),
});

export const CreateRoutineSchema = z.object({
  title: z.string().trim().min(1),
  assigneeMemberIds: z.array(UuidSchema).min(1),
  weekdays: z.array(IsoWeekdaySchema).min(1),
  steps: z.array(ChecklistStepInputSchema).min(1),
});

export const CreateRevisionSchema = CreateRoutineSchema.extend({
  effectiveDate: HouseholdDateSchema.optional(),
});

export const SetStepStatusSchema = z.object({
  mutationId: UuidSchema,
  status: StepStatusSchema,
  performedAt: InstantSchema,
});

export const LoginSchema = z.object({
  loginName: LoginNameSchema,
  passphrase: z.string().min(1).max(128),
});

export const ClaimSchema = z.object({
  claimToken: z.string().min(16).max(256),
  loginName: LoginNameSchema,
  passphrase: PassphraseSchema,
  displayName: z.string().trim().min(1).max(80),
});

export const IssueEnrollmentSchema = z.object({
  membershipId: UuidSchema.optional(),
  displayName: z.string().trim().min(1).max(80).optional(),
  preset: GrantPresetSchema,
});

export const PersonalAdditionSchema = z.object({
  text: z.string().trim().min(1),
  obligation: ObligationMeaningSchema,
  anchorLogicalItemId: UuidSchema.nullable().optional(),
  place: z.enum(["before", "after", "end"]).default("end"),
});

export const SavePersonalLayerSchema = z.object({
  additions: z.array(
    z.object({
      id: UuidSchema.optional(),
      text: z.string().trim().min(1),
      obligation: ObligationMeaningSchema,
      anchorLogicalItemId: UuidSchema.nullable().optional(),
      place: z.enum(["before", "after", "end"]).default("end"),
    }),
  ),
  effectiveDate: HouseholdDateSchema.optional(),
});

export const CreateProposalSchema = z.object({
  text: z.string().trim().min(1),
  obligation: ObligationMeaningSchema,
  anchorLogicalItemId: UuidSchema.nullable().optional(),
  place: z.enum(["before", "after", "end"]).default("end"),
});

export const DecideProposalSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
});

export const CreatePersonalTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  visibility: z.enum(["private", "household"]),
});

export const SetPersonalTaskStatusSchema = z.object({
  mutationId: UuidSchema,
  status: z.enum(["open", "completed"]),
});

export type OccurrenceStepView = {
  id: string;
  position: number;
  text: string;
  obligation: ObligationMeaning;
  status: StepStatus;
  source: "shared" | "personal";
  logicalItemId: string | null;
};

export type OccurrenceView = {
  id: string;
  definitionId: string;
  revisionId: string;
  householdDate: string;
  title: string;
  scheduleAnchor: "morning";
  accountableMemberId: string;
  accountableMemberName: string;
  version: number;
  completed: boolean;
  steps: OccurrenceStepView[];
};

export type SyncNotification = {
  type: "household_change";
  householdId: string;
  resource: "occurrence" | "routine" | "proposal" | "personal_task" | "membership";
  resourceId: string;
  version?: number;
  at: string;
};

export type MemberPublic = {
  id: string;
  displayName: string;
  grants: Grant[];
  status: "active" | "pending";
};
