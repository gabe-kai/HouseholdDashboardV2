import { useEffect, useState, type FormEvent } from "react";
import type {
  AccessState,
  GrantPreset,
  GroupPublic,
  MemberPublic,
  PersonDetail,
} from "../shared/schemas";
import {
  cancelEnrollmentSetup,
  createGroup,
  createPerson,
  deleteGroup,
  fetchGroups,
  fetchPerson,
  issueEnrollmentClaim,
  updateGroup,
  updatePerson,
  type PersonalTask,
} from "./api";
import { newClientId } from "./id";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

function classificationLabel(value: MemberPublic["classification"]): string {
  if (value === "adult") return "Adult";
  if (value === "child") return "Child";
  return "Classification not set";
}

function accessLabel(state: AccessState): string {
  switch (state) {
    case "access_set_up":
      return "Access set up";
    case "setup_ready":
      return "Setup ready";
    case "setup_expired":
      return "Setup expired";
    default:
      return "Not set up";
  }
}

const PRESET_OPTIONS: Array<{
  value: GrantPreset;
  label: string;
  description: string;
}> = [
  {
    value: "manager",
    label: "Household manager",
    description: "Manage people, access, and groups; shared Morning Routine; approvals.",
  },
  {
    value: "direct_personalizer",
    label: "Independent member",
    description: "Change their own routine directly; own checklist and personal tasks.",
  },
  {
    value: "proposal_personalizer",
    label: "Guided member",
    description: "Suggest routine changes for approval; own checklist and personal tasks.",
  },
];

