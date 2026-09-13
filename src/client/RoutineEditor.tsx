import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { MemberPublic } from "../shared/schemas";
import { createRevision, createRoutine, fetchGroups, fetchRoutine, type Routine } from "./api";
import { newClientId } from "./id";

type GroupOption = {
  id: string;
  name: string;
  membershipIds: string[];
  usedByMorningRoutine?: boolean;
};

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

function uniqueCount(directIds: string[], groupIds: string[], groups: GroupOption[]): number {
  const set = new Set(directIds);
  for (const groupId of groupIds) {
    const group = groups.find((item) => item.id === groupId);
    for (const membershipId of group?.membershipIds ?? []) set.add(membershipId);
  }
  return set.size;
}

export function RoutineEditor(props: {
  memberships: MemberPublic[];
  onSaved: (routine: Routine) => void;
  refreshToken?: number;
}) {
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [title, setTitle] = useState("Morning Routine");
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [assigneeMemberIds, setAssigneeMemberIds] = useState<string[]>([]);
  const [assigneeGroupIds, setAssigneeGroupIds] = useState<string[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [steps, setSteps] = useState<
    Array<{ text: string; obligation: "required" | "as_needed" | "optional"; logicalItemId?: string }>
  >([{ text: "New step", obligation: "required" }]);
  const [view, setView] = useState<PickerState>({ kind: "summary" });
  const [draftMembers, setDraftMembers] = useState<string[]>([]);
  const [draftGroups, setDraftGroups] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadRoutineAndGroups() {
    const [routineResult, groupsResult] = await Promise.all([fetchRoutine(), fetchGroups()]);
    setGroups(groupsResult.groups);
    setRoutine(routineResult.routine);
    const latest = routineResult.routine?.revisions.at(-1);
    if (!latest) return;
    setTitle(latest.title);
    setWeekdays(latest.weekdays);
    setAssigneeMemberIds(latest.assigneeMemberIds);
    setAssigneeGroupIds(latest.assigneeGroupIds ?? []);
    setSteps(
      latest.steps.map((step) => ({
        text: step.text,
        obligation: step.obligation,
        logicalItemId: step.logicalItemId,
      })),
    );
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
      };
      const result = routine
        ? await createRevision(routine.id, payload)
        : await createRoutine(payload);
      const latest = result.routine.revisions.at(-1)!;
      setRoutine(result.routine);
      setAssigneeMemberIds(latest.assigneeMemberIds);
      setAssigneeGroupIds(latest.assigneeGroupIds ?? []);
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
      };
      const result = routine
        ? await createRevision(routine.id, payload)
        : await createRoutine(payload);
      setRoutine(result.routine);
      const latest = result.routine.revisions.at(-1)!;
      setAssigneeMemberIds(latest.assigneeMemberIds);
      setAssigneeGroupIds(latest.assigneeGroupIds ?? []);
      props.onSaved(result.routine);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Morning Routine couldn't be updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  const resolved = uniqueCount(assigneeMemberIds, assigneeGroupIds, groups);
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
            group stay with that group.
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
                              {group.membershipIds.length === 0
                                ? "No members yet — still valid"
                                : memberNames(group.membershipIds, props.memberships)}
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
              {uniqueCount(draftMembers, draftGroups, groups)}{" "}
              {uniqueCount(draftMembers, draftGroups, groups) === 1 ? "person" : "people"}{" "}
              after save
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
                return (
                  <li key={groupId}>
                    <strong>{group?.name ?? "Group"}</strong>
                    <div className="meta">
                      {group && group.membershipIds.length > 0
                        ? memberNames(group.membershipIds, props.memberships)
                        : "No members yet"}
                    </div>
                  </li>
                );
              })}
              {assigneeMemberIds.map((membershipId) => {
                const person = props.memberships.find((item) => item.id === membershipId);
                const alsoThrough = assigneeGroupIds.find((groupId) =>
                  groups
                    .find((group) => group.id === groupId)
                    ?.membershipIds.includes(membershipId),
                );
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
            {resolved} {resolved === 1 ? "person" : "people"} unique
          </p>
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
