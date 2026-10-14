import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type {
  ApplicabilityRule,
  AssignmentSpec,
  Daypart,
  GroupPublic,
  MemberPublic,
  ScheduledAdditionSpec,
} from "../shared/schemas";
import { DEFAULT_APPLICABILITY } from "../domain/applicability";
import {
  fetchGroups,
  fetchGuideProgress,
  fetchPeople,
  fetchResponsibility,
  fetchRoutine,
  fetchSchoolCalendar,
  guideCompletePeople,
  guideDismiss,
  guideFinish,
  guideSavePerson,
  guideSaveSchool,
  guideSaveWork,
  previewDraftResponsibility,
  previewDraftRoutine,
  type GuideProgress,
  type GuideWorkPreviewBasis,
  type Responsibility,
  type Routine,
  type SchoolCalendarPublic,
  type SchoolYearPublic,
  type SessionInfo,
} from "./api";
import { newClientId } from "./id";

type GuideStep = "people" | "school" | "work" | "recap";

const STEP_ORDER: GuideStep[] = ["people", "school", "work", "recap"];
const WEEKDAYS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];
const DAYPARTS: Daypart[] = ["morning", "after_school", "evening", "bedtime", "anytime"];

type YearDraft = {
  clientKey: string;
  id?: string;
  startDate: string;
  endDate: string;
  usualWeekdays: number[];
  exceptions: Array<{
    id?: string;
    name: string;
    startDate: string;
    endDate: string;
  }>;
};

type WorkStepDraft = {
  text: string;
  obligation: "required" | "optional" | "as_needed";
  applicability: ApplicabilityRule;
  logicalItemId?: string;
};

type ScheduledAdditionDraft = {
  clientKey: string;
  id?: string;
  name: string;
  weekdays: number[];
  inheritAssignment: boolean;
  assignment?: AssignmentSpec;
  steps: Array<{
    text: string;
    obligation: "required" | "optional" | "as_needed";
    logicalItemId?: string;
  }>;
};

type EditPlanMode = "current" | "schedule";

type PendingPersonCommand = {
  mutationId: string;
  expectedGuideVersion: number;
  installationEpoch: number;
  displayName: string;
  classification: "adult" | "child";
};

type PendingWorkCommand = {
  mutationId: string;
  expectedGuideVersion: number;
  installationEpoch: number;
  status: "completed" | "skipped";
  routine?: Parameters<typeof guideSaveWork>[0]["routine"];
  responsibility?: Parameters<typeof guideSaveWork>[0]["responsibility"];
  reviseTarget?: Parameters<typeof guideSaveWork>[0]["reviseTarget"];
  previewHouseholdDate?: string;
  previewBasis?: GuideWorkPreviewBasis;
};

function errorMessage(caught: unknown): string {
  if (caught && typeof caught === "object" && "message" in caught) {
    return String((caught as { message: unknown }).message);
  }
  return "Something went wrong";
}

/** Resume at the first unfinished optional step; finished alone does not skip unfinished work. */
function initialStep(progress: GuideProgress): GuideStep {
  if (progress.firstWorkStatus !== "not_chosen") return "recap";
  if (progress.schoolStatus !== "not_chosen") return "work";
  if (progress.peopleStatus !== "not_chosen") return "school";
  return "people";
}

function yearsFromPublic(years: SchoolYearPublic[]): YearDraft[] {
  return years.map((year) => ({
    clientKey: year.id,
    id: year.id,
    startDate: year.startDate,
    endDate: year.endDate,
    usualWeekdays: [...year.usualWeekdays],
    exceptions: year.exceptions.map((exception) => ({
      id: exception.id,
      name: exception.name,
      startDate: exception.startDate,
      endDate: exception.endDate,
    })),
  }));
}

function emptyYearDraft(): YearDraft {
  return {
    clientKey: newClientId(),
    startDate: "",
    endDate: "",
    usualWeekdays: [1, 2, 3, 4, 5],
    exceptions: [],
  };
}

function schoolSnapshot(years: YearDraft[], version: number): string {
  return JSON.stringify({ version, years });
}

function workSnapshot(input: {
  workKind: string;
  workTitle: string;
  daypart: Daypart;
  weekdays: number[];
  steps: WorkStepDraft[];
  audienceIds: string[];
  audienceGroupIds: string[];
  ownerId: string;
  assignmentMode: string;
  cycleOrder: string[];
  weeklyMap: Record<number, string>;
  scheduledAdditions: ScheduledAdditionDraft[];
  editingDefinitionId: string | null;
}): string {
  return JSON.stringify(input);
}

function defaultWeeklyMap(ownerId: string): Record<number, string> {
  const map: Record<number, string> = {};
  for (let day = 1; day <= 7; day += 1) map[day] = ownerId;
  return map;
}

function buildAssignmentSpec(
  mode: "fixed" | "take_turns" | "weekly",
  fields: {
    accountableMemberId: string;
    cycleOrder: string[];
    weeklyMap: Record<number, string>;
    preserved?: AssignmentSpec | null;
  },
): AssignmentSpec {
  const anchorDate = fields.preserved?.anchorDate ?? "";
  const excludedMemberIds = fields.preserved?.excludedMemberIds ?? [];
  const sourceGroupId = fields.preserved?.sourceGroupId ?? null;
  if (mode === "fixed") {
    return {
      mode: "fixed",
      anchorDate: fields.preserved?.anchorDate ?? anchorDate,
      fixedMemberId: fields.accountableMemberId ? fields.accountableMemberId : null,
      cycleOrder: [],
      weeklyMap: {},
      excludedMemberIds,
      savedRingOrder: [],
      sourceGroupId,
    };
  }
  if (mode === "take_turns") {
    return {
      mode: "take_turns",
      anchorDate: fields.preserved?.anchorDate ?? anchorDate,
      cycleOrder: fields.cycleOrder,
      weeklyMap: {},
      excludedMemberIds,
      savedRingOrder: fields.preserved?.savedRingOrder?.length
        ? [...fields.preserved.savedRingOrder]
        : fields.cycleOrder,
      sourceGroupId,
    };
  }
  const weeklyMap: Record<string, string> = {};
  for (let day = 1; day <= 7; day += 1) {
    weeklyMap[String(day)] = fields.weeklyMap[day] ?? "";
  }
  return {
    mode: "weekly",
    anchorDate: fields.preserved?.anchorDate ?? anchorDate,
    weeklyMap,
    cycleOrder: [],
    excludedMemberIds,
    savedRingOrder: [],
    sourceGroupId,
  };
}

function scheduledAdditionsPayload(drafts: ScheduledAdditionDraft[]): ScheduledAdditionSpec[] {
  return drafts
    .filter((draft) => draft.name.trim() && draft.steps.some((s) => s.text.trim()))
    .map((draft) => ({
      ...(draft.id ? { id: draft.id } : {}),
      name: draft.name.trim(),
      weekdays: draft.weekdays.length > 0 ? draft.weekdays : [1, 2, 3, 4, 5],
      inheritAssignment: draft.inheritAssignment,
      assignment: draft.inheritAssignment ? undefined : draft.assignment,
      steps: draft.steps
        .filter((s) => s.text.trim())
        .map((s) => ({
          text: s.text.trim(),
          obligation: s.obligation,
          ...(s.logicalItemId ? { logicalItemId: s.logicalItemId } : {}),
          applicability: DEFAULT_APPLICABILITY,
        })),
    }));
}

