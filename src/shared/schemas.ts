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
  "household.structure.manage",
  "household.schedule.manage",
  "household.activity.clear",
  "routine.shared.manage",
  "routine.personalize.direct",
  "routine.personalize.propose",
  "routine.proposal.decide",
  "routine.execute.own",
  "responsibility.manage",
  "responsibility.execute.own",
  "personal_task.create",
]);
export type Grant = z.infer<typeof GrantSchema>;

export const WorkKindSchema = z.enum(["routine", "responsibility"]);
export type WorkKind = z.infer<typeof WorkKindSchema>;

/** Scope acknowledgment for Clear activity history (D-037). */
export const ActivityClearScopeSchema = z.enum(["routines_and_responsibilities"]);
export type ActivityClearScope = z.infer<typeof ActivityClearScopeSchema>;

/**
 * Structural identity the actor intended for a responsibility checklist command.
 * Distinct from status version; rejects stale owner/work after plan races (D-036).
 */
export const IntendedStructureSchema = z.object({
  revisionId: UuidSchema,
  accountableMemberId: UuidSchema,
  stepLogicalIds: z.array(UuidSchema),
});
export type IntendedStructure = z.infer<typeof IntendedStructureSchema>;

export const PersonClassificationSchema = z.enum(["adult", "child"]);
export type PersonClassification = z.infer<typeof PersonClassificationSchema>;

export const AccessStateSchema = z.enum([
  "not_set_up",
  "setup_ready",
  "setup_expired",
  "access_set_up",
]);
export type AccessState = z.infer<typeof AccessStateSchema>;

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

export const DaypartSchema = z.enum([
  "morning",
  "after_school",
  "evening",
  "bedtime",
  "anytime",
]);
export type Daypart = z.infer<typeof DaypartSchema>;

export const ApplicabilityRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("every_time") }),
  z.object({ kind: z.literal("school_days") }),
  z.object({ kind: z.literal("no_school_days") }),
  z.object({ kind: z.literal("school_nights") }),
  z.object({ kind: z.literal("weekdays") }),
  z.object({ kind: z.literal("weekends") }),
  z.object({
    kind: z.literal("selected_days"),
    weekdays: z.array(IsoWeekdaySchema).min(1),
  }),
]);
export type ApplicabilityRule = z.infer<typeof ApplicabilityRuleSchema>;

export const ChecklistStepInputSchema = z.object({
  text: z.string().trim().min(1),
  obligation: ObligationMeaningSchema,
  logicalItemId: UuidSchema.optional(),
  /** Omitted on legacy clients → Every time for new content; never silently clears stored nondefault. */
  applicability: ApplicabilityRuleSchema.optional(),
});

const CreateRoutineFieldsSchema = z.object({
  mutationId: UuidSchema,
  title: z.string().trim().min(1),
  daypart: DaypartSchema.default("anytime"),
  assigneeMemberIds: z.array(UuidSchema).default([]),
  assigneeGroupIds: z.array(UuidSchema).default([]),
  weekdays: z.array(IsoWeekdaySchema).min(1),
  steps: z.array(ChecklistStepInputSchema).min(1),
  expectedVersion: z.number().int().positive().optional(),
});

const atLeastOneAudienceSource = (
  data: { assigneeMemberIds: string[]; assigneeGroupIds: string[] },
  ctx: z.RefinementCtx,
) => {
  if (data.assigneeMemberIds.length === 0 && data.assigneeGroupIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one person or group is required",
      path: ["assigneeMemberIds"],
    });
  }
};

export const CreateRoutineSchema = CreateRoutineFieldsSchema.superRefine(atLeastOneAudienceSource);

export const CreateRevisionSchema = CreateRoutineFieldsSchema.extend({
  effectiveDate: HouseholdDateSchema.optional(),
  /** current = refine live plan; schedule = create/edit upcoming boundary */
  mode: z.enum(["current", "schedule"]).optional(),
  /** When mode=schedule, edit this upcoming entry instead of creating */
  scheduleEntryId: UuidSchema.optional(),
}).superRefine(atLeastOneAudienceSource);

const baseResponsibilityStepsOnly = (
  steps: Array<{ applicability?: ApplicabilityRule }>,
  ctx: z.RefinementCtx,
) => {
  for (let i = 0; i < steps.length; i += 1) {
    const rule = steps[i]?.applicability;
    if (rule && rule.kind !== "every_time") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Responsibility steps must use every-time applicability",
        path: ["steps", i, "applicability"],
      });
    }
  }
};

