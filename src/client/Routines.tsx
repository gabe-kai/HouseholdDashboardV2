import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Daypart, GroupPublic, MemberPublic } from "../shared/schemas";
import {
  archiveRoutine,
  createRevision,
  createRoutine,
  fetchGroups,
  fetchRoutine,
  fetchRoutines,
  type Routine,
  type RoutineRevision,
} from "./api";
import { newClientId } from "./id";

/** Client copy of domain DAYPART_LABELS (avoid domain import in client bundle). */
export const DAYPART_LABELS: Record<Daypart, string> = {
  morning: "Morning",
  after_school: "After school",
  evening: "Evening",
  bedtime: "Bedtime",
  anytime: "Anytime",
};

const DAYPART_OPTIONS: Daypart[] = [
  "morning",
  "after_school",
  "evening",
  "bedtime",
  "anytime",
];

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
  | { kind: "archived" }
  | { kind: "detail"; definitionId: string }
  | { kind: "create" }
  | { kind: "edit"; definitionId: string }
  | { kind: "picker"; returnTo: "create" | "edit"; definitionId?: string };

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
};

function emptyDraft(): Draft {
  return {
    title: "",
    daypart: "anytime",
    weekdays: [...EVERY_DAY],
    assigneeMemberIds: [],
    assigneeGroupIds: [],
    steps: [{ text: "New step", obligation: "required" }],
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

function nextFreeRevisionDate(routine: Routine | null, today: string): string | undefined {
  if (!routine) return undefined;
  const used = new Set(routine.revisions.map((revision) => revision.effectiveDate));
  const [y, m, d] = today.split("-").map(Number);
  let cursor = Date.UTC(y, m - 1, d + 1, 12, 0, 0);
  for (;;) {
    const date = new Date(cursor);
    const candidate = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    if (!used.has(candidate)) return candidate;
    cursor += 24 * 60 * 60 * 1000;
  }
}

function selectRevisionForDate(
  revisions: RoutineRevision[],
  date: string,
): RoutineRevision | null {
  let current: RoutineRevision | null = null;
  for (const revision of revisions) {
    if (revision.effectiveDate <= date) current = revision;
  }
  return current ?? revisions.at(-1) ?? null;
}

function latestRevision(routine: Routine): RoutineRevision | null {
  return routine.revisions.at(-1) ?? null;
}

function futureRevisions(revisions: RoutineRevision[], today: string): RoutineRevision[] {
  return revisions.filter((revision) => revision.effectiveDate > today);
}

function obligationLabel(obligation: RoutineRevision["steps"][number]["obligation"]): string {
  if (obligation === "as_needed") return "As needed";
  if (obligation === "required") return "Required";
  return "Optional";
}

function draftFromRevision(revision: RoutineRevision): Draft {
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
  };
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

export function RoutinesView(props: {
  memberships: MemberPublic[];
  onSaved: (routine: Routine) => void;
  onArchived?: (routine: Routine) => void;
  refreshToken?: number;
  today: string;
}) {
  const [view, setView] = useState<ViewState>({ kind: "list" });
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [archivedRoutines, setArchivedRoutines] = useState<Routine[]>([]);
  const [detailRoutine, setDetailRoutine] = useState<Routine | null>(null);
  const [groups, setGroups] = useState<GroupPublic[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [pickerMembers, setPickerMembers] = useState<string[]>([]);
  const [pickerGroups, setPickerGroups] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const loadGenerationRef = useRef(0);
  const selectedDefinitionRef = useRef<string | null>(null);

  async function loadList() {
    const generation = ++loadGenerationRef.current;
    const [activeResult, archivedResult, groupsResult] = await Promise.all([
      fetchRoutines(false),
      fetchRoutines(true),
      fetchGroups(),
    ]);
    if (generation !== loadGenerationRef.current) return;
    setGroups(groupsResult.groups);
    setRoutines(activeResult.routines);
    setArchivedRoutines(archivedResult.routines.filter((routine) => routine.archived));
  }

  async function loadDetail(definitionId: string) {
    selectedDefinitionRef.current = definitionId;
    const generation = ++loadGenerationRef.current;
    const [routineResult, groupsResult] = await Promise.all([
      fetchRoutine(definitionId),
      fetchGroups(),
    ]);
    if (generation !== loadGenerationRef.current) return;
    if (selectedDefinitionRef.current !== definitionId) return;
    setGroups(groupsResult.groups);
    setDetailRoutine(routineResult.routine);
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
    if (view.kind === "list" || view.kind === "archived") {
      selectedDefinitionRef.current = null;
      setDetailRoutine(null);
    }
  }, [view, props.refreshToken]);

  function openCreate() {
    setError(null);
    setStatusMessage(null);
    setDraft(emptyDraft());
    setView({ kind: "create" });
  }

  function openEdit(routine: Routine) {
    const latest = latestRevision(routine);
    if (!latest) return;
    setError(null);
    setStatusMessage(null);
    setDraft(draftFromRevision(latest));
    setDetailRoutine(routine);
    setView({ kind: "edit", definitionId: routine.id });
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
      setView({ kind: "picker", returnTo: "edit", definitionId: view.definitionId });
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
    else if (view.definitionId) setView({ kind: "edit", definitionId: view.definitionId });
  }

  function cancelPicker() {
    setError(null);
    if (view.kind !== "picker") return;
    if (view.returnTo === "create") setView({ kind: "create" });
    else if (view.definitionId) setView({ kind: "edit", definitionId: view.definitionId });
  }

  async function saveDraft(mode: "create" | "edit", definitionId?: string) {
    if (busy) return;
    if (!draft.title.trim()) {
      setError("Enter a routine name.");
      return;
    }
    if (draft.assigneeMemberIds.length === 0 && draft.assigneeGroupIds.length === 0) {
      setError("Add people or groups before saving.");
      return;
    }
    if (draft.weekdays.length === 0) {
      setError("Choose at least one weekday.");
      return;
    }
    if (draft.steps.some((step) => !step.text.trim())) {
      setError("Every step needs text.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
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
      let result: { routine: Routine };
      if (mode === "create") {
        result = await createRoutine(payload);
      } else {
        const current = detailRoutine ?? (definitionId ? (await fetchRoutine(definitionId)).routine : null);
        if (!current || !definitionId) throw new Error("Routine not found");
        result = await createRevision(definitionId, {
          ...payload,
          expectedVersion: current.version,
          effectiveDate: nextFreeRevisionDate(current, props.today),
        });
      }
      if (selectedDefinitionRef.current && selectedDefinitionRef.current !== result.routine.id) {
        return;
      }
      setDetailRoutine(result.routine);
      await loadList();
      const latest = latestRevision(result.routine);
      const takesEffect = latest?.effectiveDate;
      const savedTitle = latest?.title?.trim();
      if (mode === "create") {
        setStatusMessage(
          savedTitle && takesEffect
            ? `Created “${savedTitle}”. Active from ${takesEffect}.`
            : "Created.",
        );
      } else if (savedTitle && takesEffect && takesEffect > props.today) {
        setStatusMessage(
          `Saved “${savedTitle}”. Takes effect ${takesEffect}. Today’s checklist is unchanged until then.`,
        );
      } else if (savedTitle && takesEffect) {
        setStatusMessage(`Saved “${savedTitle}”. Active from ${takesEffect}.`);
      } else {
        setStatusMessage("Saved.");
      }
      setView({ kind: "detail", definitionId: result.routine.id });
      props.onSaved(result.routine);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Routine couldn't be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmArchive(routine: Routine) {
    const title = selectRevisionForDate(routine.revisions, props.today)?.title
      ?? latestRevision(routine)?.title
      ?? "this routine";
    if (
      !window.confirm(
        `Archive ${title}? It leaves the active list now. Today's checklist stays available; no occurrences are assigned from tomorrow onward.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await archiveRoutine(routine.id, {
        mutationId: newClientId(),
        expectedVersion: routine.version,
      });
      setStatusMessage(
        `Archived ${title}. Today's routine remains available; nothing is assigned from ${result.routine.archiveCutoffDate ?? "tomorrow"} onward.`,
      );
      await loadList();
      setView({ kind: "detail", definitionId: result.routine.id });
      setDetailRoutine(result.routine);
      props.onArchived?.(result.routine);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Routine couldn't be archived.");
    } finally {
      setBusy(false);
    }
  }

  function setWeekdayPreset(preset: "every" | "weekdays" | "weekends") {
    setDraft((current) => ({
      ...current,
      weekdays:
        preset === "every"
          ? [...EVERY_DAY]
          : preset === "weekdays"
            ? [...WEEKDAY_SET]
            : [...WEEKEND_SET],
    }));
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
    const heading = editing ? "Edit routine" : "New routine";
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
              if (
                !window.confirm("Discard unsaved changes and leave this routine?")
              ) {
                return;
              }
              setError(null);
              if (editing) setView({ kind: "detail", definitionId: view.definitionId });
              else setView({ kind: "list" });
            }}
          />
          <FocusHeading id="routine-form-heading">{heading}</FocusHeading>
          <p className="meta">
            {editing
              ? "Shared changes are prospective. Existing Today and history snapshots stay unchanged."
              : "New routines start today when they apply. Name, who, when, and steps stay in this draft until you save."}
          </p>
          {error ? <p role="alert">{error}</p> : null}
          <div className="form-grid">
            <label>
              Name
              <input
                value={draft.title}
                placeholder="Routine name"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, title: event.target.value }))
                }
              />
            </label>
            <label>
              Daypart
              <select
                value={draft.daypart}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    daypart: event.target.value as Daypart,
                  }))
                }
              >
                {DAYPART_OPTIONS.map((daypart) => (
                  <option key={daypart} value={daypart}>
                    {DAYPART_LABELS[daypart]}
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>When</legend>
              <div className="button-row">
                <button type="button" onClick={() => setWeekdayPreset("every")}>
                  Every day
                </button>
                <button type="button" onClick={() => setWeekdayPreset("weekdays")}>
                  Weekdays
                </button>
                <button type="button" onClick={() => setWeekdayPreset("weekends")}>
                  Weekends
                </button>
              </div>
              <div className="weekday-row">
                {WEEKDAYS.map((day) => (
                  <label key={day.value}>
                    <input
                      type="checkbox"
                      checked={draft.weekdays.includes(day.value)}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          weekdays: event.target.checked
                            ? [...current.weekdays, day.value]
                            : current.weekdays.filter((value) => value !== day.value),
                        }))
                      }
                    />
                    {day.label}
                  </label>
                ))}
              </div>
              <p className="meta">{weekdaysLabel(draft.weekdays)}</p>
            </fieldset>

            <div className="participation-summary" aria-labelledby="who-heading">
              <h3 id="who-heading">Who does this routine?</h3>
              {draft.assigneeGroupIds.length === 0 && draft.assigneeMemberIds.length === 0 ? (
                <p className="meta">Nobody selected yet.</p>
              ) : (
                <ul className="simple-list">
                  {draft.assigneeGroupIds.map((groupId) => {
                    const group = groups.find((item) => item.id === groupId);
                    const line = groupMemberLine(group, props.memberships);
                    return (
                      <li key={groupId}>
                        <strong>{group?.name ?? "Group"}</strong>
                        <div className="meta">{line.today}</div>
                        {line.pending ? <div className="meta">{line.pending}</div> : null}
                      </li>
                    );
                  })}
                  {draft.assigneeMemberIds.map((membershipId) => {
                    const person = props.memberships.find((item) => item.id === membershipId);
                    return (
                      <li key={membershipId}>
                        <strong>{person?.displayName ?? "Person"}</strong>
                        <div className="meta">Direct</div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <button type="button" onClick={openPicker}>
                {draft.assigneeGroupIds.length || draft.assigneeMemberIds.length
                  ? "Edit people or groups"
                  : "Add people or groups"}
              </button>
            </div>

            <fieldset>
              <legend>Steps</legend>
              {draft.steps.map((step, index) => (
                <div key={step.logicalItemId ?? index} className="step-editor">
                  <input
                    value={step.text}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        steps: current.steps.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, text: event.target.value } : item,
                        ),
                      }))
                    }
                  />
                  <select
                    value={step.obligation}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        steps: current.steps.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                obligation: event.target.value as DraftStep["obligation"],
                              }
                            : item,
                        ),
                      }))
                    }
                  >
                    <option value="required">Required</option>
                    <option value="as_needed">As needed</option>
                    <option value="optional">Optional</option>
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        steps: current.steps.filter((_, itemIndex) => itemIndex !== index),
                      }))
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    steps: [...current.steps, { text: "New step", obligation: "required" }],
                  }))
                }
              >
                Add step
              </button>
            </fieldset>
            <div className="button-row">
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() =>
                  void saveDraft(
                    editing ? "edit" : "create",
                    editing ? view.definitionId : undefined,
                  )
                }
              >
                {busy ? "Saving…" : editing ? "Save new revision" : "Create routine"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm("Discard unsaved changes?")) return;
                  setError(null);
                  if (editing) setView({ kind: "detail", definitionId: view.definitionId });
                  else setView({ kind: "list" });
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (view.kind === "detail") {
    const routine = detailRoutine;
    const todayRevision = routine
      ? selectRevisionForDate(routine.revisions, props.today)
      : null;
    const upcomingRevisions = routine
      ? futureRevisions(routine.revisions, props.today)
      : [];
    const title =
      todayRevision?.title ??
      (routine ? latestRevision(routine)?.title : null) ??
      "Routine";

    return (
      <section className="panel people-groups routines-view">
        <div className="focused-state" aria-labelledby="routine-detail-heading">
          <BackButton
            label={routine?.archived ? "Back to Archived routines" : "Back to Routines"}
            onClick={() => setView({ kind: routine?.archived ? "archived" : "list" })}
          />
          <FocusHeading id="routine-detail-heading">{title}</FocusHeading>
          {statusMessage ? <p role="status">{statusMessage}</p> : null}
          {error ? <p role="alert">{error}</p> : null}
          {!routine || !todayRevision ? (
            <p className="meta">Loading routine…</p>
          ) : (
            <>
              {routine.archived ? (
                <p className="meta">
                  Archived
                  {routine.archiveCutoffDate
                    ? ` · no assignments from ${routine.archiveCutoffDate}`
                    : ""}
                </p>
              ) : null}
              <p className="meta">
                Active today · {DAYPART_LABELS[todayRevision.daypart]} ·{" "}
                {weekdaysLabel(todayRevision.weekdays)}
                {todayRevision.effectiveDate !== props.today
                  ? ` · configuration from ${todayRevision.effectiveDate}`
                  : ""}
              </p>
              <h3>Who today</h3>
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
              <h3>Today&apos;s steps</h3>
              <ol className="preview-list">
                {todayRevision.steps.map((step) => (
                  <li key={step.id ?? step.logicalItemId}>
                    <strong>{step.text}</strong>
                    <div className="meta">{obligationLabel(step.obligation)}</div>
                  </li>
                ))}
              </ol>
              {upcomingRevisions.map((upcoming) => (
                <section
                  key={upcoming.id}
                  className="routine-upcoming"
                  aria-labelledby={`upcoming-${upcoming.id}-heading`}
                >
                  <h3 id={`upcoming-${upcoming.id}-heading`}>
                    Starting {upcoming.effectiveDate}
                  </h3>
                  <p className="routine-upcoming-title">{upcoming.title}</p>
                  <p className="meta">
                    {DAYPART_LABELS[upcoming.daypart]} · {weekdaysLabel(upcoming.weekdays)}
                  </p>
                  <p className="meta">
                    Who: {whoSummary(upcoming, props.memberships, groups)}
                  </p>
                  <h4 className="routine-upcoming-steps-heading">Steps from that date</h4>
                  <ol className="preview-list">
                    {upcoming.steps.map((step) => (
                      <li key={step.id ?? step.logicalItemId}>
                        <strong>{step.text}</strong>
                        <div className="meta">{obligationLabel(step.obligation)}</div>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
              <div className="button-row">
                {!routine.archived ? (
                  <>
                    <button type="button" className="primary" onClick={() => openEdit(routine)}>
                      Edit routine
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void confirmArchive(routine)}
                    >
                      Archive routine
                    </button>
                  </>
                ) : null}
              </div>
            </>
          )}
        </div>
      </section>
    );
  }

  if (view.kind === "archived") {
    return (
      <section className="panel people-groups routines-view">
        <div className="focused-state" aria-labelledby="archived-routines-heading">
          <BackButton label="Back to Routines" onClick={() => setView({ kind: "list" })} />
          <FocusHeading id="archived-routines-heading">Archived routines</FocusHeading>
          {error ? <p role="alert">{error}</p> : null}
          {archivedRoutines.length === 0 ? (
            <p className="meta">No archived routines.</p>
          ) : (
            <ul className="routine-card-list">
              {archivedRoutines.map((routine) => {
                const revision =
                  selectRevisionForDate(routine.revisions, props.today) ??
                  latestRevision(routine);
                if (!revision) return null;
                return (
                  <li key={routine.id}>
                    <button
                      type="button"
                      className="routine-card"
                      onClick={() => setView({ kind: "detail", definitionId: routine.id })}
                    >
                      <span className="person-name">{revision.title}</span>
                      <span className="meta">
                        {DAYPART_LABELS[revision.daypart]}
                        {routine.archiveCutoffDate
                          ? ` · cutoff ${routine.archiveCutoffDate}`
                          : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
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
        {statusMessage ? <p role="status">{statusMessage}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        <div className="button-row">
          <button type="button" className="primary" onClick={openCreate}>
            New routine
          </button>
        </div>
        {routines.length === 0 ? (
          <p className="meta">No active routines yet. Create one to get started.</p>
        ) : (
          <ul className="routine-card-list">
            {routines.map((routine) => {
              const revision =
                selectRevisionForDate(routine.revisions, props.today) ?? latestRevision(routine);
              const upcoming = futureRevisions(routine.revisions, props.today);
              const nextChange = upcoming.at(-1) ?? null;
              if (!revision) return null;
              return (
                <li key={routine.id}>
                  <button
                    type="button"
                    className="routine-card"
                    onClick={() => {
                      setStatusMessage(null);
                      setView({ kind: "detail", definitionId: routine.id });
                    }}
                  >
                    <span className="person-name">{revision.title}</span>
                    <span className="meta">{whoSummary(revision, props.memberships, groups)}</span>
                    <span className="meta">
                      {weekdaysLabel(revision.weekdays)} · {DAYPART_LABELS[revision.daypart]}
                    </span>
                    {nextChange ? (
                      <span className="meta routine-card-upcoming">
                        Starting {nextChange.effectiveDate}: {nextChange.title}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setStatusMessage(null);
            setView({ kind: "archived" });
          }}
        >
          Archived routines
        </button>
      </div>
    </section>
  );
}
