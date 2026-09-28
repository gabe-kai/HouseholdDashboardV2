import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import { DAYPART_LABELS } from "../domain/daypart";
import type {
  ResponsibilityOverviewRow,
  RoutineAggregateRow,
} from "../domain/household-overview";
import { formatStepProgress, stepProgressCounts, workState } from "../domain/progress";
import { isOccurrenceComplete } from "../domain/completion";
import type {
  IntendedStructure,
  ObligationMeaning,
  StepStatus,
} from "../shared/schemas";
import {
  claimDisplay,
  connectDisplaySync,
  fetchDisplayDashboard,
  fetchDisplayOccurrence,
  fetchDisplayPerson,
  fetchDisplaySession,
  setDisplayStepStatus,
  type ApiError,
  type DisplayDashboard,
  type DisplayOccurrenceDetail,
  type DisplayPersonDetail,
  type DisplaySessionInfo,
} from "./display-api";
import {
  clearDisplaySessionOutbox,
  patchDisplayOutboxItem,
  readDisplayOutbox,
  removeDisplayOutboxItem,
  replaceDesiredStateForStep,
  rejectedDisplayOutboxNotices,
  retireMismatchedDisplayOutbox,
  type DisplayOutboxItem,
} from "./display-outbox";
import { newClientId } from "./id";

const DEFAULT_IDLE_MS = 90_000;
const DEFAULT_STALE_MAX_MS = 60_000;
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

type PendingOverviewCue = {
  occurrenceId: string;
  title: string;
};

declare global {
  interface Window {
    __HD_DISPLAY_IDLE_MS?: number;
    /** Test override for disconnected/stale blank bound (default 60s). */
    __HD_DISPLAY_STALE_MS?: number;
    /** Test-only: mark sync disconnected and age last auth past the stale bound. */
    __HD_DISPLAY_FORCE_STALE__?: () => void;
    /** Test-only: close the live display sync WebSocket (reconnect may follow). */
    __HD_DISPLAY_CLOSE_SYNC__?: () => void;
    __HD_DISPLAY_RECONNECT_SYNC__?: () => void;
  }
}

function idleMs(): number {
  const override = window.__HD_DISPLAY_IDLE_MS;
  if (typeof override === "number" && override > 0) return override;
  return DEFAULT_IDLE_MS;
}