const CreateResponsibilityFieldsSchema = z
  .object({
    mutationId: UuidSchema,
    title: z.string().trim().min(1),
    daypart: DaypartSchema.default("anytime"),
    accountableMemberId: UuidSchema,
    weekdays: z.array(IsoWeekdaySchema).min(1),
    steps: z.array(ChecklistStepInputSchema).min(1),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();

export const CreateResponsibilitySchema = CreateResponsibilityFieldsSchema.superRefine(
  (data, ctx) => baseResponsibilityStepsOnly(data.steps, ctx),
);

export const CreateResponsibilityRevisionSchema = CreateResponsibilityFieldsSchema.extend({
  effectiveDate: HouseholdDateSchema.optional(),
  mode: z.enum(["current", "schedule"]).optional(),
  scheduleEntryId: UuidSchema.optional(),
})
  .strict()
  .superRefine((data, ctx) => baseResponsibilityStepsOnly(data.steps, ctx));

export const ArchiveRoutineSchema = z.object({
  mutationId: UuidSchema,
  expectedVersion: z.number().int().positive(),
});

export const EndRoutineSchema = z.object({
  mutationId: UuidSchema,
  expectedVersion: z.number().int().positive(),
});

export const DeleteRoutineSchema = z.object({
  mutationId: UuidSchema,
  expectedVersion: z.number().int().positive(),
});

export const EndResponsibilitySchema = EndRoutineSchema;
export const DeleteResponsibilitySchema = DeleteRoutineSchema;

export const DeleteScheduleEntrySchema = z.object({
  mutationId: UuidSchema,
  expectedVersion: z.number().int().positive(),
});

export const MoveScheduleEntrySchema = z.object({
  mutationId: UuidSchema,
  expectedVersion: z.number().int().positive(),
  startDate: HouseholdDateSchema,
});

export const SetStepStatusSchema = z.object({
  mutationId: UuidSchema,
  status: StepStatusSchema,
  performedAt: InstantSchema,
  /** Household activity generation; omitted only valid when generation is still 0. */
  activityGeneration: z.number().int().nonnegative().optional(),
  /** Optional work kind; when present must match stored occurrence kind. */
  kind: WorkKindSchema.optional(),
  /**
   * Required for responsibility first-action safety: revision + owner + step logical IDs.
   * Routines may omit; mismatched responsibility intent is rejected.
   */
  intendedStructure: IntendedStructureSchema.optional(),
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
  mutationId: UuidSchema,
  membershipId: UuidSchema,
  preset: GrantPresetSchema,
});

export const CreatePersonSchema = z.object({
  mutationId: UuidSchema,
  displayName: z.string().trim().min(1).max(80),
  classification: PersonClassificationSchema,
});

export const UpdatePersonSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  classification: PersonClassificationSchema.nullable(),
  fullName: z.string().max(120).nullable().optional(),
  birthday: HouseholdDateSchema.nullable().optional(),
  email: z.string().max(254).nullable().optional(),
  expectedVersion: z.number().int().positive(),
});

export const SaveFamilyOrderSchema = z.object({
  mutationId: UuidSchema,
  expectedVersion: z.number().int().nonnegative(),
  membershipIds: z.array(UuidSchema).min(1),
});
export type SaveFamilyOrderInput = z.infer<typeof SaveFamilyOrderSchema>;

export const ClearRoutineActivitySchema = z.object({
  mutationId: UuidSchema,
  expectedGeneration: z.number().int().nonnegative(),
  /**
   * New clears must acknowledge routines + responsibilities.
   * Omitted = legacy routine-only request (rejected when responsibility data exists).
   */
  acknowledgedScope: ActivityClearScopeSchema.optional(),
});
export type ClearRoutineActivityInput = z.infer<typeof ClearRoutineActivitySchema>;

export const CreateGroupSchema = z.object({
  mutationId: UuidSchema,
  name: z.string().trim().min(1).max(80),
  membershipIds: z.array(UuidSchema).default([]),
});

export const UpdateGroupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  membershipIds: z.array(UuidSchema),
  expectedVersion: z.number().int().positive(),
});

