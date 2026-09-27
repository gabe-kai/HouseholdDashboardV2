import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { isLockingStepStatus } from "../domain/occurrence-lock";
import { reconcileOccurrence, retainPendingOmittedOccurrences } from "../domain/reconcile";
import type {
  ApplicabilityRule,
  Grant,
  MemberPublic,
  OccurrenceView,
  ObligationMeaning,
  StepStatus,
} from "../shared/schemas";
import {
  claim,
  connectSync,
  createProposal,
  decideProposal,
  fetchPeople,
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
  setStepStatus,
  rememberCsrfToken,
  type PersonalAddition,
  type PersonalTask,
  type Proposal,
  type Routine,
  type RoutinePreview,
  type SessionInfo,
} from "./api";
import { HistoryView } from "./History";
import { HouseholdDisplaysView } from "./HouseholdDisplays";
import { HouseholdOverview } from "./HouseholdOverview";
import { HouseholdSettingsView } from "./HouseholdSettings";
import { TodayView } from "./TodayView";
import { PeopleGroupsView } from "./PeopleGroups";
import { ResponsibilitiesView } from "./Responsibilities";
import { DAYPART_LABELS, RoutinesView } from "./Routines";
import { SchoolCalendarView } from "./SchoolCalendar";
import {
  clearMembershipOutbox,
  enqueueOutbox,
  intendedStructureFromOccurrence,
  normalizeOccurrenceKind,
  patchOutboxItem,
  previousOccurrencesFromOutbox,
  readOutbox,
  removeOutboxItem,
  writeOutbox,
  type OutboxItem,
} from "./outbox";
import { newClientId } from "./id";
import {
  type AppLocation,
  type HistoryFilters,
  consumeIntendedPath,
  locationsEqual,
  parseHref,
  parsePath,
  pathFor,
  pushHistory,
  rememberIntendedPath,
  replaceHistory,
} from "./nav";
import { OrderedList } from "./OrderedList";
import { ToastHost, useToast } from "./Toast";

type PrimaryTab = "today" | "plan" | "household";

/** Local Household leaves that stay under /household (not URL-addressable). */
type HouseholdLeaf = "approvals" | "activity" | null;

/** Secondary destinations reached from Today (not primary nav). */
type TodaySecondary = "personalize" | "preview" | null;

const ACTIVITY_CLEARED_HINT = /routine history was cleared/i;

function primaryTabFor(location: AppLocation): PrimaryTab {
  if (
    location.name === "plan" ||
    location.name === "plan-routine" ||
    location.name === "plan-responsibility"
  ) {
    return "plan";
  }
  if (
    location.name === "household" ||
    location.name === "household-people" ||
    location.name === "household-person" ||
    location.name === "household-group" ||
    location.name === "household-school-calendar" ||
    location.name === "household-history" ||
    location.name === "household-history-occurrence" ||
    location.name === "household-settings" ||
    location.name === "household-displays"
  ) {
    return "household";
  }
  return "today";
}

function gateLocation(location: AppLocation, session: SessionInfo): AppLocation {
  const canManageShared =
    session.grants.includes("routine.shared.manage") ||
    session.grants.includes("responsibility.manage");
  const canClearActivity = session.grants.includes("household.activity.clear");
  const canManageDisplays = session.grants.includes("household.display.manage");
  if (
    (location.name === "plan" ||
      location.name === "plan-routine" ||
      location.name === "plan-responsibility") &&
    !canManageShared
  ) {
    return { name: "unavailable", attemptedPath: pathFor(location) };
  }
  if (
    (location.name === "household-history" ||
      location.name === "household-history-occurrence") &&
    !canManageShared
  ) {
    return { name: "unavailable", attemptedPath: pathFor(location) };
  }
  if (location.name === "household-settings" && !canClearActivity) {
    return { name: "unavailable", attemptedPath: pathFor(location) };
  }
  if (location.name === "household-displays" && !canManageDisplays) {
    return { name: "unavailable", attemptedPath: pathFor(location) };
  }
  return location;
}

function confirmDiscardDirty(): boolean {
  return window.confirm(
    "You have unsaved changes. Discard them?\n\nOK = Discard · Cancel = Keep editing",
  );
}

const HOUSEHOLD_MENU_ITEMS: Array<{
  id:
    | "people-groups"
    | "school-calendar"
    | "approvals"
    | "history"
    | "activity"
    | "displays"
    | "settings";
  label: string;
  description: string;
  visible: (caps: {
    canDecide: boolean;
    canManageShared: boolean;
    canViewActivity: boolean;
    canClearActivity: boolean;
    canManageDisplays: boolean;
  }) => boolean;
}> = [
  {
    id: "people-groups",
    label: "People & Groups",
    description: "Directory, access, and groups",
    visible: () => true,
  },
  {
    id: "school-calendar",
    label: "School calendar",
    description: "School years, weekdays, and breaks",
    visible: () => true,
  },
  {
    id: "approvals",
    label: "Approvals",
    description: "Review personalization proposals",
    visible: (caps) => caps.canDecide,
  },
  {
    id: "history",
    label: "History",
    description: "Recorded routine work by day",
    visible: (caps) => caps.canManageShared,
  },
  {
    id: "activity",
    label: "Household activity",
    description: "Shared progress and visible tasks",
    visible: (caps) => caps.canViewActivity,
  },
  {
    id: "displays",
    label: "Household displays",
    description: "Enroll and revoke wall dashboards",
    visible: (caps) => caps.canManageDisplays,
  },
  {
    id: "settings",
    label: "Settings",
    description: "Data & testing",
    visible: (caps) => caps.canClearActivity,
  },
];

function hasGrant(session: SessionInfo, grant: Grant): boolean {
  return session.grants.includes(grant);
}

