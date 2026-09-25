import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import { DAYPART_LABELS } from "../domain/daypart";
import type {
  ResponsibilityOverviewRow,
  RoutineAggregateRow,
} from "../domain/household-overview";
import {
  claimDisplay,
  connectDisplaySync,
  fetchDisplayDashboard,
  fetchDisplayOccurrence,
  fetchDisplayPerson,
  fetchDisplaySession,
  type ApiError,
  type DisplayDashboard,
  type DisplayOccurrenceDetail,
  type DisplayPersonDetail,
  type DisplaySessionInfo,
} from "./display-api";

const DEFAULT_IDLE_MS = 90_000;
const STALE_MAX_MS = 60_000;
const POLL_MS = 30_000;
const CLOCK_TICK_MS = 15_000;

type Organization = "by-person" | "by-work";

type DetailState =
  | null
  | { kind: "person"; membershipId: string; originKey: string }
  | { kind: "occurrence"; occurrenceId: string; originKey: string }
  | {
      kind: "routine";
      aggregateKey: string;
      originKey: string;
    }
  | {
      kind: "routine-person";
      aggregateKey: string;
      occurrenceId: string;
      originKey: string;
    };

type AuthPhase = "loading" | "setup" | "authenticated" | "blank";

declare global {
  interface Window {
    __HD_DISPLAY_IDLE_MS?: number;
  }
}

function idleMs(): number {
  const override = window.__HD_DISPLAY_IDLE_MS;
  if (typeof override === "number" && override > 0) return override;
  return DEFAULT_IDLE_MS;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isUnauthorized(error: unknown): boolean {
  const apiError = error as ApiError;
  return apiError.status === 401 || apiError.code === "UNAUTHORIZED";
}

function formatClock(serverTimeIso: string, timezone: string, elapsedMs: number): {
  weekday: string;
  date: string;
  time: string;
} {
  const instant = new Date(new Date(serverTimeIso).getTime() + elapsedMs);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
  }).format(instant);
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(instant);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
  return { weekday, date, time };
}

function needsAssignmentRows(dashboard: DisplayDashboard): ResponsibilityOverviewRow[] {
  return dashboard.byWork.responsibilities.filter((row) => row.accountableMemberId === null);
}