export const PersonalAdditionSchema = z.object({
  text: z.string().trim().min(1),
  obligation: ObligationMeaningSchema,
  anchorLogicalItemId: UuidSchema.nullable().optional(),
  place: z.enum(["before", "after", "end"]).default("end"),
  applicability: ApplicabilityRuleSchema.optional(),
});

export const SavePersonalLayerSchema = z.object({
  definitionId: UuidSchema,
  additions: z.array(
    z.object({
      id: UuidSchema.optional(),
      text: z.string().trim().min(1),
      obligation: ObligationMeaningSchema,
      anchorLogicalItemId: UuidSchema.nullable().optional(),
      place: z.enum(["before", "after", "end"]).default("end"),
      applicability: ApplicabilityRuleSchema.optional(),
    }),
  ),
  effectiveDate: HouseholdDateSchema.optional(),
});

export const CreateProposalSchema = z.object({
  definitionId: UuidSchema,
  text: z.string().trim().min(1),
  obligation: ObligationMeaningSchema,
  anchorLogicalItemId: UuidSchema.nullable().optional(),
  place: z.enum(["before", "after", "end"]).default("end"),
  applicability: ApplicabilityRuleSchema.optional(),
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
  applicability?: ApplicabilityRule;
  applicabilityReason?: string | null;
};

export type OccurrenceView = {
  id: string;
  definitionId: string;
  revisionId: string;
  householdDate: string;
  title: string;
  daypart: Daypart;
  /** @deprecated use daypart; retained for transitional clients */
  scheduleAnchor?: Daypart;
  accountableMemberId: string;
  accountableMemberName: string;
  version: number;
  /** Set on first locking checklist action; never cleared (D-023 / D-036). */
  startedAt: string | null;
  completed: boolean;
  /** Closed work kind; missing on legacy clients normalizes to routine. */
  kind: WorkKind;
  steps: OccurrenceStepView[];
  calendarEditionId?: string | null;
  calendarProvenance?: "legacy" | "unconfigured" | "edition";
};

/** Compact History list row (no steps/reports). */
export type HistoryOccurrenceSummary = {
  id: string;
  definitionId: string;
  title: string;
  daypart: Daypart;
  accountableMemberId: string;
  accountableMemberName: string;
  householdDate: string;
  completed: boolean;
  startedAt: string | null;
  kind: WorkKind;
  counts: {
    completed: number;
    notNeeded: number;
    open: number;
  };
};

export type StepReportPublic = {
  id: string;
  mutationId: string;
  occurrenceId: string;
  occurrenceStepId: string;
  accountableMemberId: string;
  actingMemberId: string;
  actingMemberName: string | null;
  /** Actual performer when recorded; null for legacy unknown. */
  performerMemberId: string | null;
  performedAt: string;
  recordedAt: string;
  resultingState: StepStatus;
};

export type HistoryOccurrenceDetail = OccurrenceView & {
  reports: StepReportPublic[];
};

export type SyncNotification = {
  type: "household_change";
  householdId: string;
  resource:
    | "occurrence"
    | "routine"
    | "responsibility"
    | "proposal"
    | "personal_task"
    | "membership"
    | "group"
    | "school_calendar"
    | "family_order"
    | "activity_reset";
  resourceId: string;
  version?: number;
  at: string;
};

export const SchoolExceptionSchema = z.object({
  id: UuidSchema.optional(),
  name: z.string().trim().min(1).max(120),
  startDate: HouseholdDateSchema,
  endDate: HouseholdDateSchema,
});

export const SchoolYearSchema = z.object({
  id: UuidSchema.optional(),
  startDate: HouseholdDateSchema,
  endDate: HouseholdDateSchema,
  usualWeekdays: z.array(IsoWeekdaySchema).min(1),
  exceptions: z.array(SchoolExceptionSchema).default([]),
});

export const SaveSchoolCalendarSchema = z.object({
  mutationId: UuidSchema,
  expectedVersion: z.number().int().nonnegative(),
  years: z.array(SchoolYearSchema).min(1),
});
export type SaveSchoolCalendarInput = z.infer<typeof SaveSchoolCalendarSchema>;

export type SchoolCalendarPublic = {
  configured: boolean;
  version: number;
  editionId: string | null;
  effectiveFrom: string | null;
  years: Array<{
    id: string;
    startDate: string;
    endDate: string;
    usualWeekdays: number[];
    exceptions: Array<{
      id: string;
      name: string;
      startDate: string;
      endDate: string;
    }>;
  }>;
};

export type MemberPublic = {
  id: string;
  displayName: string;
  grants: Grant[];
  status: "active" | "pending";
  classification: PersonClassification | null;
  accessState: AccessState;
  version: number;
  /** Household-wide peer order (0-based). */
  sortOrder: number;
};

export type FamilyOrderSaveResult = {
  version: number;
  people: MemberPublic[];
};

export type ActivityClearResult = {
  activityGeneration: number;
  activityResetFloor: string;
  counts: {
    occurrences: number;
    occurrenceSteps: number;
    stepReports: number;
    mutationReceipts: number;
  };
};

export type PersonDetail = MemberPublic & {
  fullName: string | null;
  birthday: string | null;
  email: string | null;
  groups: Array<{ id: string; name: string }>;
  routines: Array<{
    definitionId: string;
    title: string;
    daypart: Daypart;
    currentlyAssigned: boolean;
    source: "direct" | "group" | "both";
    effectiveDate: string | null;
  }>;
  /** @deprecated singular Morning projection; prefer routines[] */
  morningRoutine?: {
    currentlyAssigned: boolean;
    revisionId: string | null;
    revisionTitle: string | null;
    effectiveDate: string | null;
  };
  access: {
    state: AccessState;
    setupClaimId: string | null;
    setupCreatedAt: string | null;
    setupExpiresAt: string | null;
  };
};

export type GroupRoutineReference = {
  definitionId: string;
  title: string;
  daypart: Daypart;
  archived: boolean;
  effectFromDate: string | null;
};

export type GroupPublic = {
  id: string;
  name: string;
  version: number;
  membershipIds: string[];
  effectiveMembershipIds: string[];
  membershipPendingFromDate?: string | null;
  createdAt: string;
  updatedAt: string;
  usedByRoutines?: GroupRoutineReference[];
  /** @deprecated prefer usedByRoutines */
  usedByMorningRoutine?: boolean;
  routineEffectFromDate?: string | null;
};

export type RoutineRevisionPublic = {
  id: string;
  effectiveDate: string;
  title: string;
  daypart: Daypart;
  weekdays: number[];
  createdAt: string;
  steps: Array<{
    id: string;
    logicalItemId: string;
    position: number;
    text: string;
    obligation: ObligationMeaning;
    applicability: ApplicabilityRule;
  }>;
  assigneeMemberIds: string[];
  assigneeGroupIds: string[];
  resolvedMemberIds?: string[];
  upcomingResolvedMemberIds?: string[];
  upcomingParticipationFromDate?: string | null;
};

export type ScheduleEntryPublic = {
  id: string;
  startDate: string;
  revisionId: string;
  canceledAt: string | null;
  revision: RoutineRevisionPublic;
};

export type RoutineDefinitionPublic = {
  id: string;
  version: number;
  kind: WorkKind;
  archived: boolean;
  archiveCutoffDate: string | null;
  archivedAt: string | null;
  ended: boolean;
  endMode: "legacy_archive" | "immediate" | null;
  endedAt: string | null;
  deletedAt?: string | null;
  scheduleEntries: ScheduleEntryPublic[];
  revisions: RoutineRevisionPublic[];
};

/** Alias for responsibility definitions (same public shape; kind=responsibility). */
export type ResponsibilityDefinitionPublic = RoutineDefinitionPublic;

export type ResponsibilityMutationResult = {
  responsibility: ResponsibilityDefinitionPublic;
  refineOutcome?: PlanRefineOutcome;
};

/** Read-only next-N-days preview row (does not materialize). */
export type ResponsibilityPreviewDay = {
  householdDate: string;
  applicable: boolean;
  accountableMemberId: string | null;
  accountableMemberName: string | null;
  title: string | null;
  daypart: Daypart | null;
  revisionId: string | null;
  /** True when a started occurrence protects owner/work from the current plan. */
  startedProtected: boolean;
  occurrenceId: string | null;
};

/** Outcome of a plan reconcile for truthful save feedback. */
export type PlanRefineOutcome = {
  fromDate: string;
  untilDateExclusive: string | null;
  updatedMemberIds: string[];
  protectedMemberIds: string[];
  excludedMemberIds: string[];
};

export type RoutineMutationResult = {
  routine: RoutineDefinitionPublic;
  refineOutcome?: PlanRefineOutcome;
};
