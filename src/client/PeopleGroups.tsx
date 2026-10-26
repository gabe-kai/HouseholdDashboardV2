import { toDataURL } from "qrcode";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  GRANT_PRESETS,
  MEMBER_DEFAULT_GRANTS,
  MEMBER_DIRECT_GRANTS,
  SECONDARY_EDITABLE_GRANTS,
  memberModeFromGrants,
  mergePermissionGrants,
} from "../shared/grants";
import type {
  AccessClaimPurpose,
  AccessState,
  Daypart,
  Grant,
  GroupPublic,
  MemberPublic,
  OccurrenceView,
  PersonDetail,
  StepStatus,
} from "../shared/schemas";
import {
  applyFixtureRemediation,
  cancelAccessClaims,
  commitMemberRemoval,
  createGroup,
  createPerson,
  deleteGroup,
  fetchGroups,
  fetchPerson,
  issueAccessClaim,
  previewFixtureRemediation,
  previewMemberRemoval,
  revokeSignIn,
  saveFamilyOrder,
  saveMembershipPermissions,
  updateGroup,
  updatePerson,
  type FixtureRemediationPreview,
  type IssuedAccessClaim,
  type MemberRemovalPreview,
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
  | { kind: "permissions"; personId: string }
  | { kind: "remove-person"; personId: string }
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

/** Authority (permissions) label for the directory and detail; never Adult/Child. */
function authorityRoleLabel(value: MemberPublic["roleLabel"]): string {
  if (value === "manager") return "Manager";
  if (value === "member") return "Member";
  return "Customized";
}

function signInStatusLabel(state: AccessState): string {
  switch (state) {
    case "access_set_up":
      return "Active";
    case "setup_ready":
      return "Invitation ready";
    case "setup_expired":
      return "Invitation expired";
    case "access_revoked":
      return "Access revoked";
    default:
      return "Not set up";
  }
}

function memberModeLabel(mode: "approval" | "direct" | null): string {
  if (mode === "direct") return "Can edit own additions";
  if (mode === "approval") return "Approval required";
  return "Mixed";
}

/** Plain-language names for every grant the Permissions editor can show. */
const GRANT_LABELS: Record<string, string> = {
  "household.member.enroll": "Add and enroll people",
  "household.display.manage": "Manage household displays",
  "household.structure.manage": "Edit people and groups",
  "household.lifecycle.manage": "Back up, reset, and restore the household",
  "household.access.manage": "Manage sign-in and permissions",
  "household.member.remove": "Remove people from the household",
  "household.schedule.manage": "Manage the school calendar",
  "household.activity.clear": "Clear routine history",
  "routine.shared.manage": "Edit shared routines",
  "routine.proposal.decide": "Decide on routine suggestions",
  "responsibility.manage": "Manage responsibilities",
  "routine.personalize.propose": "Suggest changes to own routines",
  "routine.personalize.direct": "Edit own routine additions",
  "routine.execute.own": "Complete own routines",
  "responsibility.execute.own": "Complete own responsibilities",
  "personal_task.create": "Create personal tasks",
};

function grantLabel(grant: string): string {
  return GRANT_LABELS[grant] ?? grant;
}

const ALL_KNOWN_GRANTS: readonly string[] = [
  ...new Set<string>([
    ...GRANT_PRESETS.manager,
    ...MEMBER_DEFAULT_GRANTS,
    ...MEMBER_DIRECT_GRANTS,
    ...SECONDARY_EDITABLE_GRANTS,
  ]),
];

const SECONDARY_GRANT_SET = new Set<string>(SECONDARY_EDITABLE_GRANTS);

/** Role/mode/secondary draft derived from a person's effective grants. */
function permissionDraftFromGrants(person: Pick<MemberPublic, "grants" | "roleLabel">): {
  role: "manager" | "member";
  memberMode: "approval" | "direct";
  secondary: string[];
} {
  const role =
    person.roleLabel === "manager" ||
    (person.roleLabel === "customized" &&
      ["household.member.enroll", "household.structure.manage", "household.access.manage"].every(
        (grant) => person.grants.includes(grant),
      ))
      ? "manager"
      : "member";
  return {
    role,
    memberMode: memberModeFromGrants(person.grants) ?? "approval",
    secondary: person.grants.filter((grant) => SECONDARY_GRANT_SET.has(grant)),
  };
}

function accessLinkFor(token: string): string {
  return `${window.location.origin}/#access=${encodeURIComponent(token)}`;
}

const ACCESS_PURPOSE_LABELS: Record<AccessClaimPurpose, string> = {
  invitation: "Invitation link",
  password_reset: "Password reset link",
  restore_sign_in: "Restore sign-in link",
};

function memberCountLabel(count: number): string {
  return `${count} member${count === 1 ? "" : "s"}`;
}

function statusLabel(status: StepStatus): string {
  if (status === "not_needed") return "Not needed";
  if (status === "completed") return "Completed";
  return "Open";
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

export function PeopleGroupsView(props: {
  memberships: MemberPublic[];
  tasks: PersonalTask[];
  occurrences: OccurrenceView[];
  familyOrderVersion: number;
  canManageStructure: boolean;
  canEnroll: boolean;
  /** household.access.manage: sign-in links, permissions, revoke/restore. */
  canAccessManage?: boolean;
  /** household.member.remove: remove people and sample-data remediation. */
  canMemberRemove?: boolean;
  /** household.lifecycle.manage: optional backup before sample remediation. */
  canLifecycleManage?: boolean;
  /** Signed-in member; self cannot be revoked or removed from this screen. */
  currentMembershipId?: string;
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
  // Departed people should never reach the client; filter defensively.
  const sortedMemberships = sortPeople(props.memberships.filter((person) => !person.departed));
  const canAccessManage = props.canAccessManage ?? false;
  const canMemberRemove = props.canMemberRemove ?? false;
  const canLifecycleManage = props.canLifecycleManage ?? false;
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
          : (current.kind === "edit-person" ||
                current.kind === "access" ||
                current.kind === "permissions" ||
                current.kind === "remove-person") &&
              current.personId === personId
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
    view.kind === "person-detail" ||
    view.kind === "edit-person" ||
    view.kind === "access" ||
    view.kind === "permissions" ||
    view.kind === "remove-person"
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

  /** Re-read one person so authority versions stay current after access changes. */
  async function refreshDetail(personId: string) {
    try {
      const result = await fetchPerson(personId);
      setDetail(result.person);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function handleAccessChanged(personId: string) {
    props.onPeopleChanged();
    void refreshDetail(personId);
  }

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
          canMemberRemove={canMemberRemove}
          canLifecycleManage={canLifecycleManage}
          canViewActivity={props.canViewActivity}
          onExit={props.onExit}
          onRemediationApplied={(text) => {
            setMessage(text);
            setError(null);
            props.onPeopleChanged();
          }}
          onError={setError}
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
          canAccessManage={canAccessManage}
          canMemberRemove={canMemberRemove}
          isSelf={props.currentMembershipId === detail.id}
          onBack={goOverview}
          onEdit={() => {
            clearFeedback();
            setView({ kind: "edit-person", personId: detail.id });
          }}
          onAccess={() => {
            clearFeedback();
            setView({ kind: "access", personId: detail.id });
          }}
          onPermissions={() => {
            clearFeedback();
            setView({ kind: "permissions", personId: detail.id });
          }}
          onRemove={() => {
            clearFeedback();
            setView({ kind: "remove-person", personId: detail.id });
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
        <SignInManageView
          detail={detail}
          canAccessManage={canAccessManage}
          isSelf={props.currentMembershipId === detail.id}
          onBack={() => setView({ kind: "person-detail", personId: detail.id })}
          onChanged={() => handleAccessChanged(detail.id)}
          onMessage={setMessage}
          onError={setError}
        />
      ) : null}

      {view.kind === "permissions" && detail && detail.id === view.personId ? (
        <PermissionsEditorState
          detail={detail}
          onBack={() => setView({ kind: "person-detail", personId: detail.id })}
          onSaved={(name) => {
            setMessage(`Permissions saved for ${name}.`);
            setError(null);
            setView({ kind: "person-detail", personId: detail.id });
            handleAccessChanged(detail.id);
          }}
          onError={setError}
          onDirtyChange={props.onDirtyChange}
        />
      ) : null}

      {view.kind === "remove-person" && detail && detail.id === view.personId ? (
        <RemovePersonState
          detail={detail}
          onBack={() => setView({ kind: "person-detail", personId: detail.id })}
          onRemoved={(name, mode) => {
            setMessage(
              mode === "deleted"
                ? `${name} was deleted.`
                : `${name} was removed from the household.`,
            );
            setError(null);
            setDetail(null);
            setView({ kind: "overview" });
            props.onNavigate?.({ kind: "overview" });
            props.onPeopleChanged();
          }}
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
  canMemberRemove: boolean;
  canLifecycleManage: boolean;
  canViewActivity: boolean;
  onExit?: () => void;
  onRemediationApplied: (message: string) => void;
  onError: (value: string | null) => void;
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
          return (
            <li key={person.id}>
              <button
                type="button"
                className="person-row list-row"
                onClick={() => props.onOpenPerson(person.id)}
              >
                <span className="person-name">{person.displayName}</span>
                <span className="meta" data-testid="people-role-label">
                  {authorityRoleLabel(person.roleLabel)}
                </span>
                <span className="meta" data-testid="people-sign-in-status">
                  {signInStatusLabel(person.accessState)}
                </span>
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

      {props.canMemberRemove ? (
        <FixtureRemediationPanel
          canLifecycleManage={props.canLifecycleManage}
          onApplied={props.onRemediationApplied}
          onError={props.onError}
        />
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

function FixtureRemediationPanel(props: {
  canLifecycleManage: boolean;
  onApplied: (message: string) => void;
  onError: (value: string | null) => void;
}) {
  const [preview, setPreview] = useState<FixtureRemediationPreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [saveBackup, setSaveBackup] = useState(false);
  const [backupLabel, setBackupLabel] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const mutationIdRef = useRef<string>(newClientId());

  async function loadPreview() {
    try {
      const next = await previewFixtureRemediation();
      setPreview(next);
      // D-055: preselect only disposable candidates (never claimed, renamed, or used people).
      setSelected(
        next.candidates
          .filter((candidate) => candidate.preselected && candidate.disposable)
          .map((candidate) => candidate.membershipId),
      );
      mutationIdRef.current = newClientId();
    } catch {
      // Not a sample household (or no candidates left): the panel stays hidden.
      setPreview(null);
      setSelected([]);
    }
  }

  useEffect(() => {
    void loadPreview();
  }, []);

  if (!preview || preview.candidates.length === 0) return null;

  const backupRequested = saveBackup && props.canLifecycleManage;
  const canSubmit =
    !busy &&
    selected.length > 0 &&
    passphrase.length > 0 &&
    confirmation === "REMOVE SAMPLES";

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!preview || !canSubmit) return;
    setBusy(true);
    setLocalError(null);
    props.onError(null);
    try {
      const result = await applyFixtureRemediation({
        mutationId: mutationIdRef.current,
        selectedMembershipIds: selected,
        previewDigest: preview.previewDigest,
        passphrase,
        saveBackupBefore: backupRequested,
        backupLabel: backupRequested && backupLabel.trim() ? backupLabel.trim() : null,
        confirmationText: "REMOVE SAMPLES",
      });
      setPassphrase("");
      setConfirmation("");
      setSaveBackup(false);
      setBackupLabel("");
      const count = result.results.length;
      props.onApplied(
        `${count} sample ${count === 1 ? "person was" : "people were"} removed.${
          result.backup ? " A backup was saved first." : ""
        }`,
      );
      await loadPreview();
    } catch (caught) {
      setLocalError(errorMessage(caught));
      // A stale preview is the common failure; re-read so the next attempt uses fresh digest.
      if ((caught as { code?: string }).code === "CONFLICT") await loadPreview();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="fixture-remediation"
      aria-labelledby="fixture-remediation-heading"
      data-testid="fixture-remediation"
    >
      <h2 id="fixture-remediation-heading">Sample people</h2>
      <p className="meta">
        This household still has sample people from the evaluation data. Remove the ones you do not
        need. People who signed in, were renamed, or have activity are kept off by default and are
        removed with their history preserved.
      </p>
      <form className="form-grid" onSubmit={submit}>
        <fieldset disabled={busy}>
          <legend>Sample people to remove</legend>
          {preview.candidates.map((candidate) => (
            <label key={candidate.membershipId} className="choice-row">
              <input
                type="checkbox"
                checked={selected.includes(candidate.membershipId)}
                onChange={() => toggle(candidate.membershipId)}
              />
              <span>
                <strong>{candidate.displayName}</strong>
                <span className="meta">
                  {" "}
                  —{" "}
                  {candidate.disposable
                    ? "Unused sample"
                    : `Kept by default (${
                        candidate.blockers.length > 0
                          ? candidate.blockers.map((b) => b.replaceAll("_", " ")).join(", ")
                          : "in use"
                      })`}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="choice-row">
          <input
            type="checkbox"
            checked={saveBackup && props.canLifecycleManage}
            disabled={busy || !props.canLifecycleManage}
            onChange={(event) => setSaveBackup(event.target.checked)}
          />
          <span>
            Save a backup first
            {!props.canLifecycleManage ? (
              <span className="meta"> — requires permission to back up the household</span>
            ) : null}
          </span>
        </label>
        {backupRequested ? (
          <label>
            Backup label (optional)
            <input
              value={backupLabel}
              maxLength={80}
              disabled={busy}
              onChange={(event) => setBackupLabel(event.target.value)}
            />
          </label>
        ) : null}
        <label>
          Your passphrase
          <input
            type="password"
            autoComplete="current-password"
            value={passphrase}
            disabled={busy}
            onChange={(event) => setPassphrase(event.target.value)}
          />
        </label>
        <label>
          Type REMOVE SAMPLES to confirm
          <input
            value={confirmation}
            autoComplete="off"
            disabled={busy}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
        <div className="button-row">
          <button type="submit" className="danger" disabled={!canSubmit}>
            {busy ? "Removing…" : "Remove selected samples"}
          </button>
        </div>
        {localError ? (
          <p role="alert" className="form-error">
            {localError}
          </p>
        ) : null}
      </form>
    </section>
  );
}

function AddPersonState(props: {
  onBack: () => void;
  onCreated: (personId: string, name: string) => void;
  onError: (value: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<"adult" | "child">("child");
  const [showDetails, setShowDetails] = useState(false);
  const [fullName, setFullName] = useState("");
  const [birthday, setBirthday] = useState("");
  const [email, setEmail] = useState("");
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
        ...(showDetails
          ? {
              fullName: fullName.trim() ? fullName.trim() : null,
              birthday: birthday || null,
              email: email.trim() ? email.trim() : null,
            }
          : {}),
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
      <form className="form-grid" onSubmit={submit} data-testid="add-person-form">
        <label>
          Name shown in the app
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={80}
            disabled={busy}
            data-testid="add-person-display-name"
          />
        </label>
        <fieldset disabled={busy}>
          <legend>Adult or child (not an access role)</legend>
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
        <details
          className="optional-details"
          open={showDetails}
          data-testid="add-person-more-details"
          onToggle={(event) => setShowDetails((event.target as HTMLDetailsElement).open)}
        >
          <summary>More details (optional)</summary>
          <div className="form-grid">
            <label>
              Full name
              <input
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                maxLength={120}
                disabled={busy}
                data-testid="add-person-full-name"
              />
            </label>
            <label>
              Birthday
              <input
                type="date"
                value={birthday}
                onChange={(event) => setBirthday(event.target.value)}
                disabled={busy}
                data-testid="add-person-birthday"
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
                data-testid="add-person-email"
              />
            </label>
            <p className="meta">
              Optional only — not used for sign-in or access. Manager/Member permissions stay
              separate.
            </p>
          </div>
        </details>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Addingâ€¦" : "Add person"}
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
        "You have unsaved changes. Discard them?\n\nOK = Discard Â· Cancel = Keep editing",
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
          Name shown in the app
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
            {busy ? "Savingâ€¦" : "Save"}
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
  // still mirrors the older baseline â€” that CONFLICT flake under full-suite churn.
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
        "You have unsaved changes. Discard them?\n\nOK = Discard Â· Cancel = Keep editing",
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
          {busy ? "Savingâ€¦" : "Save"}
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={cancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function PersonDetailState(props: {
  detail: PersonDetail;
  canManageStructure: boolean;
  canAccessManage: boolean;
  canMemberRemove: boolean;
  isSelf: boolean;
  onBack: () => void;
  onEdit: () => void;
  onAccess: () => void;
  onPermissions: () => void;
  onRemove: () => void;
}) {
  const access = props.detail.access.state;
  return (
    <div className="focused-state" aria-labelledby="person-detail-heading">
      <BackButton label="Back to People & Groups" onClick={props.onBack} />
      <FocusHeading id="person-detail-heading">{props.detail.displayName}</FocusHeading>

      <section>
        <h3>Profile</h3>
        <p>
          Name shown in the app: <strong>{props.detail.displayName}</strong>
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
          Adult/Child: <strong>{roleLabel(props.detail.classification)}</strong>
        </p>
        {props.canManageStructure ? (
          <div className="button-row">
            <button type="button" onClick={props.onEdit}>
              Edit profile
            </button>
          </div>
        ) : null}
      </section>

      <section data-testid="person-sign-in-section">
        <h3>Sign-in &amp; permissions</h3>
        <p>
          Role:{" "}
          <strong data-testid="people-role-label">
            {authorityRoleLabel(props.detail.roleLabel)}
          </strong>
        </p>
        <p>
          Sign-in:{" "}
          <strong data-testid="people-sign-in-status">{signInStatusLabel(access)}</strong>
          {props.detail.access.setupExpiresAt ? (
            <span className="meta">
              {" "}
              · expires {new Date(props.detail.access.setupExpiresAt).toLocaleString()}
            </span>
          ) : null}
        </p>
        <p className="meta">
          Personal additions: {memberModeLabel(memberModeFromGrants(props.detail.grants))}
        </p>
        <p className="meta">
          Groups:{" "}
          {props.detail.groups.length
            ? props.detail.groups.map((group) => group.name).join(", ")
            : "None"}
        </p>
        <div className="button-row">
          {props.canAccessManage ? (
            <>
              <button type="button" onClick={props.onAccess}>
                Manage sign-in
              </button>
              <button type="button" onClick={props.onPermissions}>
                Edit permissions
              </button>
            </>
          ) : null}
          {props.canMemberRemove && !props.isSelf ? (
            <button type="button" onClick={props.onRemove}>
              Remove from household
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function SignInManageView(props: {
  detail: PersonDetail;
  canAccessManage: boolean;
  isSelf: boolean;
  onBack: () => void;
  onChanged: () => void;
  onMessage: (value: string | null) => void;
  onError: (value: string | null) => void;
}) {
  const [issued, setIssued] = useState<IssuedAccessClaim | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const access = props.detail.access.state;

  useEffect(() => {
    setIssued(null);
    setQrDataUrl(null);
    setBusy(false);
  }, [props.detail.id]);

  async function issue(purpose: AccessClaimPurpose) {
    if (busy || !props.canAccessManage) return;
    props.onError(null);
    setBusy(true);
    setQrDataUrl(null);
    try {
      const result = await issueAccessClaim({
        mutationId: newClientId(),
        membershipId: props.detail.id,
        purpose,
      });
      if (result.claim.secretAlreadyIssued || !result.claim.token) {
        props.onMessage(
          "That link was already issued for this request. Cancel and create a replacement if needed.",
        );
      } else {
        setIssued(result.claim);
        props.onMessage("Link ready. Copy it or show the QR code now; it cannot be retrieved later.");
      }
      props.onChanged();
    } catch (caught) {
      props.onError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function cancelOutstanding() {
    if (busy || !props.canAccessManage) return;
    props.onError(null);
    setBusy(true);
    try {
      await cancelAccessClaims({
        mutationId: newClientId(),
        membershipId: props.detail.id,
      });
      setIssued(null);
      setQrDataUrl(null);
      props.onMessage("Outstanding sign-in links cancelled.");
      props.onChanged();
    } catch (caught) {
      props.onError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!issued?.token) return;
    try {
      await navigator.clipboard.writeText(accessLinkFor(issued.token));
      props.onMessage("Link copied.");
    } catch {
      props.onError("Could not copy the link. Select it manually.");
    }
  }

  async function showQr() {
    if (!issued?.token) return;
    try {
      const url = await toDataURL(accessLinkFor(issued.token), {
        margin: 1,
        width: 220,
        errorCorrectionLevel: "M",
      });
      setQrDataUrl(url);
    } catch {
      props.onError("Could not generate a QR code.");
    }
  }

  async function doRevoke() {
    if (busy || !props.canAccessManage || props.isSelf) return;
    if (
      !window.confirm(
        `Revoke sign-in for ${props.detail.displayName}? They stay in the household but cannot sign in until restored.`,
      )
    ) {
      return;
    }
    props.onError(null);
    setBusy(true);
    try {
      await revokeSignIn(props.detail.id, {
        mutationId: newClientId(),
        expectedAuthorityVersion: props.detail.authorityVersion,
      });
      props.onMessage("Sign-in revoked.");
      props.onChanged();
    } catch (caught) {
      props.onError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="focused-state" aria-labelledby="sign-in-manage-heading">
      <BackButton label={`Back to ${props.detail.displayName}`} onClick={props.onBack} />
      <FocusHeading id="sign-in-manage-heading">Manage sign-in</FocusHeading>
      <p>
        Sign-in: <strong data-testid="people-sign-in-status">{signInStatusLabel(access)}</strong>
        {props.detail.access.setupExpiresAt ? (
          <span className="meta">
            {" "}
            · expires {new Date(props.detail.access.setupExpiresAt).toLocaleString()}
          </span>
        ) : null}
      </p>
      {!props.canAccessManage ? (
        <p className="meta">You can view this status, but not change it.</p>
      ) : (
        <div className="form-grid">
          <div className="button-row">
            {access === "not_set_up" || access === "setup_expired" ? (
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void issue("invitation")}
              >
                Set up sign-in
              </button>
            ) : null}
            {access === "access_revoked" ? (
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void issue("restore_sign_in")}
              >
                Restore sign-in link
              </button>
            ) : null}
            {access === "setup_ready" ? (
              <>
                <button type="button" disabled={busy} onClick={() => void issue("invitation")}>
                  Replace invitation
                </button>
                <button type="button" disabled={busy} onClick={() => void cancelOutstanding()}>
                  Cancel invitation
                </button>
              </>
            ) : null}
            {access === "access_set_up" ? (
              <>
                <button type="button" disabled={busy} onClick={() => void issue("password_reset")}>
                  Password help link
                </button>
                {!props.isSelf ? (
                  <button type="button" disabled={busy} onClick={() => void doRevoke()}>
                    Revoke sign-in
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
          {issued?.token ? (
            <div className="token-box" role="status">
              <strong>{ACCESS_PURPOSE_LABELS[issued.purpose]}</strong>
              <p className="meta">Expires {new Date(issued.expiresAt).toLocaleString()}</p>
              <code data-testid="access-invite-link">{accessLinkFor(issued.token)}</code>
              <div className="button-row">
                <button type="button" data-testid="access-copy-link" onClick={() => void copyLink()}>
                  Copy link
                </button>
                <button type="button" data-testid="access-show-qr" onClick={() => void showQr()}>
                  Show QR
                </button>
              </div>
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="Sign-in QR code"
                  data-testid="access-qr-image"
                  width={220}
                  height={220}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function PermissionsEditorState(props: {
  detail: PersonDetail;
  onBack: () => void;
  onSaved: (name: string) => void;
  onError: (value: string | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const initial = permissionDraftFromGrants(props.detail);
  const [role, setRole] = useState<"manager" | "member">(initial.role);
  const [memberMode, setMemberMode] = useState<"approval" | "direct">(initial.memberMode);
  const [secondary, setSecondary] = useState<string[]>(initial.secondary);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const next = permissionDraftFromGrants(props.detail);
    setRole(next.role);
    setMemberMode(next.memberMode);
    setSecondary(next.secondary);
  }, [props.detail.id, props.detail.authorityVersion]);

  const nextGrants = mergePermissionGrants({
    role,
    memberMode: role === "member" ? memberMode : undefined,
    secondaryGrants: secondary,
    priorGrants: props.detail.grants,
    knownGrants: ALL_KNOWN_GRANTS as Grant[],
  });
  const priorSet = new Set(props.detail.grants);
  const nextSet = new Set(nextGrants);
  const added = nextGrants.filter((g) => !priorSet.has(g));
  const removed = props.detail.grants.filter((g) => !nextSet.has(g));
  const dirty =
    role !== initial.role ||
    memberMode !== initial.memberMode ||
    secondary.slice().sort().join("\0") !== initial.secondary.slice().sort().join("\0");

  useEffect(() => {
    props.onDirtyChange?.(dirty);
    return () => props.onDirtyChange?.(false);
  }, [dirty, props.onDirtyChange]);

  async function save() {
    if (busy || !dirty) return;
    props.onError(null);
    setBusy(true);
    try {
      await saveMembershipPermissions(props.detail.id, {
        mutationId: newClientId(),
        expectedAuthorityVersion: props.detail.authorityVersion,
        role,
        memberMode: role === "member" ? memberMode : undefined,
        secondaryGrants: secondary,
      });
      props.onDirtyChange?.(false);
      props.onSaved(props.detail.displayName);
    } catch (caught) {
      props.onError(errorMessage(caught));
      setBusy(false);
    }
  }

  const beforeRole =
    props.detail.roleLabel === "manager"
      ? "Manager"
      : props.detail.roleLabel === "member"
        ? "Member"
        : props.detail.roleLabel;
  const afterRole = role === "manager" ? "Manager" : "Member";

  return (
    <div
      className="focused-state"
      aria-labelledby="permissions-heading"
      data-testid="person-permissions-section"
    >
      <BackButton label={`Back to ${props.detail.displayName}`} onClick={props.onBack} />
      <FocusHeading id="permissions-heading">Permissions</FocusHeading>
      {props.detail.unknownGrants.length > 0 ? (
        <p className="meta" role="status">
          Older capabilities kept as-is: {props.detail.unknownGrants.join(", ")}
        </p>
      ) : null}
      <div className="form-grid permissions-editor-layout">
        <fieldset disabled={busy}>
          <legend>Household role</legend>
          <label className="choice-row">
            <input
              type="radio"
              name="authority-role"
              checked={role === "manager"}
              onChange={() => setRole("manager")}
            />
            <span>
              <strong>Manager</strong>
              <span className="meta"> — manage people, access, shared work, and recovery.</span>
            </span>
          </label>
          <label className="choice-row">
            <input
              type="radio"
              name="authority-role"
              checked={role === "member"}
              onChange={() => setRole("member")}
            />
            <span>
              <strong>Member</strong>
              <span className="meta"> — own checklist and personal tasks.</span>
            </span>
          </label>
        </fieldset>
        {role === "member" ? (
          <fieldset disabled={busy}>
            <legend>Personal routine additions</legend>
            <label className="choice-row">
              <input
                type="radio"
                name="member-mode"
                checked={memberMode === "approval"}
                onChange={() => setMemberMode("approval")}
              />
              Approval required
            </label>
            <label className="choice-row">
              <input
                type="radio"
                name="member-mode"
                checked={memberMode === "direct"}
                onChange={() => setMemberMode("direct")}
              />
              Can edit own additions
            </label>
          </fieldset>
        ) : null}
        <fieldset disabled={busy}>
          <legend>Additional permissions</legend>
          {SECONDARY_EDITABLE_GRANTS.map((grant) => (
            <label key={grant} className="choice-row">
              <input
                type="checkbox"
                checked={secondary.includes(grant)}
                onChange={() => {
                  setSecondary((current) =>
                    current.includes(grant)
                      ? current.filter((item) => item !== grant)
                      : [...current, grant],
                  );
                }}
              />
              {grantLabel(grant)}
            </label>
          ))}
        </fieldset>
        <aside
          className="permission-change-summary"
          role="status"
          data-testid="permission-change-summary"
          aria-live="polite"
        >
          <strong>Before / after</strong>
          <p className="meta">
            Role: {beforeRole} → {afterRole}
            {role === "member"
              ? ` · Personal additions: ${memberModeLabel(memberMode)}`
              : null}
          </p>
          {!dirty ? (
            <p className="meta">No permission changes yet.</p>
          ) : added.length === 0 && removed.length === 0 ? (
            <p className="meta">Role or mode changes only — grant list unchanged.</p>
          ) : (
            <>
              {added.length > 0 ? (
                <p className="meta">Will add: {added.map(grantLabel).join("; ")}</p>
              ) : null}
              {removed.length > 0 ? (
                <p className="meta">Will remove: {removed.map(grantLabel).join("; ")}</p>
              ) : null}
            </>
          )}
        </aside>
        <div className="button-row">
          <button type="button" className="primary" disabled={busy || !dirty} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={props.onBack}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function RemovePersonState(props: {
  detail: PersonDetail;
  onBack: () => void;
  onRemoved: (name: string, mode: "departed" | "deleted") => void;
  onError: (value: string | null) => void;
}) {
  const [preview, setPreview] = useState<MemberRemovalPreview | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    void previewMemberRemoval(props.detail.id, {
      expectedAuthorityVersion: props.detail.authorityVersion,
      expectedVersion: props.detail.version,
    })
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((caught) => {
        if (!cancelled) props.onError(errorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.detail.id, props.detail.authorityVersion, props.detail.version]);

  async function commit(event: FormEvent) {
    event.preventDefault();
    if (!preview || busy) return;
    props.onError(null);
    setBusy(true);
    try {
      const result = await commitMemberRemoval(props.detail.id, {
        mutationId: newClientId(),
        expectedAuthorityVersion: props.detail.authorityVersion,
        expectedVersion: props.detail.version,
        passphrase,
        previewDigest: preview.previewDigest,
        confirmationText: "REMOVE",
      });
      props.onRemoved(props.detail.displayName, result.mode);
    } catch (caught) {
      props.onError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <div className="focused-state" aria-labelledby="remove-person-heading" data-testid="removal-preview">
      <BackButton label={`Back to ${props.detail.displayName}`} onClick={props.onBack} />
      <FocusHeading id="remove-person-heading">Remove from household</FocusHeading>
      {!preview ? (
        <p className="meta">{busy ? "Loading impact…" : "Unable to load impact."}</p>
      ) : (
        <form className="form-grid" onSubmit={(event) => void commit(event)}>
          <p>
            Remove <strong>{preview.impact.displayName}</strong>?
          </p>
          <p className="meta">
            Mode:{" "}
            {preview.impact.mode === "delete"
              ? "Delete unused person"
              : "Depart and keep history"}
          </p>
          <p className="meta">
            Groups:{" "}
            {preview.impact.groups.length
              ? preview.impact.groups.map((group) => group.name).join(", ")
              : "None"}
          </p>
          <p className="meta">
            Unstarted work from {preview.impact.fromDate ?? preview.impact.canceledUnstartedOccurrencesFrom} will be
            reconciled through the assignment resolver. Started work stays as Needs attention.
          </p>
          {preview.impact.days?.some((day) => day.items.length > 0) ? (
            <div className="meta" data-testid="removal-impact-days">
              <p>Next seven household days:</p>
              <ul>
                {preview.impact.days.map((day) =>
                  day.items.length === 0 ? null : (
                    <li key={day.householdDate}>
                      <strong>{day.householdDate}</strong>
                      <ul>
                        {day.items.map((item) => (
                          <li key={`${day.householdDate}-${item.definitionId}-${item.effect.type}`}>
                            {item.title}
                            {item.effect.type === "participation_ends"
                              ? " — participation ends"
                              : item.effect.type === "started_protected"
                                ? " — started work kept"
                                : item.effect.accountableMemberName
                                  ? ` — becomes ${item.effect.accountableMemberName}`
                                  : " — becomes Unassigned"}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ) : null}
          {preview.impact.repairLinks?.length ? (
            <p className="meta" data-testid="removal-repair-links">
              Repair Unassigned plans:{" "}
              {preview.impact.repairLinks.map((link) => link.title).join(", ")}
            </p>
          ) : null}
          <label>
            Your password
            <input
              type="password"
              autoComplete="current-password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              required
              disabled={busy}
            />
          </label>
          <div className="button-row">
            <button type="submit" className="primary" disabled={busy || !passphrase}>
              {busy ? "Removing…" : "Confirm REMOVE"}
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={props.onBack}>
              Cancel
            </button>
          </div>
        </form>
      )}
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
