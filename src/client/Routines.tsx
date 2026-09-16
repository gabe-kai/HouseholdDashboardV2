import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Daypart, GroupPublic, MemberPublic } from "../shared/schemas";
import {
  createRevision,
  createRoutine,
  deleteRoutine,
  deleteScheduleEntry,
  endRoutine,
  fetchGroups,
  fetchRoutine,
  fetchRoutines,
  fetchSession,
  moveScheduleEntry,
  type ApiError,
  type PlanRefineOutcome,
  type Routine,
  type RoutineMutationResult,
  type RoutineRevision,
  type ScheduleEntry,
} from "./api";
import { newClientId } from "./id";
import {
  NameSectionEditor,
  RoutineFocusedSummary,
  StepRowEditor,
  StepsSectionEditor,
  WhenSectionEditor,
} from "./RoutineFocusedEditor";

/** Client copy of domain DAYPART_LABELS (avoid domain import in client bundle). */
export const DAYPART_LABELS: Record<Daypart, string> = {
  morning: "Morning",
  after_school: "After school",
  evening: "Evening",
  bedtime: "Bedtime",
  anytime: "Anytime",
};

const WEEKDAYS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];
const WEEKDAY_SET = [1, 2, 3, 4, 5];
const WEEKEND_SET = [6, 7];

type ViewState =
  | { kind: "list" }
  | { kind: "ended" }
  | { kind: "detail"; definitionId: string }
  | { kind: "create" }
  | {
      kind: "edit";
      definitionId: string;
      mode: "current" | "schedule-new" | "schedule-edit";
      scheduleEntryId?: string;
    }
  | {
      kind: "picker";
      returnTo: "create" | "edit";
      definitionId?: string;
      editMode?: "current" | "schedule-new" | "schedule-edit";
      scheduleEntryId?: string;
    };

type DraftStep = {
  text: string;
  obligation: "required" | "as_needed" | "optional";
  logicalItemId?: string;
};

type Draft = {
  title: string;
  daypart: Daypart;
  weekdays: number[];
  assigneeMemberIds: string[];
  assigneeGroupIds: string[];
  steps: DraftStep[];
  startingDate: string;
};

function emptyDraft(today: string): Draft {
  return {
    title: "",
    daypart: "anytime",
    weekdays: [...EVERY_DAY],
    assigneeMemberIds: [],
    assigneeGroupIds: [],
    steps: [{ text: "New step", obligation: "required" }],
    startingDate: today,
  };
}

function FocusHeading(props: { id: string; children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.focus();
    node.scrollIntoView({ block: "nearest" });
  }, []);
  return (
    <h2 id={props.id} ref={ref} tabIndex={-1} className="focus-heading">
      {props.children}
    </h2>
  );
}

function BackButton(props: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="back-link" onClick={props.onClick}>
      {props.label}
    </button>
  );
}

function memberNames(ids: string[], people: MemberPublic[]): string {
  return ids
    .map((id) => people.find((person) => person.id === id)?.displayName ?? "Unknown")
    .join(", ");
}

function uniqueFromIds(
  directIds: string[],
  groupIds: string[],
  groups: GroupPublic[],
  mode: "effective" | "configured",
): number {
  const set = new Set(directIds);
  for (const groupId of groupIds) {
    const group = groups.find((item) => item.id === groupId);
    const ids =
      mode === "configured"
        ? (group?.membershipIds ?? [])
        : (group?.effectiveMembershipIds ?? group?.membershipIds ?? []);
    for (const membershipId of ids) set.add(membershipId);
  }
  return set.size;
}

