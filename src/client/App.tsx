import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useTransition,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import { reconcileOccurrence } from "../domain/reconcile";
import type {
  Grant,
  MemberPublic,
  OccurrenceView,
  ObligationMeaning,
  StepStatus,
} from "../shared/schemas";
import {
  claim,
  connectSync,
  createPersonalTask,
  createProposal,
  decideProposal,
  fetchHistory,
  fetchMemberships,
  fetchMeta,
  fetchPersonalTasks,
  fetchPreview,
  fetchProposals,
  fetchRoutines,
  fetchSession,
  fetchToday,
  login,
  logout,
  savePersonalLayer,
  setPersonalTaskStatus,
  setStepStatus,
  rememberCsrfToken,
  type PersonalAddition,
  type PersonalTask,
  type Proposal,
  type Routine,
  type RoutinePreview,
  type SessionInfo,
} from "./api";
import { PeopleGroupsView } from "./PeopleGroups";
import { DAYPART_LABELS, RoutinesView } from "./Routines";
import {
  clearMembershipOutbox,
  enqueueOutbox,
  patchOutboxItem,
  readOutbox,
  removeOutboxItem,
  type OutboxItem,
} from "./outbox";
import { newClientId } from "./id";

type Tab =
  | "today"
  | "household"
  | "approvals"
  | "routine"
  | "history"
  | "personalize"
  | "preview";

type ChangeFeedback = {
  message: string;
  membershipId: string;
  effectiveDate: string;
  definitionId?: string;
};

function hasGrant(session: SessionInfo, grant: Grant): boolean {
  return session.grants.includes(grant);
}

function obligationLabel(obligation: ObligationMeaning): string {
  if (obligation === "as_needed") return "As needed";
  if (obligation === "required") return "Required";
  return "Optional";
}

function statusLabel(status: StepStatus): string {
  if (status === "not_needed") return "Not needed";
  if (status === "completed") return "Completed";
  return "Open";
}