function selectCurrentRevision(
  definition: Routine | Responsibility,
  today: string,
): { revision: NonNullable<Routine["revisions"][number]>; mode: EditPlanMode; scheduleEntryId?: string } | null {
  const active = definition.scheduleEntries.filter((entry) => !entry.canceledAt);
  const current = active
    .filter((entry) => entry.startDate <= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .at(-1);
  if (current?.revision) {
    return { revision: current.revision, mode: "current", scheduleEntryId: current.id };
  }
  const upcoming = active
    .filter((entry) => entry.startDate > today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  if (upcoming?.revision) {
    return {
      revision: upcoming.revision,
      mode: "schedule",
      scheduleEntryId: upcoming.id,
    };
  }
  const fallback = definition.revisions.at(-1);
  return fallback ? { revision: fallback, mode: "current" } : null;
}

export type GuidedSetupProps = {
  session: SessionInfo;
  memberships: MemberPublic[];
  onMembershipsChange: (people: MemberPublic[]) => void;
  onDirtyChange: (dirty: boolean) => void;
  onNavigateToday: () => void;
  onNavigateHousehold: () => void;
  onNavigatePeople?: () => void;
  onBack: () => void;
  guideRefreshToken?: number;
};

export function GuidedSetupView(props: GuidedSetupProps) {
  const [progress, setProgress] = useState<GuideProgress | null>(null);
  const [step, setStep] = useState<GuideStep>("people");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictHint, setConflictHint] = useState<string | null>(null);
  const [people, setPeople] = useState<MemberPublic[]>(props.memberships);
  const [groups, setGroups] = useState<GroupPublic[]>([]);

  const [personName, setPersonName] = useState("");
  const [personClass, setPersonClass] = useState<"adult" | "child">("child");
  const [addingAnother, setAddingAnother] = useState(false);

  const [pinnedCalendarVersion, setPinnedCalendarVersion] = useState(0);
  const [yearDrafts, setYearDrafts] = useState<YearDraft[]>([]);
  const [schoolBaseline, setSchoolBaseline] = useState("");
  const [calendarConfigured, setCalendarConfigured] = useState(false);

  const [workKind, setWorkKind] = useState<"routine" | "responsibility" | "both" | "skip">(
    "routine",
  );
  const [workTitle, setWorkTitle] = useState("Morning checklist");
  const [daypart, setDaypart] = useState<Daypart>("morning");
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [workSteps, setWorkSteps] = useState<WorkStepDraft[]>([
    { text: "Get ready", obligation: "required", applicability: DEFAULT_APPLICABILITY },
  ]);
  const [audienceIds, setAudienceIds] = useState<string[]>([]);
  const [audienceGroupIds, setAudienceGroupIds] = useState<string[]>([]);
  const [ownerId, setOwnerId] = useState("");
  const [assignmentMode, setAssignmentMode] = useState<"fixed" | "take_turns" | "weekly">(
    "fixed",
  );
  const [cycleOrder, setCycleOrder] = useState<string[]>([]);
  const [weeklyMap, setWeeklyMap] = useState<Record<number, string>>({});
  const [scheduledAdditions, setScheduledAdditions] = useState<ScheduledAdditionDraft[]>([]);
  const [editingDefinitionId, setEditingDefinitionId] = useState<string | null>(null);
  const [editingKind, setEditingKind] = useState<"routine" | "responsibility" | null>(null);
  const [editingVersion, setEditingVersion] = useState<number | null>(null);
  const [editPlanMode, setEditPlanMode] = useState<EditPlanMode>("current");
  const [editScheduleEntryId, setEditScheduleEntryId] = useState<string | undefined>(undefined);
  const [preservedAssignment, setPreservedAssignment] = useState<AssignmentSpec | null>(null);
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);
  const [createAnother, setCreateAnother] = useState(false);
  const [workBaseline, setWorkBaseline] = useState("");
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewBasis, setPreviewBasis] = useState<GuideWorkPreviewBasis | null>(null);
  const [savedWorkSummary, setSavedWorkSummary] = useState<string[]>([]);

  const personMutationRef = useRef(newClientId());
  const peopleCompleteMutationRef = useRef(newClientId());
  const schoolMutationRef = useRef(newClientId());
  const schoolInnerMutationRef = useRef(newClientId());
  const workMutationRef = useRef(newClientId());
  const finishMutationRef = useRef(newClientId());
  const dismissMutationRef = useRef(newClientId());
  const dirtyRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const previewGenerationRef = useRef(0);
  const sessionEpochRef = useRef(props.session.installationEpoch);
  const pendingPersonRef = useRef<PendingPersonCommand | null>(null);
  const pendingWorkRef = useRef<PendingWorkCommand | null>(null);
  const mountedOnceRef = useRef(false);
  /** Skip one soft reload after a local save that already advanced the step. */
  const suppressSoftLoadRef = useRef(false);

  const schoolDirty =
    schoolBaseline !== "" &&
    schoolSnapshot(yearDrafts, pinnedCalendarVersion) !== schoolBaseline;
  const workDirty =
    step === "work" &&
    workBaseline !== "" &&
    workSnapshot({
      workKind,
      workTitle,
      daypart,
      weekdays,
      steps: workSteps,
      audienceIds,
      audienceGroupIds,
      ownerId,
      assignmentMode,
      cycleOrder,
      weeklyMap,
      scheduledAdditions,
      editingDefinitionId,
    }) !== workBaseline;
  const peopleDirty = personName.trim().length > 0;
  const dirty =
    (peopleDirty && step === "people") ||
    (schoolDirty && step === "school") ||
    workDirty;

  useEffect(() => {
    dirtyRef.current = dirty;
    props.onDirtyChange(step === "recap" ? false : dirty);
  }, [dirty, step, props]);

  useEffect(() => {
    sessionEpochRef.current = props.session.installationEpoch;
  }, [props.session.installationEpoch]);

  function applyLoadedCalendar(calendar: SchoolCalendarPublic | null | undefined) {
    const version = calendar?.version ?? 0;
    setPinnedCalendarVersion(version);
    setCalendarConfigured(Boolean(calendar?.configured && (calendar.years?.length ?? 0) > 0));
    const years =
      calendar?.configured && calendar.years.length > 0
        ? yearsFromPublic(calendar.years)
        : [emptyYearDraft()];
    setYearDrafts(years);
    setSchoolBaseline(schoolSnapshot(years, version));
  }

  function resetWorkBaseline(nextPeople: MemberPublic[], keepEditing = false) {
    const managerId = props.session.member.id;
    const defaults = {
      workKind: "routine" as const,
      workTitle: "Morning checklist",
      daypart: "morning" as Daypart,
      weekdays: [1, 2, 3, 4, 5],
      steps: [
        {
          text: "Get ready",
          obligation: "required" as const,
          applicability: DEFAULT_APPLICABILITY,
        },
      ],
      audienceIds: nextPeople.filter((p) => !p.departed).map((p) => p.id),
      audienceGroupIds: [] as string[],
      ownerId: managerId,
      assignmentMode: "fixed" as const,
      cycleOrder: nextPeople.filter((p) => !p.departed).map((p) => p.id),
      weeklyMap: defaultWeeklyMap(managerId),
      scheduledAdditions: [] as ScheduledAdditionDraft[],
      editingDefinitionId: keepEditing ? editingDefinitionId : null,
    };
    if (!keepEditing) {
      setEditingDefinitionId(null);
      setEditingKind(null);
      setEditingVersion(null);
      setCreateAnother(false);
    }
    setWorkKind(defaults.workKind);
    setWorkTitle(defaults.workTitle);
    setDaypart(defaults.daypart);
    setWeekdays(defaults.weekdays);
    setWorkSteps(defaults.steps);
    setAudienceIds(defaults.audienceIds);
    setAudienceGroupIds(defaults.audienceGroupIds);
    setOwnerId(defaults.ownerId);
    setAssignmentMode(defaults.assignmentMode);
    setCycleOrder(defaults.cycleOrder);
    setWeeklyMap(defaults.weeklyMap);
    setScheduledAdditions(defaults.scheduledAdditions);
    setPreviewText(null);
    setPreviewBasis(null);
    setWorkBaseline(workSnapshot(defaults));
  }

  async function resolveSavedWorkSummary(
    guide: GuideProgress,
    nextPeople: MemberPublic[],
  ): Promise<string[]> {
    const lines: string[] = [];
    const today = props.session.householdDate;
    for (const id of guide.workDefinitionIds) {
      try {
        const routineResult = await fetchRoutine(id);
        const selected = selectCurrentRevision(routineResult.routine, today);
        if (selected) {
          const { revision } = selected;
          const names = (revision.resolvedMemberIds ?? revision.assigneeMemberIds)
            .map(
              (memberId) =>
                nextPeople.find((p) => p.id === memberId)?.displayName ?? memberId.slice(0, 8),
            )
            .join(", ");
          const groupHint =
            revision.assigneeGroupIds.length > 0 && !names
              ? `${revision.assigneeGroupIds.length} group(s)`
              : names || "no participants";
          let nextHint = `active ${revision.effectiveDate}`;
          try {
            const preview = await previewDraftRoutine({
              mutationId: newClientId(),
              title: revision.title,
              daypart: revision.daypart,
              weekdays: revision.weekdays,
              assigneeMemberIds: revision.assigneeMemberIds,
              assigneeGroupIds: revision.assigneeGroupIds,
              steps: revision.steps.map((s) => ({
                text: s.text,
                obligation: s.obligation,
                applicability: s.applicability,
              })),
            });
            const first = preview.preview.find((d) => d.applicable);
            nextHint = first
              ? `next ${first.householdDate}`
              : preview.nextKnownDate
                ? `next ${preview.nextKnownDate}`
                : preview.noKnownReason ?? "no known date";
          } catch {
            /* keep active date */
          }
          if (routineResult.routine.deletedAt) {
            lines.push(`Routine “${revision.title}” · deleted`);
          } else if (routineResult.routine.ended) {
            lines.push(`Routine “${revision.title}” · ended`);
          } else {
            lines.push(`Routine “${revision.title}” · ${groupHint} · ${nextHint}`);
          }
          continue;
        }
      } catch {
        /* try responsibility */
      }
      try {
        const respResult = await fetchResponsibility(id);
        const selected = selectCurrentRevision(respResult.responsibility, today);
        if (selected) {
          const { revision } = selected;
          let ownerLabel = "Unassigned";
          if (revision.assignment?.mode === "fixed") {
            const fixed = revision.assignment.fixedMemberId;
            ownerLabel = fixed
              ? (nextPeople.find((p) => p.id === fixed)?.displayName ?? "Unknown")
              : "Unassigned";
          } else if (revision.assignment?.mode === "take_turns") {
            ownerLabel = "Take turns";
          } else if (revision.assignment?.mode === "weekly") {
            ownerLabel = "Weekly";
          }
          try {
            const preview = await previewDraftResponsibility({
              mutationId: newClientId(),
              title: revision.title,
              daypart: revision.daypart,
              weekdays: revision.weekdays,
              assignment: revision.assignment,
              accountableMemberId: revision.assignment?.fixedMemberId ?? undefined,
              steps: revision.steps.map((s) => ({
                text: s.text,
                obligation: s.obligation,
                applicability: DEFAULT_APPLICABILITY,
              })),
              scheduledAdditions: revision.scheduledAdditions,
            });
            const first = preview.preview.find((d) => d.applicable);
            if (first?.accountableMemberName) ownerLabel = first.accountableMemberName;
            const nextHint = first
              ? `next ${first.householdDate}`
              : preview.nextKnownDate
                ? `next ${preview.nextKnownDate}`
                : preview.noKnownReason ?? "no known date";
            if (respResult.responsibility.deletedAt) {
              lines.push(`Responsibility “${revision.title}” · deleted`);
            } else if (respResult.responsibility.ended) {
              lines.push(`Responsibility “${revision.title}” · ended`);
            } else {
              lines.push(`Responsibility “${revision.title}” · ${ownerLabel} · ${nextHint}`);
            }
          } catch {
            lines.push(`Responsibility “${revision.title}” · ${ownerLabel}`);
          }
        }
      } catch {
        lines.push(`Saved work ${id.slice(0, 8)}… (unavailable)`);
      }
    }
    return lines;
  }

  function hydrateFromRevision(
    kind: "routine" | "responsibility",
    definition: Routine | Responsibility,
    nextPeople: MemberPublic[],
  ) {
    const selected = selectCurrentRevision(definition, props.session.householdDate);
    if (!selected) return;
    const { revision, mode, scheduleEntryId } = selected;
    setEditingDefinitionId(definition.id);
    setEditingKind(kind);
    setEditingVersion(definition.version);
    setEditPlanMode(mode);
    setEditScheduleEntryId(scheduleEntryId);
    setSelectedWorkId(definition.id);
    setCreateAnother(false);
    setWorkKind(kind);
    setWorkTitle(revision.title);
    setDaypart(revision.daypart);
    setWeekdays([...revision.weekdays]);
    const steps: WorkStepDraft[] = revision.steps.map((stepRow) => ({
      text: stepRow.text,
      obligation: stepRow.obligation,
      applicability: stepRow.applicability ?? DEFAULT_APPLICABILITY,
      logicalItemId: stepRow.logicalItemId,
    }));
    setWorkSteps(steps);
    let nextAudienceIds = [...revision.assigneeMemberIds];
    let nextAudienceGroupIds = [...revision.assigneeGroupIds];
    let nextOwnerId = "";
    let nextAssignmentMode: "fixed" | "take_turns" | "weekly" = "fixed";
    let nextCycle = nextPeople.filter((p) => !p.departed).map((p) => p.id);
    const nextWeekly = defaultWeeklyMap(props.session.member.id);
    let nextAdditions: ScheduledAdditionDraft[] = [];
    let nextPreserved: AssignmentSpec | null = null;
    if (kind === "routine") {
      setAudienceIds(nextAudienceIds);
      setAudienceGroupIds(nextAudienceGroupIds);
      setOwnerId("");
      setAssignmentMode("fixed");
      setCycleOrder(nextCycle);
      setWeeklyMap(nextWeekly);
      setScheduledAdditions([]);
      setPreservedAssignment(null);
    } else {
      const assignment = revision.assignment ?? null;
      nextPreserved = assignment;
      const modeAssign = assignment?.mode ?? "fixed";
      nextAssignmentMode = modeAssign;
      nextOwnerId =
        modeAssign === "fixed" ? (assignment?.fixedMemberId ?? "") : "";
      nextCycle = assignment?.cycleOrder?.length
        ? [...assignment.cycleOrder]
        : nextCycle;
      if (assignment?.weeklyMap) {
        for (const [day, memberId] of Object.entries(assignment.weeklyMap)) {
          nextWeekly[Number(day)] = memberId;
        }
      }
      nextAdditions = (revision.scheduledAdditions ?? []).map((addition) => ({
        clientKey: addition.id ?? newClientId(),
        id: addition.id,
        name: addition.name,
        weekdays: [...addition.weekdays],
        inheritAssignment: addition.inheritAssignment,
        assignment: addition.assignment,
        steps: addition.steps.map((s) => ({
          text: s.text,
          obligation: s.obligation,
          logicalItemId: s.logicalItemId,
        })),
      }));
      setAssignmentMode(nextAssignmentMode);
      setOwnerId(nextOwnerId);
      setCycleOrder(nextCycle);
      setWeeklyMap(nextWeekly);
      setAudienceIds(nextPeople.filter((p) => !p.departed).map((p) => p.id));
      setAudienceGroupIds([]);
      setScheduledAdditions(nextAdditions);
      setPreservedAssignment(nextPreserved);
      nextAudienceIds = nextPeople.filter((p) => !p.departed).map((p) => p.id);
      nextAudienceGroupIds = [];
    }
    setPreviewText(null);
    setPreviewBasis(null);
    setWorkBaseline(
      workSnapshot({
        workKind: kind,
        workTitle: revision.title,
        daypart: revision.daypart,
        weekdays: [...revision.weekdays],
        steps,
        audienceIds: nextAudienceIds,
        audienceGroupIds: nextAudienceGroupIds,
        ownerId: nextOwnerId,
        assignmentMode: nextAssignmentMode,
        cycleOrder: nextCycle,
        weeklyMap: nextWeekly,
        scheduledAdditions: nextAdditions,
        editingDefinitionId: definition.id,
      }),
    );
  }

  async function hydrateSavedWork(
    guide: GuideProgress,
    nextPeople: MemberPublic[],
    preferredId?: string | null,
  ) {
    if (guide.workDefinitionIds.length === 0 || createAnother) {
      resetWorkBaseline(nextPeople);
      return;
    }
    const id = preferredId ?? selectedWorkId ?? guide.workDefinitionIds[0]!;
    if (!guide.workDefinitionIds.includes(id)) {
      resetWorkBaseline(nextPeople);
      return;
    }
    try {
      const routineResult = await fetchRoutine(id);
      hydrateFromRevision("routine", routineResult.routine, nextPeople);
      return;
    } catch {
      /* try responsibility */
    }
    try {
      const respResult = await fetchResponsibility(id);
      hydrateFromRevision("responsibility", respResult.responsibility, nextPeople);
    } catch {
      resetWorkBaseline(nextPeople);
    }
  }

  async function loadGuide(options?: { force?: boolean }) {
    const generation = ++loadGenerationRef.current;
    const epochAtStart = sessionEpochRef.current;
    const [guide, list, calendar, groupList] = await Promise.all([
      fetchGuideProgress(),
      fetchPeople(),
      fetchSchoolCalendar().catch(() => null),
      fetchGroups().catch(() => ({ groups: [] as GroupPublic[] })),
    ]);
    if (generation !== loadGenerationRef.current) return;
    if (epochAtStart !== sessionEpochRef.current) return;
    if (!options?.force && suppressSoftLoadRef.current) {
      suppressSoftLoadRef.current = false;
      setProgress(guide);
      setPeople(list.people);
      setGroups(groupList.groups);
      props.onMembershipsChange(list.people);
      setSavedWorkSummary(await resolveSavedWorkSummary(guide, list.people));
      return;
    }
    if (!options?.force && dirtyRef.current) {
      setConflictHint(
        "Someone else updated setup while you were editing. Keep your draft, or discard to refresh.",
      );
      // Do not replace progress used for pending command baselines while dirty.
      return;
    }
    setConflictHint(null);
    setProgress(guide);
    setStep(initialStep(guide));
    setPeople(list.people);
    setGroups(groupList.groups);
    props.onMembershipsChange(list.people);
    applyLoadedCalendar(calendar?.calendar ?? null);
    await hydrateSavedWork(guide, list.people);
    setPersonName("");
    setSavedWorkSummary(await resolveSavedWorkSummary(guide, list.people));
  }

  useEffect(() => {
    const force = !mountedOnceRef.current;
    mountedOnceRef.current = true;
    void loadGuide({ force }).catch((caught) => setError(errorMessage(caught)));
    // Soft load on refresh/reconnect/visibility; force only first mount and discard.
  }, [props.guideRefreshToken, props.session.member.id, props.session.installationEpoch]);

  const others = useMemo(
    () => people.filter((p) => p.id !== props.session.member.id && !p.departed),
    [people, props.session.member.id],
  );
  const manager = people.find((p) => p.id === props.session.member.id) ?? null;
  const activePeople = useMemo(() => people.filter((p) => !p.departed), [people]);

  function invalidatePreview() {
    previewGenerationRef.current += 1;
    setPreviewText(null);
    setPreviewBasis(null);
    if (pendingWorkRef.current) {
      pendingWorkRef.current = null;
      workMutationRef.current = newClientId();
    }
  }

  function guard() {
    if (!progress) throw new Error("Guide not loaded");
    return {
      expectedGuideVersion: progress.guideVersion,
      installationEpoch: props.session.installationEpoch,
    };
  }

  function requestStep(next: GuideStep) {
    if (next === step) return;
    if (dirty) {
      setConflictHint(
        "You have unsaved changes on this step. Discard to leave, or keep editing.",
      );
      return;
    }
    setStep(next);
  }

  function buildResponsibilityAssignment(): AssignmentSpec {
    const built = buildAssignmentSpec(assignmentMode, {
      accountableMemberId: ownerId,
      cycleOrder: cycleOrder.length > 0 ? cycleOrder : audienceIds,
      weeklyMap,
      preserved: preservedAssignment,
    });
    if (!built.anchorDate) {
      return { ...built, anchorDate: props.session.householdDate };
    }
    return built;
  }

  function clearPendingOnDefinitiveError(caught: unknown) {
    const message = errorMessage(caught);
    if (/updated elsewhere|conflict|validation|invalid|not found|denied|unauthorized/i.test(message)) {
      pendingPersonRef.current = null;
      pendingWorkRef.current = null;
      personMutationRef.current = newClientId();
      workMutationRef.current = newClientId();
    }
  }

  async function savePerson(event: FormEvent) {
    event.preventDefault();
    if (!progress) return;
    setBusy(true);
    setError(null);
    try {
      const pending =
        pendingPersonRef.current ??
        ({
          mutationId: personMutationRef.current,
          ...guard(),
          displayName: personName.trim(),
          classification: personClass,
        } satisfies PendingPersonCommand);
      pendingPersonRef.current = pending;
      const result = await guideSavePerson(pending);
      pendingPersonRef.current = null;
      personMutationRef.current = newClientId();
      suppressSoftLoadRef.current = true;
      setProgress(result.progress);
      const list = await fetchPeople();
      setPeople(list.people);
      props.onMembershipsChange(list.people);
      setPersonName("");
      setAddingAnother(true);
    } catch (caught) {
      clearPendingOnDefinitiveError(caught);
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function completePeople(status: "completed" | "skipped") {
    if (!progress) return;
    setBusy(true);
    setError(null);
    try {
      const result = await guideCompletePeople({
        mutationId: peopleCompleteMutationRef.current,
        ...guard(),
        status,
      });
      peopleCompleteMutationRef.current = newClientId();
      suppressSoftLoadRef.current = true;
      setProgress(result.progress);
      setPersonName("");
      setStep("school");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function saveSchool(status: "completed" | "skipped") {
    if (!progress) return;
    setBusy(true);
    setError(null);
    try {
      const result = await guideSaveSchool({
        mutationId: schoolMutationRef.current,
        ...guard(),
        status,
        ...(status === "completed"
          ? {
              calendar: {
                mutationId: schoolInnerMutationRef.current,
                expectedVersion: pinnedCalendarVersion,
                years: yearDrafts.map((year) => ({
                  ...(year.id ? { id: year.id } : {}),
                  startDate: year.startDate,
                  endDate: year.endDate,
                  usualWeekdays: year.usualWeekdays,
                  exceptions: year.exceptions.map((exception) => ({
                    ...(exception.id ? { id: exception.id } : {}),
                    name: exception.name,
                    startDate: exception.startDate,
                    endDate: exception.endDate,
                  })),
                })),
              },
            }
          : {}),
      });
      schoolMutationRef.current = newClientId();
      schoolInnerMutationRef.current = newClientId();
      suppressSoftLoadRef.current = true;
      setProgress(result.progress);
      if (result.calendar) {
        applyLoadedCalendar(result.calendar);
      } else {
        setSchoolBaseline(schoolSnapshot(yearDrafts, pinnedCalendarVersion));
      }
      setStep("work");
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      if (/updated elsewhere|reload and review/i.test(message)) {
        setConflictHint("Calendar changed elsewhere. Refresh to review, or keep editing your draft.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    if (!progress || workKind === "skip") return;
    const generation = ++previewGenerationRef.current;
    const snapshot = workSnapshot({
      workKind,
      workTitle,
      daypart,
      weekdays,
      steps: workSteps,
      audienceIds,
      audienceGroupIds,
      ownerId,
      assignmentMode,
      cycleOrder,
      weeklyMap,
      scheduledAdditions,
      editingDefinitionId,
    });
    setBusy(true);
    setError(null);
    try {
      const calendar = await fetchSchoolCalendar();
      if (generation !== previewGenerationRef.current) return;
      const liveSnapshot = workSnapshot({
        workKind,
        workTitle,
        daypart,
        weekdays,
        steps: workSteps,
        audienceIds,
        audienceGroupIds,
        ownerId,
        assignmentMode,
        cycleOrder,
        weeklyMap,
        scheduledAdditions,
        editingDefinitionId,
      });
      if (liveSnapshot !== snapshot) {
        invalidatePreview();
        setError("Draft changed while reviewing; review again");
        return;
      }
      const lines: string[] = [];
      let reviewedRoutineParticipantIds: string[] | undefined;
      let reviewedResponsibilityOwnerId: string | null | undefined;
      let reviewedRoutineDays: GuideWorkPreviewBasis["reviewedRoutineDays"];
      let reviewedResponsibilityDays: GuideWorkPreviewBasis["reviewedResponsibilityDays"];
      const steps = workSteps
        .filter((s) => s.text.trim())
        .map((s) => ({
          text: s.text.trim(),
          obligation: s.obligation,
          applicability:
            workKind === "responsibility" ? DEFAULT_APPLICABILITY : s.applicability,
        }));
      const assignment = buildResponsibilityAssignment();
      const additions = scheduledAdditionsPayload(scheduledAdditions);
      if (workKind === "routine" || workKind === "both") {
        const routinePreview = await previewDraftRoutine({
          mutationId: newClientId(),
          title: workTitle.trim(),
          daypart,
          weekdays,
          assigneeMemberIds: audienceIds,
          assigneeGroupIds: audienceGroupIds,
          steps,
        });
        if (generation !== previewGenerationRef.current) return;
        const applicable = routinePreview.preview.filter((d) => d.applicable);
        const first = applicable[0];
        reviewedRoutineParticipantIds = first?.participantMemberIds ?? [];
        reviewedRoutineDays = applicable.map((day) => ({
          householdDate: day.householdDate,
          participantMemberIds: day.participantMemberIds,
          stepTexts: day.stepTexts ?? [],
        }));
        lines.push(
          `Routine “${workTitle.trim()}”: ${first ? `${first.householdDate} · ${first.participantNames.join(", ") || "no participants"} · ${first.stepCount} steps` : routinePreview.nextKnownDate ? `next ${routinePreview.nextKnownDate}` : routinePreview.noKnownReason ?? "no known date"}`,
        );
        for (const day of applicable.slice(0, 7)) {
          const daySteps = (day.stepTexts ?? []).join(" → ") || "—";
          lines.push(
            `  ${day.householdDate}: ${day.participantNames.join(", ") || "—"} · steps: ${daySteps}`,
          );
        }
        if (!applicable.length && routinePreview.nextKnownDate) {
          lines.push(`  Beyond window: next known ${routinePreview.nextKnownDate}`);
        }
      }
      if (workKind === "responsibility" || workKind === "both") {
        const respPreview = await previewDraftResponsibility({
          mutationId: newClientId(),
          title: workTitle.trim() || "Shared responsibility",
          daypart: workKind === "both" ? "anytime" : daypart,
          weekdays,
          accountableMemberId: assignmentMode === "fixed" ? ownerId || undefined : undefined,
          assignment,
          steps: steps.map((s) => ({ ...s, applicability: DEFAULT_APPLICABILITY })),
          scheduledAdditions: additions,
        });
        if (generation !== previewGenerationRef.current) return;
        const applicable = respPreview.preview.filter((d) => d.applicable);
        const first = applicable[0];
        reviewedResponsibilityOwnerId = first?.accountableMemberId ?? null;
        reviewedResponsibilityDays = applicable.map((day) => ({
          householdDate: day.householdDate,
          accountableMemberId: day.accountableMemberId ?? null,
          stepTexts: steps.map((s) => s.text),
          scheduledAdditionNames: additions
            .filter((a) => a.weekdays.includes(((new Date(day.householdDate + "T12:00:00").getDay() + 6) % 7) + 1))
            .map((a) => a.name),
        }));
        lines.push(
          `Responsibility “${workTitle.trim() || "Shared responsibility"}”: ${first ? `${first.householdDate} · ${first.accountableMemberName ?? "Unassigned"}` : respPreview.nextKnownDate ? `next ${respPreview.nextKnownDate}` : respPreview.noKnownReason ?? "no known date"}`,
        );
        for (const day of applicable.slice(0, 7)) {
          const dayAdditions = additions
            .filter((a) =>
              a.weekdays.includes(((new Date(day.householdDate + "T12:00:00").getDay() + 6) % 7) + 1),
            )
            .map((a) => a.name);
          lines.push(
            `  ${day.householdDate}: ${day.accountableMemberName ?? "Unassigned"} · steps: ${steps.map((s) => s.text).join(" → ") || "—"}` +
              (dayAdditions.length ? ` · scheduled: ${dayAdditions.join(", ")}` : ""),
          );
        }
        if (!applicable.length && respPreview.nextKnownDate) {
          lines.push(`  Beyond window: next known ${respPreview.nextKnownDate}`);
        }
      }
      if (generation !== previewGenerationRef.current) return;
      const groupVersions: Record<string, number> = {};
      for (const groupId of audienceGroupIds) {
        const group = groups.find((g) => g.id === groupId);
        if (group) groupVersions[groupId] = group.version;
      }
      setPreviewText(lines.join("\n"));
      setPreviewBasis({
        householdDate: props.session.householdDate,
        calendarVersion: calendar.calendar.version,
        audienceGroupIds: [...audienceGroupIds],
        audienceGroupVersions: groupVersions,
        reviewedRoutineParticipantIds,
        reviewedResponsibilityOwnerId,
        reviewedRoutineDays,
        reviewedResponsibilityDays,
      });
    } catch (caught) {
      if (generation !== previewGenerationRef.current) return;
      setError(errorMessage(caught));
      invalidatePreview();
    } finally {
      setBusy(false);
    }
  }

  async function saveWork(status: "completed" | "skipped") {
    if (!progress) return;
    if (status === "completed" && workKind !== "skip" && !previewBasis) {
      setError("Review the work before saving");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const steps = workSteps
        .filter((s) => s.text.trim())
        .map((s) => ({
          text: s.text.trim(),
          obligation: s.obligation,
          ...(s.logicalItemId ? { logicalItemId: s.logicalItemId } : {}),
          applicability:
            workKind === "responsibility" ? DEFAULT_APPLICABILITY : s.applicability,
        }));
      const assignment = buildResponsibilityAssignment();
      const additions = scheduledAdditionsPayload(scheduledAdditions);
      const revising =
        status === "completed" &&
        editingDefinitionId &&
        editingKind &&
        editingVersion != null &&
        !createAnother;

      const routine =
        status === "completed" &&
        (revising
          ? editingKind === "routine"
          : workKind === "routine" || workKind === "both")
          ? {
              mutationId: newClientId(),
              title: workTitle.trim(),
              daypart,
              weekdays,
              assigneeMemberIds: audienceIds,
              assigneeGroupIds: audienceGroupIds,
              steps,
            }
          : undefined;
      const responsibility =
        status === "completed" &&
        (revising
          ? editingKind === "responsibility"
          : workKind === "responsibility" || workKind === "both")
          ? {
              mutationId: newClientId(),
              title: workTitle.trim() || "Shared responsibility",
              daypart:
                !revising && workKind === "both" ? ("anytime" as Daypart) : daypart,
              weekdays,
              accountableMemberId:
                assignmentMode === "fixed"
                  ? ownerId || undefined
                  : undefined,
              assignment,
              steps: steps.map((s) => ({ ...s, applicability: DEFAULT_APPLICABILITY })),
              scheduledAdditions: additions,
            }
          : undefined;

      const pending =
        pendingWorkRef.current ??
        ({
          mutationId: workMutationRef.current,
          ...guard(),
          status: status === "skipped" || workKind === "skip" ? "skipped" : "completed",
          routine,
          responsibility,
          reviseTarget: revising
            ? {
                kind: editingKind!,
                definitionId: editingDefinitionId!,
                expectedVersion: editingVersion!,
                mode: editPlanMode,
                scheduleEntryId: editScheduleEntryId,
              }
            : undefined,
          previewHouseholdDate: previewBasis?.householdDate,
          previewBasis: previewBasis ?? undefined,
        } satisfies PendingWorkCommand);
      pendingWorkRef.current = pending;
      const result = await guideSaveWork(pending);
      pendingWorkRef.current = null;
      workMutationRef.current = newClientId();
      suppressSoftLoadRef.current = true;
      setProgress(result.progress);
      if (result.routine) setEditingVersion(result.routine.version);
      if (result.responsibility) setEditingVersion(result.responsibility.version);
      const summary = await resolveSavedWorkSummary(result.progress, people);
      if (summary.length === 0) {
        if (result.routine) {
          const title = result.routine.revisions[0]?.title ?? (workTitle.trim() || "Routine");
          summary.push(`Routine “${title}”`);
        }
        if (result.responsibility) {
          const title =
            result.responsibility.revisions[0]?.title ??
            (workTitle.trim() || "Responsibility");
          summary.push(`Responsibility “${title}”`);
        }
      }
      setSavedWorkSummary(summary);
      if (result.routine) {
        setEditingDefinitionId(result.routine.id);
        setEditingKind("routine");
        setEditingVersion(result.routine.version);
      } else if (result.responsibility) {
        setEditingDefinitionId(result.responsibility.id);
        setEditingKind("responsibility");
        setEditingVersion(result.responsibility.version);
      }
      invalidatePreview();
      setWorkBaseline(
        workSnapshot({
          workKind,
          workTitle,
          daypart,
          weekdays,
          steps: workSteps,
          audienceIds,
          audienceGroupIds,
          ownerId,
          assignmentMode,
          cycleOrder,
          weeklyMap,
          scheduledAdditions,
          editingDefinitionId,
        }),
      );
      setStep("recap");
    } catch (caught) {
      clearPendingOnDefinitiveError(caught);
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function finishAndGo(target: "today" | "household", dismiss: boolean) {
    if (!progress) return;
    setBusy(true);
    setError(null);
    try {
      const result = await guideFinish({
        mutationId: finishMutationRef.current,
        ...guard(),
        dismiss,
      });
      finishMutationRef.current = newClientId();
      setProgress(result.progress);
      if (target === "today") props.onNavigateToday();
      else props.onNavigateHousehold();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function saveAndFinishLater() {
    if (dirty) {
      setError("Keep editing or discard your draft before leaving");
      return;
    }
    props.onNavigateToday();
  }

  async function dismissChecklist() {
    if (!progress) return;
    setBusy(true);
    setError(null);
    try {
      const result = await guideDismiss({
        mutationId: dismissMutationRef.current,
        ...guard(),
      });
      dismissMutationRef.current = newClientId();
      setProgress(result.progress);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function discardDraftAndRefresh() {
    dirtyRef.current = false;
    pendingPersonRef.current = null;
    pendingWorkRef.current = null;
    personMutationRef.current = newClientId();
    workMutationRef.current = newClientId();
    setPersonName("");
    setError(null);
    try {
      await loadGuide({ force: true });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function beginCreateAnother() {
    pendingWorkRef.current = null;
    workMutationRef.current = newClientId();
    setCreateAnother(true);
    setEditingDefinitionId(null);
    setEditingKind(null);
    setEditingVersion(null);
    resetWorkBaseline(people, false);
    setStep("work");
  }

  if (!progress) {
    return (
      <section className="panel guided-setup" data-testid="guided-setup">
        <p className="meta">{error ?? "Loading setup…"}</p>
      </section>
    );
  }

  return (
    <section className="panel guided-setup" data-testid="guided-setup">
      <button type="button" className="back-link" onClick={props.onBack}>
        Back to Household
      </button>
      <h1 className="page-heading">Finish setup</h1>

      <nav
        className="guide-rail guided-setup-rail"
        aria-label="Setup steps"
        data-testid="guide-rail"
      >
        {STEP_ORDER.map((item) => {
          const status =
            item === "people"
              ? progress.peopleStatus
              : item === "school"
                ? progress.schoolStatus
                : item === "work"
                  ? progress.firstWorkStatus
                  : progress.finishedAt
                    ? "completed"
                    : "not_chosen";
          return (
            <button
              key={item}
              type="button"
              className={step === item ? "guide-rail-active is-current" : undefined}
              data-testid={`guide-rail-${item}`}
              data-step={item}
              onClick={() => requestStep(item)}
            >
              {item === "people"
                ? "Your people"
                : item === "school"
                  ? "School days"
                  : item === "work"
                    ? "First work"
                    : "Recap"}
              <span className="meta"> {status.replace("_", " ")}</span>
            </button>
          );
        })}
      </nav>

      <div className="guide-progress-phone" data-testid="guide-progress-phone" aria-hidden>
        Step {STEP_ORDER.indexOf(step) + 1} of {STEP_ORDER.length}
      </div>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {conflictHint ? (
        <div className="notice" data-testid="guide-conflict">
          <p>{conflictHint}</p>
          <button type="button" onClick={() => void discardDraftAndRefresh()}>
            Discard and refresh
          </button>
        </div>
      ) : null}

      {step === "people" ? (
        <div
          className={`guide-step${step === "people" ? " is-current" : ""}`}
          data-testid="guide-step-people"
        >
          <h2>Your people</h2>
          <p className="meta">You appear once. Add others with Member + Approval defaults.</p>
          {manager ? (
            <p data-testid="guide-manager-once">
              <strong>{manager.displayName}</strong> (you)
            </p>
          ) : null}
          <ul className="simple-list" data-testid="guide-people-list">
            {others.map((person) => (
              <li key={person.id}>
                {person.displayName} · {person.classification}
              </li>
            ))}
          </ul>
          {(addingAnother || others.length === 0 || personName) && (
            <form className="stack-form" onSubmit={savePerson} data-testid="guide-add-person">
              <label>
                Name
                <input
                  value={personName}
                  onChange={(event) => setPersonName(event.target.value)}
                  data-testid="guide-person-name"
                  required
                />
              </label>
              <label>
                Adult or child
                <select
                  value={personClass}
                  onChange={(event) =>
                    setPersonClass(event.target.value as "adult" | "child")
                  }
                  data-testid="guide-person-class"
                >
                  <option value="adult">Adult</option>
                  <option value="child">Child</option>
                </select>
              </label>
              <button type="submit" className="primary" disabled={busy}>
                Save person
              </button>
            </form>
          )}
          <div className="button-row">
            <button
              type="button"
              data-testid="guide-add-another"
              onClick={() => setAddingAnother(true)}
            >
              Add another person
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              data-testid="guide-people-continue"
              onClick={() => void completePeople("completed")}
            >
              Continue
            </button>
          </div>
          <p className="meta">
            Correction, removal, and sign-in stay available in{" "}
            <a href="/household/people">People</a>.
          </p>
        </div>
      ) : null}

      {step === "school" ? (
        <div className="guide-step is-current" data-testid="guide-school">
          <h2>School days</h2>
          <p className="meta">
            Confirm usual weekdays. Leave year dates empty until you know them
            {calendarConfigured ? "; existing years and exceptions are preserved." : "."}
          </p>
          {yearDrafts.map((year, index) => (
            <fieldset key={year.clientKey} className="stack-form">
              <legend>School year {index + 1}</legend>
              <label>
                Start
                <input
                  type="date"
                  value={year.startDate}
                  onChange={(event) =>
                    setYearDrafts((current) =>
                      current.map((item) =>
                        item.clientKey === year.clientKey
                          ? { ...item, startDate: event.target.value }
                          : item,
                      ),
                    )
                  }
                  data-testid={index === 0 ? "guide-school-start" : undefined}
                />
              </label>
              <label>
                End
                <input
                  type="date"
                  value={year.endDate}
                  onChange={(event) =>
                    setYearDrafts((current) =>
                      current.map((item) =>
                        item.clientKey === year.clientKey
                          ? { ...item, endDate: event.target.value }
                          : item,
                      ),
                    )
                  }
                  data-testid={index === 0 ? "guide-school-end" : undefined}
                />
              </label>
              <div className="weekday-row">
                {WEEKDAYS.map((day) => (
                  <label key={day.value}>
                    <input
                      type="checkbox"
                      checked={year.usualWeekdays.includes(day.value)}
                      onChange={(event) =>
                        setYearDrafts((current) =>
                          current.map((item) =>
                            item.clientKey === year.clientKey
                              ? {
                                  ...item,
                                  usualWeekdays: event.target.checked
                                    ? [...item.usualWeekdays, day.value]
                                    : item.usualWeekdays.filter((value) => value !== day.value),
                                }
                              : item,
                          ),
                        )
                      }
                    />
                    {day.label}
                  </label>
                ))}
              </div>
              {year.exceptions.length > 0 ? (
                <ul className="simple-list">
                  {year.exceptions.map((exception, exIndex) => (
                    <li key={exception.id ?? `${year.clientKey}-ex-${exIndex}`}>
                      {exception.name}: {exception.startDate}
                      {exception.endDate !== exception.startDate
                        ? ` – ${exception.endDate}`
                        : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="meta">No exceptions on this year</p>
              )}
            </fieldset>
          ))}
          <div className="button-row">
            <button
              type="button"
              onClick={() =>
                setYearDrafts((current) => [...current, emptyYearDraft()])
              }
            >
              Add year
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              data-testid="guide-school-save"
              onClick={() => void saveSchool("completed")}
            >
              Save calendar
            </button>
            <button
              type="button"
              disabled={busy}
              data-testid="guide-school-not-now"
              onClick={() => void saveSchool("skipped")}
            >
              Not now
            </button>
          </div>
        </div>
      ) : null}

      {step === "work" ? (
        <div className="guide-step is-current" data-testid="guide-work">
          <h2>First work</h2>
          <p className="meta">
            Routine: each selected person gets a checklist. Responsibility: one owner per
            applicable day.
            {editingDefinitionId && !createAnother
              ? " Editing the saved definition (current plan)."
              : null}
          </p>
          {progress.workDefinitionIds.length > 0 && !createAnother ? (
            <div className="button-row">
              {progress.workDefinitionIds.length > 1 ? (
                <label>
                  Saved work
                  <select
                    data-testid="guide-select-saved-work"
                    value={selectedWorkId ?? progress.workDefinitionIds[0]}
                    onChange={(event) => {
                      const id = event.target.value;
                      setSelectedWorkId(id);
                      void hydrateSavedWork(progress, people, id);
                    }}
                  >
                    {progress.workDefinitionIds.map((id, index) => (
                      <option key={id} value={id}>
                        Item {index + 1}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <button type="button" data-testid="guide-create-another" onClick={beginCreateAnother}>
                Create different work
              </button>
            </div>
          ) : null}
          <label>
            Kind
            <select
              value={workKind}
              onChange={(event) => {
                setWorkKind(event.target.value as typeof workKind);
                invalidatePreview();
              }}
              data-testid="guide-work-kind"
              disabled={Boolean(editingDefinitionId && !createAnother)}
            >
              <option value="routine">Routine</option>
              <option value="responsibility">Responsibility</option>
              {!editingDefinitionId || createAnother ? (
                <>
                  <option value="both">Both</option>
                  <option value="skip">Finish setup for now</option>
                </>
              ) : null}
            </select>
          </label>
          {workKind !== "skip" ? (
            <div className="stack-form">
              <label>
                Name
                <input
                  value={workTitle}
                  onChange={(event) => {
                    setWorkTitle(event.target.value);
                    invalidatePreview();
                  }}
                  data-testid="guide-work-title"
                />
              </label>
              <label>
                Daypart
                <select
                  value={daypart}
                  onChange={(event) => {
                    setDaypart(event.target.value as Daypart);
                    invalidatePreview();
                  }}
                  data-testid="guide-work-daypart"
                >
                  {DAYPARTS.map((part) => (
                    <option key={part} value={part}>
                      {part}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend>Recurrence</legend>
                <div className="weekday-row">
                  {WEEKDAYS.map((day) => (
                    <label key={day.value}>
                      <input
                        type="checkbox"
                        checked={weekdays.includes(day.value)}
                        onChange={(event) => {
                          setWeekdays((current) =>
                            event.target.checked
                              ? [...current, day.value]
                              : current.filter((value) => value !== day.value),
                          );
                          invalidatePreview();
                        }}
                      />
                      {day.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>Ordered steps</legend>
                {workSteps.map((stepRow, index) => (
                  <div key={`step-${index}`} className="guide-step-row">
                    <label>
                      Step {index + 1}
                      <input
                        value={stepRow.text}
                        onChange={(event) => {
                          setWorkSteps((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, text: event.target.value }
                                : item,
                            ),
                          );
                          invalidatePreview();
                        }}
                        data-testid={index === 0 ? "guide-work-step" : undefined}
                      />
                    </label>
                    <label>
                      Obligation
                      <select
                        value={stepRow.obligation}
                        onChange={(event) => {
                          setWorkSteps((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    obligation: event.target.value as "required" | "optional",
                                  }
                                : item,
                            ),
                          );
                          invalidatePreview();
                        }}
                        data-testid={index === 0 ? "guide-work-step-obligation" : undefined}
                      >
                        <option value="required">Required</option>
                        <option value="optional">Optional</option>
                      </select>
                    </label>
                    {workKind === "routine" || workKind === "both" ? (
                      <label>
                        Applicability
                        <select
                          value={stepRow.applicability.kind}
                          onChange={(event) => {
                            const kind = event.target.value as ApplicabilityRule["kind"];
                            setWorkSteps((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, applicability: { kind } as ApplicabilityRule }
                                  : item,
                              ),
                            );
                            invalidatePreview();
                          }}
                        >
                          <option value="every_time">Every time</option>
                          <option value="school_days">School days</option>
                          <option value="no_school_days">No school days</option>
                        </select>
                      </label>
                    ) : null}
                    <div className="button-row">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => {
                          setWorkSteps((current) => {
                            if (index === 0) return current;
                            const next = [...current];
                            const tmp = next[index - 1]!;
                            next[index - 1] = next[index]!;
                            next[index] = tmp;
                            return next;
                          });
                          invalidatePreview();
                        }}
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        disabled={index === workSteps.length - 1}
                        onClick={() => {
                          setWorkSteps((current) => {
                            if (index >= current.length - 1) return current;
                            const next = [...current];
                            const tmp = next[index + 1]!;
                            next[index + 1] = next[index]!;
                            next[index] = tmp;
                            return next;
                          });
                          invalidatePreview();
                        }}
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        disabled={workSteps.length <= 1}
                        onClick={() => {
                          setWorkSteps((current) => current.filter((_, i) => i !== index));
                          invalidatePreview();
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setWorkSteps((current) => [
                      ...current,
                      {
                        text: "New step",
                        obligation: "required",
                        applicability: DEFAULT_APPLICABILITY,
                      },
                    ]);
                    invalidatePreview();
                  }}
                >
                  Add step
                </button>
              </fieldset>
              {(workKind === "routine" || workKind === "both") && (
                <>
                  <fieldset>
                    <legend>Routine audience</legend>
                    {activePeople.map((person) => (
                      <label key={person.id}>
                        <input
                          type="checkbox"
                          checked={audienceIds.includes(person.id)}
                          onChange={(event) => {
                            setAudienceIds((current) =>
                              event.target.checked
                                ? [...current, person.id]
                                : current.filter((id) => id !== person.id),
                            );
                            invalidatePreview();
                          }}
                        />
                        {person.displayName}
                      </label>
                    ))}
                  </fieldset>
                  {groups.length > 0 ? (
                    <fieldset data-testid="guide-audience-groups">
                      <legend>Audience groups</legend>
                      {groups.map((group) => (
                        <label key={group.id}>
                          <input
                            type="checkbox"
                            checked={audienceGroupIds.includes(group.id)}
                            onChange={(event) => {
                              setAudienceGroupIds((current) =>
                                event.target.checked
                                  ? [...current, group.id]
                                  : current.filter((id) => id !== group.id),
                              );
                              invalidatePreview();
                            }}
                          />
                          {group.name}
                        </label>
                      ))}
                    </fieldset>
                  ) : null}
                </>
              )}
              {(workKind === "responsibility" || workKind === "both") && (
                <>
                  <label>
                    Assignment
                    <select
                      value={assignmentMode}
                      onChange={(event) => {
                        setAssignmentMode(event.target.value as typeof assignmentMode);
                        invalidatePreview();
                      }}
                      data-testid="guide-assignment-mode"
                    >
                      <option value="fixed">Fixed owner</option>
                      <option value="take_turns">Take turns</option>
                      <option value="weekly">Weekly</option>
                    </select>
                  </label>
                  {assignmentMode === "fixed" ? (
                    <label>
                      Owner
                      <select
                        value={ownerId}
                        onChange={(event) => {
                          setOwnerId(event.target.value);
                          invalidatePreview();
                        }}
                        data-testid="guide-work-owner"
                      >
                        <option value="">Unassigned</option>
                        {activePeople.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.displayName}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {assignmentMode === "take_turns" ? (
                    <fieldset data-testid="guide-cycle-order">
                      <legend>Take-turns order</legend>
                      {activePeople.map((person) => (
                        <label key={person.id}>
                          <input
                            type="checkbox"
                            checked={cycleOrder.includes(person.id)}
                            onChange={(event) => {
                              setCycleOrder((current) =>
                                event.target.checked
                                  ? [...current, person.id]
                                  : current.filter((id) => id !== person.id),
                              );
                              invalidatePreview();
                            }}
                          />
                          {person.displayName}
                        </label>
                      ))}
                    </fieldset>
                  ) : null}
                  {assignmentMode === "weekly" ? (
                    <fieldset data-testid="guide-weekly-map">
                      <legend>Weekly ownership</legend>
                      {WEEKDAYS.map((day) => (
                        <label key={day.value}>
                          {day.label}
                          <select
                            value={weeklyMap[day.value] ?? ""}
                            onChange={(event) => {
                              setWeeklyMap((current) => ({
                                ...current,
                                [day.value]: event.target.value,
                              }));
                              invalidatePreview();
                            }}
                          >
                            <option value="">Unassigned</option>
                            {activePeople.map((person) => (
                              <option key={person.id} value={person.id}>
                                {person.displayName}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </fieldset>
                  ) : null}
                  <fieldset data-testid="guide-scheduled-additions">
                    <legend>Scheduled additions</legend>
                    {scheduledAdditions.map((addition, index) => (
                      <div key={addition.clientKey} className="stack-form">
                        <label>
                          Name
                          <input
                            value={addition.name}
                            onChange={(event) => {
                              setScheduledAdditions((current) =>
                                current.map((item, i) =>
                                  i === index ? { ...item, name: event.target.value } : item,
                                ),
                              );
                              invalidatePreview();
                            }}
                          />
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={addition.inheritAssignment}
                            onChange={(event) => {
                              setScheduledAdditions((current) =>
                                current.map((item, i) =>
                                  i === index
                                    ? { ...item, inheritAssignment: event.target.checked }
                                    : item,
                                ),
                              );
                              invalidatePreview();
                            }}
                          />
                          Inherit assignment
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            setScheduledAdditions((current) =>
                              current.filter((_, i) => i !== index),
                            );
                            invalidatePreview();
                          }}
                        >
                          Remove addition
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      data-testid="guide-add-scheduled"
                      onClick={() => {
                        setScheduledAdditions((current) => [
                          ...current,
                          {
                            clientKey: newClientId(),
                            name: "Deep clean",
                            weekdays: [6],
                            inheritAssignment: true,
                            steps: [{ text: "Extra wipe", obligation: "required" }],
                          },
                        ]);
                        invalidatePreview();
                      }}
                    >
                      Add scheduled work
                    </button>
                  </fieldset>
                </>
              )}
              {previewText ? (
                <pre className="guide-preview" data-testid="guide-work-preview">
                  {previewText}
                </pre>
              ) : null}
              <div className="button-row">
                <button
                  type="button"
                  disabled={busy}
                  data-testid="guide-work-review"
                  onClick={() => void runPreview()}
                >
                  Review
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={busy || !previewText}
                  data-testid="guide-work-save"
                  onClick={() => void saveWork("completed")}
                >
                  {editingDefinitionId && !createAnother ? "Save changes" : "Save work"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={busy}
              data-testid="guide-work-finish-for-now"
              onClick={() => void saveWork("skipped")}
            >
              Finish setup for now
            </button>
          )}
        </div>
      ) : null}

      {step === "recap" ? (
        <div className="guide-step is-current" data-testid="guide-recap">
          <h2>You are ready for Today</h2>
          <ul className="simple-list">
            <li>People: {progress.peopleStatus.replace("_", " ")}</li>
            <li>School: {progress.schoolStatus.replace("_", " ")}</li>
            <li>First work: {progress.firstWorkStatus.replace("_", " ")}</li>
          </ul>
          {manager ? <p>Manager: {manager.displayName}</p> : null}
          {others.length > 0 ? (
            <p>Family: {others.map((person) => person.displayName).join(", ")}</p>
          ) : null}
          {savedWorkSummary.length > 0 ? (
            <ul className="simple-list" data-testid="guide-recap-work">
              {savedWorkSummary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="meta">No first work saved yet — you can return from Settings.</p>
          )}
          {progress.workDefinitionIds.length > 0 ? (
            <button
              type="button"
              data-testid="guide-edit-saved-work"
              onClick={() => {
                void hydrateSavedWork(progress, people).then(() => setStep("work"));
              }}
            >
              Edit saved work
            </button>
          ) : null}
          <div className="button-row">
            <button
              type="button"
              className="primary"
              disabled={busy}
              data-testid="guide-go-today"
              onClick={() => void finishAndGo("today", false)}
            >
              Go to Today
            </button>
            <button
              type="button"
              disabled={busy}
              data-testid="guide-view-household"
              onClick={() => void finishAndGo("household", false)}
            >
              View household
            </button>
          </div>
          <p className="meta">
            Optional: <a href="/household/displays">Set up the wall display</a> ·{" "}
            <a href="/household/people">Set up sign-in</a>
          </p>
          {!progress.dismissedAt ? (
            <button type="button" disabled={busy} onClick={() => void dismissChecklist()}>
              Dismiss finish-setup reminder
            </button>
          ) : null}
        </div>
      ) : null}

      {step !== "recap" ? (
        <div className="button-row guide-exit-row">
          <button
            type="button"
            data-testid="guide-save-finish-later"
            onClick={saveAndFinishLater}
          >
            Save and finish later
          </button>
        </div>
      ) : null}
    </section>
  );
}