export function DisplayApp() {
  const [authPhase, setAuthPhase] = useState<AuthPhase>("loading");
  const [session, setSession] = useState<DisplaySessionInfo | null>(null);
  const [dashboard, setDashboard] = useState<DisplayDashboard | null>(null);
  const [organization, setOrganization] = useState<Organization>("by-person");
  const [detail, setDetail] = useState<DetailState>(null);
  const [personDetail, setPersonDetail] = useState<DisplayPersonDetail | null>(null);
  const [occurrenceDetail, setOccurrenceDetail] =
    useState<DisplayOccurrenceDetail | null>(null);
  const [setupCode, setSetupCode] = useState("");
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [humanConflict, setHumanConflict] = useState(false);
  const [stale, setStale] = useState(false);
  const [blankReason, setBlankReason] = useState<string | null>(null);
  const [loadingDash, setLoadingDash] = useState(false);
  const [clockElapsedMs, setClockElapsedMs] = useState(0);
  const [syncStatus, setSyncStatus] = useState<
    "connected" | "disconnected" | "reconnecting"
  >("disconnected");

  const lastAuthorizedAtRef = useRef<number | null>(null);
  const accessLostRef = useRef(false);
  const dashGenRef = useRef(0);
  const detailGenRef = useRef(0);
  const bootstrappingRef = useRef(false);
  const detailRef = useRef(detail);
  const originFocusRef = useRef<string | null>(null);
  const lastUserInteractionRef = useRef(performance.now());

  detailRef.current = detail;

  function clearHouseholdState(reason?: string) {
    accessLostRef.current = true;
    lastAuthorizedAtRef.current = null;
    setDashboard(null);
    setPersonDetail(null);
    setOccurrenceDetail(null);
    setDetail(null);
    setSession(null);
    setStale(false);
    setBlankReason(reason ?? null);
    setAuthPhase("setup");
  }

  function markAuthorized() {
    lastAuthorizedAtRef.current = performance.now();
    accessLostRef.current = false;
    setStale(false);
    setBlankReason(null);
  }

  function withinFreshnessBound(requestStartedAt: number): boolean {
    if (accessLostRef.current) return false;
    const last = lastAuthorizedAtRef.current;
    if (last == null) {
      // Cold load: allow first successful reply
      return true;
    }
    // Reject replies whose request started outside the bound from last success,
    // and also reject if wall-clock since last success already exceeded.
    const now = performance.now();
    if (now - last > STALE_MAX_MS) return false;
    if (now - requestStartedAt > STALE_MAX_MS) return false;
    return true;
  }

  const refreshDashboard = useEffectEvent(async (opts?: { quiet?: boolean }) => {
    if (accessLostRef.current) return;
    const started = performance.now();
    const gen = ++dashGenRef.current;
    if (!opts?.quiet) setLoadingDash(true);
    try {
      const next = await fetchDisplayDashboard();
      if (gen !== dashGenRef.current) return;
      if (!withinFreshnessBound(started)) {
        setDashboard(null);
        setPersonDetail(null);
        setOccurrenceDetail(null);
        setAuthPhase("blank");
        setBlankReason("Display data expired while offline.");
        return;
      }
      markAuthorized();
      setDashboard(next);
      setAuthPhase("authenticated");
      setClockElapsedMs(0);
    } catch (error) {
      if (isUnauthorized(error)) {
        clearHouseholdState("Display access ended. Enter a new setup code.");
        return;
      }
      // Keep last snapshot; stale handling via timer
    } finally {
      if (gen === dashGenRef.current) setLoadingDash(false);
    }
  });

  const refreshDetail = useEffectEvent(async () => {
    const current = detailRef.current;
    if (!current || accessLostRef.current) return;
    const started = performance.now();
    const gen = ++detailGenRef.current;
    try {
      if (current.kind === "person") {
        const person = await fetchDisplayPerson(current.membershipId);
        if (gen !== detailGenRef.current || !withinFreshnessBound(started)) return;
        markAuthorized();
        setPersonDetail(person);
      } else if (current.kind === "occurrence" || current.kind === "routine-person") {
        const occurrence = await fetchDisplayOccurrence(current.occurrenceId);
        if (gen !== detailGenRef.current || !withinFreshnessBound(started)) return;
        markAuthorized();
        setOccurrenceDetail(occurrence);
      }
    } catch (error) {
      if (isUnauthorized(error)) {
        clearHouseholdState("Display access ended. Enter a new setup code.");
      }
    }
  });

  const bootstrap = useEffectEvent(async () => {
    if (bootstrappingRef.current) return;
    bootstrappingRef.current = true;
    setAuthPhase("loading");
    try {
      const nextSession = await fetchDisplaySession();
      if (!nextSession) {
        setAuthPhase("setup");
        return;
      }
      accessLostRef.current = false;
      markAuthorized();
      setSession(nextSession);
      setAuthPhase("authenticated");
      await refreshDashboard({ quiet: true });
    } catch {
      setAuthPhase("setup");
    } finally {
      bootstrappingRef.current = false;
    }
  });

  // Path trap: stay on /display without fetching member APIs.
  useEffect(() => {
    const trap = () => {
      const path = window.location.pathname;
      if (path !== "/display" && !path.startsWith("/display/")) {
        window.history.replaceState(null, "", "/display");
      }
    };
    trap();
    window.addEventListener("popstate", trap);
    return () => window.removeEventListener("popstate", trap);
  }, []);

  useEffect(() => {
    void bootstrap();
  }, []);

  // Live sync + poll while authenticated and visible.
  useEffect(() => {
    if (authPhase !== "authenticated") return;

    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void refreshDashboard({ quiet: true });
        void refreshDetail();
      }, 250);
    };

    const disconnect = connectDisplaySync((msg) => {
      if (msg.reason === "access_lost") {
        clearHouseholdState("Display access was revoked.");
        return;
      }
      scheduleRefresh();
    }, setSyncStatus);

    const poll = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      scheduleRefresh();
    }, POLL_MS);

    return () => {
      disconnect();
      window.clearInterval(poll);
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [authPhase]);

  // Clock tick from server instant + elapsed client time.
  useEffect(() => {
    if (authPhase !== "authenticated" || !dashboard) return;
    setClockElapsedMs(0);
    const tick = window.setInterval(() => {
      setClockElapsedMs((ms) => ms + CLOCK_TICK_MS);
    }, CLOCK_TICK_MS);
    return () => window.clearInterval(tick);
  }, [authPhase, dashboard?.serverTime, dashboard?.timezone]);

  // Stale / blank deadline while disconnected.
  useEffect(() => {
    if (authPhase !== "authenticated") return;
    const timer = window.setInterval(() => {
      const last = lastAuthorizedAtRef.current;
      if (last == null) return;
      const age = performance.now() - last;
      if (syncStatus === "disconnected" || syncStatus === "reconnecting") {
        if (age > STALE_MAX_MS) {
          setDashboard(null);
          setPersonDetail(null);
          setOccurrenceDetail(null);
          setDetail(null);
          setStale(false);
          setAuthPhase("blank");
          setBlankReason("Connection lost. Waiting to reconnect…");
        } else if (age > 5_000) {
          setStale(true);
        }
      } else {
        setStale(false);
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [authPhase, syncStatus]);

  // Visibility / resume: check stale deadline before restoring.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const last = lastAuthorizedAtRef.current;
      if (last != null && performance.now() - last > STALE_MAX_MS) {
        setDashboard(null);
        setPersonDetail(null);
        setOccurrenceDetail(null);
        setDetail(null);
        setAuthPhase("blank");
        setBlankReason("Display data expired while away.");
        void bootstrap();
        return;
      }
      if (authPhase === "authenticated" || authPhase === "blank") {
        void refreshDashboard({ quiet: true });
        void refreshDetail();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onVisibility);
    };
  }, [authPhase]);

  // Idle return from detail (user interaction only resets).
  useEffect(() => {
    if (!detail) return;
    lastUserInteractionRef.current = performance.now();
    const onInteract = () => {
      lastUserInteractionRef.current = performance.now();
    };
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    for (const event of events) {
      window.addEventListener(event, onInteract, { passive: true });
    }
    const timer = window.setInterval(() => {
      if (performance.now() - lastUserInteractionRef.current >= idleMs()) {
        const origin = detail.originKey;
        setDetail(null);
        setPersonDetail(null);
        setOccurrenceDetail(null);
        queueMicrotask(() => {
          document.getElementById(origin)?.focus();
        });
      }
    }, 500);
    return () => {
      for (const event of events) {
        window.removeEventListener(event, onInteract);
      }
      window.clearInterval(timer);
    };
  }, [detail]);

  // Restore focus when leaving detail.
  useEffect(() => {
    if (detail) return;
    if (originFocusRef.current) {
      document.getElementById(originFocusRef.current)?.focus();
      originFocusRef.current = null;
    }
  }, [detail]);

  async function submitClaim(event: FormEvent) {
    event.preventDefault();
    setSetupBusy(true);
    setSetupError(null);
    setHumanConflict(false);
    try {
      await claimDisplay(setupCode);
      accessLostRef.current = false;
      setSetupCode("");
      await bootstrap();
    } catch (error) {
      const apiError = error as ApiError;
      if (apiError.status === 409 || apiError.code === "CONFLICT") {
        setHumanConflict(true);
        setSetupError(null);
      } else {
        setSetupError(errorMessage(error));
      }
    } finally {
      setSetupBusy(false);
    }
  }

  function openDetail(next: DetailState, originElementId: string) {
    originFocusRef.current = originElementId;
    setDetail(next);
    setPersonDetail(null);
    setOccurrenceDetail(null);
    if (!next) return;
    if (next.kind === "person") {
      void fetchDisplayPerson(next.membershipId)
        .then((person) => {
          markAuthorized();
          setPersonDetail(person);
        })
        .catch((error) => {
          if (isUnauthorized(error)) clearHouseholdState();
        });
    } else if (next.kind === "occurrence" || next.kind === "routine-person") {
      void fetchDisplayOccurrence(next.occurrenceId)
        .then((occurrence) => {
          markAuthorized();
          setOccurrenceDetail(occurrence);
        })
        .catch((error) => {
          if (isUnauthorized(error)) clearHouseholdState();
        });
    }
  }

  function closeDetail() {
    setDetail(null);
    setPersonDetail(null);
    setOccurrenceDetail(null);
  }

  const clock =
    dashboard != null
      ? formatClock(dashboard.serverTime, dashboard.timezone, clockElapsedMs)
      : session != null
        ? formatClock(session.serverTime, session.timezone, clockElapsedMs)
        : null;

  return (
    <div className="display-shell" data-testid="display-shell">
      <header className="display-header">
        <div className="display-clock" data-testid="display-clock">
          {clock ? (
            <>
              <div className="display-weekday">{clock.weekday}</div>
              <div className="display-date">{clock.date}</div>
              <div className="display-time">{clock.time}</div>
            </>
          ) : (
            <div className="display-weekday">Household Display</div>
          )}
        </div>
        <p className="display-readonly-note" role="note">
          Read-only wall view. Completing work happens on personal devices.
        </p>
        {stale ? (
          <p className="display-stale" role="status">
            Offline — showing last update
          </p>
        ) : null}
      </header>

      {authPhase === "loading" ? (
        <p className="display-status" role="status">
          Checking display access…
        </p>
      ) : null}

      {authPhase === "blank" ? (
        <p className="display-status" role="status">
          {blankReason ?? "Waiting for display access…"}
        </p>
      ) : null}

      {authPhase === "setup" ? (
        <section className="display-setup" data-testid="display-setup">
          <h1 className="display-setup-title">Set up Household Dashboard</h1>
          <p className="display-setup-copy">
            Enter the setup code from Household → Displays on a manager&apos;s phone.
          </p>
          {humanConflict ? (
            <p className="display-alert" role="alert">
              Sign out of your household account first, or open this page in a separate
              browser or profile. Your personal session and pending changes are unchanged.
            </p>
          ) : null}
          <form className="display-setup-form" onSubmit={(event) => void submitClaim(event)}>
            <label className="display-setup-label">
              Setup code
              <input
                className="display-setup-input"
                name="code"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                value={setupCode}
                onChange={(event) => setSetupCode(event.target.value)}
                disabled={setupBusy}
                data-testid="display-claim-code"
              />
            </label>
            <button
              type="submit"
              className="display-setup-submit"
              disabled={setupBusy || setupCode.trim().length < 8}
            >
              {setupBusy ? "Connecting…" : "Connect display"}
            </button>
          </form>
          {setupError ? (
            <p className="display-alert" role="alert">
              {setupError}
            </p>
          ) : null}
        </section>
      ) : null}

      {authPhase === "authenticated" && dashboard ? (
        detail ? (
          <DisplayDetailPanel
            detail={detail}
            dashboard={dashboard}
            personDetail={personDetail}
            occurrenceDetail={occurrenceDetail}
            loading={loadingDash && !personDetail && !occurrenceDetail}
            onBack={closeDetail}
            onOpenOccurrence={(occurrenceId, originKey) =>
              openDetail({ kind: "occurrence", occurrenceId, originKey }, originKey)
            }
            onOpenRoutinePerson={(aggregateKey, occurrenceId, originKey) =>
              openDetail(
                { kind: "routine-person", aggregateKey, occurrenceId, originKey },
                originKey,
              )
            }
            onBackToRoutine={(aggregateKey, originKey) =>
              openDetail({ kind: "routine", aggregateKey, originKey }, originKey)
            }
          />
        ) : (
          <DisplayOverview
            dashboard={dashboard}
            organization={organization}
            loading={loadingDash}
            onOrganizationChange={setOrganization}
            onOpenPerson={(membershipId, originKey) =>
              openDetail({ kind: "person", membershipId, originKey }, originKey)
            }
            onOpenResponsibility={(occurrenceId, originKey) =>
              openDetail({ kind: "occurrence", occurrenceId, originKey }, originKey)
            }
            onOpenRoutine={(aggregateKey, originKey) =>
              openDetail({ kind: "routine", aggregateKey, originKey }, originKey)
            }
          />
        )
      ) : null}
    </div>
  );
}