function staleMaxMs(): number {
  const override = window.__HD_DISPLAY_STALE_MS;
  if (typeof override === "number" && override > 0) return override;
  return DEFAULT_STALE_MAX_MS;
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

function statusLabel(status: string): string {
  if (status === "completed") return "Done";
  if (status === "not_needed") return "Not needed";
  if (status === "open") return "Open";
  return status;
}

function intendedStructureForOccurrence(
  occurrence: DisplayOccurrenceDetail,
): IntendedStructure | null {
  if (occurrence.intendedStructure) return occurrence.intendedStructure;
  if (!occurrence.accountableMemberId) return null;
  const stepLogicalIds = occurrence.steps
    .map((step) => step.logicalItemId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (stepLogicalIds.length === 0) return null;
  return {
    revisionId: occurrence.revisionId,
    accountableMemberId: occurrence.accountableMemberId,
    stepLogicalIds,
  };
}

function applyOptimisticStepStatus(
  occurrence: DisplayOccurrenceDetail,
  stepId: string,
  status: StepStatus,
): DisplayOccurrenceDetail {
  const steps = occurrence.steps.map((step) =>
    step.id === stepId ? { ...step, status } : step,
  );
  const completed = isOccurrenceComplete(
    steps.map((step) => ({
      obligation: step.obligation as ObligationMeaning,
      status: step.status as StepStatus,
    })),
  );
  const progress = stepProgressCounts(steps);
  return {
    ...occurrence,
    steps,
    completed,
    state: workState({ completed, startedAt: null, steps }),
    progress,
    progressLabel: formatStepProgress(progress),
  };
}

function stepFeedback(
  outbox: DisplayOutboxItem[],
  occurrenceId: string,
  stepId: string,
): { kind: "pending" | "error"; text: string } | null {
  const items = outbox.filter(
    (item) => item.occurrenceId === occurrenceId && item.stepId === stepId,
  );
  const rejected = [...items].reverse().find((item) => item.state === "rejected");
  if (rejected) {
    return {
      kind: "error",
      text: rejected.errorMessage ?? "Could not save this change.",
    };
  }
  const active = items.find(
    (item) => item.state === "pending" || item.state === "retrying",
  );
  if (active) {
    return {
      kind: "pending",
      text: active.state === "retrying" ? "Saving…" : "Pending…",
    };
  }
  return null;
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
  const [outbox, setOutbox] = useState<DisplayOutboxItem[]>([]);
  const [pendingCue, setPendingCue] = useState<PendingOverviewCue | null>(null);
  const [retiredNotices, setRetiredNotices] = useState<
    Array<{ mutationId: string; message: string }>
  >([]);
  const [savedFlashByStep, setSavedFlashByStep] = useState<Record<string, number>>({});

  const lastAuthorizedAtRef = useRef<number | null>(null);
  const accessLostRef = useRef(false);
  const dashGenRef = useRef(0);
  const detailGenRef = useRef(0);
  const bootstrappingRef = useRef(false);
  const detailRef = useRef(detail);
  const originFocusRef = useRef<string | null>(null);
  const lastUserInteractionRef = useRef(performance.now());
  const householdDateRef = useRef<string | null>(null);
  /** Display CSRF — memory only; never localStorage. */
  const csrfTokenRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionRef = useRef<DisplaySessionInfo | null>(null);
  const outboxRef = useRef<DisplayOutboxItem[]>([]);
  const flushInFlightRef = useRef(false);
  const flushAgainRef = useRef(false);
  const occurrenceDetailRef = useRef<DisplayOccurrenceDetail | null>(null);

  detailRef.current = detail;
  sessionRef.current = session;
  outboxRef.current = outbox;
  occurrenceDetailRef.current = occurrenceDetail;

  function rememberSessionSecrets(next: DisplaySessionInfo | null) {
    csrfTokenRef.current = next?.csrfToken ?? null;
    sessionIdRef.current = next?.sessionId ?? null;
  }

  async function retireSessionOutbox(sessionId: string | null) {
    if (!sessionId) return;
    await clearDisplaySessionOutbox(sessionId);
    if (sessionIdRef.current === sessionId) {
      outboxRef.current = [];
      setOutbox([]);
    }
  }

  function clearHouseholdState(reason?: string) {
    const retiringSessionId = sessionIdRef.current;
    accessLostRef.current = true;
    lastAuthorizedAtRef.current = null;
    householdDateRef.current = null;
    rememberSessionSecrets(null);
    setDashboard(null);
    setPersonDetail(null);
    setOccurrenceDetail(null);
    setDetail(null);
    setSession(null);
    setOutbox([]);
    outboxRef.current = [];
    setPendingCue(null);
    setRetiredNotices([]);
    setSavedFlashByStep({});
    setStale(false);
    setBlankReason(reason ?? null);
    setAuthPhase("setup");
    void retireSessionOutbox(retiringSessionId);
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
    const bound = staleMaxMs();
    if (now - last > bound) return false;
    if (now - requestStartedAt > bound) return false;
    return true;
  }

  /** New taps only while an authorized in-memory view remains within the C-2 lease. */
  function actionsAllowed(): boolean {
    if (accessLostRef.current) return false;
    if (authPhase !== "authenticated") return false;
    if (!csrfTokenRef.current || !sessionIdRef.current) return false;
    const last = lastAuthorizedAtRef.current;
    if (last == null) return false;
    return performance.now() - last <= staleMaxMs();
  }

  const loadOutboxForSession = useEffectEvent(async (sessionId: string) => {
    const items = await readDisplayOutbox(sessionId);
    if (sessionIdRef.current !== sessionId) return;
    outboxRef.current = items;
    setOutbox(items);
    const notices = rejectedDisplayOutboxNotices(items);
    if (notices.length > 0) {
      setRetiredNotices((current) => {
        const seen = new Set(current.map((n) => n.mutationId));
        return [
          ...current,
          ...notices.filter((n) => !seen.has(n.mutationId)),
        ];
      });
    }
  });

  const flushDisplayOutbox = useEffectEvent(async () => {
    const sessionId = sessionIdRef.current;
    const csrf = csrfTokenRef.current;
    const currentSession = sessionRef.current;
    if (!sessionId || !csrf || !currentSession) return;
    if (flushInFlightRef.current) {
      flushAgainRef.current = true;
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    flushInFlightRef.current = true;
    flushAgainRef.current = false;
    try {
      let items = await readDisplayOutbox(sessionId);
      if (sessionIdRef.current !== sessionId) return;
      outboxRef.current = items;
      setOutbox(items);

      for (const item of items) {
        if (sessionIdRef.current !== sessionId || item.state === "rejected") continue;
        items = await patchDisplayOutboxItem(sessionId, item.mutationId, {
          state: "retrying",
        });
        if (sessionIdRef.current === sessionId) {
          outboxRef.current = items;
          setOutbox(items);
        }
        try {
          const result = await setDisplayStepStatus(
            item.occurrenceId,
            item.stepId,
            {
              mutationId: item.mutationId,
              status: item.status,
              performedAt: item.performedAt,
              activityGeneration: item.activityGeneration,
              ...(item.kind ? { kind: item.kind } : {}),
              householdDate: item.householdDate,
              intendedStructure: item.intendedStructure,
            },
            csrf,
          );
          if (sessionIdRef.current !== sessionId) return;
          items = await removeDisplayOutboxItem(sessionId, item.mutationId);
          outboxRef.current = items;
          setOutbox(items);
          markAuthorized();
          if (
            occurrenceDetailRef.current?.id === result.occurrence.id ||
            detailRef.current?.kind === "occurrence" ||
            detailRef.current?.kind === "routine-person"
          ) {
            const pendingForOcc = items.filter(
              (entry) =>
                entry.occurrenceId === result.occurrence.id &&
                entry.state !== "rejected",
            );
            let nextOccurrence = result.occurrence;
            for (const pending of pendingForOcc) {
              nextOccurrence = applyOptimisticStepStatus(
                nextOccurrence,
                pending.stepId,
                pending.status,
              );
            }
            setOccurrenceDetail(nextOccurrence);
          }
          setSavedFlashByStep((current) => ({
            ...current,
            [`${item.occurrenceId}:${item.stepId}`]: Date.now(),
          }));
        } catch (caught) {
          if (sessionIdRef.current !== sessionId) return;
          const code = (caught as ApiError).code;
          const message = errorMessage(caught);
          if (isUnauthorized(caught)) {
            clearHouseholdState("Display access ended. Enter a new setup code.");
            return;
          }
          const rejected =
            code === "VALIDATION" || code === "FORBIDDEN" || code === "NOT_FOUND" ||
            code === "CONFLICT";
          items = await patchDisplayOutboxItem(sessionId, item.mutationId, {
            state: rejected ? "rejected" : "pending",
            errorMessage: message,
          });
          outboxRef.current = items;
          setOutbox(items);
          if (rejected) continue;
          break;
        }
      }
      await refreshDashboard({ quiet: true });
      await refreshDetail();
    } finally {
      flushInFlightRef.current = false;
      if (flushAgainRef.current) {
        flushAgainRef.current = false;
        void flushDisplayOutbox();
      }
    }
  });

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
      const previousDate = householdDateRef.current;
      const dateChanged =
        previousDate != null && previousDate !== next.householdDate;
      const sessionId = sessionIdRef.current;
      if (sessionId) {
        const before = outboxRef.current;
        const retired = await retireMismatchedDisplayOutbox(sessionId, {
          activityGeneration: next.activityGeneration,
          householdDate: next.householdDate,
        });
        if (sessionIdRef.current === sessionId) {
          outboxRef.current = retired;
          setOutbox(retired);
          const newlyRejected = rejectedDisplayOutboxNotices(retired).filter(
            (notice) =>
              before.some(
                (item) =>
                  item.mutationId === notice.mutationId &&
                  item.state !== "rejected",
              ),
          );
          if (newlyRejected.length > 0) {
            setRetiredNotices((current) => {
              const seen = new Set(current.map((n) => n.mutationId));
              return [
                ...current,
                ...newlyRejected.filter((n) => !seen.has(n.mutationId)),
              ];
            });
            setPendingCue(null);
          }
        }
      }
      if (dateChanged) {
        // Close old-day detail before applying the new date/work snapshot.
        setDetail(null);
        setPersonDetail(null);
        setOccurrenceDetail(null);
        // Keep retiredNotices; clear only the pending (still-retryable) cue.
        setPendingCue(null);
      }
      householdDateRef.current = next.householdDate;
      setDashboard(next);
      setSession((current) =>
        current
          ? {
              ...current,
              householdDate: next.householdDate,
              serverTime: next.serverTime,
              activityGeneration: next.activityGeneration,
            }
          : current,
      );
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
        const pendingForOcc = outboxRef.current.filter(
          (item) =>
            item.occurrenceId === occurrence.id && item.state !== "rejected",
        );
        let nextOccurrence = occurrence;
        for (const pending of pendingForOcc) {
          nextOccurrence = applyOptimisticStepStatus(
            nextOccurrence,
            pending.stepId,
            pending.status,
          );
        }
        setOccurrenceDetail(nextOccurrence);
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
        rememberSessionSecrets(null);
        setAuthPhase("setup");
        return;
      }
      accessLostRef.current = false;
      rememberSessionSecrets(nextSession);
      markAuthorized();
      setSession(nextSession);
      setAuthPhase("authenticated");
      await loadOutboxForSession(nextSession.sessionId);
      await refreshDashboard({ quiet: true });
      void flushDisplayOutbox();
    } catch {
      rememberSessionSecrets(null);
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

  useEffect(() => {
    window.__HD_DISPLAY_FORCE_STALE__ = () => {
      lastAuthorizedAtRef.current = performance.now() - staleMaxMs() - 1;
      setSyncStatus("disconnected");
    };
    return () => {
      delete window.__HD_DISPLAY_FORCE_STALE__;
    };
  }, []);

  // Clear "Saved" flash after a short window.
  useEffect(() => {
    const keys = Object.keys(savedFlashByStep);
    if (keys.length === 0) return;
    const timer = window.setTimeout(() => {
      const cutoff = Date.now() - 2_500;
      setSavedFlashByStep((current) => {
        const next: Record<string, number> = {};
        for (const [key, at] of Object.entries(current)) {
          if (at >= cutoff) next[key] = at;
        }
        return next;
      });
    }, 2_600);
    return () => window.clearTimeout(timer);
  }, [savedFlashByStep]);

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

    const sync = connectDisplaySync((msg) => {
      if (msg.reason === "access_lost") {
        clearHouseholdState("Display access was revoked.");
        return;
      }
      if (msg.reason === "reset") {
        void refreshDashboard({ quiet: true }).then(() => flushDisplayOutbox());
        return;
      }
      scheduleRefresh();
      void flushDisplayOutbox();
    }, setSyncStatus);
    window.__HD_DISPLAY_CLOSE_SYNC__ = () => sync.dropSocket();
    window.__HD_DISPLAY_RECONNECT_SYNC__ = () => sync.reconnectNow();

    const poll = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      scheduleRefresh();
    }, POLL_MS);

    return () => {
      delete window.__HD_DISPLAY_CLOSE_SYNC__;
      delete window.__HD_DISPLAY_RECONNECT_SYNC__;
      sync.disconnect();
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
    const onOffline = () => {
      setSyncStatus("disconnected");
      setStale(true);
    };
    const onOnline = () => {
      setSyncStatus("reconnecting");
      void flushDisplayOutbox();
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setSyncStatus("disconnected");
      setStale(true);
    }
    const timer = window.setInterval(() => {
      const last = lastAuthorizedAtRef.current;
      if (last == null) return;
      const age = performance.now() - last;
      const offline =
        syncStatus === "disconnected" ||
        syncStatus === "reconnecting" ||
        (typeof navigator !== "undefined" && navigator.onLine === false);
      if (offline) {
        const bound = staleMaxMs();
        if (age > bound) {
          setDashboard(null);
          setPersonDetail(null);
          setOccurrenceDetail(null);
          setDetail(null);
          setStale(false);
          setAuthPhase("blank");
          setBlankReason("Connection lost. Waiting to reconnect…");
        } else if (age > Math.min(5_000, bound / 2)) {
          setStale(true);
        }
      } else {
        setStale(false);
      }
    }, 500);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      window.clearInterval(timer);
    };
  }, [authPhase, syncStatus]);

  // Visibility / resume: check stale deadline before restoring; flush pending.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const last = lastAuthorizedAtRef.current;
      if (last != null && performance.now() - last > staleMaxMs()) {
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
        void flushDisplayOutbox();
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
  // Unresolved pending commands leave an overview cue with a way back.
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
        const leaving = detailRef.current;
        const origin = leaving?.originKey;
        let cue: PendingOverviewCue | null = null;
        if (
          leaving &&
          (leaving.kind === "occurrence" || leaving.kind === "routine-person")
        ) {
          const pendingForOcc = outboxRef.current.filter(
            (item) =>
              item.occurrenceId === leaving.occurrenceId &&
              (item.state === "pending" || item.state === "retrying"),
          );
          if (pendingForOcc.length > 0) {
            cue = {
              occurrenceId: leaving.occurrenceId,
              title: occurrenceDetailRef.current?.title ?? "Assigned work",
            };
          }
        }
        setPendingCue(cue);
        setDetail(null);
        setPersonDetail(null);
        setOccurrenceDetail(null);
        queueMicrotask(() => {
          if (origin) document.getElementById(origin)?.focus();
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
    setPendingCue(null);
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
          const pendingForOcc = outboxRef.current.filter(
            (item) =>
              item.occurrenceId === occurrence.id && item.state !== "rejected",
          );
          let nextOccurrence = occurrence;
          for (const pending of pendingForOcc) {
            nextOccurrence = applyOptimisticStepStatus(
              nextOccurrence,
              pending.stepId,
              pending.status,
            );
          }
          setOccurrenceDetail(nextOccurrence);
        })
        .catch((error) => {
          if (isUnauthorized(error)) clearHouseholdState();
        });
    }
  }

  function closeDetail() {
    const leaving = detailRef.current;
    if (
      leaving &&
      (leaving.kind === "occurrence" || leaving.kind === "routine-person")
    ) {
      const pendingForOcc = outboxRef.current.filter(
        (item) =>
          item.occurrenceId === leaving.occurrenceId &&
          (item.state === "pending" || item.state === "retrying"),
      );
      if (pendingForOcc.length > 0) {
        setPendingCue({
          occurrenceId: leaving.occurrenceId,
          title: occurrenceDetailRef.current?.title ?? "Assigned work",
        });
      }
    }
    setDetail(null);
    setPersonDetail(null);
    setOccurrenceDetail(null);
  }

  async function queueDisplayStepChange(
    occurrence: DisplayOccurrenceDetail,
    stepId: string,
    status: StepStatus,
  ) {
    if (!actionsAllowed()) return;
    const currentSession = sessionRef.current;
    const sessionId = sessionIdRef.current;
    const csrf = csrfTokenRef.current;
    if (!currentSession || !sessionId || !csrf) return;
    if (occurrence.accountableMemberId == null) return;
    const intendedStructure = intendedStructureForOccurrence(occurrence);
    if (!intendedStructure) return;

    const item: DisplayOutboxItem = {
      mutationId: newClientId(),
      occurrenceId: occurrence.id,
      stepId,
      status,
      performedAt: new Date().toISOString(),
      activityGeneration: currentSession.activityGeneration,
      kind: occurrence.kind,
      householdDate: occurrence.householdDate,
      intendedStructure,
      displaySessionId: sessionId,
      displayId: currentSession.displayId,
      householdId: currentSession.householdId,
      state: "pending",
    };

    setOccurrenceDetail((current) =>
      current && current.id === occurrence.id
        ? applyOptimisticStepStatus(current, stepId, status)
        : current,
    );
    setSavedFlashByStep((current) => {
      const next = { ...current };
      delete next[`${occurrence.id}:${stepId}`];
      return next;
    });

    const next = await replaceDesiredStateForStep(sessionId, item);
    if (sessionIdRef.current !== sessionId) return;
    outboxRef.current = next;
    setOutbox(next);
    if (typeof navigator === "undefined" || navigator.onLine) {
      void flushDisplayOutbox();
    }
  }

  const clock =
    dashboard != null
      ? formatClock(dashboard.serverTime, dashboard.timezone, clockElapsedMs)
      : session != null
        ? formatClock(session.serverTime, session.timezone, clockElapsedMs)
        : null;

  const canAct = actionsAllowed();

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
          Shared wall checklist. Tap Done, Not needed, or Open on assigned work —
          phones and Household stay in sync.
        </p>
        {stale ? (
          <p className="display-stale" role="status">
            Offline — showing last update
          </p>
        ) : null}
        {outbox.some((item) => item.state === "pending" || item.state === "retrying") ? (
          <p className="display-stale" role="status">
            <span className="status-pill" data-kind="pending">
              Saving checklist changes…
            </span>
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
            outbox={outbox}
            savedFlashByStep={savedFlashByStep}
            canAct={canAct}
            loading={loadingDash && !personDetail && !occurrenceDetail}
            onBack={closeDetail}
            onStepChange={(occurrence, stepId, status) =>
              void queueDisplayStepChange(occurrence, stepId, status)
            }
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
            pendingCue={pendingCue}
            retiredNotices={retiredNotices}
            onDismissRetiredNotice={(mutationId) => {
              setRetiredNotices((current) =>
                current.filter((n) => n.mutationId !== mutationId),
              );
              const sessionId = sessionIdRef.current;
              if (!sessionId) return;
              void removeDisplayOutboxItem(sessionId, mutationId).then((next) => {
                if (sessionIdRef.current !== sessionId) return;
                outboxRef.current = next;
                setOutbox(next);
              });
            }}
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
            onOpenPendingCue={(occurrenceId) =>
              openDetail(
                { kind: "occurrence", occurrenceId, originKey: "display-pending-cue" },
                "display-pending-cue",
              )
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
  pendingCue: PendingOverviewCue | null;
  retiredNotices: Array<{ mutationId: string; message: string }>;
  onDismissRetiredNotice: (mutationId: string) => void;
  onOrganizationChange: (next: Organization) => void;
  onOpenPerson: (membershipId: string, originKey: string) => void;
  onOpenResponsibility: (occurrenceId: string, originKey: string) => void;
  onOpenRoutine: (aggregateKey: string, originKey: string) => void;
  onOpenPendingCue: (occurrenceId: string) => void;
}) {
  const unassigned = needsAssignmentRows(props.dashboard);

  return (
    <section className="display-overview" data-testid="display-overview">
      {props.retiredNotices.length > 0 ? (
        <div
          className="display-retired-notices"
          role="status"
          data-testid="display-retired-notices"
        >
          {props.retiredNotices.map((notice) => (
            <div
              key={notice.mutationId}
              className="display-retired-notice"
              data-testid="display-retired-notice"
            >
              <p className="display-work-meta">{notice.message}</p>
              <button
                type="button"
                className="display-work-row"
                onClick={() => props.onDismissRetiredNotice(notice.mutationId)}
                data-testid={`display-retired-dismiss-${notice.mutationId}`}
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {props.pendingCue ? (
        <div className="display-pending-cue" role="status">
          <p className="display-work-meta">
            Checklist changes still pending for {props.pendingCue.title}.
          </p>
          <button
            type="button"
            id="display-pending-cue"
            className="display-work-row"
            onClick={() => props.onOpenPendingCue(props.pendingCue!.occurrenceId)}
            data-testid="display-pending-cue"
          >
            Return to {props.pendingCue.title}
          </button>
        </div>
      ) : null}

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
  outbox: DisplayOutboxItem[];
  savedFlashByStep: Record<string, number>;
  canAct: boolean;
  loading: boolean;
  onBack: () => void;
  onStepChange: (
    occurrence: DisplayOccurrenceDetail,
    stepId: string,
    status: StepStatus,
  ) => void;
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
            outbox={props.outbox}
            savedFlashByStep={props.savedFlashByStep}
            canAct={props.canAct}
            onStepChange={props.onStepChange}
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
  outbox: DisplayOutboxItem[];
  savedFlashByStep: Record<string, number>;
  canAct: boolean;
  onStepChange: (
    occurrence: DisplayOccurrenceDetail,
    stepId: string,
    status: StepStatus,
  ) => void;
  onBackToRoutine?: () => void;
}) {
  const needsAssignment = props.occurrence.accountableMemberId === null;
  const executable = props.canAct && !needsAssignment;

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
        {needsAssignment ? " · Needs assignment" : ""} · {props.occurrence.state} ·{" "}
        {props.occurrence.progressLabel}
      </p>
      {needsAssignment ? (
        <p className="display-alert" role="status">
          Needs assignment before this work can be completed at the wall.
        </p>
      ) : null}
      <ol className="display-step-list">
        {props.occurrence.steps
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((step) => {
            const feedback = stepFeedback(props.outbox, props.occurrence.id, step.id);
            const savedKey = `${props.occurrence.id}:${step.id}`;
            const showSaved =
              !feedback && typeof props.savedFlashByStep[savedKey] === "number";
            const quiet =
              step.status === "completed" || step.status === "not_needed";
            return (
              <li
                key={step.id}
                className={quiet ? "display-step completed-quiet" : "display-step"}
                data-testid={`display-step-${step.id}`}
              >
                <span className="display-work-title">{step.text}</span>
                <span className="display-work-meta">
                  {statusLabel(step.status)}
                  {step.source ? ` · ${step.source}` : ""}
                </span>
                {feedback ? (
                  <span
                    className="status-pill"
                    data-kind={feedback.kind === "error" ? "error" : "pending"}
                    role="status"
                  >
                    {feedback.text}
                  </span>
                ) : null}
                {showSaved ? (
                  <span className="status-pill" data-kind="ok" role="status">
                    Saved
                  </span>
                ) : null}
                {executable ? (
                  <div className="display-step-actions" role="group" aria-label={step.text}>
                    <button
                      type="button"
                      className="display-step-action"
                      aria-pressed={step.status === "completed"}
                      aria-label={`Mark ${step.text} done`}
                      onClick={() =>
                        props.onStepChange(props.occurrence, step.id, "completed")
                      }
                      data-testid={`display-step-done-${step.id}`}
                    >
                      Done
                    </button>
                    {step.obligation === "as_needed" ? (
                      <button
                        type="button"
                        className="display-step-action"
                        aria-pressed={step.status === "not_needed"}
                        aria-label={`Mark ${step.text} not needed`}
                        onClick={() =>
                          props.onStepChange(props.occurrence, step.id, "not_needed")
                        }
                        data-testid={`display-step-not-needed-${step.id}`}
                      >
                        Not needed
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="display-step-action"
                      aria-pressed={step.status === "open"}
                      aria-label={`Mark ${step.text} open`}
                      onClick={() =>
                        props.onStepChange(props.occurrence, step.id, "open")
                      }
                      data-testid={`display-step-open-${step.id}`}
                    >
                      Open
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
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