function addDays(date: string, days: number): string {
  const instant = new Date(`${date}T12:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function App() {
  const [meta, setMeta] = useState<{
    evaluationMode: boolean;
    banner: string;
  } | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [tab, setTab] = useState<Tab>("today");
  const [occurrences, setOccurrences] = useState<OccurrenceView[]>([]);
  const [memberships, setMemberships] = useState<MemberPublic[]>([]);
  const [tasks, setTasks] = useState<PersonalTask[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [householdDate, setHouseholdDate] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [connection, setConnection] = useState<"connected" | "reconnecting" | "offline">(
    navigator.onLine ? "connected" : "offline",
  );
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ChangeFeedback | null>(null);
  const [preview, setPreview] = useState<RoutinePreview | null>(null);
  const [mutationDelayMs, setMutationDelayMs] = useState(0);
  const [routineRefreshToken, setRoutineRefreshToken] = useState(0);
  const identityRef = useRef<string | null>(null);
  const occurrencesRef = useRef<OccurrenceView[]>([]);
  const refreshGenerationRef = useRef(0);
  const supportingGenerationRef = useRef(0);
  const [, startTransition] = useTransition();

  function clearUiCaches() {
    setOccurrences([]);
    occurrencesRef.current = [];
    setMemberships([]);
    setTasks([]);
    setProposals([]);
    setOutbox([]);
    setExpanded({});
    setHouseholdDate("");
    setFeedback(null);
    setPreview(null);
    setError(null);
  }

  function establishSession(next: SessionInfo) {
    if (identityRef.current !== next.member.id) clearUiCaches();
    identityRef.current = next.member.id;
    rememberCsrfToken(next.csrfToken);
    setSession(next);
    setHouseholdDate(next.householdDate);
    setTab("today");
  }

  function expireSession() {
    identityRef.current = null;
    setSession(null);
    clearUiCaches();
    setTab("today");
  }

  const refreshToday = useEffectEvent(async (membershipId: string, date?: string) => {
    const generation = ++refreshGenerationRef.current;
    const data = await fetchToday(date);
    if (identityRef.current !== membershipId) return;
    if (generation !== refreshGenerationRef.current) return;
    const priorById = new Map(
      occurrencesRef.current.map((occurrence) => [occurrence.id, occurrence]),
    );
    occurrencesRef.current = data.occurrences;
    setHouseholdDate(data.householdDate);
    setOccurrences(data.occurrences);
    setExpanded((current) => {
      const next = { ...current };
      for (const occurrence of data.occurrences) {
        const prior = priorById.get(occurrence.id);
        if (next[occurrence.id] === undefined) {
          next[occurrence.id] = !occurrence.completed;
        } else if (
          prior &&
          prior.steps.length === 0 &&
          occurrence.steps.length > 0 &&
          !occurrence.completed
        ) {
          // Re-open if an earlier empty/incomplete snapshot collapsed the container.
          next[occurrence.id] = true;
        }
      }
      return next;
    });
  });

  const refreshSupportingData = useEffectEvent(
    async (activeSession: SessionInfo) => {
      const membershipId = activeSession.member.id;
      const generation = ++supportingGenerationRef.current;
      const shouldLoadProposals =
        hasGrant(activeSession, "routine.personalize.propose") ||
        hasGrant(activeSession, "routine.proposal.decide");
      const [memberResult, taskResult, proposalResult] = await Promise.allSettled([
        fetchMemberships(),
        fetchPersonalTasks(),
        shouldLoadProposals
          ? fetchProposals()
          : Promise.resolve({ proposals: [] as Proposal[] }),
      ]);
      if (identityRef.current !== membershipId) return;
      if (generation !== supportingGenerationRef.current) return;
      if (memberResult.status === "fulfilled") setMemberships(memberResult.value.memberships);
      if (taskResult.status === "fulfilled") setTasks(taskResult.value.tasks);
      if (proposalResult.status === "fulfilled") setProposals(proposalResult.value.proposals);
    },
  );

  const flushOutbox = useEffectEvent(async (membershipId: string) => {
    if (identityRef.current !== membershipId) return;
    let items = await readOutbox(membershipId);
    if (identityRef.current !== membershipId) return;
    setOutbox(items);
    for (const item of items) {
      if (identityRef.current !== membershipId || item.state === "rejected") continue;
      items = await patchOutboxItem(membershipId, item.mutationId, {
        state: "retrying",
      });
      if (identityRef.current === membershipId) setOutbox(items);
      try {
        await setStepStatus(
          item.occurrenceId,
          item.stepId,
          {
            mutationId: item.mutationId,
            status: item.status,
            performedAt: item.performedAt,
          },
          mutationDelayMs ? { delayMs: mutationDelayMs } : undefined,
        );
        if (identityRef.current !== membershipId) return;
        items = await removeOutboxItem(membershipId, item.mutationId);
        setOutbox(items);
      } catch (caught) {
        if (identityRef.current !== membershipId) return;
        const code = (caught as { code?: string }).code;
        if (code === "UNAUTHORIZED") {
          items = await patchOutboxItem(membershipId, item.mutationId, {
            state: "pending",
            errorMessage: "Sign in again to sync this change.",
          });
          setOutbox(items);
          expireSession();
          return;
        }
        const rejected = code === "VALIDATION" || code === "FORBIDDEN";
        items = await patchOutboxItem(membershipId, item.mutationId, {
          state: rejected ? "rejected" : "pending",
          errorMessage: errorMessage(caught),
        });
        setOutbox(items);
        break;
      }
    }
    if (identityRef.current === membershipId) {
      await refreshToday(membershipId, householdDate || undefined).catch(() => undefined);
    }
  });

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const delay = Number(params.get("mutationDelayMs") ?? 0);
    if (Number.isFinite(delay) && delay > 0) setMutationDelayMs(delay);
    void Promise.allSettled([fetchMeta(), fetchSession()]).then(([metaResult, sessionResult]) => {
      if (metaResult.status === "fulfilled") setMeta(metaResult.value);
      if (sessionResult.status === "fulfilled" && sessionResult.value) {
        establishSession(sessionResult.value);
      }
      setRestoring(false);
    });
  }, []);

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      setConnection("reconnecting");
      const membershipId = identityRef.current;
      if (!membershipId) {
        setConnection("connected");
        return;
      }
      void flushOutbox(membershipId).finally(() => {
        if (identityRef.current === membershipId) setConnection("connected");
      });
    };
    const onOffline = () => {
      setOnline(false);
      setConnection("offline");
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    const membershipId = session.member.id;

    const refreshAuthoritative = (options?: { urgentSupporting?: boolean }) => {
      // Always read server "today" on sync/reconnect — never a stale client date.
      const todayRefresh = () =>
        void refreshToday(membershipId).catch((caught) => setError(errorMessage(caught)));
      const supportingRefresh = () => void refreshSupportingData(session);
      if (options?.urgentSupporting) {
        // Proposal/routine decisions must update open Personalize/Approvals views
        // immediately; do not defer them behind startTransition.
        supportingRefresh();
        startTransition(() => {
          todayRefresh();
        });
        return;
      }
      startTransition(() => {
        todayRefresh();
        supportingRefresh();
      });
    };

    refreshAuthoritative({ urgentSupporting: true });
    void flushOutbox(membershipId);

    const disconnect = connectSync(
      (notification) => {
        if (identityRef.current !== membershipId) return;
        if (notification.resource === "group" || notification.resource === "routine") {
          setRoutineRefreshToken((n) => n + 1);
        }
        const urgent =
          notification.resource === "proposal" ||
          notification.resource === "routine" ||
          notification.resource === "membership" ||
          notification.resource === "group";
        refreshAuthoritative({ urgentSupporting: urgent });
      },
      (status) => {
        if (identityRef.current !== membershipId) return;
        if (!navigator.onLine) {
          setConnection("offline");
          return;
        }
        setConnection(status === "reconnecting" ? "reconnecting" : "connected");
        if (status === "connected") {
          refreshAuthoritative({ urgentSupporting: true });
        }
      },
    );

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (identityRef.current !== membershipId) return;
      // Visible-tab recovery must re-read Today immediately; do not defer it
      // behind startTransition (same class of bug as deferred proposal status).
      void refreshToday(membershipId).catch((caught) => setError(errorMessage(caught)));
      void refreshSupportingData(session);
      void flushOutbox(membershipId);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      disconnect();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [session?.member.id]);

  async function signOut() {
    if (!session) return;
    const membershipId = session.member.id;
    const pending = await readOutbox(membershipId);
    if (
      pending.length > 0 &&
      !window.confirm(
        `${pending.length} checklist change${pending.length === 1 ? "" : "s"} have not synced. Sign out and discard them?`,
      )
    ) {
      return;
    }
    identityRef.current = null;
    await clearMembershipOutbox(membershipId);
    try {
      await logout();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSession(null);
      clearUiCaches();
      setTab("today");
    }
  }

  async function queueStepChange(
    occurrenceId: string,
    stepId: string,
    status: StepStatus,
  ) {
    if (!session) return;
    const membershipId = session.member.id;
    const item: OutboxItem = {
      mutationId: newClientId(),
      occurrenceId,
      stepId,
      status,
      performedAt: new Date().toISOString(),
      state: "pending",
    };
    setOccurrences((current) => {
      const next = current.map((occurrence) =>
        occurrence.id === occurrenceId
          ? reconcileOccurrence(occurrence, [item])
          : occurrence,
      );
      occurrencesRef.current = next;
      return next;
    });
    const next = await enqueueOutbox(membershipId, item);
    if (identityRef.current !== membershipId) return;
    setOutbox(next);
    if (online) void flushOutbox(membershipId);
  }

  async function openPreview(membershipId: string, date: string, definitionId: string) {
    setError(null);
    try {
      const result = await fetchPreview(definitionId, membershipId, date);
      if (identityRef.current !== session?.member.id) return;
      setPreview(result.preview);
      setTab("preview");
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  if (restoring) {
    return (
      <main className="app-shell">
        <p role="status">Restoring your session…</p>
      </main>
    );
  }

  if (!session) {
    return (
      <AuthScreen
        evaluationBanner={meta?.evaluationMode ? meta.banner : null}
        onAuthenticated={establishSession}
      />
    );
  }

  const activeSession = session;
  const canManageShared = hasGrant(activeSession, "routine.shared.manage");
  const canEnroll = hasGrant(activeSession, "household.member.enroll");
  const canManageStructure = hasGrant(activeSession, "household.structure.manage");
  const canDecide = hasGrant(activeSession, "routine.proposal.decide");
  const manager = canManageShared || canEnroll || canDecide || canManageStructure;
  const canDirect = hasGrant(activeSession, "routine.personalize.direct");
  const canPropose = hasGrant(activeSession, "routine.personalize.propose");
  const projectedOccurrences = occurrences.map((occurrence) =>
    reconcileOccurrence(occurrence, outbox),
  );
  const projectedOwn = projectedOccurrences.filter(
    (occurrence) => occurrence.accountableMemberId === activeSession.member.id,
  );
  const pendingCount = outbox.filter((item) => item.state !== "rejected").length;

  function selectTab(next: Tab) {
    setTab(next);
    if (next === "personalize" || next === "approvals") {
      void refreshSupportingData(activeSession);
    }
  }

  return (
    <main className="app-shell">
      {meta?.evaluationMode ? (
        <div className="eval-banner" role="status">
          {meta.banner}
        </div>
      ) : null}
      <header className="topbar">
        <div>
          <strong>{session.member.displayName}</strong>
          <div className="meta">
            Signed in · Household date {householdDate || session.householdDate} ·{" "}
            {session.householdTimezone}
          </div>
        </div>
        <button type="button" className="ghost" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>

      <div className="status-line" aria-live="polite">
        <span
          className="status-pill"
          data-kind={connection === "offline" ? "offline" : "online"}
        >
          {connection === "offline"
            ? "Offline"
            : connection === "reconnecting"
              ? "Reconnecting"
              : "Online"}
        </span>
        {pendingCount > 0 ? (
          <span className="status-pill" data-kind="pending">
            {pendingCount} pending
          </span>
        ) : null}
        {outbox
          .filter((item) => item.state === "rejected")
          .map((item) => (
            <span key={item.mutationId} className="status-pill" data-kind="error">
              Rejected: {item.errorMessage ?? "Unable to sync"}
            </span>
          ))}
        {error ? (
          <span className="status-pill" data-kind="error">
            {error}
          </span>
        ) : null}
      </div>

      <nav className="nav" aria-label="Primary">
        <NavButton tab="today" current={tab} onSelect={selectTab}>
          Today
        </NavButton>
        <NavButton tab="household" current={tab} onSelect={selectTab}>
          People &amp; Groups
        </NavButton>
        {manager ? (
          <>
            {canDecide ? (
              <NavButton tab="approvals" current={tab} onSelect={selectTab}>
                Approvals
              </NavButton>
            ) : null}
            {canManageShared ? (
              <>
                <NavButton tab="routine" current={tab} onSelect={selectTab}>
                  Routines
                </NavButton>
                <NavButton tab="history" current={tab} onSelect={selectTab}>
                  History
                </NavButton>
              </>
            ) : null}
          </>
        ) : null}
        {canDirect || canPropose ? (
          <NavButton tab="personalize" current={tab} onSelect={selectTab}>
            Personalize
          </NavButton>
        ) : null}
      </nav>

      {feedback && tab !== "preview" ? (
        <ChangeNotice feedback={feedback} onPreview={openPreview} />
      ) : null}

      {tab === "today" ? (
        <TodayView
          occurrences={projectedOwn}
          tasks={tasks.filter((task) => task.ownerMembershipId === session.member.id)}
          expanded={expanded}
          setExpanded={setExpanded}
          canExecute={hasGrant(session, "routine.execute.own")}
          onStepChange={queueStepChange}
          onTasksChanged={(next) =>
            setTasks((current) => [
              ...current.filter((task) => task.ownerMembershipId !== session.member.id),
              ...next,
            ])
          }
        />
      ) : null}
      {tab === "household" ? (
        <PeopleGroupsView
          memberships={memberships}
          tasks={tasks.filter((task) => task.visibility === "household")}
          occurrences={projectedOccurrences}
          canManageStructure={canManageStructure}
          canEnroll={canEnroll}
          canViewActivity={manager}
          onPeopleChanged={() => {
            if (activeSession) void refreshSupportingData(activeSession);
          }}
        />
      ) : null}
      {tab === "approvals" && canDecide ? (
        <ApprovalsView
          proposals={proposals}
          memberships={memberships}
          today={householdDate || session.householdDate}
          onChanged={(next) => {
            setProposals((current) =>
              current.map((proposal) => (proposal.id === next.id ? next : proposal)),
            );
          }}
          onApproved={(next, effectiveDate) =>
            setFeedback({
              message: `"${next.text}" was approved.`,
              membershipId: next.membershipId,
              effectiveDate,
              definitionId: next.definitionId ?? undefined,
            })
          }
        />
      ) : null}
      {tab === "routine" && canManageShared ? (
        <RoutinesView
          memberships={memberships}
          today={householdDate || session.householdDate}
          refreshToken={routineRefreshToken}
          onSaved={(routine) => {
            const latest = routine.revisions.at(-1);
            if (latest) {
              setFeedback({
                message: `"${latest.title}" was saved.`,
                membershipId:
                  latest.resolvedMemberIds?.[0] ??
                  latest.assigneeMemberIds[0] ??
                  session.member.id,
                effectiveDate: latest.effectiveDate,
                definitionId: routine.id,
              });
            }
            setRoutineRefreshToken((n) => n + 1);
            void refreshToday(session.member.id);
          }}
          onArchived={(routine) => {
            setRoutineRefreshToken((n) => n + 1);
            void refreshToday(session.member.id);
            const title = routine.revisions.at(-1)?.title ?? "Routine";
            setFeedback({
              message: `"${title}" was archived.`,
              membershipId: session.member.id,
              effectiveDate: householdDate || session.householdDate,
              definitionId: routine.id,
            });
          }}
        />
      ) : null}
      {tab === "history" && canManageShared ? (
        <HistoryView initialDate={householdDate} />
      ) : null}
      {tab === "personalize" && canDirect ? (
        <DirectPersonalization
          onPreview={(definitionId) =>
            void openPreview(
              session.member.id,
              addDays(householdDate || session.householdDate, 1),
              definitionId,
            )
          }
          onSaved={(layer) =>
            setFeedback({
              message: "Your personal settings were saved.",
              membershipId: layer.membershipId,
              effectiveDate: layer.effectiveDate,
              definitionId: layer.definitionId,
            })
          }
        />
      ) : null}
      {tab === "personalize" && !canDirect && canPropose ? (
        <ProposalPersonalization
          proposals={proposals}
          onCreated={(proposal) => setProposals((current) => [proposal, ...current])}
        />
      ) : null}
      {tab === "personalize" && !canDirect && !canPropose ? (
        <section className="panel">
          <h1>Personalize</h1>
          <p role="status">
            This account cannot add personal routine items. Ask a manager to enroll with a
            personalizer preset.
          </p>
        </section>
      ) : null}
      {tab === "preview" && preview ? (
        <PreviewView preview={preview} onBack={() => setTab(feedback ? "personalize" : "today")} />
      ) : null}
    </main>
  );
}

function NavButton(props: {
  tab: Tab;
  current: Tab;
  onSelect: (tab: Tab) => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-current={props.current === props.tab ? "page" : undefined}
      onClick={() => props.onSelect(props.tab)}
    >
      {props.children}
    </button>
  );
}

function AuthScreen(props: {
  evaluationBanner: string | null;
  onAuthenticated: (session: SessionInfo) => void;
}) {
  const [mode, setMode] = useState<"login" | "claim">("login");
  const [loginName, setLoginName] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [token, setToken] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session =
        mode === "login"
          ? await login(loginName, passphrase)
          : await claim({ token, loginName, passphrase, displayName });
      props.onAuthenticated(session);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell auth-shell">
      {props.evaluationBanner ? (
        <div className="eval-banner" role="status">
          {props.evaluationBanner}
        </div>
      ) : null}
      <section className="panel auth-panel">
        <p className="eyebrow">Household Dashboard</p>
        <h1>{mode === "login" ? "Sign in" : "Claim your household account"}</h1>
        <form className="form-grid" onSubmit={submit}>
          {mode === "claim" ? (
            <>
              <label>
                Enrollment token
                <textarea
                  autoComplete="off"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  required
                />
              </label>
              <label>
                Display name
                <input
                  autoComplete="name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  required
                />
              </label>
            </>
          ) : null}
          <label>
            Login name
            <input
              autoComplete="username"
              value={loginName}
              onChange={(event) => setLoginName(event.target.value)}
              required
            />
          </label>
          <label>
            Passphrase
            <input
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              required
            />
          </label>
          {mode === "claim" ? (
            <p className="meta">Use at least 15 characters. Paste and password managers are supported.</p>
          ) : null}
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Claim and sign in"}
          </button>
          {error ? (
            <p role="alert" className="form-error">
              {error}
            </p>
          ) : null}
        </form>
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setMode((current) => (current === "login" ? "claim" : "login"));
            setError(null);
          }}
        >
          {mode === "login" ? "I have an enrollment token" : "Back to sign in"}
        </button>
      </section>
    </main>
  );
}

function TodayView(props: {
  occurrences: OccurrenceView[];
  tasks: PersonalTask[];
  expanded: Record<string, boolean>;
  setExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
  canExecute: boolean;
  onStepChange: (occurrenceId: string, stepId: string, status: StepStatus) => void;
  onTasksChanged: (tasks: PersonalTask[]) => void;
}) {
  return (
    <>
      <section>
        <h1>Today</h1>
        {props.occurrences.length === 0 ? (
          <div className="panel">
            <p>No routines for you on this household date.</p>
          </div>
        ) : (
          <OccurrenceList
            occurrences={props.occurrences}
            expanded={props.expanded}
            setExpanded={props.setExpanded}
            canExecute={props.canExecute}
            onStepChange={props.onStepChange}
          />
        )}
      </section>
      <PersonalTasksSection tasks={props.tasks} onChanged={props.onTasksChanged} />
    </>
  );
}

function OccurrenceList(props: {
  occurrences: OccurrenceView[];
  expanded: Record<string, boolean>;
  setExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
  canExecute: boolean;
  onStepChange?: (occurrenceId: string, stepId: string, status: StepStatus) => void;
}) {
  return props.occurrences.map((occurrence) => {
    const open = props.expanded[occurrence.id] ?? !occurrence.completed;
    return (
      <article
        key={occurrence.id}
        className={`occurrence ${occurrence.completed ? "completed" : ""}`}
        data-testid={`occurrence-${occurrence.id}`}
        data-completed={occurrence.completed ? "true" : "false"}
      >
        <button
          type="button"
          className="occurrence-header"
          aria-expanded={open}
          onClick={() =>
            props.setExpanded((current) => ({ ...current, [occurrence.id]: !open }))
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
              <li key={step.id} className="step" data-testid={`step-${step.id}`}>
                <div className="step-title">
                  <strong>{step.text}</strong>
                  <span className="obligation">
                    {obligationLabel(step.obligation)}
                    {step.source === "personal" ? " · Personal" : ""}
                  </span>
                </div>
                <div className="meta" data-testid={`step-status-${step.id}`}>
                  Status: {statusLabel(step.status)}
                </div>
                {props.canExecute && props.onStepChange ? (
                  <div className="step-actions">
                    <button
                      type="button"
                      aria-pressed={step.status === "open"}
                      aria-label={`Mark ${step.text} open`}
                      onClick={() => props.onStepChange?.(occurrence.id, step.id, "open")}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      aria-pressed={step.status === "completed"}
                      aria-label={`Mark ${step.text} completed`}
                      onClick={() => props.onStepChange?.(occurrence.id, step.id, "completed")}
                    >
                      Done
                    </button>
                    {step.obligation === "as_needed" ? (
                      <button
                        type="button"
                        aria-pressed={step.status === "not_needed"}
                        aria-label={`Mark ${step.text} not needed today`}
                        onClick={() =>
                          props.onStepChange?.(occurrence.id, step.id, "not_needed")
                        }
                      >
                        Not needed
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </article>
    );
  });
}

function PersonalTasksSection(props: {
  tasks: PersonalTask[];
  onChanged: (tasks: PersonalTask[]) => void;
}) {
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState<"private" | "household">("private");
  const [error, setError] = useState<string | null>(null);
  const open = props.tasks.filter((task) => task.status === "open");
  const completed = props.tasks.filter((task) => task.status === "completed");
  const [showCompleted, setShowCompleted] = useState(false);

  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const result = await createPersonalTask(title, visibility);
      props.onChanged([result.task, ...props.tasks]);
      setTitle("");
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function setStatus(task: PersonalTask, status: "open" | "completed") {
    setError(null);
    try {
      const result = await setPersonalTaskStatus(task.id, status);
      props.onChanged(
        props.tasks.map((current) => (current.id === task.id ? result.task : current)),
      );
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <section className="panel compact-section">
      <h2>Personal tasks</h2>
      <form className="inline-form" onSubmit={create}>
        <label className="grow">
          <span className="sr-only">New personal task</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Add a personal task"
            required
          />
        </label>
        <label>
          <span className="sr-only">Task visibility</span>
          <select
            aria-label="Task visibility"
            value={visibility}
            onChange={(event) =>
              setVisibility(event.target.value as "private" | "household")
            }
          >
            <option value="private">Private</option>
            <option value="household">Household</option>
          </select>
        </label>
        <button type="submit" className="secondary">
          Add
        </button>
      </form>
      <TaskList tasks={open} onStatus={setStatus} />
      {completed.length > 0 ? (
        <>
          <button
            type="button"
            className="text-button"
            aria-expanded={showCompleted}
            onClick={() => setShowCompleted((current) => !current)}
          >
            {showCompleted ? "Hide" : "Show"} completed ({completed.length})
          </button>
          {showCompleted ? <TaskList tasks={completed} onStatus={setStatus} /> : null}
        </>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

function TaskList(props: {
  tasks: PersonalTask[];
  onStatus: (task: PersonalTask, status: "open" | "completed") => void;
}) {
  return (
    <ul className="task-list">
      {props.tasks.map((task) => (
        <li key={task.id}>
          <button
            type="button"
            className="task-toggle"
            aria-label={`Mark ${task.title} ${task.status === "open" ? "completed" : "open"}`}
            onClick={() =>
              props.onStatus(task, task.status === "open" ? "completed" : "open")
            }
          >
            <span aria-hidden="true">{task.status === "completed" ? "✓" : "○"}</span>
            <span>{task.title}</span>
          </button>
          <span className="meta">{task.visibility}</span>
        </li>
      ))}
    </ul>
  );
}

function ChangeNotice(props: {
  feedback: ChangeFeedback;
  onPreview: (membershipId: string, date: string, definitionId: string) => void;
}) {
  return (
    <div className="change-notice" role="status">
      <div>
        <strong>{props.feedback.message}</strong>
        <div>Effective {props.feedback.effectiveDate}.</div>
      </div>
      {props.feedback.definitionId ? (
        <button
          type="button"
          className="secondary"
          onClick={() =>
            void props.onPreview(
              props.feedback.membershipId,
              props.feedback.effectiveDate,
              props.feedback.definitionId!,
            )
          }
        >
          Open read-only preview
        </button>
      ) : null}
    </div>
  );
}

function AdditionFields(props: {
  addition: Omit<PersonalAddition, "position">;
  anchors: Array<{ logicalItemId: string; text: string }>;
  onChange: (addition: Omit<PersonalAddition, "position">) => void;
}) {
  return (
    <>
      <label>
        Item text
        <input
          value={props.addition.text}
          onChange={(event) =>
            props.onChange({ ...props.addition, text: event.target.value })
          }
        />
      </label>
      <label>
        Obligation
        <select
          value={props.addition.obligation}
          onChange={(event) =>
            props.onChange({
              ...props.addition,
              obligation: event.target.value as ObligationMeaning,
            })
          }
        >
          <option value="required">Required</option>
          <option value="as_needed">As needed</option>
          <option value="optional">Optional</option>
        </select>
      </label>
      <label>
        Position
        <select
          value={
            props.addition.place === "end"
              ? "end"
              : `${props.addition.place}:${props.addition.anchorLogicalItemId ?? ""}`
          }
          onChange={(event) => {
            if (event.target.value === "end") {
              props.onChange({
                ...props.addition,
                place: "end",
                anchorLogicalItemId: null,
              });
              return;
            }
            const [place, anchorLogicalItemId] = event.target.value.split(":");
            props.onChange({
              ...props.addition,
              place: place as "before" | "after",
              anchorLogicalItemId,
            });
          }}
        >
          <option value="end">At the end</option>
          {props.anchors.flatMap((anchor) => [
            <option key={`before-${anchor.logicalItemId}`} value={`before:${anchor.logicalItemId}`}>
              Before {anchor.text}
            </option>,
            <option key={`after-${anchor.logicalItemId}`} value={`after:${anchor.logicalItemId}`}>
              After {anchor.text}
            </option>,
          ])}
        </select>
      </label>
    </>
  );
}

function DirectPersonalization(props: {
  onPreview: (definitionId: string) => void;
  onSaved: (layer: {
    membershipId: string;
    effectiveDate: string;
    definitionId: string;
  }) => void;
}) {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [definitionId, setDefinitionId] = useState("");
  const [anchors, setAnchors] = useState<Array<{ logicalItemId: string; text: string }>>([]);
  const [additions, setAdditions] = useState<Array<Omit<PersonalAddition, "position">>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchRoutines(false).then((result) => {
      setRoutines(result.routines);
      const first = result.routines[0];
      if (first) setDefinitionId((current) => current || first.id);
    });
  }, []);

  useEffect(() => {
    if (!definitionId) {
      setAnchors([]);
      return;
    }
    const routine = routines.find((item) => item.id === definitionId);
    const latest = routine?.revisions.at(-1);
    setAnchors(
      latest?.steps.map((step) => ({
        logicalItemId: step.logicalItemId,
        text: step.text,
      })) ?? [],
    );
  }, [definitionId, routines]);

  async function save() {
    if (!definitionId) {
      setError("Choose a routine to personalize.");
      return;
    }
    setError(null);
    try {
      const result = await savePersonalLayer(definitionId, additions);
      setAdditions(result.layer.additions.map(({ position: _position, ...addition }) => addition));
      props.onSaved(result.layer);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  const selectedTitle =
    routines
      .find((routine) => routine.id === definitionId)
      ?.revisions.at(-1)?.title ?? "routine";

  return (
    <section className="panel">
      <h1>Personalize settings</h1>
      <p className="meta">
        Choose an active routine, then add and arrange your own items. Inherited shared items remain
        protected.
      </p>
      <div className="form-grid">
        <label>
          Routine
          <select
            value={definitionId}
            onChange={(event) => setDefinitionId(event.target.value)}
          >
            {routines.length === 0 ? <option value="">No active routines</option> : null}
            {routines.map((routine) => {
              const title = routine.revisions.at(-1)?.title ?? "Routine";
              const daypart = routine.revisions.at(-1)?.daypart;
              return (
                <option key={routine.id} value={routine.id}>
                  {title}
                  {daypart ? ` (${DAYPART_LABELS[daypart]})` : ""}
                </option>
              );
            })}
          </select>
        </label>
        {definitionId ? (
          <p className="meta">Editing personal items for {selectedTitle}.</p>
        ) : null}
        {additions.map((addition, index) => (
          <div className="step-editor" key={addition.id}>
            <AdditionFields
              addition={addition}
              anchors={anchors}
              onChange={(next) =>
                setAdditions((current) =>
                  current.map((item, itemIndex) => (itemIndex === index ? next : item)),
                )
              }
            />
            <div className="row-actions">
              <button
                type="button"
                className="secondary"
                disabled={index === 0}
                onClick={() =>
                  setAdditions((current) => {
                    const next = [...current];
                    [next[index - 1], next[index]] = [next[index], next[index - 1]];
                    return next;
                  })
                }
              >
                Move up
              </button>
              <button
                type="button"
                className="secondary"
                disabled={index === additions.length - 1}
                onClick={() =>
                  setAdditions((current) => {
                    const next = [...current];
                    [next[index], next[index + 1]] = [next[index + 1], next[index]];
                    return next;
                  })
                }
              >
                Move down
              </button>
              <button
                type="button"
                className="text-button danger-text"
                onClick={() =>
                  setAdditions((current) =>
                    current.filter((_, itemIndex) => itemIndex !== index),
                  )
                }
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="secondary"
          onClick={() =>
            setAdditions((current) => [
              ...current,
              {
                id: newClientId(),
                text: "",
                obligation: "optional",
                anchorLogicalItemId: null,
                place: "end",
              },
            ])
          }
        >
          Add personal item
        </button>
        <button type="button" className="primary" onClick={() => void save()}>
          Save personal settings
        </button>
        <button
          type="button"
          className="text-button"
          disabled={!definitionId}
          onClick={() => definitionId && props.onPreview(definitionId)}
        >
          Preview next applicable routine
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </div>
    </section>
  );
}

function ProposalPersonalization(props: {
  proposals: Proposal[];
  onCreated: (proposal: Proposal) => void;
}) {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [definitionId, setDefinitionId] = useState("");
  const [addition, setAddition] = useState<Omit<PersonalAddition, "position">>({
    id: newClientId(),
    text: "",
    obligation: "optional",
    anchorLogicalItemId: null,
    place: "end",
  });
  const [anchors, setAnchors] = useState<Array<{ logicalItemId: string; text: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchRoutines(false).then((result) => {
      setRoutines(result.routines);
      const first = result.routines[0];
      if (first) setDefinitionId((current) => current || first.id);
    });
  }, []);

  useEffect(() => {
    if (!definitionId) {
      setAnchors([]);
      return;
    }
    const routine = routines.find((item) => item.id === definitionId);
    setAnchors(
      routine?.revisions.at(-1)?.steps.map((step) => ({
        logicalItemId: step.logicalItemId,
        text: step.text,
      })) ?? [],
    );
  }, [definitionId, routines]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!definitionId) {
      setError("Choose a routine for this proposal.");
      return;
    }
    setError(null);
    try {
      const { id: _id, ...input } = addition;
      const result = await createProposal({ ...input, definitionId });
      props.onCreated(result.proposal);
      setAddition({
        id: newClientId(),
        text: "",
        obligation: "optional",
        anchorLogicalItemId: null,
        place: "end",
      });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  const titleByDefinition = new Map(
    routines.map((routine) => [
      routine.id,
      routine.revisions.at(-1)?.title ?? "Routine",
    ]),
  );

  return (
    <section className="panel">
      <h1>Propose a personal item</h1>
      <form className="form-grid" onSubmit={submit}>
        <label>
          Routine
          <select
            value={definitionId}
            onChange={(event) => setDefinitionId(event.target.value)}
          >
            {routines.length === 0 ? <option value="">No active routines</option> : null}
            {routines.map((routine) => {
              const title = routine.revisions.at(-1)?.title ?? "Routine";
              const daypart = routine.revisions.at(-1)?.daypart;
              return (
                <option key={routine.id} value={routine.id}>
                  {title}
                  {daypart ? ` (${DAYPART_LABELS[daypart]})` : ""}
                </option>
              );
            })}
          </select>
        </label>
        <AdditionFields addition={addition} anchors={anchors} onChange={setAddition} />
        <button type="submit" className="primary">
          Send proposal
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      <h2>Your proposals</h2>
      <ul className="simple-list">
        {props.proposals.map((proposal) => (
          <li key={proposal.id}>
            <span>
              {proposal.text}
              {proposal.definitionId
                ? ` · ${titleByDefinition.get(proposal.definitionId) ?? "Routine"}`
                : ""}
            </span>
            <span className="status-pill" data-kind={proposal.status === "pending" ? "pending" : "online"}>
              {proposal.status === "approved"
                ? "Approved"
                : proposal.status === "rejected"
                  ? "Rejected"
                  : "Pending"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ApprovalsView(props: {
  proposals: Proposal[];
  memberships: MemberPublic[];
  today: string;
  onChanged: (proposal: Proposal) => void;
  onApproved: (proposal: Proposal, effectiveDate: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [routineTitles, setRoutineTitles] = useState<Map<string, string>>(new Map());
  const pending = props.proposals.filter((proposal) => proposal.status === "pending");

  useEffect(() => {
    void fetchRoutines(true).then((result) => {
      const titles = new Map<string, string>();
      for (const routine of result.routines) {
        titles.set(routine.id, routine.revisions.at(-1)?.title ?? "Routine");
      }
      setRoutineTitles(titles);
    });
  }, [props.proposals]);

  async function decide(proposal: Proposal, decision: "approved" | "rejected") {
    setError(null);
    try {
      const result = await decideProposal(proposal.id, decision);
      props.onChanged(result.proposal);
      if (
        decision === "approved" &&
        result.proposal.personalRevisionId &&
        proposal.definitionId
      ) {
        let effectiveDate = addDays(props.today, 1);
        for (let offset = 1; offset <= 32; offset += 1) {
          const candidate = addDays(props.today, offset);
          const preview = await fetchPreview(
            proposal.definitionId,
            proposal.membershipId,
            candidate,
          );
          if (preview.preview.personalRevisionId === result.proposal.personalRevisionId) {
            effectiveDate = candidate;
            break;
          }
        }
        props.onApproved(result.proposal, effectiveDate);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <section>
      <h1>Approvals</h1>
      {pending.length === 0 ? (
        <div className="panel">
          <p>No pending proposals.</p>
        </div>
      ) : null}
      {pending.map((proposal) => {
        const routineTitle = proposal.definitionId
          ? routineTitles.get(proposal.definitionId)
          : null;
        return (
          <article key={proposal.id} className="panel approval-card">
            <div>
              <h2>{proposal.text}</h2>
              <p className="meta">
                Proposed by{" "}
                {props.memberships.find((member) => member.id === proposal.membershipId)
                  ?.displayName ?? "Household member"}{" "}
                · {obligationLabel(proposal.obligation)}
                {routineTitle ? ` · ${routineTitle}` : ""}
                {proposal.associationStatus === "unresolved"
                  ? " · routine association unresolved"
                  : ""}
              </p>
            </div>
            <div className="row-actions">
              <button
                type="button"
                className="primary"
                onClick={() => void decide(proposal, "approved")}
              >
                Approve {proposal.text}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => void decide(proposal, "rejected")}
              >
                Reject {proposal.text}
              </button>
            </div>
          </article>
        );
      })}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

function PreviewView(props: { preview: RoutinePreview; onBack: () => void }) {
  return (
    <section className="panel">
      <p className="eyebrow">Read-only preview</p>
      <h1>{props.preview.title}</h1>
      <p className="meta">Effective view for {props.preview.householdDate}</p>
      <ol className="preview-list">
        {props.preview.steps.map((step) => (
          <li key={`${step.logicalItemId}-${step.position}`}>
            <div>
              <strong>{step.text}</strong>
              <div className="meta">
                {obligationLabel(step.obligation)} ·{" "}
                {step.source === "personal" ? "Personal addition" : "Shared routine"}
              </div>
            </div>
          </li>
        ))}
      </ol>
      <button type="button" className="secondary" onClick={props.onBack}>
        Close preview
      </button>
    </section>
  );
}

function HistoryView(props: { initialDate: string }) {
  const [date, setDate] = useState(props.initialDate);
  const [occurrences, setOccurrences] = useState<OccurrenceView[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (date) void load(date);
  }, []);

  async function load(nextDate: string) {
    setError(null);
    try {
      const result = await fetchHistory(nextDate);
      setOccurrences(result.occurrences);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <section className="panel">
      <h1>Occurrence history</h1>
      <label className="field-label">
        Household date
        <input
          type="date"
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
            void load(event.target.value);
          }}
        />
      </label>
      {occurrences.map((occurrence) => (
        <article key={occurrence.id} className="occurrence history-occurrence">
          <div className="occurrence-header static-header">
            <div>
              <h2>{occurrence.title}</h2>
              <div className="meta">
                {occurrence.accountableMemberName} ·{" "}
                {DAYPART_LABELS[occurrence.daypart] ?? occurrence.daypart} ·{" "}
                {occurrence.completed ? "Complete" : "Incomplete"}
              </div>
            </div>
          </div>
          <ul className="checklist">
            {occurrence.steps.map((step) => (
              <li key={step.id} className="step">
                <div className="step-title">
                  <strong>{step.text}</strong>
                  <span className="obligation">{obligationLabel(step.obligation)}</span>
                </div>
                <div className="meta">{statusLabel(step.status)}</div>
              </li>
            ))}
          </ul>
        </article>
      ))}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
