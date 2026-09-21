import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Daypart, MemberPublic, ResponsibilityPreviewDay } from "../shared/schemas";
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
  type ApiError,
  type PlanRefineOutcome,
  type Responsibility,
  type ResponsibilityMutationResult,
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
  type EditorDraft,
  type EditorDraftStep,
  type EditorFocus,
} from "./RoutineFocusedEditor";
import { DAYPART_LABELS } from "./Routines";

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];

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

type Draft = {
  title: string;
  daypart: Daypart;
  weekdays: number[];
  accountableMemberId: string;
  steps: EditorDraftStep[];
  startingDate: string;
};

function emptyDraft(today: string): Draft {
  return {
    title: "",
    daypart: "anytime",
    weekdays: [...EVERY_DAY],
    accountableMemberId: "",
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
    startingDate: draft.startingDate,
    steps: draft.steps.map((step) => ({
      text: step.text.trim(),
      obligation: step.obligation,
      logicalItemId: step.logicalItemId ?? null,
    })),
  });
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

function obligationLabel(obligation: string): string {
  if (obligation === "as_needed") return "As needed";
  if (obligation === "required") return "Required";
  return "Optional";
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
    beginDraft(
      {
        title: revision.title,
        daypart: revision.daypart,
        weekdays: [...revision.weekdays],
        accountableMemberId: ownerIdFromRevision(revision),
        steps: revision.steps.map((step) => ({
          text: step.text,
          obligation: step.obligation,
          logicalItemId: step.logicalItemId,
          applicability: DEFAULT_APPLICABILITY,
        })),
        startingDate: props.today,
      },
      definition.version,
    );
    setView({ kind: "edit", definitionId: definition.id, mode: "current" });
  }

  function openScheduleNew(definition: Responsibility) {
    const revision = currentRevision(definition, props.today) ?? fallbackRevision(definition);
    if (!revision) return;
    beginDraft(
      {
        title: revision.title,
        daypart: revision.daypart,
        weekdays: [...revision.weekdays],
        accountableMemberId: ownerIdFromRevision(revision),
        steps: revision.steps.map((step) => ({
          text: step.text,
          obligation: step.obligation,
          logicalItemId: step.logicalItemId,
          applicability: DEFAULT_APPLICABILITY,
        })),
        startingDate: props.today,
      },
      definition.version,
    );
    setView({ kind: "edit", definitionId: definition.id, mode: "schedule-new" });
  }

  function openEditUpcoming(definition: Responsibility, entry: ScheduleEntry) {
    beginDraft(
      {
        title: entry.revision.title,
        daypart: entry.revision.daypart,
        weekdays: [...entry.revision.weekdays],
        accountableMemberId: ownerIdFromRevision(entry.revision),
        steps: entry.revision.steps.map((step) => ({
          text: step.text,
          obligation: step.obligation,
          logicalItemId: step.logicalItemId,
          applicability: DEFAULT_APPLICABILITY,
        })),
        startingDate: entry.startDate,
      },
      definition.version,
    );
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
    if (!draft.accountableMemberId) {
      setError("Choose one accountable person.");
      return false;
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
    return true;
  }

  function mutationPayload() {
    return {
      mutationId: newClientId(),
      title: draft.title.trim(),
      daypart: draft.daypart,
      weekdays: draft.weekdays,
      accountableMemberId: draft.accountableMemberId,
      steps: draft.steps.map((step) => ({
        text: step.text.trim(),
        obligation: step.obligation,
        ...(step.logicalItemId ? { logicalItemId: step.logicalItemId } : {}),
        applicability: DEFAULT_APPLICABILITY,
      })),
    };
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
      const result = await createResponsibility(mutationPayload());
      detailGenerationRef.current += 1;
      previewGenerationRef.current += 1;
      applyDetail(result.responsibility);
      await loadList();
      setBaselineSnapshot(draftSnapshot(draft));
      setDraftBaselineVersion(result.responsibility.version);
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
          ...mutationPayload(),
          expectedVersion,
          mode: "schedule",
          scheduleEntryId,
          effectiveDate: draft.startingDate,
        });
      } else if (editMode === "schedule-new") {
        result = await createResponsibilityRevision(definitionId, {
          ...mutationPayload(),
          expectedVersion,
          mode: "schedule",
          effectiveDate: draft.startingDate,
        });
      } else {
        result = await createResponsibilityRevision(definitionId, {
          ...mutationPayload(),
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
    const owner = ownerIdFromRevision(revision);
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
            {owner ? ` · ${ownerName(owner)}` : ""}
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
    const ordered = peopleInFamilyOrder(props.memberships);
    return (
      <section className="panel people-groups responsibilities-view">
        <div className="focused-state" aria-labelledby="responsibility-who-heading">
          <BackButton
            label={view.returnTo === "create" ? "Back to new responsibility" : "Back to edit"}
            onClick={() => {
              if (view.returnTo === "create") setView({ kind: "create" });
              else {
                setView({
                  kind: "edit",
                  definitionId: view.definitionId!,
                  mode: view.editMode ?? "current",
                  scheduleEntryId: view.scheduleEntryId,
                });
              }
            }}
          />
          <FocusHeading id="responsibility-who-heading">Who is accountable?</FocusHeading>
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
                setError("Choose one accountable person.");
                return;
              }
              setDraft((current) => ({ ...current, accountableMemberId: pickerMemberId }));
              setError(null);
              if (view.returnTo === "create") setView({ kind: "create" });
              else {
                setView({
                  kind: "edit",
                  definitionId: view.definitionId!,
                  mode: view.editMode ?? "current",
                  scheduleEntryId: view.scheduleEntryId,
                });
              }
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
                Apply who is accountable
              </button>
              <button
                type="button"
                onClick={() => {
                  if (view.returnTo === "create") setView({ kind: "create" });
                  else {
                    setView({
                      kind: "edit",
                      definitionId: view.definitionId!,
                      mode: view.editMode ?? "current",
                      scheduleEntryId: view.scheduleEntryId,
                    });
                  }
                }}
              >
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
        if (focus === "steps") setStepLocalIds(ensureStepLocalIds(draft.steps));
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
          {editorFocus === "steps" && sectionDraft ? (
            <StepsSectionEditor
              steps={sectionDraft.steps}
              stepLocalIds={workingIds}
              listLabel="Responsibility work"
              hideApplicability
              onChange={(steps, localIds) => {
                setSectionDraft({ ...sectionDraft, steps });
                setStepLocalIds(localIds);
              }}
              onEditStep={(index, localId) =>
                setEditorFocus({ kind: "step", index, localId })
              }
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
              }}
              onCancel={cancelSection}
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
                setEditorFocus("steps");
              }}
              onDone={() => setEditorFocus("steps")}
              onCancel={() => setEditorFocus("steps")}
            />
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
                whoSummary={
                  working.accountableMemberId
                    ? ownerName(working.accountableMemberId)
                    : "Nobody selected"
                }
                onOpenName={() => openSection("name")}
                onOpenWhen={() => openSection("when")}
                onOpenWho={() => {
                  setPickerMemberId(draft.accountableMemberId);
                  if (view.kind === "create") {
                    setView({ kind: "picker", returnTo: "create" });
                  } else {
                    setView({
                      kind: "picker",
                      returnTo: "edit",
                      definitionId: view.definitionId,
                      editMode: view.mode,
                      scheduleEntryId: view.scheduleEntryId,
                    });
                  }
                }}
                onOpenSteps={() => openSection("steps")}
                startingMin={props.today}
                onStartingDateChange={(value) =>
                  setDraft((current) => ({ ...current, startingDate: value }))
                }
              />
              {working.accountableMemberId && accessNote(working.accountableMemberId) ? (
                <p className="meta">{accessNote(working.accountableMemberId)}</p>
              ) : null}
              <div className="button-row">
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => void (editing ? saveEdit() : saveCreate())}
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
              <h3>Who</h3>
              <p>{owner ? ownerName(owner) : "Nobody"}</p>
              {owner && accessNote(owner) ? <p className="meta">{accessNote(owner)}</p> : null}
              <h3>Work · {revision.steps.length}</h3>
              <ol className="compact-step-list">
                {revision.steps.map((step, index) => (
                  <li key={step.id ?? step.logicalItemId} className="compact-step">
                    <span className="meta">{index + 1}.</span>
                    <strong>{step.text}</strong>
                    <span className="meta">{obligationLabel(step.obligation)}</span>
                  </li>
                ))}
              </ol>
              <section className="plan-preview-section" aria-labelledby="next-7-days-heading">
                <h3 id="next-7-days-heading">Next 7 days</h3>
                <p className="meta">
                  Read-only preview using household dates. Does not create checklist work.
                </p>
                {previewError ? <p role="alert">{previewError}</p> : null}
                {previewDays ? (
                  <ul className="simple-list responsibility-preview-list">
                    {previewDays.map((day) => (
                      <li key={day.householdDate}>
                        <strong>{day.householdDate}</strong>
                        <span className="meta">
                          {day.applicable
                            ? ` · ${day.title ?? title} · ${day.accountableMemberName ?? "Owner"}${
                                day.daypart ? ` · ${DAYPART_LABELS[day.daypart]}` : ""
                              }${day.startedProtected ? " · In progress (protected)" : ""}`
                            : " · No work"}
                        </span>
                      </li>
                    ))}
                  </ul>
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