function activeScheduleEntries(entries: ScheduleEntry[]): ScheduleEntry[] {
  return entries
    .filter((entry) => entry.canceledAt == null)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** Greatest active startDate <= today among scheduleEntries. */
function selectCurrentScheduleEntry(
  routine: Routine,
  today: string,
): ScheduleEntry | null {
  const eligible = activeScheduleEntries(routine.scheduleEntries).filter(
    (entry) => entry.startDate <= today,
  );
  return eligible.length === 0 ? null : eligible[eligible.length - 1]!;
}

function upcomingScheduleEntries(routine: Routine, today: string): ScheduleEntry[] {
  return activeScheduleEntries(routine.scheduleEntries).filter(
    (entry) => entry.startDate > today,
  );
}

function fallbackRevision(routine: Routine): RoutineRevision | null {
  return routine.revisions.at(-1) ?? null;
}

function currentRevision(routine: Routine, today: string): RoutineRevision | null {
  const entry = selectCurrentScheduleEntry(routine, today);
  return entry?.revision ?? fallbackRevision(routine);
}

function obligationLabel(obligation: RoutineRevision["steps"][number]["obligation"]): string {
  if (obligation === "as_needed") return "As needed";
  if (obligation === "required") return "Required";
  return "Optional";
}

function draftFromRevision(revision: RoutineRevision, startingDate: string): Draft {
  return {
    title: revision.title,
    daypart: revision.daypart,
    weekdays: [...revision.weekdays],
    assigneeMemberIds: [...revision.assigneeMemberIds],
    assigneeGroupIds: [...(revision.assigneeGroupIds ?? [])],
    steps: revision.steps.map((step) => ({
      text: step.text,
      obligation: step.obligation,
      logicalItemId: step.logicalItemId,
    })),
    startingDate,
  };
}

function draftSnapshot(draft: Draft): string {
  return JSON.stringify({
    title: draft.title,
    daypart: draft.daypart,
    weekdays: [...draft.weekdays].sort((a, b) => a - b),
    assigneeMemberIds: [...draft.assigneeMemberIds].sort(),
    assigneeGroupIds: [...draft.assigneeGroupIds].sort(),
    steps: draft.steps.map((step) => ({
      text: step.text,
      obligation: step.obligation,
      logicalItemId: step.logicalItemId ?? null,
    })),
    startingDate: draft.startingDate,
  });
}

function weekdaysLabel(weekdays: number[]): string {
  const sorted = [...weekdays].sort((a, b) => a - b);
  if (sorted.length === 7 && EVERY_DAY.every((day) => sorted.includes(day))) {
    return "Every day";
  }
  if (
    sorted.length === 5 &&
    WEEKDAY_SET.every((day) => sorted.includes(day)) &&
    sorted.every((day) => WEEKDAY_SET.includes(day))
  ) {
    return "Weekdays";
  }
  if (
    sorted.length === 2 &&
    WEEKEND_SET.every((day) => sorted.includes(day)) &&
    sorted.every((day) => WEEKEND_SET.includes(day))
  ) {
    return "Weekends";
  }
  return sorted
    .map((day) => WEEKDAYS.find((item) => item.value === day)?.label ?? String(day))
    .join(", ");
}

function whoSummary(
  revision: RoutineRevision,
  people: MemberPublic[],
  groups: GroupPublic[],
): string {
  const parts: string[] = [];
  for (const groupId of revision.assigneeGroupIds ?? []) {
    parts.push(groups.find((group) => group.id === groupId)?.name ?? "Group");
  }
  for (const membershipId of revision.assigneeMemberIds) {
    parts.push(people.find((person) => person.id === membershipId)?.displayName ?? "Person");
  }
  return parts.length ? parts.join(", ") : "Nobody selected";
}

function configurationSummary(
  revision: RoutineRevision,
  people: MemberPublic[],
  groups: GroupPublic[],
): string {
  return `${weekdaysLabel(revision.weekdays)} · ${DAYPART_LABELS[revision.daypart]} · ${whoSummary(revision, people, groups)}`;
}

function groupMemberLine(
  group: GroupPublic | undefined,
  people: MemberPublic[],
): { today: string; pending: string | null } {
  if (!group) return { today: "Group", pending: null };
  const effective = group.effectiveMembershipIds ?? group.membershipIds;
  const today =
    effective.length === 0 ? "No members for today" : memberNames(effective, people);
  if (
    group.membershipPendingFromDate &&
    JSON.stringify([...group.membershipIds].sort()) !==
      JSON.stringify([...effective].sort())
  ) {
    const configured =
      group.membershipIds.length === 0
        ? "No members yet"
        : memberNames(group.membershipIds, people);
    return {
      today,
      pending: `Starting ${group.membershipPendingFromDate}: ${configured}`,
    };
  }
  return { today, pending: null };
}

function nameForMembership(membershipId: string, people: MemberPublic[]): string {
  return people.find((person) => person.id === membershipId)?.displayName ?? "Someone";
}

function formatRefineStatus(
  prefix: string,
  outcome: PlanRefineOutcome | undefined,
  people: MemberPublic[],
): string {
  if (!outcome) return prefix;
  const updated = outcome.updatedMemberIds.map((id) => nameForMembership(id, people));
  const protectedNames = outcome.protectedMemberIds.map((id) =>
    nameForMembership(id, people),
  );
  const parts: string[] = [prefix];
  if (updated.length) {
    parts.push(
      updated.length === 1
        ? `Updated for ${updated[0]}`
        : `Updated for ${updated.join(", ")}`,
    );
  }
  if (protectedNames.length) {
    parts.push(
      protectedNames.length === 1
        ? `${protectedNames[0]} already started, so their routine stayed unchanged`
        : `${protectedNames.join(", ")} already started, so their routines stayed unchanged`,
    );
  }
  return parts.join(". ") + (parts.length > 1 ? "." : "");
}

function isInactiveRoutine(routine: Routine): boolean {
  return routine.ended || routine.archived;
}

function addDays(date: string, days: number): string {
  const instant = new Date(`${date}T12:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

function confirmDiscard(): boolean {
  return window.confirm(
    "You have unsaved changes. Discard them?\n\nOK = Discard · Cancel = Keep editing",
  );
}

type EditorFocus =
  | null
  | "name"
  | "when"
  | "steps"
  | { kind: "step"; index: number; localId: string };

type RoutinesRoute =
  | { kind: "list" }
  | { kind: "detail"; definitionId: string };

export function RoutinesView(props: {
  memberships: MemberPublic[];
  onSaved: (routine: Routine) => void;
  onEnded?: (routine: Routine) => void;
  onDeleted?: (definitionId: string) => void;
  refreshToken?: number;
  today: string;
  /** Addressable list/detail from App History API routes. */
  route: RoutinesRoute;
  onRouteChange: (route: RoutinesRoute) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSuccessToast?: (message: string) => void;
}) {
  const [view, setView] = useState<ViewState>(() =>
    props.route.kind === "detail"
      ? { kind: "detail", definitionId: props.route.definitionId }
      : { kind: "list" },
  );
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [endedRoutines, setEndedRoutines] = useState<Routine[]>([]);
  const [detailRoutine, setDetailRoutine] = useState<Routine | null>(null);
  const [groups, setGroups] = useState<GroupPublic[]>([]);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(props.today));
  const [baselineSnapshot, setBaselineSnapshot] = useState("");
  const [pickerMembers, setPickerMembers] = useState<string[]>([]);
  const [pickerGroups, setPickerGroups] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [deleteOfferEnd, setDeleteOfferEnd] = useState(false);
  const [stepsExpanded, setStepsExpanded] = useState(false);
  const [editorFocus, setEditorFocus] = useState<EditorFocus>(null);
  const [sectionDraft, setSectionDraft] = useState<Draft | null>(null);
  const [stepLocalIds, setStepLocalIds] = useState<string[]>([]);
  const [unavailableDetail, setUnavailableDetail] = useState(false);
  const [scheduleCollision, setScheduleCollision] = useState<{
    occupiedDate: string;
    conflictingScheduleEntryId: string;
  } | null>(null);
  const listGenerationRef = useRef(0);
  const detailGenerationRef = useRef(0);
  const selectedDefinitionRef = useRef<string | null>(null);
  const editorHouseholdDateRef = useRef(props.today);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const dirty =
    (baselineSnapshot !== "" && draftSnapshot(draft) !== baselineSnapshot) ||
    sectionDraft !== null;

  useEffect(() => {
    props.onDirtyChange?.(dirty);
  }, [dirty, props.onDirtyChange]);

  function ensureStepLocalIds(steps: DraftStep[]): string[] {
    return steps.map((step, index) => step.logicalItemId ?? stepLocalIds[index] ?? newClientId());
  }

  function announceSuccess(message: string) {
    props.onSuccessToast?.(message);
    setStatusMessage(null);
  }

  /** Sync addressable list/detail from App; create/edit/picker/ended stay under parent URL. */
  const routeKind = props.route.kind;
  const routeDefinitionId =
    props.route.kind === "detail" ? props.route.definitionId : null;
  const routeKey = routeDefinitionId ? `detail:${routeDefinitionId}` : "list";
  useEffect(() => {
    if (routeKind === "list") {
      setView((current) => {
        if (current.kind === "detail" || current.kind === "edit") {
          return { kind: "list" };
        }
        return current;
      });
      setEditorFocus(null);
      setSectionDraft(null);
      setUnavailableDetail(false);
      return;
    }
    if (!routeDefinitionId) return;
    const definitionId = routeDefinitionId;
    setUnavailableDetail(false);
    setView((current) => {
      if (
        (current.kind === "edit" || current.kind === "picker" || current.kind === "detail") &&
        "definitionId" in current &&
        current.definitionId === definitionId
      ) {
        return current;
      }
      return { kind: "detail", definitionId };
    });
  }, [routeKey, routeKind, routeDefinitionId]);

  function goList() {
    setEditorFocus(null);
    setSectionDraft(null);
    setView({ kind: "list" });
    props.onRouteChange({ kind: "list" });
  }

  function goDetail(definitionId: string) {
    setEditorFocus(null);
    setSectionDraft(null);
    setUnavailableDetail(false);
    setView({ kind: "detail", definitionId });
    props.onRouteChange({ kind: "detail", definitionId });
  }

  function applyDetailRoutine(next: Routine) {
    setDetailRoutine((prev) => {
      if (prev && prev.id === next.id && prev.version > next.version) {
        return prev;
      }
      // Same version: keep local if it already dropped canceled/deleted upcoming rows
      // that a raced GET might still include.
      if (prev && prev.id === next.id && prev.version === next.version) {
        const prevUpcoming = prev.scheduleEntries.filter((e) => e.canceledAt == null).length;
        const nextUpcoming = next.scheduleEntries.filter((e) => e.canceledAt == null).length;
        if (prevUpcoming < nextUpcoming) return prev;
      }
      return next;
    });
  }

  async function loadList() {
    const generation = ++listGenerationRef.current;
    const [activeResult, allResult, groupsResult] = await Promise.all([
      fetchRoutines(false),
      fetchRoutines(true),
      fetchGroups(),
    ]);
    if (generation !== listGenerationRef.current) return;
    setGroups(groupsResult.groups);
    setRoutines(activeResult.routines.filter((routine) => !isInactiveRoutine(routine)));
    setEndedRoutines(allResult.routines.filter((routine) => isInactiveRoutine(routine)));
  }

  async function loadDetail(definitionId: string) {
    selectedDefinitionRef.current = definitionId;
    const generation = ++detailGenerationRef.current;
    try {
      const [routineResult, groupsResult] = await Promise.all([
        fetchRoutine(definitionId),
        fetchGroups(),
      ]);
      if (generation !== detailGenerationRef.current) return;
      if (selectedDefinitionRef.current !== definitionId) return;
      setUnavailableDetail(false);
      setError(null);
      setGroups(groupsResult.groups);
      applyDetailRoutine(routineResult.routine);
    } catch (caught) {
      if (generation !== detailGenerationRef.current) return;
      if (selectedDefinitionRef.current !== definitionId) return;
      setUnavailableDetail(true);
      setDetailRoutine(null);
      setError(null);
      void caught;
    }
  }

  useEffect(() => {
    void loadList().catch((caught) =>
      setError(caught instanceof Error ? caught.message : "Something went wrong"),
    );
  }, [props.refreshToken]);

  useEffect(() => {
    if (view.kind === "detail" || view.kind === "edit") {
      const definitionId = view.definitionId;
      void loadDetail(definitionId).catch((caught) =>
        setError(caught instanceof Error ? caught.message : "Something went wrong"),
      );
      return;
    }
    if (view.kind === "list" || view.kind === "ended") {
      selectedDefinitionRef.current = null;
      setDetailRoutine(null);
      setMoreOpen(false);
      setDeleteOfferEnd(false);
    }
  }, [view, props.refreshToken]);

  useEffect(() => {
    if (!moreOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMoreOpen(false);
    }
    function onPointer(event: MouseEvent) {
      if (!moreMenuRef.current?.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [moreOpen]);

  function beginDraft(next: Draft) {
    setDraft(next);
    setBaselineSnapshot(draftSnapshot(next));
    setStepLocalIds(
      next.steps.map((step) => step.logicalItemId ?? newClientId()),
    );
    setEditorFocus(null);
    setSectionDraft(null);
    editorHouseholdDateRef.current = props.today;
    setScheduleCollision(null);
  }

  function openCreate() {
    setError(null);
    setStatusMessage(null);
    setDeleteOfferEnd(false);
    beginDraft(emptyDraft(props.today));
    setView({ kind: "create" });
    if (props.route.kind !== "list") props.onRouteChange({ kind: "list" });
  }

  function openEditCurrent(routine: Routine) {
    const current = currentRevision(routine, props.today);
    if (!current) return;
    setError(null);
    setStatusMessage(null);
    setDeleteOfferEnd(false);
    beginDraft(draftFromRevision(current, props.today));
    applyDetailRoutine(routine);
    setView({ kind: "edit", definitionId: routine.id, mode: "current" });
  }

  function openScheduleLater(routine: Routine) {
    const current = currentRevision(routine, props.today);
    if (!current) return;
    setError(null);
    setStatusMessage(null);
    setDeleteOfferEnd(false);
    setMoreOpen(false);
    beginDraft(draftFromRevision(current, addDays(props.today, 1)));
    applyDetailRoutine(routine);
    setView({ kind: "edit", definitionId: routine.id, mode: "schedule-new" });
  }

  function openEditUpcoming(routine: Routine, entry: ScheduleEntry) {
    setError(null);
    setStatusMessage(null);
    setDeleteOfferEnd(false);
    beginDraft(draftFromRevision(entry.revision, entry.startDate));
    applyDetailRoutine(routine);
    setView({
      kind: "edit",
      definitionId: routine.id,
      mode: "schedule-edit",
      scheduleEntryId: entry.id,
    });
  }

  function tryLeaveEditor(destination: ViewState) {
    if (dirty && !confirmDiscard()) return;
    setError(null);
    setDeleteOfferEnd(false);
    setEditorFocus(null);
    setSectionDraft(null);
    if (destination.kind === "list") {
      goList();
      return;
    }
    if (destination.kind === "detail") {
      goDetail(destination.definitionId);
      return;
    }
    setView(destination);
  }

  function openPicker() {
    setPickerMembers([...draft.assigneeMemberIds]);
    setPickerGroups([...draft.assigneeGroupIds]);
    setError(null);
    if (view.kind === "create") {
      setView({ kind: "picker", returnTo: "create" });
      return;
    }
    if (view.kind === "edit") {
      setView({
        kind: "picker",
        returnTo: "edit",
        definitionId: view.definitionId,
        editMode: view.mode,
        scheduleEntryId: view.scheduleEntryId,
      });
    }
  }

  function applyPicker(event: FormEvent) {
    event.preventDefault();
    if (pickerMembers.length === 0 && pickerGroups.length === 0) {
      setError("Choose at least one person or group.");
      return;
    }
    setDraft((current) => ({
      ...current,
      assigneeMemberIds: pickerMembers,
      assigneeGroupIds: pickerGroups,
    }));
    setError(null);
    if (view.kind !== "picker") return;
    if (view.returnTo === "create") setView({ kind: "create" });
    else if (view.definitionId && view.editMode) {
      setView({
        kind: "edit",
        definitionId: view.definitionId,
        mode: view.editMode,
        scheduleEntryId: view.scheduleEntryId,
      });
    }
  }

  function cancelPicker() {
    setError(null);
    if (view.kind !== "picker") return;
    if (view.returnTo === "create") setView({ kind: "create" });
    else if (view.definitionId && view.editMode) {
      setView({
        kind: "edit",
        definitionId: view.definitionId,
        mode: view.editMode,
        scheduleEntryId: view.scheduleEntryId,
      });
    }
  }

  function validateDraft(): boolean {
    if (!draft.title.trim()) {
      setError("Enter a routine name.");
      return false;
    }
    if (draft.assigneeMemberIds.length === 0 && draft.assigneeGroupIds.length === 0) {
      setError("Add people or groups before saving.");
      return false;
    }
    if (draft.weekdays.length === 0) {
      setError("Choose at least one weekday.");
      return false;
    }
    if (draft.steps.length === 0) {
      setError("Add at least one step.");
      return false;
    }
    if (draft.steps.some((step) => !step.text.trim())) {
      setError("Every step needs text.");
      return false;
    }
    return true;
  }

  function mutationPayload() {
    return {
      mutationId: newClientId(),
      title: draft.title.trim(),
      daypart: draft.daypart,
      weekdays: draft.weekdays,
      assigneeMemberIds: draft.assigneeMemberIds,
      assigneeGroupIds: draft.assigneeGroupIds,
      steps: draft.steps.map((step) => ({
        text: step.text.trim(),
        obligation: step.obligation,
        ...(step.logicalItemId ? { logicalItemId: step.logicalItemId } : {}),
      })),
    };
  }

  async function saveCreate() {
    if (busy || !validateDraft()) return;
    setBusy(true);
    setError(null);
    setScheduleCollision(null);
    try {
      const session = await fetchSession();
      if (session && session.householdDate !== editorHouseholdDateRef.current) {
        setError(
          `The household date changed to ${session.householdDate}. Your draft is kept — review Starting/today and save again.`,
        );
        setBusy(false);
        return;
      }
      const result = await createRoutine(mutationPayload());
      if (selectedDefinitionRef.current && selectedDefinitionRef.current !== result.routine.id) {
        return;
      }
      applyDetailRoutine(result.routine);
      await loadList();
      const revision = currentRevision(result.routine, props.today);
      announceSuccess(
        revision
          ? `Created “${revision.title}”. Active from ${revision.effectiveDate}.`
          : "Created.",
      );
      setBaselineSnapshot(draftSnapshot(draft));
      props.onDirtyChange?.(false);
      goDetail(result.routine.id);
      props.onSaved(result.routine);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Routine couldn't be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (busy || view.kind !== "edit" || !validateDraft()) return;
    const definitionId = view.definitionId;
    const editMode = view.mode;
    const scheduleEntryId = view.scheduleEntryId;
    setBusy(true);
    setError(null);
    setScheduleCollision(null);
    try {
      const session = await fetchSession();
      if (session && session.householdDate !== editorHouseholdDateRef.current) {
        setError(
          `The household date changed to ${session.householdDate}. Your draft is kept — review the date and save again.`,
        );
        setBusy(false);
        return;
      }

      const current =
        detailRoutine ?? (await fetchRoutine(definitionId)).routine;
      if (!current) throw new Error("Routine not found");

      let result: RoutineMutationResult;
      const payload = mutationPayload();

      if (editMode === "current") {
        result = await createRevision(definitionId, {
          ...payload,
          expectedVersion: current.version,
          effectiveDate: props.today,
          mode: "current",
        });
        announceSuccess(
          formatRefineStatus("Saved", result.refineOutcome, props.memberships),
        );
      } else if (editMode === "schedule-new") {
        if (draft.startingDate <= props.today) {
          setError("Scheduled changes must start after today.");
          setBusy(false);
          return;
        }
        result = await createRevision(definitionId, {
          ...payload,
          expectedVersion: current.version,
          effectiveDate: draft.startingDate,
          mode: "schedule",
        });
        announceSuccess(`Change scheduled for ${draft.startingDate}.`);
      } else {
        if (!scheduleEntryId) throw new Error("Schedule entry not found");
        const originalEntry = current.scheduleEntries.find(
          (entry) => entry.id === scheduleEntryId,
        );
        const originalDate = originalEntry?.startDate ?? draft.startingDate;
        result = await createRevision(definitionId, {
          ...payload,
          expectedVersion: current.version,
          effectiveDate: originalDate,
          mode: "schedule",
          scheduleEntryId,
        });
        if (draft.startingDate !== originalDate) {
          if (draft.startingDate < props.today) {
            setError("Cannot move a scheduled change to a past date.");
            setBusy(false);
            return;
          }
          result = await moveScheduleEntry(definitionId, scheduleEntryId, {
            mutationId: newClientId(),
            expectedVersion: result.routine.version,
            startDate: draft.startingDate,
          });
          announceSuccess(
            draft.startingDate === props.today
              ? formatRefineStatus(
                  `Moved to today`,
                  result.refineOutcome,
                  props.memberships,
                )
              : `Upcoming change moved to ${draft.startingDate}.`,
          );
        } else {
          announceSuccess(`Upcoming change for ${originalDate} saved.`);
        }
      }

      if (
        selectedDefinitionRef.current &&
        selectedDefinitionRef.current !== result.routine.id
      ) {
        return;
      }
      applyDetailRoutine(result.routine);
      await loadList();
      setBaselineSnapshot(draftSnapshot(draft));
      props.onDirtyChange?.(false);
      setScheduleCollision(null);
      goDetail(result.routine.id);
      props.onSaved(result.routine);
    } catch (caught) {
      const apiErr = caught as ApiError;
      if (
        apiErr.code === "CONFLICT" &&
        /already exists for that date/i.test(apiErr.message ?? "")
      ) {
        const occupiedDate = apiErr.occupiedDate ?? draft.startingDate;
        const conflictingScheduleEntryId =
          apiErr.conflictingScheduleEntryId ??
          detailRoutine?.scheduleEntries.find(
            (entry) =>
              entry.startDate === occupiedDate &&
              entry.id !== scheduleEntryId,
          )?.id;
        if (conflictingScheduleEntryId) {
          setScheduleCollision({ occupiedDate, conflictingScheduleEntryId });
        }
        setError(
          `A change already starts on ${occupiedDate}. Choose another date or edit the existing change. Your draft is kept.`,
        );
      } else {
        setError(caught instanceof Error ? caught.message : "Routine couldn't be saved.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteUpcoming(routine: Routine, entry: ScheduleEntry) {
    if (
      !window.confirm(
        `Delete the upcoming change starting ${entry.startDate}? The previous plan continues until the next remaining change.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const expectedVersion =
        detailRoutine?.id === routine.id ? detailRoutine.version : routine.version;
      const result = await deleteScheduleEntry(routine.id, entry.id, {
        mutationId: newClientId(),
        expectedVersion,
      });
      // Defensively drop the deleted entry even if a stale refresh races in.
      const cleaned: Routine = {
        ...result.routine,
        scheduleEntries: result.routine.scheduleEntries.filter(
          (item) => item.id !== entry.id && item.canceledAt == null,
        ),
      };
      // Invalidate in-flight detail fetches so they cannot restore the entry.
      detailGenerationRef.current += 1;
      applyDetailRoutine(cleaned);
      announceSuccess(`Deleted upcoming change for ${entry.startDate}.`);
      await loadList();
      props.onSaved(cleaned);
      // Re-read once after list refresh; version guard keeps our newer state.
      void loadDetail(routine.id).catch(() => undefined);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Upcoming change couldn't be deleted.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnd(routine: Routine) {
    const title =
      currentRevision(routine, props.today)?.title ??
      fallbackRevision(routine)?.title ??
      "this routine";
    if (
      !window.confirm(
        `End ${title}? Unstarted work today and later stops. Started checklists stay available. Ended routines leave the active list.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setMoreOpen(false);
    setDeleteOfferEnd(false);
    try {
      const result = await endRoutine(routine.id, {
        mutationId: newClientId(),
        expectedVersion: routine.version,
      });
      announceSuccess(`Ended ${title}.`);
      await loadList();
      applyDetailRoutine(result.routine);
      goDetail(result.routine.id);
      props.onEnded?.(result.routine);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Routine couldn't be ended.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete(routine: Routine) {
    const title =
      currentRevision(routine, props.today)?.title ??
      fallbackRevision(routine)?.title ??
      "this routine";
    if (
      !window.confirm(
        `Delete ${title} permanently? This only works when there is no started work, history, or personal records to keep.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setMoreOpen(false);
    try {
      await deleteRoutine(routine.id, {
        mutationId: newClientId(),
        expectedVersion: routine.version,
      });
      announceSuccess(`Deleted ${title}.`);
      setDeleteOfferEnd(false);
      await loadList();
      setDetailRoutine(null);
      goList();
      props.onDeleted?.(routine.id);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Routine couldn't be deleted.";
      const code = (caught as ApiError).code;
      const ineligible =
        code === "CONFLICT" || /cannot be deleted/i.test(message);
      if (ineligible) {
        setError(`${message} You can End the routine instead to keep history.`);
        setDeleteOfferEnd(true);
      } else {
        setError(message);
        setDeleteOfferEnd(false);
      }
    } finally {
      setBusy(false);
    }
  }

  function renderRoutineRow(
    routine: Routine,
    options?: { showCutoff?: boolean },
  ) {
    const revision = currentRevision(routine, props.today);
    if (!revision) return null;
    return (
      <li key={routine.id}>
        <button
          type="button"
          className="routine-card"
          onClick={() => {
            setStatusMessage(null);
            setDeleteOfferEnd(false);
            goDetail(routine.id);
          }}
        >
          <span className="person-name">{revision.title}</span>
          <span className="meta">
            {weekdaysLabel(revision.weekdays)} · {DAYPART_LABELS[revision.daypart]}
          </span>
          <span className="meta">{whoSummary(revision, props.memberships, groups)}</span>
          {options?.showCutoff && routine.archiveCutoffDate ? (
            <span className="meta">Cutoff {routine.archiveCutoffDate}</span>
          ) : null}
          {options?.showCutoff && routine.ended ? (
            <span className="meta">Ended</span>
          ) : null}
        </button>
      </li>
    );
  }

  if (view.kind === "picker") {
    return (
      <section className="panel people-groups routines-view">
        <div className="focused-state" aria-labelledby="participation-picker-heading">
          <BackButton
            label={view.returnTo === "create" ? "Back to new routine" : "Back to edit"}
            onClick={cancelPicker}
          />
          <FocusHeading id="participation-picker-heading">Who does this routine?</FocusHeading>
          <p className="meta">
            Selecting people or groups updates this draft only. The routine is not saved until you
            choose Save. People already included through a group stay with that group. Configured
            group changes that start tomorrow are labeled separately from today.
          </p>
          {error ? <p role="alert">{error}</p> : null}
          <form className="form-grid" onSubmit={applyPicker}>
            <fieldset>
              <legend>Groups</legend>
              {groups.length === 0 ? (
                <p className="meta">No groups yet. Create one in People &amp; Groups.</p>
              ) : (
                <ul className="people-list">
                  {groups.map((group) => {
                    const selected = pickerGroups.includes(group.id);
                    const line = groupMemberLine(group, props.memberships);
                    return (
                      <li key={group.id}>
                        <label className={`choice-row person-row ${selected ? "selected" : ""}`}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => {
                              const nextSelected = !selected;
                              setPickerGroups((current) =>
                                nextSelected
                                  ? [...current, group.id]
                                  : current.filter((id) => id !== group.id),
                              );
                              if (nextSelected) {
                                setPickerMembers((members) =>
                                  members.filter((id) => !group.membershipIds.includes(id)),
                                );
                              }
                            }}
                          />
                          <span>
                            <span className="person-name">{group.name}</span>
                            <span className="meta">
                              Today: {line.today}
                              {line.pending ? ` · ${line.pending}` : ""}
                              {" · "}
                              one routine per member
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </fieldset>
            <fieldset>
              <legend>People</legend>
              <ul className="people-list">
                {props.memberships.map((person) => {
                  const covered = pickerGroups.some((groupId) =>
                    groups
                      .find((group) => group.id === groupId)
                      ?.membershipIds.includes(person.id),
                  );
                  const selected = pickerMembers.includes(person.id) || covered;
                  return (
                    <li key={person.id}>
                      <label className={`choice-row person-row ${selected ? "selected" : ""}`}>
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={covered}
                          onChange={() => {
                            if (covered) return;
                            setPickerMembers((current) =>
                              current.includes(person.id)
                                ? current.filter((id) => id !== person.id)
                                : [...current, person.id],
                            );
                          }}
                        />
                        <span>
                          <span className="person-name">{person.displayName}</span>
                          <span className="meta">
                            {covered
                              ? `Included through ${
                                  groups.find(
                                    (group) =>
                                      pickerGroups.includes(group.id) &&
                                      group.membershipIds.includes(person.id),
                                  )?.name ?? "a group"
                                }`
                              : person.status === "pending"
                                ? "No app access yet"
                                : "Direct"}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
            <p className="meta">
              {uniqueFromIds(pickerMembers, pickerGroups, groups, "configured")}{" "}
              {uniqueFromIds(pickerMembers, pickerGroups, groups, "configured") === 1
                ? "person"
                : "people"}{" "}
              after the next save takes effect
            </p>
            <div className="button-row">
              <button type="submit" className="primary">
                Apply who does this
              </button>
              <button type="button" onClick={cancelPicker}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      </section>
    );
  }

  if (view.kind === "create" || view.kind === "edit") {
    const editing = view.kind === "edit";
    const scheduleMode =
      editing && (view.mode === "schedule-new" || view.mode === "schedule-edit");
    const heading =
      !editing
        ? "New routine"
        : view.mode === "schedule-new"
          ? "Schedule for later"
          : view.mode === "schedule-edit"
            ? "Edit upcoming change"
            : "Edit routine";
    const working = sectionDraft ?? draft;
    const workingIds =
      sectionDraft && editorFocus === "steps"
        ? ensureStepLocalIds(sectionDraft.steps)
        : stepLocalIds.length === draft.steps.length
          ? stepLocalIds
          : ensureStepLocalIds(draft.steps);

    function openSection(focus: Exclude<EditorFocus, null>) {
      setError(null);
      if (focus === "name" || focus === "when" || focus === "steps") {
        setSectionDraft({ ...draft, steps: draft.steps.map((step) => ({ ...step })) });
        if (focus === "steps") {
          setStepLocalIds(ensureStepLocalIds(draft.steps));
        }
        setEditorFocus(focus);
        return;
      }
      setEditorFocus(focus);
    }

    function cancelSection() {
      setSectionDraft(null);
      setEditorFocus(null);
      setError(null);
    }

    function doneName() {
      if (!sectionDraft) return;
      if (!sectionDraft.title.trim()) {
        setError("Enter a routine name.");
        return;
      }
      setDraft((current) => ({ ...current, title: sectionDraft.title }));
      setSectionDraft(null);
      setEditorFocus(null);
      setError(null);
    }

    function doneWhen() {
      if (!sectionDraft) return;
      if (sectionDraft.weekdays.length === 0) {
        setError("Choose at least one weekday.");
        return;
      }
      setDraft((current) => ({
        ...current,
        daypart: sectionDraft.daypart,
        weekdays: sectionDraft.weekdays,
        startingDate: sectionDraft.startingDate,
      }));
      setSectionDraft(null);
      setEditorFocus(null);
      setError(null);
    }

    function doneSteps() {
      if (!sectionDraft) return;
      if (sectionDraft.steps.length === 0) {
        setError("Add at least one step.");
        return;
      }
      if (sectionDraft.steps.some((step) => !step.text.trim())) {
        setError("Every step needs text.");
        return;
      }
      const ids = ensureStepLocalIds(sectionDraft.steps);
      setDraft((current) => ({ ...current, steps: sectionDraft.steps }));
      setStepLocalIds(ids);
      setSectionDraft(null);
      setEditorFocus(null);
      setError(null);
    }

    if (editorFocus === "name" && sectionDraft) {
      return (
        <section className="panel people-groups routines-view">
          <div className="focused-state" aria-labelledby="routine-name-heading">
            <BackButton label={`Back to ${heading}`} onClick={cancelSection} />
            <FocusHeading id="routine-name-heading">Edit name</FocusHeading>
            {error ? <p role="alert">{error}</p> : null}
            <NameSectionEditor
              value={sectionDraft.title}
              onChange={(title) => setSectionDraft({ ...sectionDraft, title })}
              onDone={doneName}
              onCancel={cancelSection}
            />
          </div>
        </section>
      );
    }

    if (editorFocus === "when" && sectionDraft) {
      return (
        <section className="panel people-groups routines-view">
          <div className="focused-state" aria-labelledby="routine-when-heading">
            <BackButton label={`Back to ${heading}`} onClick={cancelSection} />
            <FocusHeading id="routine-when-heading">Edit when</FocusHeading>
            {error ? <p role="alert">{error}</p> : null}
            <WhenSectionEditor
              daypart={sectionDraft.daypart}
              weekdays={sectionDraft.weekdays}
              onChange={(next) => setSectionDraft({ ...sectionDraft, ...next })}
              onDone={doneWhen}
              onCancel={cancelSection}
            />
          </div>
        </section>
      );
    }

    if (
      editorFocus !== null &&
      typeof editorFocus === "object" &&
      editorFocus.kind === "step" &&
      sectionDraft
    ) {
      const index = sectionDraft.steps.findIndex(
        (_, i) => (stepLocalIds[i] ?? ensureStepLocalIds(sectionDraft.steps)[i]) === editorFocus.localId,
      );
      const stepIndex = index >= 0 ? index : editorFocus.index;
      const step = sectionDraft.steps[stepIndex];
      if (!step) {
        return (
          <section className="panel people-groups routines-view">
            <p className="meta">Step unavailable.</p>
            <button type="button" onClick={() => setEditorFocus("steps")}>
              Back to Steps
            </button>
          </section>
        );
      }
      return (
          <section className="panel people-groups routines-view">
            <div className="focused-state" aria-labelledby="routine-step-heading">
              <BackButton label="Back to Steps" onClick={() => setEditorFocus("steps")} />
              <FocusHeading id="routine-step-heading">Edit step</FocusHeading>
              {error ? <p role="alert">{error}</p> : null}
              <StepRowEditor
                step={step}
                canRemove={sectionDraft.steps.length > 1}
                onChange={(nextStep) =>
                  setSectionDraft({
                    ...sectionDraft,
                    steps: sectionDraft.steps.map((item, i) =>
                      i === stepIndex ? nextStep : item,
                    ),
                  })
                }
                onRemove={() => {
                  const nextSteps = sectionDraft.steps.filter((_, i) => i !== stepIndex);
                  const nextIds = workingIds.filter((_, i) => i !== stepIndex);
                  setSectionDraft({ ...sectionDraft, steps: nextSteps });
                  setStepLocalIds(nextIds);
                  setEditorFocus("steps");
                }}
                onDone={() => setEditorFocus("steps")}
                onCancel={() => setEditorFocus("steps")}
              />
            </div>
          </section>
        );
    }

    if (editorFocus === "steps" && sectionDraft) {
      return (
        <section className="panel people-groups routines-view">
          <div className="focused-state" aria-labelledby="routine-steps-heading">
            <BackButton label={`Back to ${heading}`} onClick={cancelSection} />
            <FocusHeading id="routine-steps-heading">Edit steps</FocusHeading>
            {error ? <p role="alert">{error}</p> : null}
            <StepsSectionEditor
              steps={sectionDraft.steps}
              stepLocalIds={workingIds}
              onChange={(steps, localIds) => {
                setSectionDraft({ ...sectionDraft, steps });
                setStepLocalIds(localIds);
              }}
              onEditStep={(index, localId) =>
                setEditorFocus({ kind: "step", index, localId })
              }
              onDone={doneSteps}
              onCancel={cancelSection}
            />
          </div>
        </section>
      );
    }

    return (
      <section className="panel people-groups routines-view">
        <div className="focused-state" aria-labelledby="routine-form-heading">
          <BackButton
            label={
              editing
                ? `Back to ${draft.title.trim() || "routine"}`
                : "Back to Routines"
            }
            onClick={() => {
              if (editing) {
                tryLeaveEditor({ kind: "detail", definitionId: view.definitionId });
              } else {
                tryLeaveEditor({ kind: "list" });
              }
            }}
          />
          <FocusHeading id="routine-form-heading">{heading}</FocusHeading>
          <p className="meta">
            {!editing
              ? "New routines start today when they apply. Edit one section at a time, then save."
              : view.mode === "schedule-new"
                ? "Scheduling copies this draft into a future change. Today's plan stays as it is."
                : view.mode === "schedule-edit"
                  ? "Changes apply to this upcoming entry. You can move its Starting date, including to today."
                  : "Save changes updates applicable unstarted work from today forward. Started checklists stay unchanged."}
          </p>
          {error ? <p role="alert">{error}</p> : null}
          {scheduleCollision ? (
            <div className="status-notice" role="status">
              <p>
                {scheduleCollision.occupiedDate} already has an upcoming change.
              </p>
              <div className="button-row">
                <button
                  type="button"
                  onClick={() => {
                    setScheduleCollision(null);
                    setError(null);
                    const starting = document.getElementById("routine-starting-date");
                    starting?.focus();
                  }}
                >
                  Choose another date
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const routine = detailRoutine;
                    const entry = routine?.scheduleEntries.find(
                      (item) => item.id === scheduleCollision.conflictingScheduleEntryId,
                    );
                    if (!routine || !entry) {
                      setError("Could not open the existing change. Choose another date.");
                      return;
                    }
                    if (dirty && !confirmDiscard()) return;
                    setScheduleCollision(null);
                    openEditUpcoming(routine, entry);
                  }}
                >
                  Edit existing change
                </button>
              </div>
            </div>
          ) : null}
          <RoutineFocusedSummary
            draft={working}
            scheduleMode={scheduleMode}
            people={props.memberships}
            groups={groups}
            stepLocalIds={workingIds}
            onOpenName={() => openSection("name")}
            onOpenWhen={() => openSection("when")}
            onOpenWho={openPicker}
            onOpenSteps={() => openSection("steps")}
            startingMin={
              editing && view.kind === "edit" && view.mode === "schedule-edit"
                ? props.today
                : addDays(props.today, 1)
            }
            onStartingDateChange={(startingDate) =>
              setDraft((current) => ({ ...current, startingDate }))
            }
          />
          <div className="button-row">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void (editing ? saveEdit() : saveCreate())}
            >
              {busy
                ? "Saving…"
                : editing
                  ? view.mode === "schedule-new"
                    ? "Schedule change"
                    : "Save changes"
                  : "Create routine"}
            </button>
            {editing && view.mode === "current" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setDraft((current) => ({
                    ...current,
                    startingDate:
                      current.startingDate > props.today
                        ? current.startingDate
                        : addDays(props.today, 1),
                  }));
                  setView({
                    kind: "edit",
                    definitionId: view.definitionId,
                    mode: "schedule-new",
                  });
                }}
              >
                Schedule for later
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (editing) {
                  tryLeaveEditor({ kind: "detail", definitionId: view.definitionId });
                } else {
                  tryLeaveEditor({ kind: "list" });
                }
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </section>
    );
  }


  if (view.kind === "detail") {
    const routine = detailRoutine;
    const todayRevision = routine ? currentRevision(routine, props.today) : null;
    const upcoming = routine ? upcomingScheduleEntries(routine, props.today) : [];
    const title =
      todayRevision?.title ??
      (routine ? fallbackRevision(routine)?.title : null) ??
      "Routine";
    const inactive = routine ? isInactiveRoutine(routine) : false;
    const visibleSteps = todayRevision
      ? stepsExpanded || todayRevision.steps.length <= 5
        ? todayRevision.steps
        : todayRevision.steps.slice(0, 5)
      : [];

    return (
      <section className="panel people-groups routines-view">
        <div className="focused-state routine-detail" aria-labelledby="routine-detail-heading">
          <BackButton
            label={inactive ? "Back to Ended routines" : "Back to Routines"}
            onClick={() => {
              if (inactive) setView({ kind: "ended" });
              else goList();
            }}
          />
          <FocusHeading id="routine-detail-heading">{title}</FocusHeading>
          {unavailableDetail ? (
            <div className="status-notice" role="status">
              <p>This routine is unavailable.</p>
              <button type="button" className="primary" onClick={goList}>
                Back to Routines
              </button>
            </div>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
          {deleteOfferEnd && routine && !inactive ? (
            <p className="status-notice" role="status">
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => void confirmEnd(routine)}
              >
                End routine instead
              </button>
            </p>
          ) : null}
          {!unavailableDetail && (!routine || !todayRevision) ? (
            <p className="meta">Loading routine…</p>
          ) : null}
          {!unavailableDetail && routine && todayRevision ? (
            <>
              {inactive ? (
                <p className="meta">
                  {routine.ended ? "Ended" : "Archived"}
                  {routine.archiveCutoffDate
                    ? ` · no assignments from ${routine.archiveCutoffDate}`
                    : ""}
                </p>
              ) : null}
              <p className="meta">
                {weekdaysLabel(todayRevision.weekdays)} · {DAYPART_LABELS[todayRevision.daypart]}
              </p>
              <h3>Who</h3>
              <p>{whoSummary(todayRevision, props.memberships, groups)}</p>
              <p className="meta">
                {(todayRevision.resolvedMemberIds ?? []).length}{" "}
                {(todayRevision.resolvedMemberIds ?? []).length === 1 ? "person" : "people"} unique
                today
              </p>
              {todayRevision.upcomingParticipationFromDate &&
              todayRevision.upcomingResolvedMemberIds ? (
                <p className="meta">
                  Starting {todayRevision.upcomingParticipationFromDate}:{" "}
                  {todayRevision.upcomingResolvedMemberIds.length}{" "}
                  {todayRevision.upcomingResolvedMemberIds.length === 1 ? "person" : "people"} unique
                </p>
              ) : null}
              <h3>
                Steps · {todayRevision.steps.length}
              </h3>
              <ol className="compact-step-list">
                {visibleSteps.map((step, index) => (
                  <li key={step.id ?? step.logicalItemId} className="compact-step">
                    <span className="meta">{index + 1}.</span>
                    <strong>{step.text}</strong>
                    <span className="meta">{obligationLabel(step.obligation)}</span>
                  </li>
                ))}
              </ol>
              {todayRevision.steps.length > 5 ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setStepsExpanded((open) => !open)}
                >
                  {stepsExpanded
                    ? "Show fewer steps"
                    : `Show all ${todayRevision.steps.length} steps`}
                </button>
              ) : null}
              {upcoming.length > 0 ? (
                <section
                  className="upcoming-section"
                  aria-labelledby="upcoming-changes-heading"
                >
                  <h3 id="upcoming-changes-heading">
                    {upcoming.length === 1 ? "Upcoming change" : "Upcoming changes"}
                  </h3>
                  <ul className="simple-list">
                    {upcoming.map((entry) => (
                      <li key={entry.id}>
                        <p className="routine-upcoming-title">
                          Starting {entry.startDate}
                        </p>
                        <p className="meta">
                          {entry.revision.title} ·{" "}
                          {configurationSummary(entry.revision, props.memberships, groups)}
                        </p>
                        {!inactive ? (
                          <div className="button-row">
                            <button
                              type="button"
                              onClick={() => openEditUpcoming(routine, entry)}
                            >
                              Edit upcoming
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void confirmDeleteUpcoming(routine, entry)}
                            >
                              Delete upcoming
                            </button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {!inactive ? (
                <div className="detail-actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => openEditCurrent(routine)}
                  >
                    Edit
                  </button>
                  <div className="more-wrap" ref={moreMenuRef}>
                    <button
                      type="button"
                      aria-haspopup="menu"
                      aria-expanded={moreOpen}
                      aria-controls="routine-more-menu"
                      onClick={() => setMoreOpen((open) => !open)}
                    >
                      More
                    </button>
                    {moreOpen ? (
                      <div
                        id="routine-more-menu"
                        className="more-menu-panel"
                        role="menu"
                        aria-label="More routine actions"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => openScheduleLater(routine)}
                        >
                          Schedule for later
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={busy}
                          onClick={() => void confirmEnd(routine)}
                        >
                          End routine
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={busy}
                          onClick={() => void confirmDelete(routine)}
                        >
                          Delete routine
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </section>
    );
  }


  if (view.kind === "ended") {
    return (
      <section className="panel people-groups routines-view">
        <div className="focused-state" aria-labelledby="ended-routines-heading">
          <BackButton label="Back to Routines" onClick={() => setView({ kind: "list" })} />
          <FocusHeading id="ended-routines-heading">Ended routines</FocusHeading>
          {error ? <p role="alert">{error}</p> : null}
          {endedRoutines.length === 0 ? (
            <p className="meta">No ended or archived routines.</p>
          ) : (
            <ul className="routine-list routine-card-list">
              {endedRoutines.map((routine) => renderRoutineRow(routine, { showCutoff: true }))}
            </ul>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="panel people-groups routines-view">
      <div className="focused-state" aria-labelledby="routines-heading">
        <h1 id="routines-heading">Routines</h1>
        <p className="meta">
          {routines.length} active {routines.length === 1 ? "routine" : "routines"}
        </p>
        {statusMessage ? (
          <p className="status-notice" role="status">
            {statusMessage}
          </p>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        <div className="button-row">
          <button type="button" className="primary" onClick={openCreate}>
            Create routine
          </button>
        </div>
        {routines.length === 0 ? (
          <p className="meta">No active routines yet. Create one to get started.</p>
        ) : (
          <ul className="routine-list routine-card-list">
            {routines.map((routine) => renderRoutineRow(routine))}
          </ul>
        )}
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setStatusMessage(null);
            setView({ kind: "ended" });
          }}
        >
          Ended routines
        </button>
      </div>
    </section>
  );
}
