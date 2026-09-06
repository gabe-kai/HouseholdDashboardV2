import {
  useEffect,
  useEffectEvent,
  useState,
  useTransition,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { MemberPublic, OccurrenceView, ObligationMeaning, StepStatus } from "../shared/schemas";
import { reconcileOccurrence } from "../domain/reconcile";
import {
  clearSession,
  connectSync,
  createRevision,
  createRoutine,
  createSession,
  fetchHistory,
  fetchMembers,
  fetchMeta,
  fetchRoutine,
  fetchSession,
  fetchToday,
  setStepStatus,
  type SessionInfo,
} from "./api";
import {
  enqueueOutbox,
  patchOutboxItem,
  readOutbox,
  removeOutboxItem,
  type OutboxItem,
} from "./outbox";

type Tab = "today" | "routine" | "history";

const WEEKDAYS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

function newId(): string {
  return crypto.randomUUID();
}

function obligationLabel(o: ObligationMeaning): string {
  if (o === "as_needed") return "As needed";
  if (o === "required") return "Required";
  return "Optional";
}

function statusLabel(s: StepStatus): string {
  if (s === "not_needed") return "Not needed";
  if (s === "completed") return "Completed";
  return "Open";
}

export function App() {
  const [banner, setBanner] = useState("");
  const [members, setMembers] = useState<MemberPublic[]>([]);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [tab, setTab] = useState<Tab>("today");
  const [occurrences, setOccurrences] = useState<OccurrenceView[]>([]);
  const [householdDate, setHouseholdDate] = useState("");
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [connection, setConnection] = useState<"connected" | "reconnecting" | "offline">(
    navigator.onLine ? "connected" : "offline",
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [mutationDelayMs, setMutationDelayMs] = useState(0);

  const refreshToday = useEffectEvent(async (date?: string) => {
    const data = await fetchToday(date);
    setHouseholdDate(data.householdDate);
    setOccurrences(data.occurrences);
    setExpanded((prev) => {
      const next = { ...prev };
      for (const occ of data.occurrences) {
        if (next[occ.id] === undefined) {
          next[occ.id] = !occ.completed;
        } else if (occ.completed && next[occ.id] === true && prev[occ.id] === undefined) {
          next[occ.id] = false;
        }
      }
      return next;
    });
  });

  const flushOutbox = useEffectEvent(async () => {
    const items = await readOutbox();
    setOutbox(items);
    for (const item of items) {
      if (item.state === "rejected") continue;
      await patchOutboxItem(item.mutationId, { state: "retrying" });
      setOutbox(await readOutbox());
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
        await removeOutboxItem(item.mutationId);
        setOutbox(await readOutbox());
      } catch (err) {
        const message = err instanceof Error ? err.message : "Sync failed";
        const code = (err as { code?: string }).code;
        if (code === "VALIDATION" || code === "FORBIDDEN") {
          await patchOutboxItem(item.mutationId, { state: "rejected", errorMessage: message });
        } else {
          await patchOutboxItem(item.mutationId, { state: "pending", errorMessage: message });
        }
        setOutbox(await readOutbox());
        break;
      }
    }
    try {
      await refreshToday(householdDate || undefined);
    } catch {
      /* offline */
    }
  });

  useEffect(() => {
    void (async () => {
      const meta = await fetchMeta();
      setBanner(meta.banner);
      const memberList = await fetchMembers();
      setMembers(memberList.members);
      const existing = await fetchSession();
      if (existing) {
        setSession(existing);
      }
      setOutbox(await readOutbox());
      const params = new URLSearchParams(location.search);
      const delay = Number(params.get("mutationDelayMs") ?? 0);
      if (delay > 0) setMutationDelayMs(delay);
    })();
  }, []);

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      setConnection("reconnecting");
      void flushOutbox().finally(() => setConnection("connected"));
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
    void refreshToday().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    void flushOutbox();
    const stop = connectSync(() => {
      startTransition(() => {
        void refreshToday(householdDate || undefined).catch(() => undefined);
      });
    });
    return stop;
  }, [session?.member.id]);

  async function selectProfile(memberId: string) {
    setError(null);
    const next = await createSession(memberId);
    setSession(next);
    setTab("today");
  }

  async function signOut() {
    await clearSession();
    setSession(null);
    setOccurrences([]);
  }

  async function queueStepChange(occurrenceId: string, stepId: string, status: StepStatus) {
    const mutationId = newId();
    const performedAt = new Date().toISOString();
    const item: OutboxItem = {
      mutationId,
      occurrenceId,
      stepId,
      status,
      performedAt,
      state: "pending",
    };

    // Optimistic local update — synchronous in the click turn.
    setOccurrences((current) =>
      current.map((occ) =>
        occ.id === occurrenceId
          ? reconcileOccurrence(occ, [
              { mutationId, occurrenceId, stepId, status },
            ])
          : occ,
      ),
    );
    setExpanded((prev) => {
      const occ = occurrences.find((o) => o.id === occurrenceId);
      if (!occ) return prev;
      const projected = reconcileOccurrence(occ, [{ mutationId, occurrenceId, stepId, status }]);
      return { ...prev, [occurrenceId]: !projected.completed ? true : prev[occurrenceId] };
    });

    const nextOutbox = await enqueueOutbox(item);
    setOutbox(nextOutbox);

    if (!online) return;
    void flushOutbox();
  }

  const pendingCount = outbox.filter((i) => i.state !== "rejected").length;
  const rejected = outbox.filter((i) => i.state === "rejected");

  if (!session) {
    return (
      <div className="app-shell">
        <div className="eval-banner" role="status">
          {banner || "EVALUATION BUILD — not secure individual login."}
        </div>
        <h1>Choose evaluation profile</h1>
        <p className="meta">
          This selector creates a temporary server session for local testing. It does not authenticate
          a person.
        </p>
        <div className="profile-grid">
          {members.map((m) => (
            <button key={m.id} type="button" onClick={() => void selectProfile(m.id)}>
              <strong>{m.displayName}</strong>
              <div className="meta">{m.capabilities.join(", ")}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const isParent = session.member.capabilities.includes("manage_routine");
  const visibleOccurrences = occurrences.map((occ) =>
    reconcileOccurrence(
      occ,
      outbox.map((o) => ({
        mutationId: o.mutationId,
        occurrenceId: o.occurrenceId,
        stepId: o.stepId,
        status: o.status,
      })),
    ),
  );

  return (
    <div className="app-shell">
      <div className="eval-banner" role="status">
        {banner || "EVALUATION BUILD — not secure individual login."}
      </div>
      <div className="topbar">
        <div>
          <strong>{session.member.displayName}</strong>
          <div className="meta">
            Household date {householdDate} · {session.householdTimezone}
          </div>
        </div>
        <button type="button" className="ghost" onClick={() => void signOut()}>
          Switch profile
        </button>
      </div>

      <div className="status-line" aria-live="polite">
        <span className="status-pill" data-kind={connection === "offline" ? "offline" : "online"}>
          {connection === "offline" ? "Offline" : connection === "reconnecting" ? "Reconnecting" : "Online"}
        </span>
        {pendingCount > 0 ? (
          <span className="status-pill" data-kind="pending">
            {pendingCount} pending
          </span>
        ) : null}
        {rejected.map((r) => (
          <span key={r.mutationId} className="status-pill" data-kind="error">
            Rejected: {r.errorMessage ?? "error"}
          </span>
        ))}
        {error ? (
          <span className="status-pill" data-kind="error">
            {error}
          </span>
        ) : null}
      </div>

      <nav className="nav" aria-label="Primary">
        <button type="button" aria-current={tab === "today" ? "page" : undefined} onClick={() => setTab("today")}>
          Today
        </button>
        {isParent ? (
          <>
            <button
              type="button"
              aria-current={tab === "routine" ? "page" : undefined}
              onClick={() => setTab("routine")}
            >
              Routine
            </button>
            <button
              type="button"
              aria-current={tab === "history" ? "page" : undefined}
              onClick={() => setTab("history")}
            >
              History
            </button>
          </>
        ) : null}
      </nav>

      {tab === "today" ? (
        <TodayView
          isParent={isParent}
          occurrences={visibleOccurrences}
          expanded={expanded}
          setExpanded={setExpanded}
          onStepChange={queueStepChange}
          canExecute={!isParent}
        />
      ) : null}
      {tab === "routine" && isParent ? (
        <RoutineEditor
          members={members}
          onSaved={() => void refreshToday()}
        />
      ) : null}
      {tab === "history" && isParent ? <HistoryView /> : null}
    </div>
  );
}

function TodayView(props: {
  isParent: boolean;
  occurrences: OccurrenceView[];
  expanded: Record<string, boolean>;
  setExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
  onStepChange: (occurrenceId: string, stepId: string, status: StepStatus) => void;
  canExecute: boolean;
}) {
  if (props.occurrences.length === 0) {
    return (
      <div className="panel">
        <h1>Today</h1>
        <p>
          {props.isParent
            ? "No Morning Routine occurrences for this household date yet. Create a routine that includes today."
            : "No Morning Routine for you on this household date."}
        </p>
      </div>
    );
  }

  return (
    <section>
      <h1>{props.isParent ? "Household progress" : "Morning Routine"}</h1>
      {props.occurrences.map((occ) => {
        const open = props.expanded[occ.id] ?? !occ.completed;
        return (
          <article
            key={occ.id}
            className={`occurrence ${occ.completed ? "completed" : ""}`}
            data-testid={`occurrence-${occ.id}`}
            data-completed={occ.completed ? "true" : "false"}
          >
            <button
              type="button"
              className="occurrence-header"
              aria-expanded={open}
              onClick={() =>
                props.setExpanded((prev) => ({ ...prev, [occ.id]: !open }))
              }
            >
              <div>
                <h2>{occ.title}</h2>
                <div className="meta">
                  {occ.accountableMemberName} · {occ.householdDate} · Morning
                  {" · "}
                  {occ.completed ? "Complete" : "In progress"}
                </div>
              </div>
              <span aria-hidden="true">{open ? "▾" : "▸"}</span>
            </button>
            {open ? (
              <ul className="checklist">
                {occ.steps.map((step) => (
                  <li key={step.id} className="step" data-testid={`step-${step.id}`}>
                    <div className="step-title">
                      <strong>{step.text}</strong>
                      <span className="obligation">{obligationLabel(step.obligation)}</span>
                    </div>
                    <div className="meta" data-testid={`step-status-${step.id}`}>
                      Status: {statusLabel(step.status)}
                    </div>
                    {props.canExecute ? (
                      <div className="step-actions">
                        <button
                          type="button"
                          aria-pressed={step.status === "open"}
                          aria-label={`Mark ${step.text} open`}
                          onClick={() => props.onStepChange(occ.id, step.id, "open")}
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          aria-pressed={step.status === "completed"}
                          aria-label={`Mark ${step.text} completed`}
                          onClick={() => props.onStepChange(occ.id, step.id, "completed")}
                        >
                          Done
                        </button>
                        {step.obligation === "as_needed" ? (
                          <button
                            type="button"
                            aria-pressed={step.status === "not_needed"}
                            aria-label={`Mark ${step.text} not needed today`}
                            onClick={() => props.onStepChange(occ.id, step.id, "not_needed")}
                          >
                            Not needed
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <p className="meta">Observation only — parent cannot complete child steps here.</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}

function RoutineEditor(props: { members: MemberPublic[]; onSaved: () => void }) {
  const children = props.members.filter((m) =>
    m.capabilities.includes("execute_own_occurrence"),
  );
  const [title, setTitle] = useState("Morning Routine");
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [assignees, setAssignees] = useState<string[]>(children.map((c) => c.id));
  const [steps, setSteps] = useState<Array<{ text: string; obligation: ObligationMeaning }>>([
    { text: "Make bed", obligation: "required" },
    { text: "Pack lunch", obligation: "as_needed" },
    { text: "Stretch", obligation: "optional" },
  ]);
  const [definitionId, setDefinitionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchRoutine().then((data) => {
      if (!data.routine) return;
      setDefinitionId(data.routine.id);
      const latest = data.routine.revisions[data.routine.revisions.length - 1];
      if (!latest) return;
      setTitle(latest.title);
      setWeekdays(latest.weekdays);
      setAssignees(latest.assigneeMemberIds);
      setSteps(latest.steps.map((s) => ({ text: s.text, obligation: s.obligation })));
    });
  }, []);

  async function save() {
    setError(null);
    setMessage(null);
    try {
      if (!definitionId) {
        const result = await createRoutine({
          title,
          assigneeMemberIds: assignees,
          weekdays,
          steps,
        });
        const id = (result.routine as { id: string }).id;
        setDefinitionId(id);
        setMessage("Routine created for today onward.");
      } else {
        await createRevision(definitionId, {
          title,
          assigneeMemberIds: assignees,
          weekdays,
          steps,
        });
        setMessage("Future revision scheduled for the next household day.");
      }
      props.onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="panel">
      <h1>Morning Routine</h1>
      <p className="meta">
        First save creates the definition effective today. Later saves append a revision effective no
        earlier than tomorrow.
      </p>
      <div className="form-grid">
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <fieldset>
          <legend>Weekdays</legend>
          <div className="weekday-row">
            {WEEKDAYS.map((d) => (
              <label key={d.value}>
                <input
                  type="checkbox"
                  checked={weekdays.includes(d.value)}
                  onChange={(e) => {
                    setWeekdays((prev) =>
                      e.target.checked ? [...prev, d.value] : prev.filter((x) => x !== d.value),
                    );
                  }}
                />
                {d.label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Children</legend>
          <div className="assignee-row">
            {children.map((c) => (
              <label key={c.id}>
                <input
                  type="checkbox"
                  checked={assignees.includes(c.id)}
                  onChange={(e) => {
                    setAssignees((prev) =>
                      e.target.checked ? [...prev, c.id] : prev.filter((x) => x !== c.id),
                    );
                  }}
                />
                {c.displayName}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <h2>Steps</h2>
          {steps.map((step, index) => (
            <div className="step-editor" key={index}>
              <label>
                Text
                <input
                  value={step.text}
                  onChange={(e) => {
                    const next = [...steps];
                    next[index] = { ...step, text: e.target.value };
                    setSteps(next);
                  }}
                />
              </label>
              <label>
                Obligation
                <select
                  value={step.obligation}
                  onChange={(e) => {
                    const next = [...steps];
                    next[index] = {
                      ...step,
                      obligation: e.target.value as ObligationMeaning,
                    };
                    setSteps(next);
                  }}
                >
                  <option value="required">Required</option>
                  <option value="as_needed">As needed</option>
                  <option value="optional">Optional</option>
                </select>
              </label>
            </div>
          ))}
          <button
            type="button"
            className="secondary"
            onClick={() => setSteps((s) => [...s, { text: "New step", obligation: "optional" }])}
          >
            Add step
          </button>
        </div>
        <button type="button" className="primary" onClick={() => void save()}>
          {definitionId ? "Schedule future revision" : "Create routine"}
        </button>
        {message ? <p role="status">{message}</p> : null}
        {error ? (
          <p role="alert" className="status-pill" data-kind="error">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function HistoryView() {
  const [date, setDate] = useState("");
  const [occurrences, setOccurrences] = useState<OccurrenceView[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchToday().then((data) => {
      setDate(data.householdDate);
      void load(data.householdDate);
    });
  }, []);

  async function load(d: string) {
    setError(null);
    try {
      const data = await fetchHistory(d);
      setOccurrences(data.occurrences);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="panel">
      <h1>Occurrence history</h1>
      <label>
        Household date
        <input
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            void load(e.target.value);
          }}
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      {occurrences.map((occ) => (
        <article key={occ.id} className="occurrence" style={{ marginTop: "1rem" }}>
          <div className="occurrence-header" style={{ cursor: "default" }}>
            <div>
              <h2>{occ.title}</h2>
              <div className="meta">
                {occ.accountableMemberName} · {occ.completed ? "Complete" : "Incomplete"}
              </div>
            </div>
          </div>
          <ul className="checklist">
            {occ.steps.map((step) => (
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
    </section>
  );
}