function DisplayOverview(props: {
  dashboard: DisplayDashboard;
  organization: Organization;
  loading: boolean;
  onOrganizationChange: (next: Organization) => void;
  onOpenPerson: (membershipId: string, originKey: string) => void;
  onOpenResponsibility: (occurrenceId: string, originKey: string) => void;
  onOpenRoutine: (aggregateKey: string, originKey: string) => void;
}) {
  const unassigned = needsAssignmentRows(props.dashboard);

  return (
    <section className="display-overview" data-testid="display-overview">
      <div className="display-org-toggle" role="group" aria-label="Organization">
        <button
          type="button"
          className={
            props.organization === "by-person"
              ? "display-org-button active"
              : "display-org-button"
          }
          aria-pressed={props.organization === "by-person"}
          onClick={() => props.onOrganizationChange("by-person")}
          data-testid="display-org-by-person"
        >
          By person
        </button>
        <button
          type="button"
          className={
            props.organization === "by-work"
              ? "display-org-button active"
              : "display-org-button"
          }
          aria-pressed={props.organization === "by-work"}
          onClick={() => props.onOrganizationChange("by-work")}
          data-testid="display-org-by-work"
        >
          By work
        </button>
      </div>

      {props.loading ? (
        <p className="display-status" role="status">
          Updating…
        </p>
      ) : null}

      {props.organization === "by-person" ? (
        <>
          {unassigned.length > 0 ? (
            <div className="display-needs-assignment" data-testid="display-needs-assignment">
              <h2 className="display-section-title">Needs assignment</h2>
              <ul className="display-work-list">
                {unassigned.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      id={`display-unassigned-${row.id}`}
                      className="display-work-row"
                      onClick={() =>
                        props.onOpenResponsibility(row.id, `display-unassigned-${row.id}`)
                      }
                    >
                      <span className="display-work-title">{row.title}</span>
                      <span className="display-work-meta">
                        Unassigned · {row.state} · {row.progressLabel}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <ul className="display-person-list" data-testid="display-by-person">
            {props.dashboard.byPerson.map((person) => {
              const id = `display-person-${person.membershipId}`;
              return (
                <li key={person.membershipId}>
                  <button
                    type="button"
                    id={id}
                    className={`display-person-card ${
                      person.recurringState === "Complete" ? "completed-quiet" : ""
                    }`}
                    onClick={() => props.onOpenPerson(person.membershipId, id)}
                  >
                    <span className="display-person-name">{person.displayName}</span>
                    <span className="display-person-status">
                      {person.recurringState}
                      {person.progressLabel ? ` · ${person.progressLabel}` : ""}
                    </span>
                    {person.unfinished.length > 0 ? (
                      <span className="display-person-unfinished">
                        {person.unfinished
                          .slice(0, 3)
                          .map((item) => item.title)
                          .join(" · ")}
                        {person.unfinished.length > 3
                          ? ` · +${person.unfinished.length - 3} more`
                          : ""}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <DisplayByWork
          dashboard={props.dashboard}
          onOpenResponsibility={props.onOpenResponsibility}
          onOpenRoutine={props.onOpenRoutine}
        />
      )}
    </section>
  );
}

function DisplayByWork(props: {
  dashboard: DisplayDashboard;
  onOpenResponsibility: (occurrenceId: string, originKey: string) => void;
  onOpenRoutine: (aggregateKey: string, originKey: string) => void;
}) {
  const { responsibilities, routines } = props.dashboard.byWork;
  const unassigned = responsibilities.filter((row) => row.accountableMemberId === null);
  const assigned = responsibilities.filter((row) => row.accountableMemberId !== null);

  return (
    <div data-testid="display-by-work">
      {unassigned.length > 0 ? (
        <div className="display-needs-assignment">
          <h2 className="display-section-title">Needs assignment</h2>
          <ul className="display-work-list">
            {unassigned.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  id={`display-work-unassigned-${row.id}`}
                  className="display-work-row"
                  onClick={() =>
                    props.onOpenResponsibility(row.id, `display-work-unassigned-${row.id}`)
                  }
                >
                  <span className="display-work-title">{row.title}</span>
                  <span className="display-work-meta">
                    Unassigned · {row.state} · {row.progressLabel}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <h2 className="display-section-title">Responsibilities</h2>
      {assigned.length === 0 ? (
        <p className="display-empty">No responsibility progress to show right now.</p>
      ) : (
        <ul className="display-work-list">
          {assigned.map((row) => (
            <ResponsibilityRow
              key={row.id}
              row={row}
              onOpen={props.onOpenResponsibility}
            />
          ))}
        </ul>
      )}

      <h2 className="display-section-title">Routines</h2>
      {routines.length === 0 ? (
        <p className="display-empty">No routine progress to show right now.</p>
      ) : (
        <ul className="display-work-list">
          {routines.map((aggregate) => (
            <RoutineRow
              key={aggregate.key}
              aggregate={aggregate}
              onOpen={props.onOpenRoutine}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ResponsibilityRow(props: {
  row: ResponsibilityOverviewRow;
  onOpen: (occurrenceId: string, originKey: string) => void;
}) {
  const id = `display-resp-${props.row.id}`;
  return (
    <li>
      <button
        type="button"
        id={id}
        className={`display-work-row ${props.row.completed ? "completed-quiet" : ""}`}
        onClick={() => props.onOpen(props.row.id, id)}
      >
        <span className="display-work-title">{props.row.title}</span>
        <span className="display-work-meta">
          {props.row.accountableMemberName} · {props.row.state} · {props.row.progressLabel}
        </span>
      </button>
    </li>
  );
}

function RoutineRow(props: {
  aggregate: RoutineAggregateRow;
  onOpen: (aggregateKey: string, originKey: string) => void;
}) {
  const id = `display-routine-${props.aggregate.key}`;
  return (
    <li>
      <button
        type="button"
        id={id}
        className={`display-work-row ${
          props.aggregate.overallState === "Complete" ? "completed-quiet" : ""
        }`}
        onClick={() => props.onOpen(props.aggregate.key, id)}
      >
        <span className="display-work-title">{props.aggregate.displayTitle}</span>
        <span className="display-work-meta">
          {DAYPART_LABELS[props.aggregate.daypart] ?? props.aggregate.daypart} ·{" "}
          {props.aggregate.completedCount}/{props.aggregate.applicableCount} people ·{" "}
          {props.aggregate.overallState}
        </span>
      </button>
    </li>
  );
}

function DisplayDetailPanel(props: {
  detail: NonNullable<DetailState>;
  dashboard: DisplayDashboard;
  personDetail: DisplayPersonDetail | null;
  occurrenceDetail: DisplayOccurrenceDetail | null;
  loading: boolean;
  onBack: () => void;
  onOpenOccurrence: (occurrenceId: string, originKey: string) => void;
  onOpenRoutinePerson: (
    aggregateKey: string,
    occurrenceId: string,
    originKey: string,
  ) => void;
  onBackToRoutine: (aggregateKey: string, originKey: string) => void;
}) {
  return (
    <section className="display-detail" data-testid="display-detail">
      <button type="button" className="display-back" onClick={props.onBack}>
        Back
      </button>

      {props.detail.kind === "person" ? (
        props.personDetail ? (
          <PersonDetailView person={props.personDetail} onOpen={props.onOpenOccurrence} />
        ) : (
          <p className="display-status" role="status">
            Loading…
          </p>
        )
      ) : null}

      {props.detail.kind === "occurrence" || props.detail.kind === "routine-person" ? (
        props.occurrenceDetail ? (
          <OccurrenceDetailView
            occurrence={props.occurrenceDetail}
            onBackToRoutine={
              props.detail.kind === "routine-person"
                ? (() => {
                    const { aggregateKey, originKey } = props.detail;
                    return () => props.onBackToRoutine(aggregateKey, originKey);
                  })()
                : undefined
            }
          />
        ) : (
          <p className="display-status" role="status">
            Loading…
          </p>
        )
      ) : null}

      {props.detail.kind === "routine" ? (
        <RoutinePeopleView
          aggregate={props.dashboard.byWork.routines.find(
            (row) =>
              props.detail.kind === "routine" && row.key === props.detail.aggregateKey,
          )}
          onOpenPerson={props.onOpenRoutinePerson}
          onBack={props.onBack}
        />
      ) : null}
    </section>
  );
}

function PersonDetailView(props: {
  person: DisplayPersonDetail;
  onOpen: (occurrenceId: string, originKey: string) => void;
}) {
  return (
    <div>
      <h1 className="display-detail-title">{props.person.displayName}</h1>
      <h2 className="display-section-title">Recurring work</h2>
      {props.person.recurringWork.length === 0 ? (
        <p className="display-empty">No assigned work today</p>
      ) : (
        <ul className="display-work-list">
          {props.person.recurringWork.map((work) => {
            const id = `display-person-work-${work.occurrenceId}`;
            return (
              <li key={work.occurrenceId}>
                <button
                  type="button"
                  id={id}
                  className={`display-work-row ${work.completed ? "completed-quiet" : ""}`}
                  onClick={() => props.onOpen(work.occurrenceId, id)}
                >
                  <span className="display-work-title">{work.title}</span>
                  <span className="display-work-meta">
                    {work.state} · {work.progressLabel}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <h2 className="display-section-title">Household-visible tasks</h2>
      {props.person.householdVisibleTasks.length === 0 ? (
        <p className="display-empty">None right now.</p>
      ) : (
        <ul className="display-task-list">
          {props.person.householdVisibleTasks.map((task) => (
            <li
              key={task.id}
              className={task.status === "completed" ? "completed-quiet" : ""}
            >
              <span className="display-work-title">{task.title}</span>
              <span className="display-work-meta">{task.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OccurrenceDetailView(props: {
  occurrence: DisplayOccurrenceDetail;
  onBackToRoutine?: () => void;
}) {
  return (
    <div>
      {props.onBackToRoutine ? (
        <button type="button" className="display-back secondary" onClick={props.onBackToRoutine}>
          Back to routine
        </button>
      ) : null}
      <h1 className="display-detail-title">{props.occurrence.title}</h1>
      <p className="display-work-meta">
        {props.occurrence.accountableMemberName}
        {props.occurrence.accountableMemberId === null ? " · Needs assignment" : ""} ·{" "}
        {props.occurrence.state} · {props.occurrence.progressLabel}
      </p>
      <ol className="display-step-list">
        {props.occurrence.steps
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((step) => (
            <li
              key={step.id}
              className={step.status === "done" || step.status === "not_needed" ? "completed-quiet" : ""}
            >
              <span className="display-work-title">{step.text}</span>
              <span className="display-work-meta">
                {step.status}
                {step.source ? ` · ${step.source}` : ""}
              </span>
            </li>
          ))}
      </ol>
    </div>
  );
}

function RoutinePeopleView(props: {
  aggregate: RoutineAggregateRow | undefined;
  onOpenPerson: (
    aggregateKey: string,
    occurrenceId: string,
    originKey: string,
  ) => void;
  onBack: () => void;
}) {
  if (!props.aggregate) {
    return (
      <p className="display-status" role="status">
        That routine summary is no longer available.
        <button type="button" className="display-back" onClick={props.onBack}>
          Back
        </button>
      </p>
    );
  }
  return (
    <div>
      <h1 className="display-detail-title">{props.aggregate.displayTitle}</h1>
      <p className="display-work-meta">
        {props.aggregate.completedCount}/{props.aggregate.applicableCount} people ·{" "}
        {props.aggregate.overallState}
      </p>
      <ul className="display-work-list">
        {props.aggregate.people.map((person) => {
          const id = `display-routine-person-${person.occurrenceId}`;
          return (
            <li key={person.occurrenceId}>
              <button
                type="button"
                id={id}
                className={`display-work-row ${person.completed ? "completed-quiet" : ""}`}
                onClick={() =>
                  props.onOpenPerson(props.aggregate!.key, person.occurrenceId, id)
                }
              >
                <span className="display-person-name">{person.accountableMemberName}</span>
                <span className="display-work-meta">{person.state}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
