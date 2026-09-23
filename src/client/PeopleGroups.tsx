import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type {
  AccessState,
  Daypart,
  GrantPreset,
  GroupPublic,
  MemberPublic,
  OccurrenceView,
  PersonDetail,
  StepStatus,
} from "../shared/schemas";
import {
  cancelEnrollmentSetup,
  createGroup,
  createPerson,
  deleteGroup,
  fetchGroups,
  fetchPerson,
  issueEnrollmentClaim,
  saveFamilyOrder,
  updateGroup,
  updatePerson,
  type PersonalTask,
} from "./api";
import { newClientId } from "./id";
import { OrderedList } from "./OrderedList";

const DAYPART_LABELS: Record<Daypart, string> = {
  morning: "Morning",
  after_school: "After school",
  evening: "Evening",
  bedtime: "Bedtime",
  anytime: "Anytime",
};

type ViewState =
  | { kind: "overview" }
  | { kind: "person-detail"; personId: string }
  | { kind: "add-person" }
  | { kind: "edit-person"; personId: string }
  | { kind: "reorder-people" }
  | { kind: "access"; personId: string }
  | { kind: "group-detail"; groupId: string }
  | { kind: "create-group" }
  | { kind: "edit-group"; groupId: string }
  | { kind: "household-activity" };

function sortPeople(people: MemberPublic[]): MemberPublic[] {
  return [...people].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
  );
}

