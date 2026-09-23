import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type {
  AssignmentSpec,
  Daypart,
  MemberPublic,
  ResponsibilityPreviewDay,
  ScheduledAdditionSpec,
} from "../shared/schemas";
import { DEFAULT_APPLICABILITY } from "../domain/applicability";
import {
  createResponsibility,
  createResponsibilityRevision,
  deleteResponsibility,
  deleteResponsibilityScheduleEntry,
  endResponsibility,
  fetchResponsibility,
  fetchResponsibilityPreview,
  fetchResponsibilities,
  fetchSession,
  previewDraftResponsibility,
  type ApiError,
  type PlanRefineOutcome,
  type Responsibility,
  type ResponsibilityMutationResult,
  type RoutineRevision,
  type ScheduleEntry,
} from "./api";
import { newClientId } from "./id";
import { OrderedList } from "./OrderedList";
import {
  NameSectionEditor,
  RoutineFocusedSummary,
  StepRowEditor,
  StepsSectionEditor,
  WhenSectionEditor,
  type EditorDraft,
  type EditorDraftStep,
} from "./RoutineFocusedEditor";
import { DAYPART_LABELS } from "./Routines";

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];

const WEEKDAYS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

type AssignmentMode = "fixed" | "take_turns" | "weekly";

type ScheduledAdditionDraft = {
  id: string;
  name: string;
  weekdays: number[];
  inheritAssignment: boolean;
  assignmentMode: AssignmentMode;
  fixedMemberId: string;
  cycleOrder: string[];
  weeklyMap: Partial<Record<number, string>>;
  steps: EditorDraftStep[];
};

type EditorFocus =
  | null
  | "name"
  | "when"
  | "assignment"
  | "work"
  | "save-preview"
  | { kind: "work-base" }
  | { kind: "work-addition"; additionId: string }
  | { kind: "step"; index: number; localId: string }
  | { kind: "addition-step"; additionId: string; index: number; localId: string };

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
      purpose: "fixed" | "weekly-day" | "cycle-add" | "addition-fixed" | "addition-weekly-day" | "addition-cycle-add";
      definitionId?: string;
      editMode?: "current" | "schedule-new" | "schedule-edit";
      scheduleEntryId?: string;
      weeklyDay?: number;
      additionId?: string;
    };

type Draft = {
  title: string;
  daypart: Daypart;
  weekdays: number[];
  accountableMemberId: string;
  assignmentMode: AssignmentMode;
  cycleOrder: string[];
  weeklyMap: Partial<Record<number, string>>;
  scheduledAdditions: ScheduledAdditionDraft[];
  steps: EditorDraftStep[];
  startingDate: string;
};

function defaultWeeklyMap(fallbackMemberId = ""): Partial<Record<number, string>> {
  const map: Partial<Record<number, string>> = {};
  for (let day = 1; day <= 7; day += 1) {
    if (fallbackMemberId) map[day] = fallbackMemberId;
  }
  return map;
}

function normalizeWeeklyMap(
  raw: Partial<Record<number, string>> | Record<string, string> | undefined,
  fallbackMemberId = "",
): Partial<Record<number, string>> {
  if (!raw || Object.keys(raw).length === 0) return defaultWeeklyMap(fallbackMemberId);
  const map: Partial<Record<number, string>> = {};
  for (let day = 1; day <= 7; day += 1) {
    const value = raw[day as keyof typeof raw] ?? raw[String(day) as keyof typeof raw];
    if (value) map[day] = value;
  }
  return map;
}

function emptyAdditionDraft(parentWeekdays: number[]): ScheduledAdditionDraft {
  return {
    id: newClientId(),
    name: "Scheduled work",
    weekdays: parentWeekdays.includes(6) ? [6] : [parentWeekdays[0] ?? 1],
    inheritAssignment: true,
    assignmentMode: "fixed",
    fixedMemberId: "",
    cycleOrder: [],
    weeklyMap: defaultWeeklyMap(),
    steps: [{ text: "New step", obligation: "required", applicability: DEFAULT_APPLICABILITY }],
  };
}

