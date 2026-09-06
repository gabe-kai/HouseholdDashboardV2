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

export const CapabilitySchema = z.enum(["manage_routine", "execute_own_occurrence"]);
export type Capability = z.infer<typeof CapabilitySchema>;

export const MemberPublicSchema = z.object({
  id: UuidSchema,
  displayName: z.string().min(1),
  capabilities: z.array(CapabilitySchema),
});

export const CreateSessionSchema = z.object({
  memberId: UuidSchema,
});

export const ChecklistStepInputSchema = z.object({
  text: z.string().trim().min(1),
  obligation: ObligationMeaningSchema,
});

export const CreateRoutineSchema = z.object({
  title: z.string().trim().min(1),
  assigneeMemberIds: z.array(UuidSchema).min(1),
  weekdays: z.array(IsoWeekdaySchema).min(1),
  steps: z.array(ChecklistStepInputSchema).min(1),
});

export const CreateRevisionSchema = z.object({
  title: z.string().trim().min(1),
  assigneeMemberIds: z.array(UuidSchema).min(1),
  weekdays: z.array(IsoWeekdaySchema).min(1),
  steps: z.array(ChecklistStepInputSchema).min(1),
  effectiveDate: HouseholdDateSchema.optional(),
});

export const SetStepStatusSchema = z.object({
  mutationId: UuidSchema,
  status: StepStatusSchema,
  performedAt: InstantSchema,
});

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.string(),
});

export type MemberPublic = z.infer<typeof MemberPublicSchema>;

export type OccurrenceStepView = {
  id: string;
  position: number;
  text: string;
  obligation: ObligationMeaning;
  status: StepStatus;
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
  resource: "occurrence" | "routine";
  resourceId: string;
  version?: number;
  at: string;
};