function obligationLabel(obligation: ObligationMeaning): string {
  if (obligation === "as_needed") return "As needed";
  if (obligation === "required") return "Required";
  return "Optional";
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
    allowEvaluationHistoryClear: boolean;
  } | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [location, setLocation] = useState<AppLocation>(() =>
    parsePath(window.location.pathname, window.location.search),
  );
  const [householdLeaf, setHouseholdLeaf] = useState<HouseholdLeaf>(null);
  const [todaySecondary, setTodaySecondary] = useState<TodaySecondary>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [occurrences, setOccurrences] = useState<OccurrenceView[]>([]);
  const [memberships, setMemberships] = useState<MemberPublic[]>([]);
  const [familyOrderVersion, setFamilyOrderVersion] = useState(0);
  const [tasks, setTasks] = useState<PersonalTask[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [householdDate, setHouseholdDate] = useState("");
  const [occurrencesLoaded, setOccurrencesLoaded] = useState(false);
  const [knownActivityGeneration, setKnownActivityGeneration] = useState(0);
  const [activityResetBanner, setActivityResetBanner] = useState(false);
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [connection, setConnection] = useState<"connected" | "reconnecting" | "offline">(
    navigator.onLine ? "connected" : "offline",
  );
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RoutinePreview | null>(null);
  const [previewReturn, setPreviewReturn] = useState<TodaySecondary>(null);
  const [mutationDelayMs, setMutationDelayMs] = useState(0);
  const [routineRefreshToken, setRoutineRefreshToken] = useState(0);
  const [schoolCalendarRefreshToken, setSchoolCalendarRefreshToken] = useState(0);
  const identityRef = useRef<string | null>(null);
  const occurrencesRef = useRef<OccurrenceView[]>([]);
  const outboxRef = useRef<OutboxItem[]>([]);
  const activityGenerationRef = useRef(0);
  const refreshGenerationRef = useRef(0);
  const supportingGenerationRef = useRef(0);
  const locationRef = useRef(location);
  const editorDirtyRef = useRef(editorDirty);
  const { toast, showToast, clearToast } = useToast();
  const [, startTransition] = useTransition();

  useEffect(() => {
    outboxRef.current = outbox;
  }, [outbox]);

  useEffect(() => {
    activityGenerationRef.current = knownActivityGeneration;
  }, [knownActivityGeneration]);

  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  useEffect(() => {
    editorDirtyRef.current = editorDirty;
  }, [editorDirty]);

  function clearUiCaches() {
    setOccurrences([]);
    occurrencesRef.current = [];
    setOccurrencesLoaded(false);
    setMemberships([]);
    setFamilyOrderVersion(0);
    setTasks([]);
    setProposals([]);
    setOutbox([]);
    outboxRef.current = [];
    setHouseholdDate("");
    setKnownActivityGeneration(0);
    activityGenerationRef.current = 0;
    setActivityResetBanner(false);
    setPreview(null);
    setPreviewReturn(null);
    setError(null);
    clearToast();
  }

  function resetLocalOverlays() {
    setHouseholdLeaf(null);
    setTodaySecondary(null);
    setAccountMenuOpen(false);
    setEditorDirty(false);
  }

  function applyLocation(next: AppLocation, historyMode: "push" | "replace" | "none") {
    const previous = locationRef.current;
    if (historyMode === "push") pushHistory(next);
    else if (historyMode === "replace") replaceHistory(next);
    locationRef.current = next;
    setLocation(next);
    if (!locationsEqual(previous, next)) {
      clearToast();
      setHouseholdLeaf(null);
      setTodaySecondary(null);
      setAccountMenuOpen(false);
    }
  }

  function requestNavigate(
    next: AppLocation,
    historyMode: "push" | "replace" = "push",
  ): boolean {
    if (editorDirtyRef.current && !confirmDiscardDirty()) {
      return false;
    }
    setEditorDirty(false);
    applyLocation(next, historyMode);
    return true;
  }

  function establishSession(next: SessionInfo) {
    if (identityRef.current !== next.member.id) clearUiCaches();
    identityRef.current = next.member.id;
    rememberCsrfToken(next.csrfToken);
    setSession(next);
    setHouseholdDate(next.householdDate);
    activityGenerationRef.current = next.activityGeneration;
    setKnownActivityGeneration(next.activityGeneration);
    resetLocalOverlays();
    clearToast();

    const intended = consumeIntendedPath();
    const raw = intended
      ? parseHref(intended)
      : parsePath(window.location.pathname, window.location.search);
    const gated = gateLocation(raw, next);
    applyLocation(gated, "replace");
  }

  function expireSession() {
    identityRef.current = null;
    setSession(null);
    clearUiCaches();
    resetLocalOverlays();
    rememberIntendedPath(window.location.pathname, window.location.search);
  }

  const retireStaleOutboxForGeneration = useEffectEvent(
    async (membershipId: string, serverGeneration: number): Promise<boolean> => {
      if (identityRef.current !== membershipId) return false;
      const known = activityGenerationRef.current;
      if (serverGeneration <= known) return false;
      const items = await readOutbox(membershipId);
      if (identityRef.current !== membershipId) return false;
      const kept = items.filter(
        (item) => (item.activityGeneration ?? 0) >= serverGeneration,
      );
      await writeOutbox(membershipId, kept);
      if (identityRef.current !== membershipId) return false;
      outboxRef.current = kept;
      setOutbox(kept);
      activityGenerationRef.current = serverGeneration;
      setKnownActivityGeneration(serverGeneration);
      setActivityResetBanner(true);
      setHistoryRefreshToken((n) => n + 1);
      return true;
    },
  );

  const noteActivityGeneration = useEffectEvent(
    async (membershipId: string, serverGeneration: number) => {
      if (identityRef.current !== membershipId) return;
      const retired = await retireStaleOutboxForGeneration(membershipId, serverGeneration);
      if (retired) {
        await refreshToday(membershipId).catch(() => undefined);
        return;
      }
      if (serverGeneration > activityGenerationRef.current) {
        activityGenerationRef.current = serverGeneration;
        setKnownActivityGeneration(serverGeneration);
      }
    },
  );

  const refreshToday = useEffectEvent(async (membershipId: string, date?: string) => {
    const generation = ++refreshGenerationRef.current;
    const data = await fetchToday(date);
    if (identityRef.current !== membershipId) return;
    if (generation !== refreshGenerationRef.current) return;

    const retired = await retireStaleOutboxForGeneration(
      membershipId,
      data.activityGeneration,
    );
    if (identityRef.current !== membershipId) return;
    if (generation !== refreshGenerationRef.current) return;

    const pendingItems = outboxRef.current.filter((item) => item.state !== "rejected");
    const pendingCommands = pendingItems.map((item) => ({
      mutationId: item.mutationId,
      occurrenceId: item.occurrenceId,
      stepId: item.stepId,
      status: item.status,
    }));
    const priorById = new Map<string, OccurrenceView>();
    for (const occurrence of previousOccurrencesFromOutbox(pendingItems)) {
      priorById.set(occurrence.id, occurrence);
    }
    for (const occurrence of occurrencesRef.current) {
      priorById.set(occurrence.id, occurrence);
    }
    const previous = [...priorById.values()];
    // After a generation bump, do not retain omitted cards from retired intent.
    const merged = retired
      ? data.occurrences
      : retainPendingOmittedOccurrences(previous, data.occurrences, pendingCommands);
    occurrencesRef.current = merged;
    setHouseholdDate(data.householdDate);
    setOccurrences(merged);
    setOccurrencesLoaded(true);
    if (!retired && data.activityGeneration > activityGenerationRef.current) {
      activityGenerationRef.current = data.activityGeneration;
      setKnownActivityGeneration(data.activityGeneration);
    }
  });

  const refreshSupportingData = useEffectEvent(
    async (activeSession: SessionInfo) => {
      const membershipId = activeSession.member.id;
      const generation = ++supportingGenerationRef.current;
      const shouldLoadProposals =
        hasGrant(activeSession, "routine.personalize.propose") ||
        hasGrant(activeSession, "routine.proposal.decide");
      const [memberResult, taskResult, proposalResult] = await Promise.allSettled([
        fetchPeople(),
        fetchPersonalTasks(),
        shouldLoadProposals
          ? fetchProposals()
          : Promise.resolve({ proposals: [] as Proposal[] }),
      ]);
      if (identityRef.current !== membershipId) return;
      if (generation !== supportingGenerationRef.current) return;
      if (memberResult.status === "fulfilled") {
        setMemberships(memberResult.value.people);
        setFamilyOrderVersion(memberResult.value.familyOrderVersion);
        const self = memberResult.value.people.find((person) => person.id === membershipId);
        if (self) {
          setSession((current) =>
            current && current.member.displayName !== self.displayName
              ? {
                  ...current,
                  member: { ...current.member, displayName: self.displayName },
                }
              : current,
          );
        }
      }
      if (taskResult.status === "fulfilled") setTasks(taskResult.value.tasks);
      if (proposalResult.status === "fulfilled") setProposals(proposalResult.value.proposals);
    },
  );

  const flushOutbox = useEffectEvent(async (membershipId: string) => {
    if (identityRef.current !== membershipId) return;
    let items = await readOutbox(membershipId);
    if (identityRef.current !== membershipId) return;
    outboxRef.current = items;
    setOutbox(items);
    for (const item of items) {
      if (identityRef.current !== membershipId || item.state === "rejected") continue;
      items = await patchOutboxItem(membershipId, item.mutationId, {
        state: "retrying",
      });
      if (identityRef.current === membershipId) {
        outboxRef.current = items;
        setOutbox(items);
      }
      try {
        await setStepStatus(
          item.occurrenceId,
          item.stepId,
          {
            mutationId: item.mutationId,
            status: item.status,
            performedAt: item.performedAt,
            activityGeneration: item.activityGeneration ?? activityGenerationRef.current,
            ...(item.kind ? { kind: item.kind } : {}),
            ...(item.intendedStructure
              ? { intendedStructure: item.intendedStructure }
              : {}),
          },
          mutationDelayMs ? { delayMs: mutationDelayMs } : undefined,
        );
        if (identityRef.current !== membershipId) return;
        items = await removeOutboxItem(membershipId, item.mutationId);
        outboxRef.current = items;
        setOutbox(items);
      } catch (caught) {
        if (identityRef.current !== membershipId) return;
        const code = (caught as { code?: string }).code;
        const message = errorMessage(caught);
        if (code === "UNAUTHORIZED") {
          items = await patchOutboxItem(membershipId, item.mutationId, {
            state: "pending",
            errorMessage: "Sign in again to sync this change.",
          });
          outboxRef.current = items;
          setOutbox(items);
          expireSession();
          return;
        }
        if (
          (code === "CONFLICT" || code === "FORBIDDEN") &&
          ACTIVITY_CLEARED_HINT.test(message)
        ) {
          try {
            const latest = await fetchSession();
            if (latest && identityRef.current === membershipId) {
              await noteActivityGeneration(membershipId, latest.activityGeneration);
            } else {
              await retireStaleOutboxForGeneration(
                membershipId,
                (item.activityGeneration ?? 0) + 1,
              );
              await refreshToday(membershipId).catch(() => undefined);
            }
          } catch {
            await retireStaleOutboxForGeneration(
              membershipId,
              activityGenerationRef.current + 1,
            );
            await refreshToday(membershipId).catch(() => undefined);
          }
          return;
        }
        const rejected =
          code === "VALIDATION" || code === "FORBIDDEN" || code === "NOT_FOUND";
        items = await patchOutboxItem(membershipId, item.mutationId, {
          state: rejected ? "rejected" : "pending",
          errorMessage: message,
        });
        outboxRef.current = items;
        setOutbox(items);
        break;
      }
    }
    if (identityRef.current === membershipId) {
      await refreshToday(membershipId, householdDate || undefined).catch(() => undefined);
    }
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
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
        if (
          notification.resource === "group" ||
          notification.resource === "routine" ||
          notification.resource === "responsibility" ||
          notification.resource === "school_calendar"
        ) {
          setRoutineRefreshToken((n) => n + 1);
        }
        if (notification.resource === "school_calendar") {
          setSchoolCalendarRefreshToken((n) => n + 1);
        }
        if (
          notification.resource === "family_order" ||
          notification.resource === "membership"
        ) {
          void refreshSupportingData(session);
        }
        if (notification.resource === "activity_reset") {
          const version = notification.version;
          if (typeof version === "number") {
            void noteActivityGeneration(membershipId, version);
          } else {
            void refreshToday(membershipId).catch((caught) => setError(errorMessage(caught)));
          }
          setHistoryRefreshToken((n) => n + 1);
        }
        if (notification.resource === "occurrence") {
          setHistoryRefreshToken((n) => n + 1);
        }
        const urgent =
          notification.resource === "proposal" ||
          notification.resource === "routine" ||
          notification.resource === "responsibility" ||
          notification.resource === "membership" ||
          notification.resource === "group" ||
          notification.resource === "school_calendar" ||
          notification.resource === "family_order" ||
          notification.resource === "activity_reset";
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
          // Missed WS notifications: refresh Plan/History tokens with Today.
          setRoutineRefreshToken((n) => n + 1);
          setHistoryRefreshToken((n) => n + 1);
          refreshAuthoritative({ urgentSupporting: true });
        }
      },
    );

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (identityRef.current !== membershipId) return;
      // Visible-tab recovery must re-read Today immediately; do not defer it
      // behind startTransition (same class of bug as deferred proposal status).
      setRoutineRefreshToken((n) => n + 1);
      setHistoryRefreshToken((n) => n + 1);
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
      resetLocalOverlays();
      rememberIntendedPath(window.location.pathname, window.location.search);
      applyLocation({ name: "today" }, "replace");
    }
  }

  async function queueStepChange(
    occurrenceId: string,
    stepId: string,
    status: StepStatus,
  ) {
    if (!session) return;
    const membershipId = session.member.id;
    const base = occurrencesRef.current.find((occurrence) => occurrence.id === occurrenceId);
    const normalized = base ? normalizeOccurrenceKind(base) : undefined;
    const item: OutboxItem = {
      mutationId: newClientId(),
      occurrenceId,
      stepId,
      status,
      performedAt: new Date().toISOString(),
      state: "pending",
      activityGeneration: activityGenerationRef.current,
      occurrenceSnapshot:
        normalized && isLockingStepStatus(status)
          ? (JSON.parse(JSON.stringify(normalized)) as OccurrenceView)
          : undefined,
      ...(normalized
        ? {
            kind: normalized.kind,
            ...(normalized.kind === "responsibility"
              ? { intendedStructure: intendedStructureFromOccurrence(normalized) }
              : {}),
          }
        : {}),
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
    outboxRef.current = next;
    setOutbox(next);
    if (online) void flushOutbox(membershipId);
  }

  async function openPreview(membershipId: string, date: string, definitionId: string) {
    setError(null);
    try {
      const result = await fetchPreview(definitionId, membershipId, date);
      if (identityRef.current !== session?.member.id) return;
      if (editorDirtyRef.current && !confirmDiscardDirty()) return;
      setEditorDirty(false);
      setPreview(result.preview);
      setPreviewReturn(todaySecondary === "personalize" ? "personalize" : null);
      if (locationRef.current.name !== "today") {
        applyLocation({ name: "today" }, "push");
      }
      setTodaySecondary("preview");
      setHouseholdLeaf(null);
      setAccountMenuOpen(false);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  useEffect(() => {
    function onPopState() {
      const next = parsePath(window.location.pathname, window.location.search);
      if (editorDirtyRef.current) {
        if (!confirmDiscardDirty()) {
          // Keep editing: restore previous URL without discarding draft.
          replaceHistory(locationRef.current);
          return;
        }
        setEditorDirty(false);
      }
      clearToast();
      setHouseholdLeaf(null);
      setTodaySecondary(null);
      setAccountMenuOpen(false);
      locationRef.current = next;
      setLocation(next);
    }

    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!editorDirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("popstate", onPopState);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
    // clearToast is stable for this owner; bind once.
  }, []);

  useEffect(() => {
    if (restoring || session) return;
    rememberIntendedPath(window.location.pathname, window.location.search);
  }, [restoring, session]);

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
  const canManageShared =
    hasGrant(activeSession, "routine.shared.manage") ||
    hasGrant(activeSession, "responsibility.manage");
  const canEnroll = hasGrant(activeSession, "household.member.enroll");
  const canManageStructure = hasGrant(activeSession, "household.structure.manage");
  const canManageSchedule = hasGrant(activeSession, "household.schedule.manage");
  const canDecide = hasGrant(activeSession, "routine.proposal.decide");
  const canClearActivity =
    Boolean(meta?.allowEvaluationHistoryClear) &&
    hasGrant(activeSession, "household.activity.clear");
  const canManageDisplays = hasGrant(activeSession, "household.display.manage");
  const manager = canManageShared || canEnroll || canDecide || canManageStructure;
  const canDirect = hasGrant(activeSession, "routine.personalize.direct");
  const canPropose = hasGrant(activeSession, "routine.personalize.propose");
  const canPersonalize = canDirect || canPropose;
  const projectedOccurrences = occurrences.map((occurrence) =>
    reconcileOccurrence(occurrence, outbox),
  );
  const projectedOwn = projectedOccurrences.filter(
    (occurrence) =>
      occurrence.accountableMemberId !== null &&
      occurrence.accountableMemberId === activeSession.member.id,
  );
  const pendingCount = outbox.filter((item) => item.state !== "rejected").length;
  const primaryTab = primaryTabFor(location);
  const gatedLocation = gateLocation(location, activeSession);

  function selectPrimaryTab(next: PrimaryTab) {
    const destination: AppLocation =
      next === "today"
        ? { name: "today" }
        : next === "plan"
          ? { name: "plan" }
          : { name: "household" };
    if (!requestNavigate(destination, "push")) return;
    if (next === "household" && canDecide) {
      void refreshSupportingData(activeSession);
    }
  }

  function openHouseholdLeaf(leaf: Exclude<HouseholdLeaf, null>) {
    if (editorDirtyRef.current && !confirmDiscardDirty()) return;
    setEditorDirty(false);
    if (location.name !== "household") {
      applyLocation({ name: "household" }, "push");
    }
    setHouseholdLeaf(leaf);
    setTodaySecondary(null);
    if (leaf === "approvals") {
      void refreshSupportingData(activeSession);
    }
  }

  function openPersonalize() {
    if (!requestNavigate({ name: "today" }, "push")) return;
    setTodaySecondary("personalize");
    void refreshSupportingData(activeSession);
  }

  const showPlanTab = canManageShared;
  const householdCaps = {
    canDecide,
    canManageShared,
    canViewActivity: manager,
    canClearActivity,
    canManageDisplays,
  };
  const visibleHouseholdItems = HOUSEHOLD_MENU_ITEMS.filter((item) =>
    item.visible(householdCaps),
  );

  const showingTodayContent =
    gatedLocation.name === "today" && todaySecondary === null;
  const showingPersonalize =
    gatedLocation.name === "today" && todaySecondary === "personalize";
  const showingPreview =
    gatedLocation.name === "today" && todaySecondary === "preview";
  const showingPlan =
    showPlanTab &&
    (gatedLocation.name === "plan" ||
      gatedLocation.name === "plan-routine" ||
      gatedLocation.name === "plan-responsibility");
  const showingPlanRoutines =
    showingPlan && gatedLocation.name !== "plan-responsibility";
  const showingHouseholdMenu =
    gatedLocation.name === "household" && householdLeaf === null;
  const showingPeople =
    gatedLocation.name === "household-people" ||
    gatedLocation.name === "household-person" ||
    gatedLocation.name === "household-group";
  const showingSchoolCalendar = gatedLocation.name === "household-school-calendar";
  const showingActivity =
    gatedLocation.name === "household" && householdLeaf === "activity" && manager;
  const showingApprovals =
    gatedLocation.name === "household" && householdLeaf === "approvals" && canDecide;
  const showingHistory =
    (gatedLocation.name === "household-history" ||
      gatedLocation.name === "household-history-occurrence") &&
    canManageShared;
  const showingSettings =
    gatedLocation.name === "household-settings" && canClearActivity;
  const showingDisplays =
    gatedLocation.name === "household-displays" && canManageDisplays;
  const showingUnavailable =
    gatedLocation.name === "unavailable" ||
    ((location.name === "plan" ||
      location.name === "plan-routine" ||
      location.name === "plan-responsibility") &&
      !canManageShared) ||
    (gatedLocation.name === "household-settings" && !canClearActivity) ||
    (gatedLocation.name === "household-displays" && !canManageDisplays) ||
    ((gatedLocation.name === "household-history" ||
      gatedLocation.name === "household-history-occurrence") &&
      !canManageShared);

  const viewTitle = showingPersonalize
    ? "Personalize"
    : showingPreview
      ? "Preview"
      : showingApprovals
        ? "Approvals"
        : showingHistory
          ? "History"
          : showingDisplays
            ? "Household displays"
            : showingSettings
            ? "Settings"
            : showingActivity
              ? "Activity"
              : showingPeople
                ? "People & Groups"
                : showingSchoolCalendar
                  ? "School calendar"
                  : showingUnavailable
                    ? "Unavailable"
                    : primaryTab === "plan"
                      ? "Plan"
                      : primaryTab === "household"
                        ? "Household"
                        : "Today";

  const statusPills: ReactNode[] = [];
  if (connection === "offline") {
    statusPills.push(
      <span key="offline" className="status-pill" data-kind="offline">
        Offline
      </span>,
    );
  } else if (connection === "reconnecting") {
    statusPills.push(
      <span key="reconnecting" className="status-pill" data-kind="online">
        Reconnecting
      </span>,
    );
  }
  if (pendingCount > 0) {
    statusPills.push(
      <span key="pending" className="status-pill" data-kind="pending">
        {pendingCount} pending
      </span>,
    );
  }
  for (const item of outbox.filter((entry) => entry.state === "rejected")) {
    statusPills.push(
      <span key={item.mutationId} className="status-pill" data-kind="error">
        Rejected: {item.errorMessage ?? "Unable to sync"}
      </span>,
    );
  }
  if (error) {
    statusPills.push(
      <span key="error" className="status-pill" data-kind="error">
        {error}
      </span>,
    );
  }

  return (
    <main className="app-shell has-bottom-nav">
      {meta?.evaluationMode ? (
        <div className="eval-banner" role="status">
          {meta.banner}
        </div>
      ) : null}
      <header className="topbar">
        <div className="topbar-identity">
          <strong className="view-title">{viewTitle}</strong>
        </div>
        <div className="topbar-tools">
          <div className="account-menu">
            <button
              type="button"
              className="account-menu-trigger"
              aria-expanded={accountMenuOpen}
              aria-haspopup="menu"
              onClick={() => setAccountMenuOpen((open) => !open)}
            >
              Account
            </button>
            {accountMenuOpen ? (
              <div className="account-menu-panel" role="menu">
                <div className="account-detail">
                  <strong>{session.member.displayName}</strong>
                  <span>Household date {householdDate || session.householdDate}</span>
                  <span>{session.householdTimezone}</span>
                  <span className="dev-indicator" role="status">
                    Local development
                  </span>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    void signOut();
                  }}
                >
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {activityResetBanner ? (
        <div className="status-notice activity-reset-banner" role="status">
          <p>
            Activity history was cleared. Older unsynced checklist changes were not applied.
          </p>
          <button
            type="button"
            className="text-button"
            onClick={() => setActivityResetBanner(false)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {statusPills.length > 0 ? (
        <div className="status-line" aria-live="polite">
          {statusPills}
        </div>
      ) : null}

      <nav className="primary-nav primary-nav--top" aria-label="Primary">
        <PrimaryNavButton tab="today" current={primaryTab} onSelect={selectPrimaryTab}>
          Today
        </PrimaryNavButton>
        {showPlanTab ? (
          <PrimaryNavButton tab="plan" current={primaryTab} onSelect={selectPrimaryTab}>
            Plan
          </PrimaryNavButton>
        ) : null}
        <PrimaryNavButton
          tab="household"
          current={primaryTab}
          onSelect={selectPrimaryTab}
        >
          Household
        </PrimaryNavButton>
      </nav>

      {showingUnavailable ? (
        <section className="panel">
          <h1 className="page-heading">This view is unavailable</h1>
          <p className="meta">
            The page you opened is not available for this account, or it no longer exists.
          </p>
          <div className="button-row">
            <button
              type="button"
              className="primary"
              onClick={() => void requestNavigate({ name: "today" })}
            >
              Return to Today
            </button>
            <button
              type="button"
              onClick={() => void requestNavigate({ name: "household" })}
            >
              Return to Household
            </button>
          </div>
        </section>
      ) : null}

      {!showingUnavailable && showingTodayContent ? (
        <TodayView
          occurrences={projectedOwn}
          tasks={tasks.filter((task) => task.ownerMembershipId === session.member.id)}
          pendingOccurrenceIds={
            new Set(
              outbox
                .filter((item) => item.state !== "rejected")
                .map((item) => item.occurrenceId),
            )
          }
          canExecuteRoutine={hasGrant(session, "routine.execute.own")}
          canExecuteResponsibility={hasGrant(session, "responsibility.execute.own")}
          canPersonalize={canPersonalize}
          onOpenPersonalize={openPersonalize}
          onStepChange={queueStepChange}
          focusScopeKey={`${session.member.id}:${householdDate || session.householdDate}`}
          occurrencesLoaded={occurrencesLoaded}
          onTasksChanged={(next) =>
            setTasks((current) => [
              ...current.filter((task) => task.ownerMembershipId !== session.member.id),
              ...next,
            ])
          }
        />
      ) : null}
      {!showingUnavailable && showingPlanRoutines ? (
        <RoutinesView
          memberships={memberships}
          today={householdDate || session.householdDate}
          refreshToken={routineRefreshToken}
          planHome={gatedLocation.name === "plan"}
          onCreateResponsibility={() =>
            requestNavigate({ name: "plan-responsibility", definitionId: "new" })
          }
          responsibilitiesSlot={
            gatedLocation.name === "plan" ? (
              <ResponsibilitiesView
                memberships={memberships}
                today={householdDate || session.householdDate}
                refreshToken={routineRefreshToken}
                listOnly
                route={{ kind: "list" }}
                onRouteChange={(next) => {
                  if (next.kind === "list") {
                    requestNavigate({ name: "plan" });
                  } else if (next.kind === "create") {
                    requestNavigate({ name: "plan-responsibility", definitionId: "new" });
                  } else {
                    requestNavigate({
                      name: "plan-responsibility",
                      definitionId: next.definitionId,
                    });
                  }
                }}
                onDirtyChange={(dirty) => {
                  editorDirtyRef.current = dirty;
                  setEditorDirty(dirty);
                }}
                onSuccessToast={(message) => showToast(message)}
                onSaved={() => {
                  setRoutineRefreshToken((n) => n + 1);
                  void refreshToday(session.member.id);
                }}
              />
            ) : null
          }
          route={
            gatedLocation.name === "plan-routine"
              ? { kind: "detail", definitionId: gatedLocation.definitionId }
              : { kind: "list" }
          }
          onRouteChange={(next) => {
            if (next.kind === "list") {
              requestNavigate({ name: "plan" });
            } else {
              requestNavigate({
                name: "plan-routine",
                definitionId: next.definitionId,
              });
            }
          }}
          onDirtyChange={(dirty) => {
            editorDirtyRef.current = dirty;
            setEditorDirty(dirty);
          }}
          onSuccessToast={(message) => showToast(message)}
          onSaved={() => {
            setRoutineRefreshToken((n) => n + 1);
            void refreshToday(session.member.id);
          }}
          onEnded={() => {
            setRoutineRefreshToken((n) => n + 1);
            void refreshToday(session.member.id);
          }}
          onDeleted={() => {
            setRoutineRefreshToken((n) => n + 1);
            void refreshToday(session.member.id);
          }}
        />
      ) : null}
      {!showingUnavailable &&
      showingPlan &&
      gatedLocation.name === "plan-responsibility" ? (
        <ResponsibilitiesView
          memberships={memberships}
          today={householdDate || session.householdDate}
          refreshToken={routineRefreshToken}
          route={
            gatedLocation.definitionId === "new"
              ? { kind: "create" }
              : { kind: "detail", definitionId: gatedLocation.definitionId }
          }
          onRouteChange={(next) => {
            if (next.kind === "list") {
              requestNavigate({ name: "plan" });
            } else if (next.kind === "create") {
              requestNavigate({ name: "plan-responsibility", definitionId: "new" });
            } else {
              requestNavigate({
                name: "plan-responsibility",
                definitionId: next.definitionId,
              });
            }
          }}
          onDirtyChange={(dirty) => {
            editorDirtyRef.current = dirty;
            setEditorDirty(dirty);
          }}
          onSuccessToast={(message) => showToast(message)}
          onSaved={() => {
            setRoutineRefreshToken((n) => n + 1);
            void refreshToday(session.member.id);
          }}
          onEnded={() => {
            setRoutineRefreshToken((n) => n + 1);
            void refreshToday(session.member.id);
          }}
          onDeleted={() => {
            setRoutineRefreshToken((n) => n + 1);
            void refreshToday(session.member.id);
          }}
        />
      ) : null}
      {!showingUnavailable && showingHouseholdMenu ? (
        householdCaps.canViewActivity ? (
          <HouseholdOverview
            occurrences={projectedOccurrences}
            tasks={tasks.filter((task) => task.visibility === "household")}
            memberships={memberships}
            pendingOccurrenceIds={
              new Set(
                outbox
                  .filter((item) => item.state !== "rejected")
                  .map((item) => item.occurrenceId),
              )
            }
            canManageResponsibility={hasGrant(activeSession, "responsibility.manage")}
            occurrencesLoaded={occurrencesLoaded}
            onRepairUnassigned={(definitionId) =>
              requestNavigate({ name: "plan-responsibility", definitionId })
            }
            managementLinks={visibleHouseholdItems
              .filter((item) => item.id !== "activity")
              .map((item) => ({
                id: item.id,
                label: item.label,
                description: item.description,
                onOpen: () => {
                  if (item.id === "people-groups") {
                    requestNavigate({ name: "household-people" });
                    void refreshSupportingData(activeSession);
                    return;
                  }
                  if (item.id === "school-calendar") {
                    requestNavigate({ name: "household-school-calendar" });
                    return;
                  }
                  if (item.id === "history") {
                    requestNavigate({
                      name: "household-history",
                      filters: {
                        date: householdDate || activeSession.householdDate,
                      },
                    });
                    return;
                  }
                  if (item.id === "settings") {
                    requestNavigate({ name: "household-settings" });
                    return;
                  }
                  if (item.id === "displays") {
                    requestNavigate({ name: "household-displays" });
                    return;
                  }
                  if (item.id === "approvals") {
                    openHouseholdLeaf("approvals");
                  }
                },
              }))}
          />
        ) : (
          <section>
            <h1 className="page-heading">Household</h1>
            <p className="page-subcopy">
              People, structure, and oversight for this household.
            </p>
            <nav className="household-nav" aria-label="Household">
              {visibleHouseholdItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="list-row"
                  onClick={() => {
                    if (item.id === "people-groups") {
                      requestNavigate({ name: "household-people" });
                      void refreshSupportingData(activeSession);
                      return;
                    }
                    if (item.id === "school-calendar") {
                      requestNavigate({ name: "household-school-calendar" });
                      return;
                    }
                    if (item.id === "history") {
                      requestNavigate({
                        name: "household-history",
                        filters: {
                          date: householdDate || activeSession.householdDate,
                        },
                      });
                      return;
                    }
                    if (item.id === "settings") {
                      requestNavigate({ name: "household-settings" });
                      return;
                    }
                    if (item.id === "displays") {
                      requestNavigate({ name: "household-displays" });
                      return;
                    }
                    if (item.id === "approvals" || item.id === "activity") {
                      openHouseholdLeaf(item.id);
                    }
                  }}
                >
                  <span>{item.label}</span>
                  <span className="meta">{item.description}</span>
                </button>
              ))}
            </nav>
          </section>
        )
      ) : null}
      {!showingUnavailable && showingSchoolCalendar ? (
        <SchoolCalendarView
          today={householdDate || session.householdDate}
          canManage={canManageSchedule}
          refreshToken={schoolCalendarRefreshToken}
          onBack={() => requestNavigate({ name: "household" })}
          onDirtyChange={(dirty) => {
            editorDirtyRef.current = dirty;
            setEditorDirty(dirty);
          }}
          onSuccessToast={(message) => {
            setSchoolCalendarRefreshToken((n) => n + 1);
            showToast(message);
          }}
        />
      ) : null}
      {!showingUnavailable && showingPeople ? (
        <PeopleGroupsView
          memberships={memberships}
          tasks={tasks.filter((task) => task.visibility === "household")}
          occurrences={projectedOccurrences}
          familyOrderVersion={familyOrderVersion}
          canManageStructure={canManageStructure}
          canEnroll={canEnroll}
          canViewActivity={false}
          entry={
            gatedLocation.name === "household-person"
              ? "person"
              : gatedLocation.name === "household-group"
                ? "group"
                : "overview"
          }
          personId={
            gatedLocation.name === "household-person"
              ? gatedLocation.membershipId
              : undefined
          }
          groupId={
            gatedLocation.name === "household-group" ? gatedLocation.groupId : undefined
          }
          onNavigate={(next) => {
            if (next.kind === "overview") {
              requestNavigate({ name: "household-people" });
            } else if (next.kind === "person") {
              requestNavigate({
                name: "household-person",
                membershipId: next.personId,
              });
            } else {
              requestNavigate({ name: "household-group", groupId: next.groupId });
            }
          }}
          onExit={() => requestNavigate({ name: "household" })}
          onPeopleChanged={(update) => {
            if (update) {
              setMemberships(update.people);
              setFamilyOrderVersion(update.familyOrderVersion);
            }
            if (activeSession) void refreshSupportingData(activeSession);
          }}
          onDirtyChange={(dirty) => {
            editorDirtyRef.current = dirty;
            setEditorDirty(dirty);
          }}
        />
      ) : null}
      {!showingUnavailable && showingActivity ? (
        <>
          <button type="button" className="back-link" onClick={() => setHouseholdLeaf(null)}>
            Back to Household
          </button>
          <HouseholdOverview
            occurrences={projectedOccurrences}
            tasks={tasks.filter((task) => task.visibility === "household")}
            memberships={memberships}
            pendingOccurrenceIds={
              new Set(
                outbox
                  .filter((item) => item.state !== "rejected")
                  .map((item) => item.occurrenceId),
              )
            }
            canManageResponsibility={hasGrant(activeSession, "responsibility.manage")}
            occurrencesLoaded={occurrencesLoaded}
            onRepairUnassigned={(definitionId) =>
              requestNavigate({ name: "plan-responsibility", definitionId })
            }
            managementLinks={visibleHouseholdItems
              .filter((item) => item.id !== "activity")
              .map((item) => ({
                id: item.id,
                label: item.label,
                description: item.description,
                onOpen: () => {
                  setHouseholdLeaf(null);
                  if (item.id === "people-groups") {
                    requestNavigate({ name: "household-people" });
                    void refreshSupportingData(activeSession);
                    return;
                  }
                  if (item.id === "school-calendar") {
                    requestNavigate({ name: "household-school-calendar" });
                    return;
                  }
                  if (item.id === "history") {
                    requestNavigate({
                      name: "household-history",
                      filters: {
                        date: householdDate || activeSession.householdDate,
                      },
                    });
                    return;
                  }
                  if (item.id === "settings") {
                    requestNavigate({ name: "household-settings" });
                    return;
                  }
                  if (item.id === "displays") {
                    requestNavigate({ name: "household-displays" });
                    return;
                  }
                  if (item.id === "approvals") {
                    openHouseholdLeaf("approvals");
                  }
                },
              }))}
          />
        </>
      ) : null}
      {!showingUnavailable && showingApprovals ? (
        <ApprovalsView
          proposals={proposals}
          memberships={memberships}
          today={householdDate || session.householdDate}
          onBack={() => setHouseholdLeaf(null)}
          onChanged={(next) => {
            setProposals((current) =>
              current.map((proposal) => (proposal.id === next.id ? next : proposal)),
            );
          }}
          onApproved={(next, effectiveDate) =>
            showToast(`"${next.text}" was approved. Effective ${effectiveDate}.`, {
              actionLabel: next.definitionId ? "Preview" : undefined,
              onAction: next.definitionId
                ? () =>
                    void openPreview(next.membershipId, effectiveDate, next.definitionId!)
                : undefined,
            })
          }
        />
      ) : null}
      {!showingUnavailable && showingHistory ? (
        <HistoryView
          householdDate={householdDate || session.householdDate}
          memberships={memberships}
          filters={
            gatedLocation.name === "household-history" ||
            gatedLocation.name === "household-history-occurrence"
              ? gatedLocation.filters
              : undefined
          }
          occurrenceId={
            gatedLocation.name === "household-history-occurrence"
              ? gatedLocation.occurrenceId
              : undefined
          }
          refreshToken={historyRefreshToken}
          knownActivityGeneration={knownActivityGeneration}
          onFiltersChange={(filters: HistoryFilters) => {
            requestNavigate({ name: "household-history", filters }, "replace");
          }}
          onOpenOccurrence={(occurrenceId, filters) => {
            requestNavigate({
              name: "household-history-occurrence",
              occurrenceId,
              filters,
            });
          }}
          onBack={() => requestNavigate({ name: "household" })}
          onBackToSummary={(filters) => {
            requestNavigate({ name: "household-history", filters });
          }}
          onActivityGeneration={(generation) => {
            void noteActivityGeneration(session.member.id, generation);
          }}
          onOpenPreview={() => {
            requestNavigate({ name: "today" });
          }}
        />
      ) : null}
      {!showingUnavailable && showingSettings ? (
        <HouseholdSettingsView
          expectedGeneration={knownActivityGeneration}
          canClearActivity={canClearActivity}
          onBack={() => requestNavigate({ name: "household" })}
          onCleared={(generation) => {
            void noteActivityGeneration(session.member.id, generation);
            setHistoryRefreshToken((n) => n + 1);
          }}
          onSuccessToast={(message) => showToast(message)}
        />
      ) : null}
      {!showingUnavailable && showingDisplays ? (
        <HouseholdDisplaysView
          onBack={() => requestNavigate({ name: "household" })}
          onSuccessToast={(message) => showToast(message)}
        />
      ) : null}
      {!showingUnavailable && showingPersonalize && canDirect ? (
        <DirectPersonalization
          onBack={() => setTodaySecondary(null)}
          onPreview={(definitionId) =>
            void openPreview(
              session.member.id,
              addDays(householdDate || session.householdDate, 1),
              definitionId,
            )
          }
          onSaved={(layer) =>
            showToast(
              `Your personal settings were saved. Effective ${layer.effectiveDate}.`,
              {
                actionLabel: "Preview",
                onAction: () =>
                  void openPreview(
                    layer.membershipId,
                    layer.effectiveDate,
                    layer.definitionId,
                  ),
              },
            )
          }
        />
      ) : null}
      {!showingUnavailable && showingPersonalize && !canDirect && canPropose ? (
        <ProposalPersonalization
          proposals={proposals}
          onBack={() => setTodaySecondary(null)}
          onCreated={(proposal) => setProposals((current) => [proposal, ...current])}
        />
      ) : null}
      {!showingUnavailable && showingPersonalize && !canDirect && !canPropose ? (
        <section className="panel">
          <button
            type="button"
            className="back-link"
            onClick={() => setTodaySecondary(null)}
          >
            Back to Today
          </button>
          <h1 className="page-heading">Personalize</h1>
          <p className="status-notice" role="status">
            This account cannot add personal routine items. Ask a manager to enroll with a
            personalizer preset.
          </p>
        </section>
      ) : null}
      {!showingUnavailable && showingPreview && preview ? (
        <PreviewView
          preview={preview}
          onBack={() => setTodaySecondary(previewReturn)}
        />
      ) : null}

      <ToastHost toast={toast} onDismiss={clearToast} />

      <nav className="primary-nav primary-nav--bottom" aria-label="Primary">
        <PrimaryNavButton tab="today" current={primaryTab} onSelect={selectPrimaryTab}>
          Today
        </PrimaryNavButton>
        {showPlanTab ? (
          <PrimaryNavButton tab="plan" current={primaryTab} onSelect={selectPrimaryTab}>
            Plan
          </PrimaryNavButton>
        ) : null}
        <PrimaryNavButton
          tab="household"
          current={primaryTab}
          onSelect={selectPrimaryTab}
        >
          Household
        </PrimaryNavButton>
      </nav>
    </main>
  );
}

function PrimaryNavButton(props: {
  tab: PrimaryTab;
  current: PrimaryTab;
  onSelect: (tab: PrimaryTab) => void;
  children: string;
}) {
  return (
    <button
      type="button"
      className="nav-item"
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
        <h1 className="page-heading">
          {mode === "login" ? "Sign in" : "Claim your household account"}
        </h1>
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

function AdditionFields(props: {
  addition: Omit<PersonalAddition, "position">;
  anchors: Array<{ logicalItemId: string; text: string }>;
  onChange: (addition: Omit<PersonalAddition, "position">) => void;
}) {
  const rule = props.addition.applicability ?? { kind: "every_time" as const };
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
        Applicability
        <select
          value={rule.kind}
          onChange={(event) => {
            const kind = event.target.value as ApplicabilityRule["kind"];
            const next: ApplicabilityRule =
              kind === "selected_days"
                ? { kind: "selected_days", weekdays: rule.kind === "selected_days" ? rule.weekdays : [1] }
                : { kind };
            props.onChange({ ...props.addition, applicability: next });
          }}
        >
          <option value="every_time">Every time this routine runs</option>
          <option value="school_days">School days</option>
          <option value="no_school_days">No-school days</option>
          <option value="school_nights">School nights</option>
          <option value="weekdays">Weekdays</option>
          <option value="weekends">Weekends</option>
          <option value="selected_days">Selected days</option>
        </select>
      </label>
      {rule.kind === "selected_days" ? (
        <fieldset className="weekday-fieldset">
          <legend>Selected days</legend>
          {[
            [1, "Mon"],
            [2, "Tue"],
            [3, "Wed"],
            [4, "Thu"],
            [5, "Fri"],
            [6, "Sat"],
            [7, "Sun"],
          ].map(([value, label]) => {
            const day = value as number;
            const checked = rule.weekdays.includes(day);
            return (
              <label key={day} className="inline-check">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const weekdays = checked
                      ? rule.weekdays.filter((item) => item !== day)
                      : [...rule.weekdays, day].sort((a, b) => a - b);
                    props.onChange({
                      ...props.addition,
                      applicability: {
                        kind: "selected_days",
                        weekdays: weekdays.length ? weekdays : [day],
                      },
                    });
                  }}
                />
                {label}
              </label>
            );
          })}
        </fieldset>
      ) : null}
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
  onBack: () => void;
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
      <button type="button" className="back-link" onClick={props.onBack}>
        Back to Today
      </button>
      <h1 className="page-heading">Personalize settings</h1>
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
        <OrderedList
          listLabel="Personal additions"
          items={additions.map((addition) => ({
            id: addition.id,
            label: addition.text.trim() || "Personal item",
            addition,
          }))}
          onReorder={(next) => setAdditions(next.map((item) => item.addition))}
          renderRow={(item) => (
            <div className="step-editor">
              <AdditionFields
                addition={item.addition}
                anchors={anchors}
                onChange={(nextAddition) =>
                  setAdditions((current) =>
                    current.map((entry) =>
                      entry.id === item.id ? nextAddition : entry,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="text-button danger-text"
                onClick={() =>
                  setAdditions((current) =>
                    current.filter((entry) => entry.id !== item.id),
                  )
                }
              >
                Remove
              </button>
            </div>
          )}
        />
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
  onBack: () => void;
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
      <button type="button" className="back-link" onClick={props.onBack}>
        Back to Today
      </button>
      <h1 className="page-heading">Propose a personal item</h1>
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
  onBack: () => void;
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
      <button type="button" className="back-link" onClick={props.onBack}>
        Back to Household
      </button>
      <h1 className="page-heading">Approvals</h1>
      {pending.length === 0 ? (
        <div className="empty-state">
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
                {proposal.applicability && proposal.applicability.kind !== "every_time"
                  ? ` · ${proposal.applicability.kind.replaceAll("_", " ")}`
                  : ""}
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
  const excluded = props.preview.excludedSteps ?? [];
  return (
    <section className="panel">
      <button type="button" className="back-link" onClick={props.onBack}>
        {props.preview ? "Close preview" : "Back"}
      </button>
      <p className="eyebrow">Read-only preview</p>
      <h1 className="page-heading">{props.preview.title}</h1>
      <p className="meta">Effective view for {props.preview.householdDate}</p>
      {props.preview.message ? <p className="meta">{props.preview.message}</p> : null}
      {props.preview.steps.length > 0 ? (
        <>
          <h2 className="section-heading">Included</h2>
          <ol className="preview-list">
            {props.preview.steps.map((step) => (
              <li key={`${step.logicalItemId}-${step.position}`}>
                <div>
                  <strong>{step.text}</strong>
                  <div className="meta">
                    {obligationLabel(step.obligation)} ·{" "}
                    {step.source === "personal" ? "Personal addition" : "Shared routine"}
                    {step.reason ? ` · ${step.reason}` : ""}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : null}
      {excluded.length > 0 ? (
        <>
          <h2 className="section-heading">Not included</h2>
          <ol className="preview-list">
            {excluded.map((step) => (
              <li key={`ex-${step.logicalItemId}-${step.position}`}>
                <div>
                  <strong>{step.text}</strong>
                  <div className="meta">
                    {step.reason ?? "Not applicable"}
                    {step.unresolved ? " · Needs school calendar" : ""}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : null}
      <button type="button" className="secondary" onClick={props.onBack}>
        Close preview
      </button>
    </section>
  );
}