function displayOrNotSet(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "Not set";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

function roleLabel(value: MemberPublic["classification"]): string {
  if (value === "adult") return "Adult";
  if (value === "child") return "Child";
  return "Role not selected";
}

function overviewRoleLabel(value: MemberPublic["classification"]): string | null {
  if (value === "adult") return "Adult";
  if (value === "child") return "Child";
  return null;
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

function memberCountLabel(count: number): string {
  return `${count} member${count === 1 ? "" : "s"}`;
}

function statusLabel(status: StepStatus): string {
  if (status === "not_needed") return "Not needed";
  if (status === "completed") return "Completed";
  return "Open";
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

export function PeopleGroupsView(props: {
  memberships: MemberPublic[];
  tasks: PersonalTask[];
  occurrences: OccurrenceView[];
  familyOrderVersion: number;
  canManageStructure: boolean;
  canEnroll: boolean;
  canViewActivity: boolean;
  /** When nested under Household, start on overview, activity, or a detail route. */
  entry?: "overview" | "activity" | "person" | "group";
  personId?: string;
  groupId?: string;
  /** Sync addressable overview/person/group destinations with App. */
  onNavigate?: (
    next:
      | { kind: "overview" }
      | { kind: "person"; personId: string }
      | { kind: "group"; groupId: string },
  ) => void;
  /** Return to Household hub when leaving the top of this view. */
  onExit?: () => void;
  onPeopleChanged: (update?: {
    people: MemberPublic[];
    familyOrderVersion: number;
  }) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const sortedMemberships = sortPeople(props.memberships);
  const [view, setView] = useState<ViewState>(() => {
    if (props.entry === "activity") return { kind: "household-activity" };
    if (props.entry === "person" && props.personId) {
      return { kind: "person-detail", personId: props.personId };
    }
    if (props.entry === "group" && props.groupId) {
      return { kind: "group-detail", groupId: props.groupId };
    }
    return { kind: "overview" };
  });
  const [groups, setGroups] = useState<GroupPublic[] | null>(null);
  const [detail, setDetail] = useState<PersonDetail | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (props.entry === "activity") {
      setView({ kind: "household-activity" });
      return;
    }
    if (props.entry === "person" && props.personId) {
      const personId = props.personId;
      setView((current) =>
        current.kind === "person-detail" && current.personId === personId
          ? current
          : current.kind === "edit-person" && current.personId === personId
            ? current
            : current.kind === "access" && current.personId === personId
              ? current
              : { kind: "person-detail", personId },
      );
      return;
    }
    if (props.entry === "group" && props.groupId) {
      const groupId = props.groupId;
      setView((current) =>
        current.kind === "group-detail" && current.groupId === groupId
          ? current
          : current.kind === "edit-group" && current.groupId === groupId
            ? current
            : { kind: "group-detail", groupId },
      );
      return;
    }
    if (props.entry === "overview" || props.entry === undefined) {
      setView((current) =>
        current.kind === "overview" ||
        current.kind === "add-person" ||
        current.kind === "create-group" ||
        current.kind === "reorder-people"
          ? current
          : { kind: "overview" },
      );
    }
  }, [props.entry, props.personId, props.groupId]);

  useEffect(() => {
    void fetchGroups()
      .then((result) => setGroups(result.groups))
      .catch((caught) => setError(errorMessage(caught)));
  }, [props.memberships]);

  useEffect(() => {
    if (groups === null) return;
    if (view.kind !== "group-detail" && view.kind !== "edit-group") return;
    if (!groups.some((group) => group.id === view.groupId)) {
      setMessage("That group was removed.");
      setError(null);
      goOverview();
    }
  }, [groups, view]);

  const openPersonId =
    view.kind === "person-detail" || view.kind === "edit-person" || view.kind === "access"
      ? view.personId
      : null;

  useEffect(() => {
    if (!openPersonId) {
      setDetail(null);
      return;
    }
    void fetchPerson(openPersonId)
      .then((result) => setDetail(result.person))
      .catch((caught) => setError(errorMessage(caught)));
  }, [openPersonId, props.memberships]);

  function goOverview() {
    if (props.entry === "activity" && props.onExit) {
      props.onExit();
      return;
    }
    setView({ kind: "overview" });
    props.onNavigate?.({ kind: "overview" });
  }

  function clearFeedback() {
    setError(null);
    setMessage(null);
  }

  function openPerson(personId: string) {
    clearFeedback();
    setView({ kind: "person-detail", personId });
    props.onNavigate?.({ kind: "person", personId });
  }

  function openGroup(groupId: string) {
    clearFeedback();
    setView({ kind: "group-detail", groupId });
    props.onNavigate?.({ kind: "group", groupId });
  }

  const loadedGroups = groups ?? [];

  return (
    <section className="panel people-groups">
      {message ? (
        <p className="status-pill" data-kind="ok" role="status">
          {message}
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}

      {view.kind === "overview" ? (
        <OverviewState
          memberships={sortedMemberships}
          groups={loadedGroups}
          canManageStructure={props.canManageStructure}
          canViewActivity={props.canViewActivity}
          onExit={props.onExit}
          onOpenPerson={openPerson}
          onAddPerson={() => {
            clearFeedback();
            setView({ kind: "add-person" });
          }}
          onReorderPeople={() => {
            clearFeedback();
            setView({ kind: "reorder-people" });
          }}
          onOpenGroup={openGroup}
          onCreateGroup={() => {
            clearFeedback();
            setView({ kind: "create-group" });
          }}
          onViewActivity={() => {
            clearFeedback();
            setView({ kind: "household-activity" });
          }}
        />
      ) : null}

      {view.kind === "reorder-people" ? (
        <ReorderPeopleState
          people={sortedMemberships}
          familyOrderVersion={props.familyOrderVersion}
          onBack={goOverview}
          onSaved={(result) => {
            setMessage("People order saved.");
            setError(null);
            setView({ kind: "overview" });
            props.onPeopleChanged({
              people: result.people,
              familyOrderVersion: result.version,
            });
          }}
          onError={setError}
          onDirtyChange={props.onDirtyChange}
        />
      ) : null}

      {view.kind === "person-detail" && detail && detail.id === view.personId ? (
        <PersonDetailState
          detail={detail}
          canManageStructure={props.canManageStructure}
          canEnroll={props.canEnroll}
          onBack={goOverview}
          onEdit={() => {
            clearFeedback();
            setView({ kind: "edit-person", personId: detail.id });
          }}
          onAccess={() => {
            clearFeedback();
            setView({ kind: "access", personId: detail.id });
          }}
        />
      ) : null}

      {view.kind === "add-person" ? (
        <AddPersonState
          onBack={goOverview}
          onCreated={(personId, name) => {
            setMessage(`${name} added.`);
            setError(null);
            setView({ kind: "person-detail", personId });
            props.onNavigate?.({ kind: "person", personId });
            props.onPeopleChanged();
          }}
          onError={setError}
        />
      ) : null}

      {view.kind === "edit-person" && detail && detail.id === view.personId ? (
        <EditPersonState
          detail={detail}
          onBack={() => setView({ kind: "person-detail", personId: detail.id })}
          onSaved={() => {
            setMessage("Person updated.");
            setError(null);
            setView({ kind: "person-detail", personId: detail.id });
            props.onPeopleChanged();
          }}
          onError={setError}
          onDirtyChange={props.onDirtyChange}
        />
      ) : null}

      {view.kind === "access" && detail && detail.id === view.personId ? (
        <AccessStateView
          detail={detail}
          onBack={() => setView({ kind: "person-detail", personId: detail.id })}
          onChanged={() => props.onPeopleChanged()}
          onMessage={setMessage}
          onError={setError}
        />
      ) : null}

      {view.kind === "group-detail" ? (
        <GroupDetailState
          group={loadedGroups.find((group) => group.id === view.groupId) ?? null}
          people={sortedMemberships}
          canManageStructure={props.canManageStructure}
          onBack={goOverview}
          onEdit={() => {
            clearFeedback();
            setView({ kind: "edit-group", groupId: view.groupId });
          }}
        />
      ) : null}

      {view.kind === "create-group" ? (
        <GroupFormState
          mode="create"
          people={sortedMemberships}
          onBack={goOverview}
          onSaved={(group) => {
            setGroups((current) => {
              const list = current ?? [];
              return [...list.filter((item) => item.id !== group.id), group].sort((a, b) =>
                a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
              );
            });
            setMessage(`Saved group ${group.name}.`);
            setError(null);
            setView({ kind: "group-detail", groupId: group.id });
            props.onNavigate?.({ kind: "group", groupId: group.id });
            props.onPeopleChanged();
          }}
          onError={setError}
        />
      ) : null}

      {view.kind === "edit-group" ? (
        <GroupFormState
          mode="edit"
          initial={loadedGroups.find((group) => group.id === view.groupId) ?? null}
          people={sortedMemberships}
          onBack={() => setView({ kind: "group-detail", groupId: view.groupId })}
          onSaved={(group) => {
            const prior = loadedGroups.find((item) => item.id === group.id);
            const membersChanged =
              !prior ||
              [...prior.membershipIds].sort().join("\0") !==
                [...group.membershipIds].sort().join("\0");
            setGroups((current) => {
              const list = current ?? [];
              return [...list.filter((item) => item.id !== group.id), group].sort((a, b) =>
                a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
              );
            });
            if (
              membersChanged &&
              ((group.usedByRoutines && group.usedByRoutines.length > 0) ||
                group.usedByMorningRoutine) &&
              group.routineEffectFromDate
            ) {
              const names =
                group.usedByRoutines && group.usedByRoutines.length > 0
                  ? group.usedByRoutines.map((item) => item.title).join(", ")
                  : "Morning Routine";
              setMessage(
                `${group.name} updated. ${names} will use the new members starting ${group.routineEffectFromDate}.`,
              );
            } else {
              setMessage(`Saved group ${group.name}.`);
            }
            setError(null);
            setView({ kind: "group-detail", groupId: group.id });
            props.onPeopleChanged();
          }}
          onDeleted={(groupId) => {
            setGroups((current) => (current ?? []).filter((item) => item.id !== groupId));
            setMessage("Group deleted.");
            setError(null);
            setView({ kind: "overview" });
            props.onPeopleChanged();
          }}
          onError={setError}
        />
      ) : null}

      {view.kind === "household-activity" ? (
        <HouseholdActivityState
          memberships={sortedMemberships}
          tasks={props.tasks}
          occurrences={props.occurrences}
          backLabel={
            props.entry === "activity" && props.onExit
              ? "Back to Household"
              : "Back to People & Groups"
          }
          onBack={
            props.entry === "activity" && props.onExit
              ? props.onExit
              : goOverview
          }
        />
      ) : null}
    </section>
  );
}

function OverviewState(props: {
  memberships: MemberPublic[];
  groups: GroupPublic[];
  canManageStructure: boolean;
  canViewActivity: boolean;
  onExit?: () => void;
  onOpenPerson: (personId: string) => void;
  onAddPerson: () => void;
  onReorderPeople: () => void;
  onOpenGroup: (groupId: string) => void;
  onCreateGroup: () => void;
  onViewActivity: () => void;
}) {
  return (
    <div className="focused-state">
      {props.onExit ? (
        <BackButton label="Back to Household" onClick={props.onExit} />
      ) : null}
      <h1 className="page-heading">People &amp; Groups</h1>
      <p className="meta">
        {props.memberships.length} {props.memberships.length === 1 ? "person" : "people"} ·{" "}
        {props.groups.length} {props.groups.length === 1 ? "group" : "groups"}
      </p>

      <h2>People</h2>
      <ul className="people-list">
        {props.memberships.map((person) => {
          const role = overviewRoleLabel(person.classification);
          return (
            <li key={person.id}>
              <button
                type="button"
                className="person-row list-row"
                onClick={() => props.onOpenPerson(person.id)}
              >
                <span className="person-name">{person.displayName}</span>
                {role ? <span className="meta">{role}</span> : null}
                <span className="meta">{accessLabel(person.accessState)}</span>
                <span className="row-affordance">View details</span>
              </button>
            </li>
          );
        })}
      </ul>
      {props.canManageStructure ? (
        <div className="button-row">
          <button type="button" className="primary" onClick={props.onAddPerson}>
            Add person
          </button>
          <button type="button" className="secondary" onClick={props.onReorderPeople}>
            Reorder people
          </button>
        </div>
      ) : null}

      <h2>Groups</h2>
      {props.groups.length === 0 ? (
        <p className="meta">
          Groups are named sets of people you reuse around the household. Create one when you want a
          shared label such as Kids.
        </p>
      ) : (
        <ul className="people-list">
          {props.groups.map((group) => (
            <li key={group.id}>
              <button
                type="button"
                className="person-row list-row"
                onClick={() => props.onOpenGroup(group.id)}
              >
                <span className="person-name">{group.name}</span>
                <span className="meta">{memberCountLabel(group.membershipIds.length)}</span>
                <span className="row-affordance">View details</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {props.canManageStructure ? (
        <button type="button" className="primary" onClick={props.onCreateGroup}>
          Create group
        </button>
      ) : null}

      {props.canViewActivity ? (
        <div className="button-row">
          <button type="button" onClick={props.onViewActivity}>
            View household activity
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PersonDetailState(props: {
  detail: PersonDetail;
  canManageStructure: boolean;
  canEnroll: boolean;
  onBack: () => void;
  onEdit: () => void;
  onAccess: () => void;
}) {
  const access = props.detail.access.state;
  return (
    <div className="focused-state" aria-labelledby="person-detail-heading">
      <BackButton label="Back to People & Groups" onClick={props.onBack} />
      <FocusHeading id="person-detail-heading">{props.detail.displayName}</FocusHeading>
      <p>
        Friendly name: <strong>{props.detail.displayName}</strong>
      </p>
      <p>
        Full name: <strong>{displayOrNotSet(props.detail.fullName)}</strong>
      </p>
      <p>
        Birthday: <strong>{displayOrNotSet(props.detail.birthday)}</strong>
      </p>
      <p>
        Email: <strong>{displayOrNotSet(props.detail.email)}</strong>
      </p>
      <p>
        Role: <strong>{roleLabel(props.detail.classification)}</strong>
      </p>
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
        Routines:{" "}
        {props.detail.routines && props.detail.routines.length > 0
          ? props.detail.routines
              .map((routine) => {
                const source =
                  routine.source === "group"
                    ? "group"
                    : routine.source === "both"
                      ? "direct + group"
                      : "direct";
                return `${routine.title} (${source})`;
              })
              .join(", ")
          : props.detail.morningRoutine?.currentlyAssigned
            ? `Assigned on current shared revision (${props.detail.morningRoutine.revisionTitle})`
            : "Not currently assigned to a shared routine"}
      </p>
      <div className="button-row">
        {props.canManageStructure ? (
          <button type="button" onClick={props.onEdit}>
            Edit person
          </button>
        ) : null}
        {props.canEnroll ? (
          <button type="button" onClick={props.onAccess}>
            {access === "not_set_up" ? "Set up access" : "Manage access"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function AddPersonState(props: {
  onBack: () => void;
  onCreated: (personId: string, name: string) => void;
  onError: (value: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<"adult" | "child">("child");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    props.onError(null);
    setBusy(true);
    try {
      const result = await createPerson({
        mutationId: newClientId(),
        displayName: name,
        classification: role,
      });
      props.onCreated(result.person.id, result.person.displayName);
    } catch (caught) {
      props.onError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <div className="focused-state" aria-labelledby="add-person-heading">
      <BackButton label="Back to People & Groups" onClick={props.onBack} />
      <FocusHeading id="add-person-heading">Add person</FocusHeading>
      <form className="form-grid" onSubmit={submit}>
        <label>
          Friendly name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={80}
            disabled={busy}
          />
        </label>
        <fieldset disabled={busy}>
          <legend>Role</legend>
          <label className="choice-row">
            <input
              type="radio"
              name="add-role"
              checked={role === "adult"}
              onChange={() => setRole("adult")}
            />
            Adult
          </label>
          <label className="choice-row">
            <input
              type="radio"
              name="add-role"
              checked={role === "child"}
              onChange={() => setRole("child")}
            />
            Child
          </label>
        </fieldset>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Adding…" : "Add person"}
        </button>
      </form>
    </div>
  );
}

function EditPersonState(props: {
  detail: PersonDetail;
  onBack: () => void;
  onSaved: () => void;
  onError: (value: string | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [name, setName] = useState(props.detail.displayName);
  const [fullName, setFullName] = useState(props.detail.fullName ?? "");
  const [birthday, setBirthday] = useState(props.detail.birthday ?? "");
  const [email, setEmail] = useState(props.detail.email ?? "");
  const [role, setRole] = useState<"adult" | "child" | "unset">(
    props.detail.classification ?? "unset",
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(props.detail.displayName);
    setFullName(props.detail.fullName ?? "");
    setBirthday(props.detail.birthday ?? "");
    setEmail(props.detail.email ?? "");
    setRole(props.detail.classification ?? "unset");
  }, [props.detail.id, props.detail.version]);

  const dirty =
    name.trim() !== props.detail.displayName ||
    fullName.trim() !== (props.detail.fullName ?? "") ||
    birthday !== (props.detail.birthday ?? "") ||
    email.trim() !== (props.detail.email ?? "") ||
    (role === "unset" ? null : role) !== props.detail.classification;

  useEffect(() => {
    props.onDirtyChange?.(dirty);
    return () => props.onDirtyChange?.(false);
  }, [dirty, props.onDirtyChange]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    props.onError(null);
    setBusy(true);
    try {
      await updatePerson(props.detail.id, {
        displayName: name,
        classification: role === "unset" ? null : role,
        fullName: fullName.trim() ? fullName.trim() : null,
        birthday: birthday || null,
        email: email.trim() ? email.trim() : null,
        expectedVersion: props.detail.version,
      });
      props.onDirtyChange?.(false);
      props.onSaved();
    } catch (caught) {
      props.onError(errorMessage(caught));
      setBusy(false);
    }
  }

  function cancel() {
    if (
      dirty &&
      !window.confirm(
        "You have unsaved changes. Discard them?\n\nOK = Discard · Cancel = Keep editing",
      )
    ) {
      return;
    }
    props.onDirtyChange?.(false);
    props.onBack();
  }

  return (
    <div className="focused-state" aria-labelledby="edit-person-heading">
      <BackButton label={`Back to ${props.detail.displayName}`} onClick={cancel} />
      <FocusHeading id="edit-person-heading">Edit person</FocusHeading>
      <form className="form-grid" onSubmit={submit}>
        <label>
          Friendly name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={80}
            disabled={busy}
            aria-required="true"
          />
        </label>
        <label>
          Full name
          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            maxLength={120}
            disabled={busy}
          />
        </label>
        <label>
          Birthday
          <input
            type="date"
            value={birthday}
            onChange={(event) => setBirthday(event.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={254}
            disabled={busy}
            autoComplete="off"
          />
        </label>
        <fieldset disabled={busy}>
          <legend>Role</legend>
          <label className="choice-row">
            <input
              type="radio"
              name="edit-role"
              checked={role === "adult"}
              onChange={() => setRole("adult")}
            />
            Adult
          </label>
          <label className="choice-row">
            <input
              type="radio"
              name="edit-role"
              checked={role === "child"}
              onChange={() => setRole("child")}
            />
            Child
          </label>
          {props.detail.classification === null ? (
            <label className="choice-row">
              <input
                type="radio"
                name="edit-role"
                checked={role === "unset"}
                onChange={() => setRole("unset")}
              />
              Not selected
            </label>
          ) : null}
        </fieldset>
        <div className="button-row">
          <button type="submit" className="primary" disabled={busy || !dirty}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={cancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function ReorderPeopleState(props: {
  people: MemberPublic[];
  familyOrderVersion: number;
  onBack: () => void;
  onSaved: (result: { version: number; people: MemberPublic[] }) => void;
  onError: (value: string | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState(() => props.people.map((person) => person.id));
  // Pin baseline + expectedVersion at open (and on remote version advances). Live
  // membership refreshes must not retarget Save at a newer version while the draft
  // still mirrors the older baseline — that CONFLICT flake under full-suite churn.
  const [baselineIds, setBaselineIds] = useState(() =>
    props.people.map((person) => person.id),
  );
  const [expectedVersion, setExpectedVersion] = useState(props.familyOrderVersion);
  const [busy, setBusy] = useState(false);
  const dirty = draft.join("\0") !== baselineIds.join("\0");

  useEffect(() => {
    if (props.familyOrderVersion === expectedVersion) return;
    if (dirty) {
      // Keep the pinned draft/version so Save surfaces a real conflict instead of
      // silently retargeting expectedVersion under mid-edit supporting-data refresh.
      return;
    }
    const ids = props.people.map((person) => person.id);
    setDraft(ids);
    setBaselineIds(ids);
    setExpectedVersion(props.familyOrderVersion);
  }, [props.familyOrderVersion, props.people, expectedVersion, dirty]);

  useEffect(() => {
    props.onDirtyChange?.(dirty);
    return () => props.onDirtyChange?.(false);
  }, [dirty, props.onDirtyChange]);

  const items = draft
    .map((id) => props.people.find((person) => person.id === id))
    .filter((person): person is MemberPublic => Boolean(person))
    .map((person) => ({
      id: person.id,
      label: person.displayName,
      person,
    }));

  async function save() {
    if (busy || !dirty) return;
    props.onError(null);
    setBusy(true);
    try {
      const result = await saveFamilyOrder({
        mutationId: newClientId(),
        expectedVersion,
        membershipIds: draft,
      });
      props.onDirtyChange?.(false);
      props.onSaved(result);
    } catch (caught) {
      props.onError(errorMessage(caught));
      setBusy(false);
    }
  }

  function cancel() {
    if (
      dirty &&
      !window.confirm(
        "You have unsaved changes. Discard them?\n\nOK = Discard · Cancel = Keep editing",
      )
    ) {
      return;
    }
    props.onDirtyChange?.(false);
    props.onBack();
  }

  return (
    <div className="focused-state" aria-labelledby="reorder-people-heading">
      <BackButton label="Back to People & Groups" onClick={cancel} />
      <FocusHeading id="reorder-people-heading">Reorder people</FocusHeading>
      <p className="meta">
        This order is used wherever household people appear as peers, including History.
      </p>
      <OrderedList
        listLabel="Family order"
        items={items}
        onReorder={(next) => setDraft(next.map((item) => item.id))}
        renderRow={(item) => (
          <div>
            <strong>{item.person.displayName}</strong>
            <div className="meta">{roleLabel(item.person.classification)}</div>
          </div>
        )}
      />
      <div className="button-row">
        <button type="button" className="primary" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={cancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function AccessStateView(props: {
  detail: PersonDetail;
  onBack: () => void;
  onChanged: () => void;
  onMessage: (value: string | null) => void;
  onError: (value: string | null) => void;
}) {
  const [preset, setPreset] = useState<GrantPreset>("proposal_personalizer");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [replaceExplained, setReplaceExplained] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setIssuedToken(null);
    setReplaceExplained(false);
    setBusy(false);
  }, [props.detail.id]);

  const access = props.detail.access.state;

  async function prepareSetup(replace: boolean) {
    if (busy) return;
    if (replace && !replaceExplained) {
      setReplaceExplained(true);
      props.onMessage(
        "Creating a replacement invalidates the previous setup material. Confirm by preparing again.",
      );
      return;
    }
    props.onError(null);
    setIssuedToken(null);
    setBusy(true);
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
    } finally {
      setBusy(false);
    }
  }

  async function cancelSetup() {
    if (busy) return;
    props.onError(null);
    setBusy(true);
    try {
      await cancelEnrollmentSetup(props.detail.id);
      setIssuedToken(null);
      props.onMessage("Setup cancelled.");
      props.onChanged();
    } catch (caught) {
      props.onError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="focused-state" aria-labelledby="access-heading">
      <BackButton label={`Back to ${props.detail.displayName}`} onClick={props.onBack} />
      <FocusHeading id="access-heading">Access setup</FocusHeading>
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
        Adult/Child does not choose access level. Pick an access level explicitly.
      </p>
      <div className="form-grid">
        <fieldset disabled={busy}>
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
        <div className="button-row">
          {access === "setup_ready" || access === "setup_expired" || access === "access_set_up" ? (
            <button type="button" disabled={busy} onClick={() => void prepareSetup(true)}>
              {replaceExplained ? "Confirm replacement setup" : "Replace setup"}
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void prepareSetup(false)}
            >
              Prepare access setup
            </button>
          )}
          {access === "setup_ready" ? (
            <button type="button" disabled={busy} onClick={() => void cancelSetup()}>
              Cancel setup
            </button>
          ) : null}
        </div>
        {issuedToken ? (
          <div className="token-box" role="status">
            <strong>Copy this setup material now</strong>
            <code>{issuedToken}</code>
            <span className="meta">It cannot be shown again after you leave this screen.</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function GroupDetailState(props: {
  group: GroupPublic | null;
  people: MemberPublic[];
  canManageStructure: boolean;
  onBack: () => void;
  onEdit: () => void;
}) {
  if (!props.group) return null;
  const members = props.group.membershipIds
    .map((id) => props.people.find((person) => person.id === id)?.displayName)
    .filter((name): name is string => Boolean(name));

  return (
    <div className="focused-state" aria-labelledby="group-detail-heading">
      <BackButton label="Back to People & Groups" onClick={props.onBack} />
      <FocusHeading id="group-detail-heading">{props.group.name}</FocusHeading>
      <p className="meta">{memberCountLabel(props.group.membershipIds.length)}</p>
      {props.group.usedByRoutines && props.group.usedByRoutines.length > 0 ? (
        <>
          <p>
            Used by{" "}
            {props.group.usedByRoutines.map((routine) => routine.title).join(", ")}
          </p>
          <p className="meta">
            Membership changes update these routines beginning on{" "}
            {props.group.routineEffectFromDate ??
              props.group.usedByRoutines
                .map((routine) => routine.effectFromDate)
                .find(Boolean)}
          </p>
        </>
      ) : props.group.usedByMorningRoutine ? (
        <>
          <p>Used by Morning Routine</p>
          <p className="meta">
            Membership changes update Morning Routine beginning on{" "}
            {props.group.routineEffectFromDate}
          </p>
        </>
      ) : null}
      <p>
        Members:{" "}
        {members.length ? members.join(", ") : "No members yet"}
      </p>
      {props.canManageStructure ? (
        <div className="button-row">
          <button type="button" onClick={props.onEdit}>
            Edit group
          </button>
        </div>
      ) : null}
    </div>
  );
}

function GroupFormState(props: {
  mode: "create" | "edit";
  initial?: GroupPublic | null;
  people: MemberPublic[];
  onBack: () => void;
  onSaved: (group: GroupPublic) => void;
  onDeleted?: (groupId: string) => void;
  onError: (value: string | null) => void;
}) {
  const [name, setName] = useState(props.initial?.name ?? "");
  const [selected, setSelected] = useState<string[]>(props.initial?.membershipIds ?? []);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

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
    if (busy) return;
    props.onError(null);
    setBusy(true);
    try {
      if (props.mode === "create" || !props.initial) {
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
      setBusy(false);
    }
  }

  async function remove() {
    if (!props.initial || !props.onDeleted || busy) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    props.onError(null);
    setBusy(true);
    try {
      await deleteGroup(props.initial.id);
      props.onDeleted(props.initial.id);
    } catch (caught) {
      props.onError(errorMessage(caught));
      setBusy(false);
    }
  }

  const heading =
    props.mode === "create" ? "Create group" : `Edit ${props.initial?.name ?? "group"}`;
  const backLabel =
    props.mode === "create"
      ? "Back to People & Groups"
      : `Back to ${props.initial?.name ?? "group"}`;

  return (
    <div className="focused-state" aria-labelledby="group-form-heading">
      <BackButton label={backLabel} onClick={props.onBack} />
      <FocusHeading id="group-form-heading">{heading}</FocusHeading>
      {(props.mode === "edit" &&
        ((props.initial?.usedByRoutines && props.initial.usedByRoutines.length > 0) ||
          props.initial?.usedByMorningRoutine)) ? (
        <>
          <p>
            Used by{" "}
            {props.initial?.usedByRoutines && props.initial.usedByRoutines.length > 0
              ? props.initial.usedByRoutines.map((routine) => routine.title).join(", ")
              : "Morning Routine"}
          </p>
          <p className="meta">
            Membership changes update{" "}
            {props.initial?.usedByRoutines && props.initial.usedByRoutines.length > 0
              ? "these routines"
              : "Morning Routine"}{" "}
            beginning on {props.initial?.routineEffectFromDate}
          </p>
        </>
      ) : null}
      <form className="form-grid" onSubmit={save}>
        <label>
          Group name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={80}
            disabled={busy}
          />
        </label>
        <fieldset disabled={busy}>
          <legend>Members</legend>
          {props.people.map((person) => (
            <label key={person.id} className="choice-row">
              <input
                type="checkbox"
                checked={selected.includes(person.id)}
                onChange={() => toggleMember(person.id)}
              />
              {person.displayName}
            </label>
          ))}
        </fieldset>
        <div className="button-row">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save group"}
          </button>
          {props.mode === "edit" && props.initial && props.onDeleted ? (
            <button type="button" disabled={busy} onClick={() => void remove()}>
              {confirmDelete ? "Confirm delete group" : "Delete group"}
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function HouseholdActivityState(props: {
  memberships: MemberPublic[];
  tasks: PersonalTask[];
  occurrences: OccurrenceView[];
  backLabel: string;
  onBack: () => void;
}) {
  const [selectedResponsibilityId, setSelectedResponsibilityId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const routines = props.occurrences.filter(
    (occurrence) => occurrence.kind !== "responsibility",
  );
  const responsibilities = props.occurrences.filter(
    (occurrence) => occurrence.kind === "responsibility",
  );
  const selectedResponsibility = responsibilities.find(
    (occurrence) => occurrence.id === selectedResponsibilityId,
  );

  useEffect(() => {
    setExpanded((current) => {
      const next = { ...current };
      for (const occurrence of props.occurrences) {
        if (occurrence.kind === "responsibility") continue;
        if (next[occurrence.id] === undefined) {
          next[occurrence.id] = !occurrence.completed;
        }
      }
      return next;
    });
  }, [props.occurrences]);

  function progressState(occurrence: OccurrenceView): "Not started" | "In progress" | "Complete" {
    if (occurrence.completed) return "Complete";
    if (occurrence.startedAt) return "In progress";
    const touched = occurrence.steps.some((step) => step.status !== "open");
    return touched ? "In progress" : "Not started";
  }

  function progressCounts(occurrence: OccurrenceView): string {
    const completed = occurrence.steps.filter((step) => step.status === "completed").length;
    return `${completed}/${occurrence.steps.length}`;
  }

  if (selectedResponsibility) {
    return (
      <div className="focused-state" aria-labelledby="responsibility-activity-heading">
        <BackButton
          label="Back to Household activity"
          onClick={() => setSelectedResponsibilityId(null)}
        />
        <FocusHeading id="responsibility-activity-heading">
          {selectedResponsibility.title}
        </FocusHeading>
        <p className="meta">
          {selectedResponsibility.accountableMemberId
            ? selectedResponsibility.accountableMemberName
            : "Unassigned"}{" "}
          · {progressState(selectedResponsibility)} · {progressCounts(selectedResponsibility)}
        </p>
        {!selectedResponsibility.accountableMemberId ? (
          <p className="status-notice" role="status">
            Nobody is assigned yet. Edit assignment in Plan to fix this before work can be completed.
          </p>
        ) : null}
        <ul className="checklist">
          {selectedResponsibility.steps.map((step) => (
            <li key={step.id} className="step">
              <div className="step-title">
                <strong>{step.text}</strong>
              </div>
              <div className="meta">Status: {statusLabel(step.status)}</div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="focused-state" aria-labelledby="household-activity-heading">
      <BackButton label={props.backLabel} onClick={props.onBack} />
      <FocusHeading id="household-activity-heading">Household activity</FocusHeading>

      <h3>Responsibilities</h3>
      {responsibilities.length === 0 ? (
        <p className="meta">No responsibility progress to show right now.</p>
      ) : (
        <ul className="responsibility-activity-list">
          {responsibilities.map((occurrence) => (
            <li key={occurrence.id}>
              <button
                type="button"
                className="list-row compact-activity-row"
                onClick={() => setSelectedResponsibilityId(occurrence.id)}
              >
                <span className="compact-activity-title">{occurrence.title}</span>
                <span className="meta">
                  {occurrence.accountableMemberId
                    ? occurrence.accountableMemberName
                    : "Unassigned"}
                  {!occurrence.accountableMemberId ? " · Needs assignment" : ""} ·{" "}
                  {progressCounts(occurrence)} · {progressState(occurrence)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3>Routine progress</h3>
      {routines.length === 0 ? (
        <p className="meta">No routine progress to show right now.</p>
      ) : (
        routines.map((occurrence) => {
          const open = expanded[occurrence.id] ?? !occurrence.completed;
          return (
            <article
              key={occurrence.id}
              className={`occurrence ${occurrence.completed ? "completed" : ""}`}
            >
              <button
                type="button"
                className="occurrence-header"
                aria-expanded={open}
                onClick={() =>
                  setExpanded((current) => ({ ...current, [occurrence.id]: !open }))
                }
              >
                <div>
                  <h2>{occurrence.title}</h2>
                  <div className="meta">
                    {occurrence.accountableMemberName} · {occurrence.householdDate} ·{" "}
                    {DAYPART_LABELS[occurrence.daypart] ?? occurrence.daypart} ·{" "}
                    {occurrence.completed ? "Complete" : "In progress"}
                  </div>
                </div>
                <span aria-hidden="true">{open ? "▾" : "▸"}</span>
              </button>
              {open ? (
                <ul className="checklist">
                  {occurrence.steps.map((step) => (
                    <li key={step.id} className="step">
                      <div className="step-title">
                        <strong>{step.text}</strong>
                      </div>
                      <div className="meta">Status: {statusLabel(step.status)}</div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          );
        })
      )}

      <h3>Household-visible personal tasks</h3>
      {props.tasks.length === 0 ? (
        <p className="meta">None right now.</p>
      ) : (
        <ul className="people-list">
          {props.tasks.map((task) => (
            <li key={task.id} className="activity-entry">
              {props.memberships.find((member) => member.id === task.ownerMembershipId)
                ?.displayName ?? "Household member"}{" "}
              · {task.title} · {task.status}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
