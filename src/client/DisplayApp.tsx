import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
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
  fetchDisplayPersonDay,
  fetchDisplaySession,
  setDisplayStepStatus,
  type ApiError,
  type DisplayDashboard,
  type DisplayOccurrenceDetail,
  type DisplayPersonDay,
  type DisplayPersonDetail,
  type DisplaySessionInfo,
} from "./display-api";
import {
  DisplayDetailPanel,
  DisplayOverview,
  formatDisplayClock,
  type DisplayDetailState,
  type DisplayOrganization,
  type PendingOverviewCue,
} from "./display-presentation";
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
import {
  FamilyBoard,
  familyPaneCues,
  unassignedRows,
  type FamilyPaneModel,
} from "./family-board";
import { fetchMeta } from "./api";
import { newClientId } from "./id";

const DEFAULT_IDLE_MS = 90_000;
const DEFAULT_STALE_MAX_MS = 60_000;
const POLL_MS = 30_000;
const CLOCK_TICK_MS = 15_000;

type Organization = DisplayOrganization;
type DetailState = DisplayDetailState | null;

type AuthPhase = "loading" | "setup" | "authenticated" | "blank";

declare global {
  interface Window {
    __HD_DISPLAY_IDLE_MS?: number;
    /** Test override for disconnected/stale blank bound (default 60s). */
    __HD_DISPLAY_STALE_MS?: number;
    /** Test override for per-pane freshness only; does not shorten the dashboard lease. */
    __HD_DISPLAY_PANE_STALE_MS?: number;
    /** Test-only: mark sync disconnected and age last auth past the stale bound. */
    __HD_DISPLAY_FORCE_STALE__?: () => void;
    /** Test-only: close the live display sync WebSocket (reconnect may follow). */
    __HD_DISPLAY_CLOSE_SYNC__?: () => void;
    __HD_DISPLAY_RECONNECT_SYNC__?: () => void;
    /** Test-only clock for pane idle/freshness. */
    __HD_DISPLAY_NOW_MS?: number;
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

function paneStaleMaxMs(): number {
  const override = window.__HD_DISPLAY_PANE_STALE_MS;
  if (typeof override === "number" && override > 0) return override;
  return staleMaxMs();
}

function displayNow(): number {
  const override = window.__HD_DISPLAY_NOW_MS;
  if (typeof override === "number" && override > 0) return override;
  return performance.now();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isUnauthorized(error: unknown): boolean {
  const apiError = error as ApiError;
  return apiError.status === 401 || apiError.code === "UNAUTHORIZED";
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
    state: workState({
      completed,
      startedAt: occurrence.startedAt ?? (occurrence.state === "In progress" ? "in-progress" : null),
      steps,
    }),
    startedAt:
      occurrence.startedAt ?? (occurrence.state === "In progress" ? "in-progress" : null),
    progress,
    progressLabel: formatStepProgress(progress),
  };
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
  const [paneDays, setPaneDays] = useState<Record<string, DisplayPersonDay | null>>({});
  const [panePhase, setPanePhase] = useState<Record<string, FamilyPaneModel["phase"]>>({});
  const panePhaseRef = useRef(panePhase);
  panePhaseRef.current = panePhase;

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
  const installationEpochRef = useRef(1);
  const flushInFlightRef = useRef(false);
  const flushAgainRef = useRef(false);
  const occurrenceDetailRef = useRef<DisplayOccurrenceDetail | null>(null);
  const paneGenRef = useRef<Record<string, number>>({});
  const paneStartedRef = useRef<Record<string, number>>({});
  const paneSuccessStartedRef = useRef<Record<string, number>>({});
  const paneFailedAtRef = useRef<Record<string, number>>({});
  const paneEpochRef = useRef(0);
  const promotedIdsRef = useRef<Set<string> | null>(null);
  const activityGenerationRef = useRef<number | null>(null);
  const paneLoadQueueRef = useRef<string[]>([]);
  const paneLoadActiveRef = useRef(0);
  const organizationRef = useRef(organization);

  detailRef.current = detail;
  sessionRef.current = session;
  outboxRef.current = outbox;
  occurrenceDetailRef.current = occurrenceDetail;
  organizationRef.current = organization;

  function familyBoardVisible() {
    return organizationRef.current === "by-person" && detailRef.current == null;
  }

  function resetPaneSnapshots() {
    paneEpochRef.current += 1;
    paneLoadQueueRef.current = [];
    setPaneDays({});
    setPanePhase({});
    paneStartedRef.current = {};
    paneSuccessStartedRef.current = {};
    paneFailedAtRef.current = {};
  }

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
    activityGenerationRef.current = null;
    promotedIdsRef.current = null;
    rememberSessionSecrets(null);
    setDashboard(null);
    setPersonDetail(null);
    setOccurrenceDetail(null);
    setDetail(null);
    resetPaneSnapshots();
    paneGenRef.current = {};
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

  /** Installation reset: explain retired pending work, then blank the wall. */
  const handleInstallationReset = useEffectEvent(async () => {
    // Fence immediately so reconnect/poll paths cannot clear retirement notices.
    accessLostRef.current = true;
    const sessionId = sessionIdRef.current;
    const before = outboxRef.current;
    let nextEpoch = installationEpochRef.current + 1;
    try {
      const meta = await fetchMeta();
      nextEpoch = meta.installationEpoch;
    } catch {
      /* meta may fail while control is mid-swap; still fence local pending. */
    }
    installationEpochRef.current = nextEpoch;
    if (sessionId) {
      const retired = await retireMismatchedDisplayOutbox(sessionId, {
        activityGeneration: sessionRef.current?.activityGeneration ?? 0,
        householdDate:
          householdDateRef.current ?? sessionRef.current?.householdDate ?? "",
        installationEpoch: nextEpoch,
      });
      outboxRef.current = retired;
      setOutbox(retired);
      const newlyRejected = rejectedDisplayOutboxNotices(retired).filter((notice) =>
        before.some(
          (item) =>
            item.mutationId === notice.mutationId && item.state !== "rejected",
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
      }
    }
    lastAuthorizedAtRef.current = null;
    householdDateRef.current = null;
    activityGenerationRef.current = null;
    rememberSessionSecrets(null);
    setDashboard(null);
    setPersonDetail(null);
    setOccurrenceDetail(null);
    setDetail(null);
    resetPaneSnapshots();
    paneGenRef.current = {};
    setSession(null);
    setPendingCue(null);
    setSavedFlashByStep({});
    setStale(false);
    setBlankReason(
      "The household was reset. Pending display changes were not saved. Enter a new setup code when ready.",
    );
    setAuthPhase("blank");
  });

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
        const epoch = installationEpochRef.current;
        if (item.installationEpoch != null && item.installationEpoch !== epoch) {
          items = await patchDisplayOutboxItem(sessionId, item.mutationId, {
            state: "rejected",
            errorMessage: "The household was reset; this display change was not saved.",
          });
          outboxRef.current = items;
          setOutbox(items);
          continue;
        }
        if (item.installationEpoch == null) {
          items = await patchDisplayOutboxItem(sessionId, item.mutationId, {
            state: "rejected",
            errorMessage:
              "This display change was saved before reset protection and was not applied.",
          });
          outboxRef.current = items;
          setOutbox(items);
          continue;
        }
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
          const ownerId = result.occurrence.accountableMemberId;
          if (ownerId) {
            paneGenRef.current[ownerId] = (paneGenRef.current[ownerId] ?? 0) + 1;
            setPaneDays((current) => {
              const day = current[ownerId];
              if (!day || !day.occurrences.some((row) => row.id === result.occurrence.id)) return current;
              return { ...current, [ownerId]: {
                ...day,
                occurrences: day.occurrences.map((row) => row.id === result.occurrence.id ? result.occurrence : row),
              } };
            });
          }
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
          if (rejected) {
            setRetiredNotices((current) =>
              current.some((notice) => notice.mutationId === item.mutationId)
                ? current
                : [...current, { mutationId: item.mutationId, message }],
            );
            continue;
          }
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

  function overlayPersonDay(day: DisplayPersonDay): DisplayPersonDay {
    let occurrences = day.occurrences;
    for (const item of outboxRef.current) {
      if (item.state === "rejected") continue;
      occurrences = occurrences.map((occurrence) =>
        occurrence.id === item.occurrenceId
          ? applyOptimisticStepStatus(occurrence, item.stepId, item.status)
          : occurrence,
      );
    }
    return { ...day, occurrences };
  }

  const loadPersonDay = useEffectEvent(async (membershipId: string) => {
    if (accessLostRef.current) return;
    const epoch = paneEpochRef.current;
    const gen = (paneGenRef.current[membershipId] ?? 0) + 1;
    paneGenRef.current[membershipId] = gen;
    const started = displayNow();
    paneStartedRef.current[membershipId] = started;
    setPanePhase((current) => {
      const prev = current[membershipId];
      const keep =
        prev === "ready" || prev === "unavailable" || prev === "blank" ? prev : "loading";
      if (prev === keep) return current;
      return { ...current, [membershipId]: keep };
    });
    try {
      const day = await fetchDisplayPersonDay(membershipId);
      if (paneEpochRef.current !== epoch) return;
      if (paneGenRef.current[membershipId] !== gen || accessLostRef.current) return;
      if (day.installationEpoch !== installationEpochRef.current) return;
      if (
        householdDateRef.current &&
        day.householdDate !== householdDateRef.current
      ) {
        return;
      }
      if (
        activityGenerationRef.current != null &&
        day.activityGeneration !== activityGenerationRef.current
      ) {
        return;
      }
      if (displayNow() - started >= paneStaleMaxMs()) {
        setPaneDays((current) => ({ ...current, [membershipId]: null }));
        setPanePhase((current) => ({ ...current, [membershipId]: "blank" }));
        return;
      }
      paneSuccessStartedRef.current[membershipId] = started;
      delete paneFailedAtRef.current[membershipId];
      // Keep the authoritative snapshot separate from the optimistic overlay,
      // so a rejected command can reveal the server's actual state again.
      const allowed = promotedIdsRef.current;
      const filtered = allowed
        ? { ...day, promotedPersonalTasks: day.promotedPersonalTasks.filter((task) => allowed.has(task.id)) }
        : day;
      setPaneDays((current) => ({ ...current, [membershipId]: filtered }));
      setPanePhase((current) => ({ ...current, [membershipId]: "ready" }));
    } catch (error) {
      if (paneEpochRef.current !== epoch) return;
      if (paneGenRef.current[membershipId] !== gen) return;
      if (isUnauthorized(error)) {
        clearHouseholdState("Display access ended. Enter a new setup code.");
        return;
      }
      const apiError = error as ApiError;
      const successStarted = paneSuccessStartedRef.current[membershipId];
      if (
        successStarted != null &&
        displayNow() - successStarted >= paneStaleMaxMs()
      ) {
        setPaneDays((current) => ({ ...current, [membershipId]: null }));
        setPanePhase((current) => ({ ...current, [membershipId]: "blank" }));
        return;
      }
      if (paneFailedAtRef.current[membershipId] == null) {
        paneFailedAtRef.current[membershipId] = started;
      }
      if (apiError.status === 404) {
        setPaneDays((current) => ({ ...current, [membershipId]: null }));
      }
      setPanePhase((current) =>
        current[membershipId] === "unavailable"
          ? current
          : { ...current, [membershipId]: "unavailable" },
      );
    }
  });

  const pumpPaneLoads = useEffectEvent(() => {
    const limit = 2;
    while (paneLoadActiveRef.current < limit && paneLoadQueueRef.current.length > 0) {
      const membershipId = paneLoadQueueRef.current.shift();
      if (!membershipId) break;
      paneLoadActiveRef.current += 1;
      void loadPersonDay(membershipId).finally(() => {
        paneLoadActiveRef.current = Math.max(0, paneLoadActiveRef.current - 1);
        pumpPaneLoads();
      });
    }
  });

  const refreshPersonDays = useEffectEvent((membershipIds: string[], force = false) => {
    for (const membershipId of membershipIds) {
      const phase = panePhaseRef.current[membershipId];
      if (!force && (phase === "unavailable" || phase === "blank")) continue;
      if (!paneLoadQueueRef.current.includes(membershipId)) {
        paneLoadQueueRef.current.push(membershipId);
      }
    }
    pumpPaneLoads();
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
      const previousGeneration = activityGenerationRef.current;
      const generationChanged =
        previousGeneration != null && previousGeneration !== next.activityGeneration;
      const sessionId = sessionIdRef.current;
      if (sessionId) {
        const before = outboxRef.current;
        const retired = await retireMismatchedDisplayOutbox(sessionId, {
          activityGeneration: next.activityGeneration,
          householdDate: next.householdDate,
          installationEpoch: installationEpochRef.current,
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
      if (gen !== dashGenRef.current || accessLostRef.current) return;
      if (dateChanged || generationChanged) {
        // Close old-day/old-generation detail before applying the new snapshot.
        setDetail(null);
        setPersonDetail(null);
        setOccurrenceDetail(null);
        resetPaneSnapshots();
        // Keep retiredNotices; clear only the pending (still-retryable) cue.
        setPendingCue(null);
      }
      householdDateRef.current = next.householdDate;
      activityGenerationRef.current = next.activityGeneration;
      const nextPromoted = new Set(next.promotedPersonalTasks.map((task) => task.id));
      const previousPromoted = promotedIdsRef.current;
      const promotionChanged = previousPromoted !== null &&
        (previousPromoted.size !== nextPromoted.size || [...previousPromoted].some((id) => !nextPromoted.has(id)));
      promotedIdsRef.current = nextPromoted;
      if (promotionChanged) {
        // Fence in-flight person reads and withdraw removed values immediately.
        paneEpochRef.current += 1;
        setPaneDays((current) => Object.fromEntries(Object.entries(current).map(([id, day]) => [
          id,
          day ? { ...day, promotedPersonalTasks: day.promotedPersonalTasks.filter((task) => nextPromoted.has(task.id)) } : null,
        ])));
      }
      setDashboard(next);
      if (familyBoardVisible()) {
        refreshPersonDays(next.byPerson.map((person) => person.membershipId));
      }
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
      try {
        const meta = await fetchMeta();
        installationEpochRef.current = meta.installationEpoch;
      } catch {
        installationEpochRef.current = 1;
      }
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
        if (familyBoardVisible()) {
          const ids = sessionRef.current ? Object.keys(paneGenRef.current) : [];
          if (ids.length > 0) refreshPersonDays(ids);
        }
      }, 250);
    };

    const sync = connectDisplaySync((msg) => {
      if (msg.reason === "access_lost") {
        clearHouseholdState("Display access was revoked.");
        return;
      }
      if (msg.reason === "reset" || msg.reason === "restore") {
        void handleInstallationReset();
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

  useEffect(() => {
    if (organization !== "by-person" || detail || !dashboard) return;
    refreshPersonDays(dashboard.byPerson.map((person) => person.membershipId), true);
  }, [organization, detail]);

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
      if (familyBoardVisible()) refreshPersonDays(Object.keys(paneGenRef.current), true);
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
      const paneBound = paneStaleMaxMs();
      const now = displayNow();
      const expired: string[] = [];
      for (const [membershipId, phase] of Object.entries(panePhaseRef.current)) {
        if (phase === "blank") continue;
        const started = paneStartedRef.current[membershipId];
        const success = paneSuccessStartedRef.current[membershipId];
        const failed = paneFailedAtRef.current[membershipId];
        // Only the request that produced the displayed snapshot grants its lease.
        // A later pending or failed refresh cannot renew old content.
        const leaseStart = success ?? failed ?? started;
        if (leaseStart != null && now - leaseStart >= paneBound) {
          expired.push(membershipId);
        }
      }
      if (expired.length > 0) {
        for (const membershipId of expired) {
          paneGenRef.current[membershipId] = (paneGenRef.current[membershipId] ?? 0) + 1;
        }
        setPaneDays((current) => {
          const next = { ...current };
          for (const membershipId of expired) next[membershipId] = null;
          return next;
        });
        setPanePhase((current) => {
          const next = { ...current };
          for (const membershipId of expired) next[membershipId] = "blank";
          return next;
        });
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
        if (familyBoardVisible()) refreshPersonDays(Object.keys(paneGenRef.current), true);
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
    const gen = ++detailGenRef.current;
    if (!next) return;
    if (next.kind === "person") {
      void fetchDisplayPerson(next.membershipId)
        .then((person) => {
          if (gen !== detailGenRef.current) return;
          markAuthorized();
          setPersonDetail(person);
        })
        .catch((error) => {
          if (gen !== detailGenRef.current) return;
          if (isUnauthorized(error)) clearHouseholdState();
        });
    } else if (next.kind === "occurrence" || next.kind === "routine-person") {
      void fetchDisplayOccurrence(next.occurrenceId)
        .then((occurrence) => {
          if (gen !== detailGenRef.current) return;
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
          if (gen !== detailGenRef.current) return;
          if (isUnauthorized(error)) clearHouseholdState();
        });
    }
  }

  function closeDetail() {
    detailGenRef.current += 1;
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
      installationEpoch: installationEpochRef.current,
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
    const superseded = new Set(outboxRef.current.filter((existing) =>
      existing.occurrenceId === occurrence.id && existing.stepId === stepId && existing.state === "rejected",
    ).map((existing) => existing.mutationId));
    if (superseded.size > 0) {
      setRetiredNotices((current) => current.filter((notice) => !superseded.has(notice.mutationId)));
    }
    outboxRef.current = next;
    setOutbox(next);
    if (typeof navigator === "undefined" || navigator.onLine) {
      void flushDisplayOutbox();
    }
  }

  const clock =
    dashboard != null
      ? formatDisplayClock(dashboard.serverTime, dashboard.timezone, clockElapsedMs)
      : session != null
        ? formatDisplayClock(session.serverTime, session.timezone, clockElapsedMs)
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
        <section className="display-blank" data-testid="display-blank">
          <p className="display-status" role="status">
            {blankReason ?? "Waiting for display access…"}
          </p>
          {retiredNotices.length > 0 ? (
            <div
              className="display-retired-notices"
              role="status"
              data-testid="display-retired-notices"
            >
              {retiredNotices.map((notice) => (
                <p
                  key={notice.mutationId}
                  className="display-retired-notice"
                  data-testid="display-retired-notice"
                >
                  {notice.message}
                </p>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            className="display-setup-submit"
            data-testid="display-blank-continue"
            onClick={() => {
              setRetiredNotices([]);
              setBlankReason(null);
              setAuthPhase("setup");
            }}
          >
            Continue to setup
          </button>
        </section>
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
        <>
          {detail ? (
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
          ) : null}
          <div
            className="display-overview-host"
            hidden={detail ? true : undefined}
            inert={detail ? true : undefined}
          >
            <DisplayOverview
              dashboard={dashboard}
              organization={organization}
              loading={loadingDash}
              pendingCue={pendingCue}
              retiredNotices={retiredNotices}
              paneCues={familyPaneCues(
                dashboard.byPerson.map((person) => ({
                  membershipId: person.membershipId,
                  displayName: person.displayName,
                  sortOrder: person.sortOrder,
                  status: person.status,
                  phase: panePhase[person.membershipId] ?? "loading",
                  progressLabel: person.progressLabel,
                  day: paneDays[person.membershipId]
                    ? overlayPersonDay(paneDays[person.membershipId]!)
                    : null,
                })),
                outbox,
              )}
              personBoard={
                <FamilyBoard
                  key={dashboard.householdDate}
                  panes={dashboard.byPerson.map((person) => ({
                    membershipId: person.membershipId,
                    displayName: person.displayName,
                    sortOrder: person.sortOrder,
                    status: person.status,
                    phase: panePhase[person.membershipId] ?? "loading",
                    progressLabel: person.progressLabel,
                    day: paneDays[person.membershipId]
                      ? overlayPersonDay(paneDays[person.membershipId]!)
                      : null,
                  }))}
                  unassigned={unassignedRows(dashboard)}
                  outbox={outbox}
                  savedFlashByStep={savedFlashByStep}
                  canAct={canAct}
                  idleMs={idleMs()}
                  nowMs={displayNow}
                  onRetryPane={(membershipId) => refreshPersonDays([membershipId], true)}
                  onStepChange={(occurrence, stepId, status) =>
                    void queueDisplayStepChange(occurrence, stepId, status)
                  }
                  onOpenUnassigned={(occurrenceId, originKey) =>
                    openDetail({ kind: "occurrence", occurrenceId, originKey }, originKey)
                  }
                  onOpenPersonalDetail={(membershipId, originKey) =>
                    openDetail({ kind: "person", membershipId, originKey }, originKey)
                  }
                />
              }
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
          </div>
        </>
      ) : null}
    </div>
  );
}