export function PeopleGroupsView(props: {
  memberships: MemberPublic[];
  tasks: PersonalTask[];
  canManageStructure: boolean;
  canEnroll: boolean;
  onPeopleChanged: () => void;
  focusPersonId?: string | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(props.focusPersonId ?? null);
  const [detail, setDetail] = useState<PersonDetail | null>(null);
  const [groups, setGroups] = useState<GroupPublic[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groupEditor, setGroupEditor] = useState<GroupPublic | "new" | null>(null);

  const [newName, setNewName] = useState("");
  const [newClassification, setNewClassification] = useState<"adult" | "child">("child");

  useEffect(() => {
    if (props.focusPersonId) setSelectedId(props.focusPersonId);
  }, [props.focusPersonId]);

  useEffect(() => {
    void fetchGroups()
      .then((result) => setGroups(result.groups))
      .catch((caught) => setError(errorMessage(caught)));
  }, [props.memberships]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void fetchPerson(selectedId)
      .then((result) => setDetail(result.person))
      .catch((caught) => setError(errorMessage(caught)));
  }, [selectedId, props.memberships]);

  async function addPerson(event: FormEvent) {
    event.preventDefault();
    if (!props.canManageStructure) return;
    setError(null);
    setMessage(null);
    try {
      const result = await createPerson({
        mutationId: newClientId(),
        displayName: newName,
        classification: newClassification,
      });
      setNewName("");
      setMessage(`${result.person.displayName} added.`);
      setSelectedId(result.person.id);
      props.onPeopleChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <section className="panel people-groups">
      <h1>People &amp; Groups</h1>
      <p className="meta">
        Everyone in the household, their access status, and simple reusable groups.
      </p>
      {message ? (
        <p className="status-pill" data-kind="ok" role="status">
          {message}
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}

      <h2>People</h2>
      <ul className="people-list">
        {props.memberships.map((person) => (
          <li key={person.id}>
            <button
              type="button"
              className={selectedId === person.id ? "person-row selected" : "person-row"}
              onClick={() => setSelectedId(person.id)}
              aria-current={selectedId === person.id ? "true" : undefined}
            >
              <span className="person-name">{person.displayName}</span>
              <span className="meta">{classificationLabel(person.classification)}</span>
              <span className="meta">{accessLabel(person.accessState)}</span>
            </button>
          </li>
        ))}
      </ul>

      {props.canManageStructure ? (
        <form className="form-grid" onSubmit={addPerson}>
          <h3>Add a person</h3>
          <label>
            Display name
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              required
              maxLength={80}
            />
          </label>
          <fieldset>
            <legend>Classification</legend>
            <label className="choice-row">
              <input
                type="radio"
                name="new-classification"
                checked={newClassification === "adult"}
                onChange={() => setNewClassification("adult")}
              />
              Adult
            </label>
            <label className="choice-row">
              <input
                type="radio"
                name="new-classification"
                checked={newClassification === "child"}
                onChange={() => setNewClassification("child")}
              />
              Child
            </label>
          </fieldset>
          <button type="submit" className="primary">
            Add person
          </button>
        </form>
      ) : null}

      {detail ? (
        <PersonDetailPanel
          detail={detail}
          canManageStructure={props.canManageStructure}
          canEnroll={props.canEnroll}
          onChanged={() => {
            props.onPeopleChanged();
          }}
          onMessage={setMessage}
          onError={setError}
        />
      ) : null}

      <h2>Groups</h2>
      <ul className="people-list">
        {groups.map((group) => (
          <li key={group.id}>
            <button
              type="button"
              className="person-row"
              onClick={() => setGroupEditor(group)}
            >
              <span className="person-name">{group.name}</span>
              <span className="meta">
                {group.membershipIds.length} member
                {group.membershipIds.length === 1 ? "" : "s"}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {props.canManageStructure ? (
        <button type="button" className="primary" onClick={() => setGroupEditor("new")}>
          Create group
        </button>
      ) : null}

      {groupEditor ? (
        <GroupEditor
          initial={groupEditor === "new" ? null : groupEditor}
          people={props.memberships}
          canManage={props.canManageStructure}
          onClose={() => setGroupEditor(null)}
          onSaved={(group) => {
            setGroups((current) => {
              const without = current.filter((item) => item.id !== group.id);
              return [...without, group].sort((a, b) =>
                a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
              );
            });
            setGroupEditor(group);
            setMessage(`Saved group ${group.name}.`);
            props.onPeopleChanged();
          }}
          onDeleted={(groupId) => {
            setGroups((current) => current.filter((item) => item.id !== groupId));
            setGroupEditor(null);
            setMessage("Group deleted.");
            props.onPeopleChanged();
          }}
          onError={setError}
        />
      ) : null}

      <h2>Household-visible personal tasks</h2>
      {props.tasks.length === 0 ? (
        <p className="meta">None right now.</p>
      ) : (
        <ul className="checklist">
          {props.tasks.map((task) => (
            <li key={task.id}>
              {props.memberships.find((member) => member.id === task.ownerMembershipId)
                ?.displayName ?? "Household member"}{" "}
              · {task.title} · {task.status}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PersonDetailPanel(props: {
  detail: PersonDetail;
  canManageStructure: boolean;
  canEnroll: boolean;
  onChanged: () => void;
  onMessage: (value: string | null) => void;
  onError: (value: string | null) => void;
}) {
  const [displayName, setDisplayName] = useState(props.detail.displayName);
  const [classification, setClassification] = useState<"adult" | "child" | "unset">(
    props.detail.classification ?? "unset",
  );
  const [preset, setPreset] = useState<GrantPreset>("proposal_personalizer");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [replaceExplained, setReplaceExplained] = useState(false);

  useEffect(() => {
    setDisplayName(props.detail.displayName);
    setClassification(props.detail.classification ?? "unset");
    setIssuedToken(null);
    setReplaceExplained(false);
  }, [props.detail]);

  async function savePerson(event: FormEvent) {
    event.preventDefault();
    if (!props.canManageStructure) return;
    props.onError(null);
    try {
      await updatePerson(props.detail.id, {
        displayName,
        classification: classification === "unset" ? null : classification,
        expectedVersion: props.detail.version,
      });
      props.onMessage("Person updated.");
      props.onChanged();
    } catch (caught) {
      props.onError(errorMessage(caught));
    }
  }

  async function prepareSetup(replace: boolean) {
    if (!props.canEnroll) return;
    if (replace && !replaceExplained) {
      setReplaceExplained(true);
      props.onMessage(
        "Creating a replacement invalidates the previous setup material. Confirm by preparing again.",
      );
      return;
    }
    props.onError(null);
    setIssuedToken(null);
    try {
      const result = await issueEnrollmentClaim({
        mutationId: newClientId(),
        membershipId: props.detail.id,
        preset,
      });
      if (result.claim.secretAlreadyIssued || !result.claim.token) {
        props.onMessage(
          "Setup material was already issued for this request. Status is available; create a replacement if needed.",
        );
      } else {
        setIssuedToken(result.claim.token);
        props.onMessage("Setup ready. Copy the one-time material now; it cannot be retrieved later.");
      }
      setReplaceExplained(false);
      props.onChanged();
    } catch (caught) {
      props.onError(errorMessage(caught));
    }
  }

  async function cancelSetup() {
    if (!props.canEnroll) return;
    props.onError(null);
    try {
      await cancelEnrollmentSetup(props.detail.id);
      setIssuedToken(null);
      props.onMessage("Setup cancelled.");
      props.onChanged();
    } catch (caught) {
      props.onError(errorMessage(caught));
    }
  }

  const access = props.detail.access.state;
  const unenrolled = props.detail.access.state !== "access_set_up";

  return (
    <section className="person-detail" aria-labelledby="person-detail-heading">
      <h2 id="person-detail-heading">{props.detail.displayName}</h2>
      <p className="meta">{classificationLabel(props.detail.classification)}</p>
      <p>
        Access: <strong>{accessLabel(access)}</strong>
        {props.detail.access.setupExpiresAt ? (
          <span className="meta">
            {" "}
            · setup expires {new Date(props.detail.access.setupExpiresAt).toLocaleString()}
          </span>
        ) : null}
      </p>
      <p className="meta">
        Groups:{" "}
        {props.detail.groups.length
          ? props.detail.groups.map((group) => group.name).join(", ")
          : "None"}
      </p>
      <p className="meta">
        Morning Routine:{" "}
        {props.detail.morningRoutine.currentlyAssigned
          ? `Assigned on current shared revision (${props.detail.morningRoutine.revisionTitle})`
          : "Not currently assigned on the shared Morning Routine"}
      </p>

      {props.canManageStructure ? (
        <form className="form-grid" onSubmit={savePerson}>
          <h3>Edit person</h3>
          <label>
            Display name
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
              maxLength={80}
              aria-required="true"
            />
          </label>
          <fieldset>
            <legend>Classification</legend>
            <label className="choice-row">
              <input
                type="radio"
                name="edit-classification"
                checked={classification === "adult"}
                onChange={() => setClassification("adult")}
              />
              Adult
            </label>
            <label className="choice-row">
              <input
                type="radio"
                name="edit-classification"
                checked={classification === "child"}
                onChange={() => setClassification("child")}
              />
              Child
            </label>
            {props.detail.classification === null ? (
              <label className="choice-row">
                <input
                  type="radio"
                  name="edit-classification"
                  checked={classification === "unset"}
                  onChange={() => setClassification("unset")}
                />
                Classification not set
              </label>
            ) : null}
          </fieldset>
          <button type="submit" className="primary">
            Save person
          </button>
        </form>
      ) : null}

      {props.canEnroll && unenrolled ? (
        <div className="form-grid">
          <h3>Access setup</h3>
          <p className="meta">
            Adult/Child does not choose access level. Pick an access level explicitly.
          </p>
          <fieldset>
            <legend>Access level</legend>
            {PRESET_OPTIONS.map((option) => (
              <label key={option.value} className="choice-row">
                <input
                  type="radio"
                  name="access-preset"
                  checked={preset === option.value}
                  onChange={() => setPreset(option.value)}
                />
                <span>
                  <strong>{option.label}</strong>
                  <span className="meta"> — {option.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {access === "setup_ready" || access === "setup_expired" ? (
            <button type="button" onClick={() => void prepareSetup(true)}>
              {replaceExplained ? "Confirm replacement setup" : "Replace setup"}
            </button>
          ) : (
            <button type="button" className="primary" onClick={() => void prepareSetup(false)}>
              Prepare access setup
            </button>
          )}
          {access === "setup_ready" ? (
            <button type="button" onClick={() => void cancelSetup()}>
              Cancel setup
            </button>
          ) : null}
          {issuedToken ? (
            <div className="token-box" role="status">
              <strong>Copy this setup material now</strong>
              <code>{issuedToken}</code>
              <span className="meta">It cannot be shown again after you leave this screen.</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function GroupEditor(props: {
  initial: GroupPublic | null;
  people: MemberPublic[];
  canManage: boolean;
  onClose: () => void;
  onSaved: (group: GroupPublic) => void;
  onDeleted: (groupId: string) => void;
  onError: (value: string | null) => void;
}) {
  const [name, setName] = useState(props.initial?.name ?? "");
  const [selected, setSelected] = useState<string[]>(props.initial?.membershipIds ?? []);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setName(props.initial?.name ?? "");
    setSelected(props.initial?.membershipIds ?? []);
    setConfirmDelete(false);
  }, [props.initial]);

  function toggleMember(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!props.canManage) return;
    props.onError(null);
    try {
      if (!props.initial) {
        const result = await createGroup({
          mutationId: newClientId(),
          name,
          membershipIds: selected,
        });
        props.onSaved(result.group);
        return;
      }
      const result = await updateGroup(props.initial.id, {
        name,
        membershipIds: selected,
        expectedVersion: props.initial.version,
      });
      props.onSaved(result.group);
    } catch (caught) {
      props.onError(errorMessage(caught));
    }
  }

  async function remove() {
    if (!props.initial || !props.canManage) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    props.onError(null);
    try {
      await deleteGroup(props.initial.id);
      props.onDeleted(props.initial.id);
    } catch (caught) {
      props.onError(errorMessage(caught));
    }
  }

  return (
    <form className="form-grid group-editor" onSubmit={save}>
      <h3>{props.initial ? `Edit ${props.initial.name}` : "Create group"}</h3>
      <label>
        Group name
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={80}
          disabled={!props.canManage}
        />
      </label>
      <fieldset>
        <legend>Members</legend>
        {props.people.map((person) => (
          <label key={person.id} className="choice-row">
            <input
              type="checkbox"
              checked={selected.includes(person.id)}
              onChange={() => toggleMember(person.id)}
              disabled={!props.canManage}
            />
            {person.displayName}
          </label>
        ))}
      </fieldset>
      <div className="button-row">
        {props.canManage ? (
          <button type="submit" className="primary">
            Save group
          </button>
        ) : null}
        <button type="button" onClick={props.onClose}>
          Close
        </button>
        {props.canManage && props.initial ? (
          <button type="button" onClick={() => void remove()}>
            {confirmDelete ? "Confirm delete group" : "Delete group"}
          </button>
        ) : null}
      </div>
    </form>
  );
}
