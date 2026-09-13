import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { GroupPublic, MemberPublic } from "../shared/schemas";
import { createRevision, createRoutine, fetchGroups, fetchRoutine, type Routine } from "./api";
import { newClientId } from "./id";

type PickerState =
  | { kind: "summary" }
  | { kind: "picker" };

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

function memberNames(ids: string[], people: MemberPublic[]): string {
  return ids
    .map((id) => people.find((person) => person.id === id)?.displayName ?? "Unknown")
    .join(", ");
}

function uniqueFromIds(directIds: string[], groupIds: string[], groups: GroupPublic[], mode: "effective" | "configured"): number {
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

function groupMemberLine(
  group: GroupPublic | undefined,
  people: MemberPublic[],
): { today: string; pending: string | null } {
  if (!group) return { today: "Group", pending: null };
  const effective = group.effectiveMembershipIds ?? group.membershipIds;
  const today =
    effective.length === 0
      ? "No members for today"
      : memberNames(effective, people);
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

export function RoutineEditor(props: {
  memberships: MemberPublic[];
  onSaved: (routine: Routine) => void;
  refreshToken?: number;
  today: string;
}) {
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [title, setTitle] = useState("Morning Routine");
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [assigneeMemberIds, setAssigneeMemberIds] = useState<string[]>([]);
  const [assigneeGroupIds, setAssigneeGroupIds] = useState<string[]>([]);
  const [groups, setGroups] = useState<GroupPublic[]>([]);
  const [resolvedToday, setResolvedToday] = useState<string[]>([]);
  const [upcomingResolved, setUpcomingResolved] = useState<string[] | null>(null);
  const [upcomingFromDate, setUpcomingFromDate] = useState<string | null>(null);
  const [steps, setSteps] = useState<
    Array<{ text: string; obligation: "required" | "as_needed" | "optional"; logicalItemId?: string }>
  >([{ text: "New step", obligation: "required" }]);
  const [view, setView] = useState<PickerState>({ kind: "summary" });
  const [draftMembers, setDraftMembers] = useState<string[]>([]);
  const [draftGroups, setDraftGroups] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function applyLatestRevision(next: Routine | null, nextGroups: GroupPublic[]) {
    setGroups(nextGroups);
    setRoutine(next);
    const latest = next?.revisions.at(-1);
    if (!latest) {
      setResolvedToday([]);
      setUpcomingResolved(null);
      setUpcomingFromDate(null);
      return;
    }
    setTitle(latest.title);
    setWeekdays(latest.weekdays);
    setAssigneeMemberIds(latest.assigneeMemberIds);
    setAssigneeGroupIds(latest.assigneeGroupIds ?? []);
    setResolvedToday(latest.resolvedMemberIds ?? []);
    setUpcomingResolved(latest.upcomingResolvedMemberIds ?? null);
    setUpcomingFromDate(latest.upcomingParticipationFromDate ?? null);
    setSteps(
      latest.steps.map((step) => ({
        text: step.text,
        obligation: step.obligation,
        logicalItemId: step.logicalItemId,
      })),
    );
  }

  async function loadRoutineAndGroups() {
    const [routineResult, groupsResult] = await Promise.all([fetchRoutine(), fetchGroups()]);
    applyLatestRevision(routineResult.routine, groupsResult.groups);
  }

  useEffect(() => {
    void loadRoutineAndGroups().catch((caught) =>
      setError(caught instanceof Error ? caught.message : "Something went wrong"),
    );
  }, [props.refreshToken]);

  function openPicker() {
    setDraftMembers([...assigneeMemberIds]);
    setDraftGroups([...assigneeGroupIds]);
    setError(null);
    setView({ kind: "picker" });
  }

  function toggleGroup(groupId: string) {
    const group = groups.find((item) => item.id === groupId);
    setDraftGroups((current) => {
      const selected = current.includes(groupId);
      const next = selected ? current.filter((id) => id !== groupId) : [...current, groupId];
      if (!selected && group) {
        // Normalize against configured members (what a save will use for the next effect date).
        setDraftMembers((members) =>
          members.filter((id) => !group.membershipIds.includes(id)),
        );
      }
      return next;
    });
  }

  function togglePerson(membershipId: string) {
    const covered = draftGroups.some((groupId) =>
      groups.find((group) => group.id === groupId)?.membershipIds.includes(membershipId),
    );
    if (covered) return;
    setDraftMembers((current) =>
      current.includes(membershipId)
        ? current.filter((id) => id !== membershipId)
        : [...current, membershipId],
    );
  }

  async function applyParticipation(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (draftMembers.length === 0 && draftGroups.length === 0) {
      setError("Choose at least one person or group.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        mutationId: newClientId(),
        title,
        weekdays,
        assigneeMemberIds: draftMembers,
        assigneeGroupIds: draftGroups,
        steps,
        effectiveDate: nextFreeRevisionDate(routine, props.today),
      };
      const result = routine
        ? await createRevision(routine.id, payload)
        : await createRoutine(payload);
      const groupsResult = await fetchGroups();
      applyLatestRevision(result.routine, groupsResult.groups);
      setView({ kind: "summary" });
      props.onSaved(result.routine);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Morning Routine couldn't be updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveDefinition() {
    if (busy) return;
    if (assigneeMemberIds.length === 0 && assigneeGroupIds.length === 0) {
      setError("Add people or groups before saving the Morning Routine.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        mutationId: newClientId(),
        title,
        weekdays,
        assigneeMemberIds,
        assigneeGroupIds,
        steps,
        effectiveDate: nextFreeRevisionDate(routine, props.today),
      };
      const result = routine
        ? await createRevision(routine.id, payload)
        : await createRoutine(payload);
      const groupsResult = await fetchGroups();
      applyLatestRevision(result.routine, groupsResult.groups);
      props.onSaved(result.routine);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Morning Routine couldn't be updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  const resolvedCount =
    resolvedToday.length > 0
      ? resolvedToday.length
      : uniqueFromIds(assigneeMemberIds, assigneeGroupIds, groups, "effective");
  const WEEKDAYS: Array<{ value: number; label: string }> = [
    { value: 1, label: "Mon" },
    { value: 2, label: "Tue" },
    { value: 3, label: "Wed" },
    { value: 4, label: "Thu" },
    { value: 5, label: "Fri" },
    { value: 6, label: "Sat" },
    { value: 7, label: "Sun" },
  ];

  if (view.kind === "picker") {
    return (
      <section className="panel people-groups">
        <div className="focused-state" aria-labelledby="participation-picker-heading">
          <button type="button" className="back-link" onClick={() => setView({ kind: "summary" })}>
            Back to Morning Routine
          </button>
          <FocusHeading id="participation-picker-heading">Who does this routine?</FocusHeading>
          <p className="meta">
            Each selected group member gets one Morning Routine. People already included through a
            group stay with that group. Configured group changes that start tomorrow are labeled
            separately from today.
          </p>
          {error ? <p role="alert">{error}</p> : null}
          <form className="form-grid" onSubmit={applyParticipation}>
            <fieldset>
              <legend>Groups</legend>
              {groups.length === 0 ? (
                <p className="meta">No groups yet. Create one in People &amp; Groups.</p>
              ) : (
                <ul className="people-list">
                  {groups.map((group) => {
                    const selected = draftGroups.includes(group.id);
                    const line = groupMemberLine(group, props.memberships);
                    return (
                      <li key={group.id}>
                        <label className={`choice-row person-row ${selected ? "selected" : ""}`}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleGroup(group.id)}
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
                  const covered = draftGroups.some((groupId) =>
                    groups
                      .find((group) => group.id === groupId)
                      ?.membershipIds.includes(person.id),
                  );
                  const selected = draftMembers.includes(person.id) || covered;
                  return (
                    <li key={person.id}>
                      <label
                        className={`choice-row person-row ${selected ? "selected" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={covered}
                          onChange={() => togglePerson(person.id)}
                        />
                        <span>
                          <span className="person-name">{person.displayName}</span>
                          <span className="meta">
                            {covered
                              ? `Included through ${
                                  groups.find(
                                    (group) =>
                                      draftGroups.includes(group.id) &&
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
              {uniqueFromIds(draftMembers, draftGroups, groups, "configured")}{" "}
              {uniqueFromIds(draftMembers, draftGroups, groups, "configured") === 1
                ? "person"
                : "people"}{" "}
              after the next save takes effect
            </p>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Saving…" : "Save who does this"}
            </button>
          </form>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <h1>Morning Routine</h1>
      <p className="meta">
        Shared changes are prospective. Existing Today and history snapshots stay unchanged.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <div className="form-grid">
        <label>
          Title
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <fieldset>
          <legend>Weekdays</legend>
          <div className="weekday-row">
            {WEEKDAYS.map((day) => (
              <label key={day.value}>
                <input
                  type="checkbox"
                  checked={weekdays.includes(day.value)}
                  onChange={(event) =>
                    setWeekdays((current) =>
                      event.target.checked
                        ? [...current, day.value]
                        : current.filter((value) => value !== day.value),
                    )
                  }
                />
                {day.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="participation-summary" aria-labelledby="who-heading">
          <h2 id="who-heading">Who does this routine?</h2>
          {assigneeGroupIds.length === 0 && assigneeMemberIds.length === 0 ? (
            <p className="meta">Nobody selected yet.</p>
          ) : (
            <ul className="simple-list">
              {assigneeGroupIds.map((groupId) => {
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
              {assigneeMemberIds.map((membershipId) => {
                const person = props.memberships.find((item) => item.id === membershipId);
                const alsoThrough = assigneeGroupIds.find((groupId) => {
                  const group = groups.find((item) => item.id === groupId);
                  const effective = group?.effectiveMembershipIds ?? group?.membershipIds ?? [];
                  return effective.includes(membershipId);
                });
                return (
                  <li key={membershipId}>
                    <strong>{person?.displayName ?? "Person"}</strong>
                    <div className="meta">
                      {alsoThrough
                        ? `Also included through ${
                            groups.find((group) => group.id === alsoThrough)?.name ?? "a group"
                          }`
                        : "Direct"}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="meta">
            {resolvedCount} {resolvedCount === 1 ? "person" : "people"} unique today
          </p>
          {upcomingFromDate && upcomingResolved ? (
            <p className="meta">
              Starting {upcomingFromDate}: {upcomingResolved.length}{" "}
              {upcomingResolved.length === 1 ? "person" : "people"} unique
            </p>
          ) : null}
          <button type="button" onClick={openPicker}>
            {assigneeGroupIds.length || assigneeMemberIds.length
              ? "Edit people or groups"
              : "Add people or groups"}
          </button>
        </div>

        <fieldset>
          <legend>Steps</legend>
          {steps.map((step, index) => (
            <div key={step.logicalItemId ?? index} className="step-editor">
              <input
                value={step.text}
                onChange={(event) =>
                  setSteps((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, text: event.target.value } : item,
                    ),
                  )
                }
              />
              <select
                value={step.obligation}
                onChange={(event) =>
                  setSteps((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index
                        ? {
                            ...item,
                            obligation: event.target.value as
                              | "required"
                              | "as_needed"
                              | "optional",
                          }
                        : item,
                    ),
                  )
                }
              >
                <option value="required">Required</option>
                <option value="as_needed">As needed</option>
                <option value="optional">Optional</option>
              </select>
              <button
                type="button"
                onClick={() =>
                  setSteps((current) => current.filter((_, itemIndex) => itemIndex !== index))
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setSteps((current) => [...current, { text: "New step", obligation: "required" }])
            }
          >
            Add step
          </button>
        </fieldset>
        <button type="button" className="primary" disabled={busy} onClick={() => void saveDefinition()}>
          {busy ? "Saving…" : routine ? "Save new revision" : "Create Morning Routine"}
        </button>
      </div>
    </section>
  );
}