function emptyDraft(today: string): Draft {
  return {
    title: "",
    daypart: "anytime",
    weekdays: [...EVERY_DAY],
    accountableMemberId: "",
    assignmentMode: "fixed",
    cycleOrder: [],
    weeklyMap: defaultWeeklyMap(),
    scheduledAdditions: [],
    steps: [{ text: "New step", obligation: "required", applicability: DEFAULT_APPLICABILITY }],
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

function draftSnapshot(draft: Draft): string {
  return JSON.stringify({
    title: draft.title.trim(),
    daypart: draft.daypart,
    weekdays: [...draft.weekdays].sort((a, b) => a - b),
    accountableMemberId: draft.accountableMemberId,
    assignmentMode: draft.assignmentMode,
    cycleOrder: [...draft.cycleOrder],
    weeklyMap: draft.weeklyMap,
    scheduledAdditions: draft.scheduledAdditions.map((addition) => ({
      id: addition.id,
      name: addition.name.trim(),
      weekdays: [...addition.weekdays].sort((a, b) => a - b),
      inheritAssignment: addition.inheritAssignment,
      assignmentMode: addition.assignmentMode,
      fixedMemberId: addition.fixedMemberId,
      cycleOrder: [...addition.cycleOrder],
      weeklyMap: addition.weeklyMap,
      steps: addition.steps.map((step) => ({
        text: step.text.trim(),
        obligation: step.obligation,
        logicalItemId: step.logicalItemId ?? null,
      })),
    })),
    startingDate: draft.startingDate,
    steps: draft.steps.map((step) => ({
      text: step.text.trim(),
      obligation: step.obligation,
      logicalItemId: step.logicalItemId ?? null,
    })),
  });
}

function assignmentFromSpec(
  spec: AssignmentSpec | undefined,
  fallbackMemberId: string,
  _anchorDate: string,
): Pick<Draft, "assignmentMode" | "accountableMemberId" | "cycleOrder" | "weeklyMap"> {
  if (!spec) {
    return {
      assignmentMode: "fixed",
      accountableMemberId: fallbackMemberId,
      cycleOrder: [],
      weeklyMap: defaultWeeklyMap(fallbackMemberId),
    };
  }
  return {
    assignmentMode: spec.mode,
    accountableMemberId: spec.mode === "fixed" ? (spec.fixedMemberId ?? fallbackMemberId) : "",
    cycleOrder: spec.cycleOrder ?? [],
    weeklyMap: normalizeWeeklyMap(spec.weeklyMap, spec.fixedMemberId ?? fallbackMemberId),
  };
}

function additionFromSpec(spec: ScheduledAdditionSpec): ScheduledAdditionDraft {
  const assignmentFields = spec.inheritAssignment
    ? {
        assignmentMode: "fixed" as AssignmentMode,
        accountableMemberId: "",
        cycleOrder: [] as string[],
        weeklyMap: defaultWeeklyMap(),
      }
    : assignmentFromSpec(spec.assignment, "", spec.assignment?.anchorDate ?? "");
  return {
    id: spec.id ?? newClientId(),
    name: spec.name,
    weekdays: [...spec.weekdays],
    inheritAssignment: spec.inheritAssignment,
    assignmentMode: assignmentFields.assignmentMode,
    fixedMemberId: assignmentFields.accountableMemberId,
    cycleOrder: assignmentFields.cycleOrder,
    weeklyMap: assignmentFields.weeklyMap,
    steps: spec.steps.map((step) => ({
      text: step.text,
      obligation: step.obligation,
      logicalItemId: step.logicalItemId,
      applicability: DEFAULT_APPLICABILITY,
    })),
  };
}

function draftFromRevision(revision: RoutineRevision, startingDate: string): Draft {
  const fallbackOwner = revision.assigneeMemberIds[0] ?? "";
  const assignmentFields = assignmentFromSpec(
    revision.assignment,
    fallbackOwner,
    revision.effectiveDate,
  );
  return {
    title: revision.title,
    daypart: revision.daypart,
    weekdays: [...revision.weekdays],
    ...assignmentFields,
    scheduledAdditions: (revision.scheduledAdditions ?? []).map(additionFromSpec),
    steps: revision.steps.map((step) => ({
      text: step.text,
      obligation: step.obligation,
      logicalItemId: step.logicalItemId,
      applicability: DEFAULT_APPLICABILITY,
    })),
    startingDate,
  };
}

function buildAssignmentSpec(
  mode: AssignmentMode,
  anchorDate: string,
  fields: {
    accountableMemberId: string;
    cycleOrder: string[];
    weeklyMap: Partial<Record<number, string>>;
  },
): AssignmentSpec {
  if (mode === "fixed") {
    return {
      mode: "fixed",
      anchorDate,
      fixedMemberId: fields.accountableMemberId,
      cycleOrder: [],
      weeklyMap: {},
      excludedMemberIds: [],
      savedRingOrder: [],
    };
  }
  if (mode === "take_turns") {
    return {
      mode: "take_turns",
      anchorDate,
      cycleOrder: fields.cycleOrder,
      weeklyMap: {},
      excludedMemberIds: [],
      savedRingOrder: fields.cycleOrder,
    };
  }
  const weeklyMap: Record<string, string> = {};
  for (let day = 1; day <= 7; day += 1) {
    weeklyMap[String(day)] = fields.weeklyMap[day] ?? "";
  }
  return {
    mode: "weekly",
    anchorDate,
    weeklyMap,
    cycleOrder: [],
    excludedMemberIds: [],
    savedRingOrder: [],
  };
}

function needsSavePreview(draft: Draft): boolean {
  if (draft.assignmentMode !== "fixed") return true;
  return draft.scheduledAdditions.some((addition) => !addition.inheritAssignment);
}

function previewRowsForAddition(
  preview: ResponsibilityPreviewDay[] | null,
  additionWeekdays: number[],
  limit = 3,
): ResponsibilityPreviewDay[] {
  if (!preview) return [];
  return preview
    .filter((day) => day.applicable && additionWeekdays.includes(isoWeekdayFromDate(day.householdDate)))
    .slice(0, limit);
}

function isoWeekdayFromDate(householdDate: string): number {
  const day = new Date(`${householdDate}T12:00:00`).getDay();
  return day === 0 ? 7 : day;
}

function AdditionEditor(props: {
  addition: ScheduledAdditionDraft;
  parentWeekdays: number[];
  ownerName: (memberId: string) => string;
  additionPreviewDays: ResponsibilityPreviewDay[] | null;
  onPreview: () => void;
  onChange: (next: ScheduledAdditionDraft) => void;
  onRemove: () => void;
  onOpenPicker: (
    purpose: "addition-fixed" | "addition-weekly-day" | "addition-cycle-add",
    options?: { weeklyDay?: number; initialMemberId?: string },
  ) => void;
  onEditStep: (index: number, localId: string) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const stepLocalIds = props.addition.steps.map((step) => step.logicalItemId ?? newClientId());
  const previewRows = previewRowsForAddition(
    props.additionPreviewDays,
    props.addition.weekdays,
  );
  return (
    <div className="form-grid" aria-labelledby="addition-editor-heading">
      <FocusHeading id="addition-editor-heading">Scheduled work</FocusHeading>
      <label>
        Name
        <input
          autoFocus
          value={props.addition.name}
          onChange={(event) => props.onChange({ ...props.addition, name: event.target.value })}
        />
      </label>
      <fieldset>
        <legend>Weekdays</legend>
        <div className="weekday-row">
          {WEEKDAYS.map((day) => (
            <label key={day.value}>
              <input
                type="checkbox"
                checked={props.addition.weekdays.includes(day.value)}
                disabled={!props.parentWeekdays.includes(day.value)}
                onChange={(event) =>
                  props.onChange({
                    ...props.addition,
                    weekdays: event.target.checked
                      ? [...props.addition.weekdays, day.value]
                      : props.addition.weekdays.filter((value) => value !== day.value),
                  })
                }
              />
              {day.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="choice-row">
        <input
          type="checkbox"
          checked={props.addition.inheritAssignment}
          onChange={(event) =>
            props.onChange({ ...props.addition, inheritAssignment: event.target.checked })
          }
        />
        Use this responsibility&apos;s assignment
      </label>
      {!props.addition.inheritAssignment ? (
        <fieldset>
          <legend>Ownership for this scheduled work</legend>
          <div className="button-row">
            {(["fixed", "take_turns", "weekly"] as AssignmentMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={props.addition.assignmentMode === mode ? "primary" : undefined}
                onClick={() => props.onChange({ ...props.addition, assignmentMode: mode })}
              >
                {mode === "fixed"
                  ? "Fixed person"
                  : mode === "take_turns"
                    ? "Take turns"
                    : "Weekly pattern"}
              </button>
            ))}
          </div>
          {props.addition.assignmentMode === "fixed" ? (
            <button
              type="button"
              onClick={() =>
                props.onOpenPicker("addition-fixed", {
                  initialMemberId: props.addition.fixedMemberId,
                })
              }
            >
              {props.addition.fixedMemberId
                ? props.ownerName(props.addition.fixedMemberId)
                : "Choose person"}
            </button>
          ) : null}
          {props.addition.assignmentMode === "take_turns" ? (
            <>
              <OrderedList
                listLabel="Turn order"
                items={props.addition.cycleOrder.map((memberId) => ({
                  id: memberId,
                  label: props.ownerName(memberId),
                }))}
                onReorder={(next) =>
                  props.onChange({
                    ...props.addition,
                    cycleOrder: next.map((item) => item.id),
                  })
                }
                renderRow={(item) => <strong>{item.label}</strong>}
              />
              <button type="button" onClick={() => props.onOpenPicker("addition-cycle-add")}>
                Add person
              </button>
            </>
          ) : null}
          {props.addition.assignmentMode === "weekly" ? (
            <ul className="section-summary">
              {WEEKDAYS.map((day) => (
                <li key={day.value}>
                  <button
                    type="button"
                    className="section-summary-row"
                    onClick={() =>
                      props.onOpenPicker("addition-weekly-day", {
                        weeklyDay: day.value,
                        initialMemberId: props.addition.weeklyMap[day.value],
                      })
                    }
                  >
                    <strong>{day.label}</strong>
                    <span>
                      {props.addition.weeklyMap[day.value]
                        ? props.ownerName(props.addition.weeklyMap[day.value]!)
                        : "Choose person"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </fieldset>
      ) : null}
      <StepsSectionEditor
        steps={props.addition.steps}
        stepLocalIds={stepLocalIds}
        listLabel="Scheduled work items"
        hideApplicability
        onChange={(steps) => props.onChange({ ...props.addition, steps })}
        onEditStep={props.onEditStep}
        onDone={props.onDone}
        onCancel={props.onCancel}
      />
      <div>
        <button type="button" onClick={props.onPreview}>
          Preview next dates
        </button>
        {previewRows.length > 0 ? (
          <ul className="simple-list responsibility-preview-list">
            {previewRows.map((day) => (
              <li key={day.householdDate}>
                <strong>{day.householdDate}</strong>
                <span className="meta">
                  {" "}
                  · {day.accountableMemberName ?? "Unassigned"}
                  {day.stepCount != null ? ` · ${day.stepCount} items` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : props.additionPreviewDays ? (
          <p className="meta">No matching dates in the next week.</p>
        ) : null}
      </div>
      <button type="button" className="text-button danger-text" onClick={props.onRemove}>
        Remove scheduled work
      </button>
    </div>
  );
}

function assignmentSummary(
  draft: Draft,
  ownerName: (memberId: string) => string,
): string {
  if (draft.assignmentMode === "fixed") {
    return draft.accountableMemberId ? ownerName(draft.accountableMemberId) : "Nobody selected";
  }
  if (draft.assignmentMode === "take_turns") {
    if (draft.cycleOrder.length === 0) return "Add people for turns";
    return draft.cycleOrder.map((id) => ownerName(id)).join(" → ");
  }
  const labels = WEEKDAYS.map((day) => {
    const memberId = draft.weeklyMap[day.value];
    return memberId ? `${day.label}: ${ownerName(memberId)}` : `${day.label}: ?`;
  });
  return labels.join(" · ");
}

function isInactive(definition: Responsibility): boolean {
  return Boolean(definition.ended || definition.archived || definition.deletedAt);
}

function currentRevision(definition: Responsibility, today: string): RoutineRevision | null {
  const active = definition.scheduleEntries
    .filter((entry) => !entry.canceledAt && entry.startDate <= today)
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || b.id.localeCompare(a.id));
  return active[0]?.revision ?? definition.revisions.at(-1) ?? null;
}

function upcomingEntries(definition: Responsibility, today: string): ScheduleEntry[] {
  return definition.scheduleEntries
    .filter((entry) => !entry.canceledAt && entry.startDate > today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));
}

function fallbackRevision(definition: Responsibility): RoutineRevision | null {
  return definition.revisions.at(-1) ?? null;
}

function ownerIdFromRevision(revision: RoutineRevision | null | undefined): string {
  return revision?.assigneeMemberIds[0] ?? "";
}

function weekdaysLabel(weekdays: number[]): string {
  const sorted = [...weekdays].sort((a, b) => a - b);
  if (sorted.length === 7) return "Every day";
  if (sorted.length === 5 && [1, 2, 3, 4, 5].every((d) => sorted.includes(d))) return "Weekdays";
  if (sorted.length === 2 && sorted.includes(6) && sorted.includes(7)) return "Weekends";
  const labels = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return sorted.map((d) => labels[d] ?? String(d)).join(", ");
}

function refineMessage(outcome: PlanRefineOutcome | undefined, today: string): string | null {
  if (!outcome) return null;
  const protectedCount = outcome.protectedMemberIds.length;
  if (protectedCount > 0 && outcome.updatedMemberIds.length === 0) {
    return "Today's work is already in progress, so this save applies after it.";
  }
  if (outcome.fromDate === today && outcome.updatedMemberIds.length > 0) {
    return "Today's unstarted work was updated.";
  }
  return null;
}

function peopleInFamilyOrder(people: MemberPublic[]): MemberPublic[] {
  return [...people].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName),
  );
}

function toEditorDraft(draft: Draft): EditorDraft {
  return {
    title: draft.title,
    daypart: draft.daypart,
    weekdays: draft.weekdays,
    assigneeMemberIds: draft.accountableMemberId ? [draft.accountableMemberId] : [],
    assigneeGroupIds: [],
    steps: draft.steps,
    startingDate: draft.startingDate,
  };
}

function ensureStepLocalIds(steps: EditorDraftStep[]): string[] {
  return steps.map((step) => step.logicalItemId ?? newClientId());
}

export function ResponsibilitiesView(props: {
  memberships: MemberPublic[];
  today: string;
  refreshToken?: number;
  route: { kind: "list" } | { kind: "detail"; definitionId: string } | { kind: "create" };
  listOnly?: boolean;
  onRouteChange: (
    next: { kind: "list" } | { kind: "detail"; definitionId: string } | { kind: "create" },
  ) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSuccessToast?: (message: string) => void;
  onSaved?: () => void;
  onEnded?: () => void;
  onDeleted?: () => void;
  onCreateRoutine?: () => void;
}) {
  const [view, setView] = useState<ViewState>(() =>
    props.route.kind === "detail"
      ? { kind: "detail", definitionId: props.route.definitionId }
      : props.route.kind === "create"
        ? { kind: "create" }
        : { kind: "list" },
  );
  const [items, setItems] = useState<Responsibility[]>([]);
  const [endedItems, setEndedItems] = useState<Responsibility[]>([]);
  const [detail, setDetail] = useState<Responsibility | null>(null);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(props.today));
  const [baselineSnapshot, setBaselineSnapshot] = useState(() => draftSnapshot(emptyDraft(props.today)));
  const [draftBaselineVersion, setDraftBaselineVersion] = useState<number | null>(null);
  const [stepLocalIds, setStepLocalIds] = useState<string[]>([]);
  const [editorFocus, setEditorFocus] = useState<EditorFocus>(null);
  const [sectionDraft, setSectionDraft] = useState<Draft | null>(null);
  const [pickerMemberId, setPickerMemberId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailableDetail, setUnavailableDetail] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [deleteOfferEnd, setDeleteOfferEnd] = useState(false);
  const [previewDays, setPreviewDays] = useState<ResponsibilityPreviewDay[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [draftPreviewDays, setDraftPreviewDays] = useState<ResponsibilityPreviewDay[] | null>(
    null,
  );
  const [draftPreviewError, setDraftPreviewError] = useState<string | null>(null);
  const [detailPreviewExpanded, setDetailPreviewExpanded] = useState(false);
  const [additionPreviewDays, setAdditionPreviewDays] = useState<ResponsibilityPreviewDay[] | null>(
    null,
  );
  const [scheduleCollision, setScheduleCollision] = useState<{
    occupiedDate: string;
    conflictingScheduleEntryId?: string;
  } | null>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const selectedDefinitionRef = useRef<string | null>(null);
  const listGenerationRef = useRef(0);
  const detailGenerationRef = useRef(0);
  const previewGenerationRef = useRef(0);
  const editorHouseholdDateRef = useRef(props.today);

  const dirty = draftSnapshot(draft) !== baselineSnapshot;
  const editing = view.kind === "edit";
  useEffect(() => {
    props.onDirtyChange?.(dirty && (view.kind === "create" || view.kind === "edit"));
  }, [dirty, view.kind]);

  useEffect(() => {
    if (props.route.kind === "detail") {
      setView({ kind: "detail", definitionId: props.route.definitionId });
      return;
    }
    if (props.route.kind === "create") {
      if (view.kind !== "create" && view.kind !== "picker" && view.kind !== "edit") {
        beginDraft(emptyDraft(props.today));
        setView({ kind: "create" });
      }
      return;
    }
    if (view.kind === "detail" || view.kind === "edit") {
      setView({ kind: "list" });
    }
  }, [props.route.kind, props.route.kind === "detail" ? props.route.definitionId : ""]);

  function announceSuccess(message: string) {
    props.onSuccessToast?.(message);
  }

  function beginDraft(next: Draft, baselineVersion?: number | null) {
    setDraft(next);
    setBaselineSnapshot(draftSnapshot(next));
    setDraftBaselineVersion(baselineVersion ?? null);
    setStepLocalIds(ensureStepLocalIds(next.steps));
    setEditorFocus(null);
    setSectionDraft(null);
    editorHouseholdDateRef.current = props.today;
    setScheduleCollision(null);
  }

  function applyDetail(next: Responsibility) {
    setDetail((prev) => {
      if (prev && prev.id === next.id && prev.version > next.version) {
        return prev;
      }
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
    const [activeResult, allResult] = await Promise.all([
      fetchResponsibilities(false),
      fetchResponsibilities(true),
    ]);
    if (generation !== listGenerationRef.current) return;
    setItems(activeResult.responsibilities.filter((item) => !isInactive(item)));
    setEndedItems(allResult.responsibilities.filter((item) => isInactive(item)));
  }

  async function loadDetail(definitionId: string) {
    selectedDefinitionRef.current = definitionId;
    const generation = ++detailGenerationRef.current;
    const preserveDraft = editing || dirty;
    try {
      const result = await fetchResponsibility(definitionId);
      if (generation !== detailGenerationRef.current) return;
      if (selectedDefinitionRef.current !== definitionId) return;
      setUnavailableDetail(false);
      setError(null);
      if (preserveDraft) {
        // Keep draft + pinned baselineVersion; only raise remote detail for conflict messaging.
        applyDetail(result.responsibility);
      } else {
        applyDetail(result.responsibility);
      }
    } catch {
      if (generation !== detailGenerationRef.current) return;
      if (selectedDefinitionRef.current !== definitionId) return;
      setUnavailableDetail(true);
      if (!preserveDraft) setDetail(null);
    }
  }

  useEffect(() => {
    void loadList().catch((caught) =>
      setError(caught instanceof Error ? caught.message : "Something went wrong"),
    );
  }, [props.refreshToken]);

  useEffect(() => {
    if (view.kind === "detail" || view.kind === "edit") {
      void loadDetail(view.definitionId).catch((caught) =>
        setError(caught instanceof Error ? caught.message : "Something went wrong"),
      );
      return;
    }
    if (view.kind === "list" || view.kind === "ended") {
      selectedDefinitionRef.current = null;
      setDetail(null);
      setMoreOpen(false);
      setDeleteOfferEnd(false);
    }
  }, [view, props.refreshToken]);

  useEffect(() => {
    if (view.kind !== "detail") return;
    const definitionId = view.definitionId;
    const generation = ++previewGenerationRef.current;
    void fetchResponsibilityPreview(definitionId)
      .then((result) => {
        if (generation !== previewGenerationRef.current) return;
        if (selectedDefinitionRef.current !== definitionId) return;
        setPreviewDays(result.preview);
        setPreviewError(null);
      })
      .catch((caught) => {
        if (generation !== previewGenerationRef.current) return;
        if (selectedDefinitionRef.current !== definitionId) return;
        setPreviewError(caught instanceof Error ? caught.message : String(caught));
      });
  }, [view, props.refreshToken]);

  useEffect(() => {
    if (!moreOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMoreOpen(false);
    }
    function onPointer(event: MouseEvent) {
      if (!moreMenuRef.current?.contains(event.target as Node)) setMoreOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [moreOpen]);

  function tryLeaveEditor(destination: ViewState) {
    if (dirty && (view.kind === "create" || view.kind === "edit")) {
      const discard = window.confirm(
        "You have unsaved changes. Discard them?\n\nOK = Discard · Cancel = Keep editing",
      );
      if (!discard) return;
    }
    if (destination.kind === "list") {
      setView({ kind: "list" });
      props.onRouteChange({ kind: "list" });
      props.onDirtyChange?.(false);
      return;
    }
    if (destination.kind === "detail") {
      setView(destination);
      props.onRouteChange({ kind: "detail", definitionId: destination.definitionId });
      props.onDirtyChange?.(false);
    }
  }

  function goList() {
    setView({ kind: "list" });
    props.onRouteChange({ kind: "list" });
  }

  function goDetail(definitionId: string) {
    setView({ kind: "detail", definitionId });
    props.onRouteChange({ kind: "detail", definitionId });
  }

  function openCreate() {
    setError(null);
    beginDraft(emptyDraft(props.today));
    setView({ kind: "create" });
    props.onRouteChange({ kind: "create" });
  }

  function openEditCurrent(definition: Responsibility) {
    const revision = currentRevision(definition, props.today) ?? fallbackRevision(definition);
    if (!revision) return;
    beginDraft(draftFromRevision(revision, props.today), definition.version);
    setView({ kind: "edit", definitionId: definition.id, mode: "current" });
  }

  function openScheduleNew(definition: Responsibility) {
    const revision = currentRevision(definition, props.today) ?? fallbackRevision(definition);
    if (!revision) return;
    beginDraft(draftFromRevision(revision, props.today), definition.version);
    setView({ kind: "edit", definitionId: definition.id, mode: "schedule-new" });
  }

  function openEditUpcoming(definition: Responsibility, entry: ScheduleEntry) {
    beginDraft(draftFromRevision(entry.revision, entry.startDate), definition.version);
    setView({
      kind: "edit",
      definitionId: definition.id,
      mode: "schedule-edit",
      scheduleEntryId: entry.id,
    });
  }

  function validateDraft(): boolean {
    if (!draft.title.trim()) {
      setError("Enter a responsibility name.");
      return false;
    }
    if (draft.assignmentMode === "fixed" && !draft.accountableMemberId) {
      setError("Choose one accountable person.");
      return false;
    }
    if (draft.assignmentMode === "take_turns" && draft.cycleOrder.length === 0) {
      setError("Add at least one person to the turn order.");
      return false;
    }
    if (draft.assignmentMode === "weekly") {
      for (const day of WEEKDAYS) {
        if (!draft.weeklyMap[day.value]) {
          setError(`Choose a person for ${day.label} in the weekly pattern.`);
          return false;
        }
      }
    }
    if (draft.weekdays.length === 0) {
      setError("Choose at least one weekday.");
      return false;
    }
    if (draft.steps.length === 0 || !draft.steps.some((step) => step.obligation === "required")) {
      setError("Add at least one required work item.");
      return false;
    }
    if (draft.steps.some((step) => !step.text.trim())) {
      setError("Every work item needs text.");
      return false;
    }
    for (const addition of draft.scheduledAdditions) {
      if (!addition.name.trim()) {
        setError("Every scheduled work item needs a name.");
        return false;
      }
      if (addition.weekdays.length === 0) {
        setError(`Choose weekdays for “${addition.name.trim()}”.`);
        return false;
      }
      if (!addition.weekdays.some((day) => draft.weekdays.includes(day))) {
        setError(`“${addition.name.trim()}” must overlap the responsibility recurrence.`);
        return false;
      }
      if (
        !addition.inheritAssignment &&
        addition.assignmentMode === "fixed" &&
        !addition.fixedMemberId
      ) {
        setError(`Choose who owns “${addition.name.trim()}”.`);
        return false;
      }
      if (
        !addition.inheritAssignment &&
        addition.assignmentMode === "take_turns" &&
        addition.cycleOrder.length === 0
      ) {
        setError(`Add people to the turn order for “${addition.name.trim()}”.`);
        return false;
      }
      if (
        addition.steps.length === 0 ||
        !addition.steps.some((step) => step.obligation === "required")
      ) {
        setError(`“${addition.name.trim()}” needs at least one required work item.`);
        return false;
      }
    }
    return true;
  }

  function mutationPayload(anchorDate: string) {
    const assignment = buildAssignmentSpec(draft.assignmentMode, anchorDate, {
      accountableMemberId: draft.accountableMemberId,
      cycleOrder: draft.cycleOrder,
      weeklyMap: draft.weeklyMap,
    });
    return {
      mutationId: newClientId(),
      title: draft.title.trim(),
      daypart: draft.daypart,
      weekdays: draft.weekdays,
      assignment,
      scheduledAdditions: draft.scheduledAdditions.map((addition, index) => ({
        id: addition.id,
        name: addition.name.trim(),
        weekdays: addition.weekdays,
        inheritAssignment: addition.inheritAssignment,
        assignment: addition.inheritAssignment
          ? undefined
          : buildAssignmentSpec(addition.assignmentMode, anchorDate, {
              accountableMemberId: addition.fixedMemberId,
              cycleOrder: addition.cycleOrder,
              weeklyMap: addition.weeklyMap,
            }),
        position: index,
        steps: addition.steps.map((step) => ({
          text: step.text.trim(),
          obligation: step.obligation,
          ...(step.logicalItemId ? { logicalItemId: step.logicalItemId } : {}),
          applicability: DEFAULT_APPLICABILITY,
        })),
      })),
      steps: draft.steps.map((step) => ({
        text: step.text.trim(),
        obligation: step.obligation,
        ...(step.logicalItemId ? { logicalItemId: step.logicalItemId } : {}),
        applicability: DEFAULT_APPLICABILITY,
      })),
    };
  }

  async function loadDraftPreview() {
    setDraftPreviewError(null);
    setDraftPreviewDays(null);
    try {
      const result = await previewDraftResponsibility(mutationPayload(draft.startingDate));
      setDraftPreviewDays(result.preview);
    } catch (caught) {
      setDraftPreviewError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function requestSave(editing: boolean) {
    if (busy || !validateDraft()) return;
    if (needsSavePreview(draft)) {
      setEditorFocus("save-preview");
      await loadDraftPreview();
      return;
    }
    if (editing) await saveEdit();
    else await saveCreate();
  }

  async function saveCreate() {
    if (busy || !validateDraft()) return;
    setBusy(true);
    setError(null);
    try {
      const session = await fetchSession();
      if (session && session.householdDate !== editorHouseholdDateRef.current) {
        setError(
          `The household date changed to ${session.householdDate}. Your draft is kept — review and save again.`,
        );
        setBusy(false);
        return;
      }
      const result = await createResponsibility(mutationPayload(props.today));
      detailGenerationRef.current += 1;
      previewGenerationRef.current += 1;
      applyDetail(result.responsibility);
      await loadList();
      setBaselineSnapshot(draftSnapshot(draft));
      setDraftBaselineVersion(result.responsibility.version);
      setEditorFocus(null);
      setDraftPreviewDays(null);
      props.onDirtyChange?.(false);
      goDetail(result.responsibility.id);
      props.onSaved?.();
      const revision = currentRevision(result.responsibility, props.today);
      announceSuccess(
        revision
          ? `Created “${revision.title}”. Active from ${revision.effectiveDate}.`
          : "Created.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Responsibility couldn't be saved.");
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
      const expectedVersion = draftBaselineVersion;
      if (!expectedVersion) {
        setError("Reload this responsibility before saving.");
        setBusy(false);
        return;
      }
      let result: ResponsibilityMutationResult;
      if (editMode === "schedule-edit" && scheduleEntryId) {
        result = await createResponsibilityRevision(definitionId, {
          ...mutationPayload(draft.startingDate),
          expectedVersion,
          mode: "schedule",
          scheduleEntryId,
          effectiveDate: draft.startingDate,
        });
      } else if (editMode === "schedule-new") {
        result = await createResponsibilityRevision(definitionId, {
          ...mutationPayload(draft.startingDate),
          expectedVersion,
          mode: "schedule",
          effectiveDate: draft.startingDate,
        });
      } else {
        result = await createResponsibilityRevision(definitionId, {
          ...mutationPayload(props.today),
          expectedVersion,
          mode: "current",
        });
      }
      detailGenerationRef.current += 1;
      previewGenerationRef.current += 1;
      applyDetail(result.responsibility);
      await loadList();
      setBaselineSnapshot(draftSnapshot(draft));
      setDraftBaselineVersion(result.responsibility.version);
      setEditorFocus(null);
      setDraftPreviewDays(null);
      props.onDirtyChange?.(false);
      goDetail(definitionId);
      props.onSaved?.();
      const note = refineMessage(result.refineOutcome, props.today);
      announceSuccess(note ?? "Saved.");
    } catch (caught) {
      const apiError = caught as ApiError;
      if (apiError.code === "CONFLICT" && apiError.occupiedDate) {
        setScheduleCollision({
          occupiedDate: apiError.occupiedDate,
          conflictingScheduleEntryId: apiError.conflictingScheduleEntryId,
        });
      }
      setError(caught instanceof Error ? caught.message : "Responsibility couldn't be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnd(definition: Responsibility) {
    if (
      !window.confirm(
        "End this responsibility? Unstarted today and future work will be canceled. Past and started work stays in History.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await endResponsibility(definition.id, {
        mutationId: newClientId(),
        expectedVersion: definition.version,
      });
      detailGenerationRef.current += 1;
      previewGenerationRef.current += 1;
      applyDetail(result.responsibility);
      await loadList();
      props.onEnded?.();
      announceSuccess("Responsibility ended.");
      setMoreOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not end responsibility.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete(definition: Responsibility) {
    if (
      !window.confirm(
        "Delete this unused responsibility? Setup that was never used will be removed.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setDeleteOfferEnd(false);
    try {
      await deleteResponsibility(definition.id, {
        mutationId: newClientId(),
        expectedVersion: definition.version,
      });
      detailGenerationRef.current += 1;
      previewGenerationRef.current += 1;
      await loadList();
      props.onDeleted?.();
      announceSuccess("Responsibility deleted.");
      goList();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not delete.";
      setError(message);
      if (/end/i.test(message) || /history|started|used/i.test(message)) {
        setDeleteOfferEnd(true);
      }
    } finally {
      setBusy(false);
      setMoreOpen(false);
    }
  }

  async function confirmDeleteUpcoming(definition: Responsibility, entry: ScheduleEntry) {
    if (!window.confirm(`Delete the upcoming change starting ${entry.startDate}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await deleteResponsibilityScheduleEntry(definition.id, entry.id, {
        mutationId: newClientId(),
        expectedVersion: definition.version,
      });
      const cleaned: Responsibility = {
        ...result.responsibility,
        scheduleEntries: result.responsibility.scheduleEntries.filter(
          (item) => item.id !== entry.id && item.canceledAt == null,
        ),
      };
      detailGenerationRef.current += 1;
      previewGenerationRef.current += 1;
      applyDetail(cleaned);
      await loadList();
      props.onSaved?.();
      announceSuccess("Upcoming change deleted.");
      void loadDetail(definition.id).catch(() => undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete upcoming change.");
    } finally {
      setBusy(false);
    }
  }

  function ownerName(memberId: string): string {
    return props.memberships.find((person) => person.id === memberId)?.displayName ?? "Person";
  }

  function accessNote(memberId: string): string | null {
    const person = props.memberships.find((item) => item.id === memberId);
    if (!person) return null;
    if (person.accessState === "access_set_up") return null;
    return "Needs access before they can execute.";
  }

  function renderRow(definition: Responsibility) {
    const revision = currentRevision(definition, props.today) ?? fallbackRevision(definition);
    const title = revision?.title ?? "Responsibility";
    const draftLike = revision ? draftFromRevision(revision, props.today) : null;
    const ownerLabel = draftLike ? assignmentSummary(draftLike, ownerName) : "";
    return (
      <li key={definition.id}>
        <button
          type="button"
          className="list-row routine-card"
          onClick={() => goDetail(definition.id)}
        >
          <span className="routine-card-title">{title}</span>
          <span className="meta">
            {revision ? `${weekdaysLabel(revision.weekdays)} · ${DAYPART_LABELS[revision.daypart]}` : ""}
            {ownerLabel ? ` · ${ownerLabel}` : ""}
          </span>
        </button>
      </li>
    );
  }

  if (props.listOnly && (view.kind === "list" || view.kind === "ended")) {
    if (view.kind === "ended") {
      return (
        <div className="plan-section" aria-labelledby="ended-responsibilities-heading">
          <button type="button" className="text-button" onClick={() => setView({ kind: "list" })}>
            Back to Responsibilities
          </button>
          <h2 id="ended-responsibilities-heading">Ended responsibilities</h2>
          {endedItems.length === 0 ? (
            <p className="meta">No ended responsibilities.</p>
          ) : (
            <ul className="routine-list routine-card-list">
              {endedItems.map((item) => renderRow(item))}
            </ul>
          )}
        </div>
      );
    }
    return (
      <div className="plan-section" aria-labelledby="responsibilities-heading">
        <h2 id="responsibilities-heading">Responsibilities</h2>
        <p className="meta">
          {items.length} active {items.length === 1 ? "responsibility" : "responsibilities"}
        </p>
        {error ? <p role="alert">{error}</p> : null}
        {items.length === 0 ? (
          <p className="meta">No active responsibilities yet.</p>
        ) : (
          <ul className="routine-list routine-card-list">{items.map((item) => renderRow(item))}</ul>
        )}
        {endedItems.length > 0 ? (
          <button type="button" className="text-button" onClick={() => setView({ kind: "ended" })}>
            Ended responsibilities
          </button>
        ) : null}
      </div>
    );
  }

  if (view.kind === "picker") {
    const pickerView = view;
    const ordered = peopleInFamilyOrder(props.memberships);
    const pickerHeading =
      pickerView.purpose === "weekly-day" || pickerView.purpose === "addition-weekly-day"
        ? `Who on ${WEEKDAYS.find((day) => day.value === pickerView.weeklyDay)?.label ?? "this day"}?`
        : pickerView.purpose === "cycle-add" || pickerView.purpose === "addition-cycle-add"
          ? "Add to turn order"
          : "Who is accountable?";
    function returnFromPicker() {
      if (pickerView.returnTo === "create") setView({ kind: "create" });
      else {
        setView({
          kind: "edit",
          definitionId: pickerView.definitionId!,
          mode: pickerView.editMode ?? "current",
          scheduleEntryId: pickerView.scheduleEntryId,
        });
      }
      setEditorFocus(
        pickerView.purpose.startsWith("addition")
          ? { kind: "work-addition", additionId: pickerView.additionId! }
          : "assignment",
      );
    }
    function applyPickerSelection(memberId: string) {
      if (pickerView.purpose === "fixed") {
        setDraft((current) => ({
          ...current,
          accountableMemberId: memberId,
          weeklyMap: defaultWeeklyMap(memberId),
        }));
      } else if (pickerView.purpose === "weekly-day" && pickerView.weeklyDay) {
        setDraft((current) => ({
          ...current,
          weeklyMap: { ...current.weeklyMap, [pickerView.weeklyDay!]: memberId },
        }));
      } else if (pickerView.purpose === "cycle-add") {
        setDraft((current) =>
          current.cycleOrder.includes(memberId)
            ? current
            : { ...current, cycleOrder: [...current.cycleOrder, memberId] },
        );
      } else if (pickerView.purpose === "addition-fixed" && pickerView.additionId) {
        setDraft((current) => ({
          ...current,
          scheduledAdditions: current.scheduledAdditions.map((addition) =>
            addition.id === pickerView.additionId
              ? { ...addition, fixedMemberId: memberId, weeklyMap: defaultWeeklyMap(memberId) }
              : addition,
          ),
        }));
      } else if (pickerView.purpose === "addition-weekly-day" && pickerView.additionId && pickerView.weeklyDay) {
        setDraft((current) => ({
          ...current,
          scheduledAdditions: current.scheduledAdditions.map((addition) =>
            addition.id === pickerView.additionId
              ? {
                  ...addition,
                  weeklyMap: { ...addition.weeklyMap, [pickerView.weeklyDay!]: memberId },
                }
              : addition,
          ),
        }));
      } else if (pickerView.purpose === "addition-cycle-add" && pickerView.additionId) {
        setDraft((current) => ({
          ...current,
          scheduledAdditions: current.scheduledAdditions.map((addition) =>
            addition.id === pickerView.additionId
              ? addition.cycleOrder.includes(memberId)
                ? addition
                : { ...addition, cycleOrder: [...addition.cycleOrder, memberId] }
              : addition,
          ),
        }));
      }
    }
    return (
      <section className="panel people-groups responsibilities-view">
        <div className="focused-state" aria-labelledby="responsibility-who-heading">
          <BackButton
            label={pickerView.returnTo === "create" ? "Back to new responsibility" : "Back to edit"}
            onClick={returnFromPicker}
          />
          <FocusHeading id="responsibility-who-heading">{pickerHeading}</FocusHeading>
          <p className="meta">
            Choose one person in family order. Pending access is allowed; they need access before
            they can execute.
          </p>
          {error ? <p role="alert">{error}</p> : null}
          <form
            className="form-grid"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              if (!pickerMemberId) {
                setError("Choose one person.");
                return;
              }
              applyPickerSelection(pickerMemberId);
              setError(null);
              returnFromPicker();
            }}
          >
            <fieldset>
              <legend>People</legend>
              <ul className="people-list">
                {ordered.map((person) => (
                  <li key={person.id}>
                    <label
                      className={`choice-row person-row ${pickerMemberId === person.id ? "selected" : ""}`}
                    >
                      <input
                        type="radio"
                        name="accountable"
                        checked={pickerMemberId === person.id}
                        onChange={() => setPickerMemberId(person.id)}
                      />
                      <span>
                        <span className="person-name">{person.displayName}</span>
                        <span className="meta">
                          {person.accessState === "access_set_up"
                            ? "Can execute when assigned"
                            : "Needs access before they can execute"}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
            <div className="button-row">
              <button type="submit" className="primary">
                Apply
              </button>
              <button type="button" onClick={returnFromPicker}>
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
        ? "New responsibility"
        : view.mode === "schedule-new"
          ? "Schedule for later"
          : view.mode === "schedule-edit"
            ? "Edit upcoming change"
            : "Edit responsibility";
    const working = sectionDraft ?? draft;
    const editingBaseSteps =
      (typeof editorFocus === "object" && editorFocus?.kind === "work-base") ||
      (typeof editorFocus === "object" && editorFocus?.kind === "step");
    const workingIds =
      sectionDraft && editingBaseSteps
        ? ensureStepLocalIds(sectionDraft.steps)
        : stepLocalIds.length === draft.steps.length
          ? stepLocalIds
          : ensureStepLocalIds(draft.steps);

    function openPicker(
      purpose:
        | "fixed"
        | "weekly-day"
        | "cycle-add"
        | "addition-fixed"
        | "addition-weekly-day"
        | "addition-cycle-add",
      options?: {
        weeklyDay?: number;
        additionId?: string;
        initialMemberId?: string;
      },
    ) {
      setPickerMemberId(options?.initialMemberId ?? "");
      const pickerBase = {
        kind: "picker" as const,
        purpose,
        weeklyDay: options?.weeklyDay,
        additionId: options?.additionId,
      };
      if (view.kind === "create") {
        setView({ ...pickerBase, returnTo: "create" });
      } else if (view.kind === "edit") {
        setView({
          ...pickerBase,
          returnTo: "edit",
          definitionId: view.definitionId,
          editMode: view.mode,
          scheduleEntryId: view.scheduleEntryId,
        });
      }
    }

    function openSection(focus: Exclude<EditorFocus, null>) {
      setError(null);
      if (focus === "name" || focus === "when") {
        setSectionDraft({ ...draft, steps: draft.steps.map((step) => ({ ...step })) });
        setEditorFocus(focus);
        return;
      }
      if (
        (typeof focus === "object" && focus.kind === "work-base") ||
        (typeof focus === "object" && focus.kind === "step")
      ) {
        setSectionDraft({ ...draft, steps: draft.steps.map((step) => ({ ...step })) });
        setStepLocalIds(ensureStepLocalIds(draft.steps));
        setEditorFocus(focus);
        return;
      }
      setEditorFocus(focus);
    }

    function cancelSection() {
      setSectionDraft(null);
      setEditorFocus(null);
      setDraftPreviewDays(null);
      setDraftPreviewError(null);
      setAdditionPreviewDays(null);
      setError(null);
    }

    const activeAddition =
      typeof editorFocus === "object" && editorFocus?.kind === "work-addition"
        ? draft.scheduledAdditions.find((addition) => addition.id === editorFocus.additionId)
        : typeof editorFocus === "object" && editorFocus?.kind === "addition-step"
          ? draft.scheduledAdditions.find((addition) => addition.id === editorFocus.additionId)
          : null;

    return (
      <section className="panel people-groups responsibilities-view">
        <div className="focused-state" aria-labelledby="responsibility-editor-heading">
          <BackButton
            label={editing ? "Back to responsibility" : "Back to Plan"}
            onClick={() => {
              if (editing) tryLeaveEditor({ kind: "detail", definitionId: view.definitionId });
              else tryLeaveEditor({ kind: "list" });
            }}
          />
          <FocusHeading id="responsibility-editor-heading">{heading}</FocusHeading>
          {error ? <p role="alert">{error}</p> : null}
          {scheduleCollision ? (
            <p className="status-notice" role="status">
              That date already has an upcoming change ({scheduleCollision.occupiedDate}). Keep
              editing the draft date.
            </p>
          ) : null}
          {editorFocus === "name" && sectionDraft ? (
            <NameSectionEditor
              value={sectionDraft.title}
              onChange={(title) => setSectionDraft({ ...sectionDraft, title })}
              onDone={() => {
                if (!sectionDraft.title.trim()) {
                  setError("Enter a responsibility name.");
                  return;
                }
                setDraft((current) => ({ ...current, title: sectionDraft.title }));
                cancelSection();
              }}
              onCancel={cancelSection}
            />
          ) : null}
          {editorFocus === "when" && sectionDraft ? (
            <WhenSectionEditor
              daypart={sectionDraft.daypart}
              weekdays={sectionDraft.weekdays}
              onChange={(next) =>
                setSectionDraft({ ...sectionDraft, daypart: next.daypart, weekdays: next.weekdays })
              }
              onDone={() => {
                if (sectionDraft.weekdays.length === 0) {
                  setError("Choose at least one weekday.");
                  return;
                }
                setDraft((current) => ({
                  ...current,
                  daypart: sectionDraft.daypart,
                  weekdays: sectionDraft.weekdays,
                }));
                cancelSection();
              }}
              onCancel={cancelSection}
            />
          ) : null}
          {editorFocus === "assignment" ? (
            <div className="form-grid" aria-labelledby="assignment-pattern-heading">
              <FocusHeading id="assignment-pattern-heading">Assignment pattern</FocusHeading>
              <fieldset>
                <legend>Pattern</legend>
                <div className="button-row">
                  {(["fixed", "take_turns", "weekly"] as AssignmentMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={draft.assignmentMode === mode ? "primary" : undefined}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          assignmentMode: mode,
                          weeklyMap:
                            mode === "weekly" && !Object.values(current.weeklyMap).some(Boolean)
                              ? defaultWeeklyMap(current.accountableMemberId)
                              : current.weeklyMap,
                        }))
                      }
                    >
                      {mode === "fixed"
                        ? "Fixed person"
                        : mode === "take_turns"
                          ? "Take turns"
                          : "Weekly pattern"}
                    </button>
                  ))}
                </div>
              </fieldset>
              {draft.assignmentMode === "fixed" ? (
                <div className="button-row">
                  <button type="button" onClick={() => openPicker("fixed", { initialMemberId: draft.accountableMemberId })}>
                    {draft.accountableMemberId
                      ? ownerName(draft.accountableMemberId)
                      : "Choose accountable person"}
                  </button>
                </div>
              ) : null}
              {draft.assignmentMode === "take_turns" ? (
                <>
                  <OrderedList
                    listLabel="Turn order"
                    items={draft.cycleOrder.map((memberId) => ({
                      id: memberId,
                      label: ownerName(memberId),
                    }))}
                    onReorder={(next) =>
                      setDraft((current) => ({
                        ...current,
                        cycleOrder: next.map((item) => item.id),
                      }))
                    }
                    renderRow={(item) => <strong>{item.label}</strong>}
                  />
                  <div className="button-row">
                    <button type="button" onClick={() => openPicker("cycle-add")}>
                      Add person
                    </button>
                  </div>
                </>
              ) : null}
              {draft.assignmentMode === "weekly" ? (
                <ul className="section-summary">
                  {WEEKDAYS.map((day) => (
                    <li key={day.value}>
                      <button
                        type="button"
                        className="section-summary-row"
                        onClick={() =>
                          openPicker("weekly-day", {
                            weeklyDay: day.value,
                            initialMemberId: draft.weeklyMap[day.value],
                          })
                        }
                      >
                        <strong>{day.label}</strong>
                        <span>
                          {draft.weeklyMap[day.value]
                            ? ownerName(draft.weeklyMap[day.value]!)
                            : "Choose person"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="button-row">
                <button type="button" className="primary" onClick={() => setEditorFocus(null)}>
                  Done
                </button>
                <button type="button" onClick={() => setEditorFocus(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          {editorFocus === "work" ? (
            <div className="form-grid" aria-labelledby="work-section-heading">
              <FocusHeading id="work-section-heading">Work</FocusHeading>
              <ul className="section-summary">
                <li>
                  <button
                    type="button"
                    className="section-summary-row"
                    onClick={() => openSection({ kind: "work-base" })}
                  >
                    <strong>Base</strong>
                    <span>
                      {draft.steps.length} {draft.steps.length === 1 ? "item" : "items"}
                    </span>
                  </button>
                </li>
                {draft.scheduledAdditions.map((addition) => (
                  <li key={addition.id}>
                    <button
                      type="button"
                      className="section-summary-row"
                      onClick={() => setEditorFocus({ kind: "work-addition", additionId: addition.id })}
                    >
                      <strong>{addition.name.trim() || "Scheduled work"}</strong>
                      <span>
                        {weekdaysLabel(addition.weekdays)} · {addition.steps.length}{" "}
                        {addition.steps.length === 1 ? "item" : "items"}
                        {addition.inheritAssignment ? " · Uses responsibility assignment" : " · Own assignment"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => {
                  const addition = emptyAdditionDraft(draft.weekdays);
                  setDraft((current) => ({
                    ...current,
                    scheduledAdditions: [...current.scheduledAdditions, addition],
                  }));
                  setEditorFocus({ kind: "work-addition", additionId: addition.id });
                }}
              >
                Add scheduled work
              </button>
              <div className="button-row">
                <button type="button" className="primary" onClick={() => setEditorFocus(null)}>
                  Done
                </button>
              </div>
            </div>
          ) : null}
          {typeof editorFocus === "object" &&
          editorFocus?.kind === "work-base" &&
          sectionDraft ? (
            <StepsSectionEditor
              steps={sectionDraft.steps}
              stepLocalIds={workingIds}
              listLabel="Base work"
              hideApplicability
              onChange={(steps, localIds) => {
                setSectionDraft({ ...sectionDraft, steps });
                setStepLocalIds(localIds);
              }}
              onEditStep={(index, localId) => setEditorFocus({ kind: "step", index, localId })}
              onDone={() => {
                if (sectionDraft.steps.some((step) => !step.text.trim())) {
                  setError("Every work item needs text.");
                  return;
                }
                if (!sectionDraft.steps.some((step) => step.obligation === "required")) {
                  setError("Add at least one required work item.");
                  return;
                }
                setDraft((current) => ({ ...current, steps: sectionDraft.steps }));
                cancelSection();
                setEditorFocus("work");
              }}
              onCancel={() => {
                cancelSection();
                setEditorFocus("work");
              }}
            />
          ) : null}
          {typeof editorFocus === "object" &&
          editorFocus?.kind === "step" &&
          sectionDraft &&
          sectionDraft.steps[editorFocus.index] ? (
            <StepRowEditor
              hideApplicability
              step={sectionDraft.steps[editorFocus.index]!}
              canRemove={sectionDraft.steps.length > 1}
              onChange={(step) => {
                const steps = sectionDraft.steps.map((item, index) =>
                  index === editorFocus.index
                    ? { ...step, applicability: DEFAULT_APPLICABILITY }
                    : item,
                );
                setSectionDraft({ ...sectionDraft, steps });
              }}
              onRemove={() => {
                const steps = sectionDraft.steps.filter((_, index) => index !== editorFocus.index);
                const localIds = workingIds.filter((_, index) => index !== editorFocus.index);
                setSectionDraft({ ...sectionDraft, steps });
                setStepLocalIds(localIds);
                setEditorFocus({ kind: "work-base" });
              }}
              onDone={() => setEditorFocus({ kind: "work-base" })}
              onCancel={() => setEditorFocus({ kind: "work-base" })}
            />
          ) : null}
          {activeAddition && typeof editorFocus === "object" && editorFocus?.kind === "work-addition" ? (
            <AdditionEditor
              addition={activeAddition}
              parentWeekdays={draft.weekdays}
              ownerName={ownerName}
              additionPreviewDays={additionPreviewDays}
              onPreview={() =>
                void previewDraftResponsibility(mutationPayload(draft.startingDate))
                  .then((result) => setAdditionPreviewDays(result.preview))
                  .catch((caught) =>
                    setError(caught instanceof Error ? caught.message : String(caught)),
                  )
              }
              onChange={(next) =>
                setDraft((current) => ({
                  ...current,
                  scheduledAdditions: current.scheduledAdditions.map((item) =>
                    item.id === next.id ? next : item,
                  ),
                }))
              }
              onRemove={() => {
                setDraft((current) => ({
                  ...current,
                  scheduledAdditions: current.scheduledAdditions.filter(
                    (item) => item.id !== activeAddition.id,
                  ),
                }));
                setEditorFocus("work");
              }}
              onOpenPicker={(purpose, options) => openPicker(purpose, { ...options, additionId: activeAddition.id })}
              onEditStep={(index, localId) =>
                setEditorFocus({ kind: "addition-step", additionId: activeAddition.id, index, localId })
              }
              onDone={() => setEditorFocus("work")}
              onCancel={() => setEditorFocus("work")}
            />
          ) : null}
          {activeAddition && typeof editorFocus === "object" && editorFocus?.kind === "addition-step" ? (
            <StepRowEditor
              hideApplicability
              step={activeAddition.steps[editorFocus.index]!}
              canRemove={activeAddition.steps.length > 1}
              onChange={(step) => {
                setDraft((current) => ({
                  ...current,
                  scheduledAdditions: current.scheduledAdditions.map((item) =>
                    item.id === activeAddition.id
                      ? {
                          ...item,
                          steps: item.steps.map((existing, index) =>
                            index === editorFocus.index
                              ? { ...step, applicability: DEFAULT_APPLICABILITY }
                              : existing,
                          ),
                        }
                      : item,
                  ),
                }));
              }}
              onRemove={() => {
                setDraft((current) => ({
                  ...current,
                  scheduledAdditions: current.scheduledAdditions.map((item) =>
                    item.id === activeAddition.id
                      ? {
                          ...item,
                          steps: item.steps.filter((_, index) => index !== editorFocus.index),
                        }
                      : item,
                  ),
                }));
                setEditorFocus({ kind: "work-addition", additionId: activeAddition.id });
              }}
              onDone={() => setEditorFocus({ kind: "work-addition", additionId: activeAddition.id })}
              onCancel={() => setEditorFocus({ kind: "work-addition", additionId: activeAddition.id })}
            />
          ) : null}
          {editorFocus === "save-preview" ? (
            <div className="form-grid" aria-labelledby="save-preview-heading">
              <FocusHeading id="save-preview-heading">Upcoming preview</FocusHeading>
              <p className="meta">
                Review who will receive this responsibility before saving. Read-only — does not
                create checklist work.
              </p>
              {draftPreviewError ? <p role="alert">{draftPreviewError}</p> : null}
              {draftPreviewDays ? (
                <ul className="simple-list responsibility-preview-list">
                  {draftPreviewDays.map((day) => (
                    <li key={day.householdDate}>
                      <strong>{day.householdDate}</strong>
                      <span className="meta">
                        {day.applicable
                          ? ` · ${day.accountableMemberName ?? "Unassigned"}${
                              day.unassignedReason ? ` (${day.unassignedReason})` : ""
                            }${day.stepCount != null ? ` · ${day.stepCount} items` : ""}`
                          : " · No work"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="meta">Loading preview…</p>
              )}
              <div className="button-row">
                <button
                  type="button"
                  className="primary"
                  disabled={busy || !draftPreviewDays}
                  onClick={() => void (editing ? saveEdit() : saveCreate())}
                >
                  {busy ? "Saving…" : "Confirm and save"}
                </button>
                <button type="button" onClick={cancelSection}>
                  Back to edit
                </button>
              </div>
            </div>
          ) : null}
          {editorFocus === null ? (
            <>
              <RoutineFocusedSummary
                draft={toEditorDraft(working)}
                scheduleMode={scheduleMode}
                people={props.memberships}
                groups={[]}
                stepLocalIds={workingIds}
                workSectionLabel="Work"
                whoSummary={assignmentSummary(working, ownerName)}
                onOpenName={() => openSection("name")}
                onOpenWhen={() => openSection("when")}
                onOpenWho={() => setEditorFocus("assignment")}
                onOpenSteps={() => setEditorFocus("work")}
                startingMin={props.today}
                onStartingDateChange={(value) =>
                  setDraft((current) => ({ ...current, startingDate: value }))
                }
              />
              {working.assignmentMode === "fixed" &&
              working.accountableMemberId &&
              accessNote(working.accountableMemberId) ? (
                <p className="meta">{accessNote(working.accountableMemberId)}</p>
              ) : null}
              <div className="button-row">
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => void requestSave(editing)}
                >
                  {busy ? "Saving…" : editing ? "Save" : "Create responsibility"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (editing) tryLeaveEditor({ kind: "detail", definitionId: view.definitionId });
                    else tryLeaveEditor({ kind: "list" });
                  }}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : null}
        </div>
      </section>
    );
  }

  if (view.kind === "detail") {
    const revision = detail ? currentRevision(detail, props.today) : null;
    const upcoming = detail ? upcomingEntries(detail, props.today) : [];
    const title =
      revision?.title ?? (detail ? fallbackRevision(detail)?.title : null) ?? "Responsibility";
    const inactive = detail ? isInactive(detail) : false;
    const owner = ownerIdFromRevision(revision);

    return (
      <section className="panel people-groups responsibilities-view">
        <div className="focused-state routine-detail" aria-labelledby="responsibility-detail-heading">
          <BackButton
            label={inactive ? "Back to Ended responsibilities" : "Back to Plan"}
            onClick={() => {
              if (inactive) {
                setView({ kind: "ended" });
                props.onRouteChange({ kind: "list" });
                void loadList();
              } else {
                goList();
              }
            }}
          />
          <FocusHeading id="responsibility-detail-heading">{title}</FocusHeading>
          {unavailableDetail ? (
            <div className="status-notice" role="status">
              <p>This responsibility is unavailable.</p>
              <button type="button" className="primary" onClick={goList}>
                Back to Plan
              </button>
            </div>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
          {deleteOfferEnd && detail && !inactive ? (
            <p className="status-notice" role="status">
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => void confirmEnd(detail)}
              >
                End responsibility instead
              </button>
            </p>
          ) : null}
          {!unavailableDetail && (!detail || !revision) ? (
            <p className="meta">Loading responsibility…</p>
          ) : null}
          {!unavailableDetail && detail && revision ? (
            <>
              {inactive ? (
                <p className="meta">
                  {detail.ended ? "Ended" : "Archived"}
                  {detail.archiveCutoffDate
                    ? ` · no assignments from ${detail.archiveCutoffDate}`
                    : ""}
                </p>
              ) : null}
              <p className="meta">
                {weekdaysLabel(revision.weekdays)} · {DAYPART_LABELS[revision.daypart]}
              </p>
              <h3>Assignment</h3>
              <p>{assignmentSummary(draftFromRevision(revision, props.today), ownerName)}</p>
              {revision.assignment?.mode === "fixed" && owner && accessNote(owner) ? (
                <p className="meta">{accessNote(owner)}</p>
              ) : null}
              <h3>Work</h3>
              <ul className="section-summary">
                <li>
                  <div className="section-summary-row">
                    <strong>Base</strong>
                    <span>
                      {revision.steps.length} {revision.steps.length === 1 ? "item" : "items"}
                    </span>
                  </div>
                </li>
                {(revision.scheduledAdditions ?? []).map((addition) => (
                  <li key={addition.id ?? addition.name}>
                    <div className="section-summary-row">
                      <strong>{addition.name}</strong>
                      <span>
                        {weekdaysLabel(addition.weekdays)} · {addition.steps.length}{" "}
                        {addition.steps.length === 1 ? "item" : "items"}
                        {addition.inheritAssignment ? " · Inherited assignment" : " · Own assignment"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              <section className="plan-preview-section" aria-labelledby="upcoming-preview-heading">
                <h3 id="upcoming-preview-heading">Upcoming</h3>
                {previewError ? <p role="alert">{previewError}</p> : null}
                {previewDays?.some((day) => day.applicable && day.accountableMemberId === null) ? (
                  <p className="status-notice" role="status">
                    Some upcoming dates are Unassigned. Edit assignment to repair before work begins.
                  </p>
                ) : null}
                {previewDays ? (
                  <>
                    <ul className="simple-list responsibility-preview-list">
                      {(detailPreviewExpanded ? previewDays : previewDays.slice(0, 3)).map((day) => (
                        <li key={day.householdDate}>
                          <strong>{day.householdDate}</strong>
                          <span className="meta">
                            {day.applicable
                              ? ` · ${day.accountableMemberName ?? "Unassigned"}${
                                  day.unassignedReason ? ` (${day.unassignedReason})` : ""
                                }${day.stepCount != null ? ` · ${day.stepCount} items` : ""}${
                                  day.startedProtected ? " · In progress (protected)" : ""
                                }`
                              : " · No work"}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {previewDays.length > 3 ? (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setDetailPreviewExpanded((open) => !open)}
                      >
                        {detailPreviewExpanded ? "Show fewer" : "View all"}
                      </button>
                    ) : null}
                  </>
                ) : (
                  <p className="meta">Loading preview…</p>
                )}
              </section>
              {upcoming.length > 0 ? (
                <section className="upcoming-section" aria-labelledby="upcoming-changes-heading">
                  <h3 id="upcoming-changes-heading">
                    {upcoming.length === 1 ? "Upcoming change" : "Upcoming changes"}
                  </h3>
                  <ul className="simple-list">
                    {upcoming.map((entry) => (
                      <li key={entry.id}>
                        <p className="routine-upcoming-title">Starting {entry.startDate}</p>
                        <p className="meta">
                          {entry.revision.title} · {weekdaysLabel(entry.revision.weekdays)} ·{" "}
                          {DAYPART_LABELS[entry.revision.daypart]} ·{" "}
                          {ownerName(ownerIdFromRevision(entry.revision))}
                        </p>
                        {!inactive ? (
                          <div className="button-row">
                            <button type="button" onClick={() => openEditUpcoming(detail, entry)}>
                              Edit upcoming
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void confirmDeleteUpcoming(detail, entry)}
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
                <div className="detail-actions button-row">
                  <button type="button" className="primary" onClick={() => openEditCurrent(detail)}>
                    Edit
                  </button>
                  <div className="more-menu" ref={moreMenuRef}>
                    <button
                      type="button"
                      aria-expanded={moreOpen}
                      aria-haspopup="menu"
                      onClick={() => setMoreOpen((open) => !open)}
                    >
                      More
                    </button>
                    {moreOpen ? (
                      <ul className="more-menu-list" role="menu">
                        <li role="none">
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMoreOpen(false);
                              openScheduleNew(detail);
                            }}
                          >
                            Schedule for later
                          </button>
                        </li>
                        <li role="none">
                          <button
                            type="button"
                            role="menuitem"
                            disabled={busy}
                            onClick={() => void confirmEnd(detail)}
                          >
                            End responsibility
                          </button>
                        </li>
                        <li role="none">
                          <button
                            type="button"
                            role="menuitem"
                            className="danger-text"
                            disabled={busy}
                            onClick={() => void confirmDelete(detail)}
                          >
                            Delete
                          </button>
                        </li>
                      </ul>
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
      <section className="panel people-groups responsibilities-view">
        <div className="focused-state" aria-labelledby="ended-responsibilities-heading">
          <BackButton label="Back to Plan" onClick={() => setView({ kind: "list" })} />
          <FocusHeading id="ended-responsibilities-heading">Ended responsibilities</FocusHeading>
          {error ? <p role="alert">{error}</p> : null}
          {endedItems.length === 0 ? (
            <p className="meta">No ended responsibilities.</p>
          ) : (
            <ul className="routine-list routine-card-list">
              {endedItems.map((item) => renderRow(item))}
            </ul>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="panel people-groups responsibilities-view">
      <div className="focused-state" aria-labelledby="plan-heading">
        <h1 id="plan-heading">Plan</h1>
        <p className="page-subcopy">Household routines and responsibilities.</p>
        {error ? <p role="alert">{error}</p> : null}
        <div className="button-row plan-add-row">
          <button type="button" className="primary" onClick={openCreate}>
            Add responsibility
          </button>
          {props.onCreateRoutine ? (
            <button type="button" className="secondary" onClick={props.onCreateRoutine}>
              Add routine
            </button>
          ) : null}
        </div>
        <div className="plan-section">
          <h2>Responsibilities</h2>
          <p className="meta">
            {items.length} active {items.length === 1 ? "responsibility" : "responsibilities"}
          </p>
          {items.length === 0 ? (
            <p className="meta">No active responsibilities yet.</p>
          ) : (
            <ul className="routine-list routine-card-list">{items.map((item) => renderRow(item))}</ul>
          )}
          <button type="button" className="text-button" onClick={() => setView({ kind: "ended" })}>
            Ended responsibilities
          </button>
        </div>
      </div>
    </section>
  );
}
