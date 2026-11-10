import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  fetchDisplayPreviewDashboard,
  fetchDisplayPreviewOccurrence,
  fetchDisplayPreviewPerson,
  fetchDisplayPreviewPersonDay,
  type ApiError,
  type SessionInfo,
} from "./api";
import type {
  DisplayDashboard,
  DisplayOccurrenceDetail,
  DisplayPersonDay,
  DisplayPersonDetail,
} from "./display-api";
import type { FamilyPanePhase } from "./family-board";
import type { DisplayDetailState, DisplayOrganization } from "./display-presentation";
import {
  PREVIEW_FRAME_PATH,
  PREVIEW_POLL_MS,
  PREVIEW_STALE_MAX_MS,
  PREVIEW_VIEWPORT_PRESETS,
  fitScale,
  isPreviewFrameNav,
  parsePreviewViewport,
  previewViewportSearch,
  stripPreviewCommandMetadata,
  type PreviewFrameState,
  type PreviewViewport,
} from "./display-preview";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDenied(error: unknown): boolean {
  const apiError = error as ApiError;
  return (
    apiError.status === 401 ||
    apiError.status === 403 ||
    apiError.status === 404 ||
    apiError.code === "UNAUTHORIZED" ||
    apiError.code === "FORBIDDEN" ||
    apiError.code === "NOT_FOUND"
  );
}

function staleMaxMs(): number {
  const override = window.__HD_PREVIEW_STALE_MS;
  if (typeof override === "number" && override > 0) return override;
  return PREVIEW_STALE_MAX_MS;
}

function pollMs(): number {
  const override = window.__HD_PREVIEW_POLL_MS;
  if (typeof override === "number" && override > 0) return override;
  return PREVIEW_POLL_MS;
}

declare global {
  interface Window {
    __HD_PREVIEW_STALE_MS?: number;
    __HD_PREVIEW_POLL_MS?: number;
    __HD_PREVIEW_NOW_MS?: number;
    __HD_PREVIEW_FORCE_STALE__?: () => void;
  }
}

export function DisplayPreviewHost(props: {
  displayId: string;
  session: SessionInfo;
  refreshToken: number;
  onBack: () => void;
  onViewportChange: (search: string) => void;
  onAuthorityLost: () => void;
}) {
  const [viewport, setViewport] = useState<PreviewViewport>(() =>
    parsePreviewViewport(window.location.search),
  );
  const [customWidth, setCustomWidth] = useState(String(viewport.width));
  const [customHeight, setCustomHeight] = useState(String(viewport.height));
  const [viewportError, setViewportError] = useState<string | null>(null);
  const [label, setLabel] = useState("Display");
  const [dashboard, setDashboard] = useState<DisplayDashboard | null>(null);
  const [person, setPerson] = useState<DisplayPersonDetail | null>(null);
  const [occurrence, setOccurrence] = useState<DisplayOccurrenceDetail | null>(null);
  const [organization, setOrganization] = useState<DisplayOrganization>("by-person");
  const [detail, setDetail] = useState<DisplayDetailState | null>(null);
  const [detailUnavailable, setDetailUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [frameReady, setFrameReady] = useState(false);
  const [personDays, setPersonDays] = useState<Record<string, DisplayPersonDay | null>>({});
  const [panePhase, setPanePhase] = useState<Record<string, FamilyPanePhase>>({});
  const paneGenRef = useRef<Record<string, number>>({});
  const paneEpochRef = useRef(0);
  const paneStartedRef = useRef<Record<string, number>>({});
  const paneSuccessStartedRef = useRef<Record<string, number>>({});
  const panePhaseRef = useRef<Record<string, FamilyPanePhase>>({});
  const paneLoadQueueRef = useRef<string[]>([]);
  const paneLoadActiveRef = useRef(0);
  const organizationRef = useRef(organization);
  organizationRef.current = organization;
  panePhaseRef.current = panePhase;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const dashSeqRef = useRef(0);
  const detailSeqRef = useRef(0);
  const acceptedDashSeqRef = useRef(0);
  const acceptedDetailSeqRef = useRef(0);
  const lastSuccessStartRef = useRef<number | null>(null);
  const lastSuccessEpochRef = useRef<number | null>(null);
  const lastSuccessGenerationRef = useRef<number | null>(null);
  const lastSuccessDateRef = useRef<string | null>(null);
  const lastSuccessDisplayRef = useRef<string | null>(null);
  const withdrawnPersonalRef = useRef<Set<string>>(new Set());
  const blankedAtRef = useRef<number | null>(null);
  const dashboardRef = useRef<DisplayDashboard | null>(null);
  const sessionRef = useRef(props.session);
  const selectedDisplayRef = useRef(props.displayId);
  const detailRef = useRef(detail);
  sessionRef.current = props.session;
  selectedDisplayRef.current = props.displayId;
  detailRef.current = detail;
  dashboardRef.current = dashboard;

  function nowMs(): number {
    return typeof window.__HD_PREVIEW_NOW_MS === "number"
      ? window.__HD_PREVIEW_NOW_MS
      : Date.now();
  }

  function clearContent(): void {
    paneEpochRef.current += 1;
    setDashboard(null);
    setPerson(null);
    setOccurrence(null);
    setDetail(null);
    setDetailUnavailable(false);
    setPersonDays({});
    setPanePhase({});
    paneLoadQueueRef.current = [];
    paneLoadActiveRef.current = 0;
    paneStartedRef.current = {};
    paneSuccessStartedRef.current = {};
    lastSuccessStartRef.current = null;
    blankedAtRef.current = Date.now();
  }

  function filterWithdrawn(nextDashboard: DisplayDashboard): DisplayDashboard {
    if (withdrawnPersonalRef.current.size === 0) return nextDashboard;
    return {
      ...nextDashboard,
      promotedPersonalTasks: nextDashboard.promotedPersonalTasks.filter(
        (task) => !withdrawnPersonalRef.current.has(task.id),
      ),
      byPerson: nextDashboard.byPerson.map((personRow) => ({
        ...personRow,
        promotedPersonalTasks: personRow.promotedPersonalTasks.filter(
          (task) => !withdrawnPersonalRef.current.has(task.id),
        ),
      })),
    };
  }

  function acceptContext(payload: {
    displayId: string;
    householdDate: string;
    activityGeneration: number;
    installationEpoch: number;
    requestSeq: number;
    kind: "dashboard" | "detail";
  }): boolean {
    if (payload.displayId !== props.displayId) return false;
    if (payload.installationEpoch !== sessionRef.current.installationEpoch) return false;
    if (payload.kind === "dashboard") {
      if (payload.requestSeq < acceptedDashSeqRef.current) return false;
      if (
        lastSuccessGenerationRef.current !== null &&
        payload.activityGeneration < lastSuccessGenerationRef.current
      ) {
        return false;
      }
      if (
        lastSuccessDateRef.current !== null &&
        payload.householdDate < lastSuccessDateRef.current
      ) {
        return false;
      }
      acceptedDashSeqRef.current = payload.requestSeq;
      lastSuccessEpochRef.current = payload.installationEpoch;
      lastSuccessGenerationRef.current = payload.activityGeneration;
      lastSuccessDateRef.current = payload.householdDate;
      lastSuccessDisplayRef.current = payload.displayId;
      return true;
    }
    if (payload.requestSeq < acceptedDetailSeqRef.current) return false;
    if (payload.displayId !== lastSuccessDisplayRef.current && lastSuccessDisplayRef.current) {
      return false;
    }
    if (
      lastSuccessDateRef.current &&
      payload.householdDate !== lastSuccessDateRef.current
    ) {
      return false;
    }
    if (
      lastSuccessGenerationRef.current !== null &&
      payload.activityGeneration !== lastSuccessGenerationRef.current
    ) {
      return false;
    }
    if (
      lastSuccessEpochRef.current !== null &&
      payload.installationEpoch !== lastSuccessEpochRef.current
    ) {
      return false;
    }
    acceptedDetailSeqRef.current = payload.requestSeq;
    return true;
  }

  const loadPreviewPersonDay = useEffectEvent(async (membershipId: string) => {
    const epoch = paneEpochRef.current;
    const selectedDisplay = props.displayId;
    const gen = (paneGenRef.current[membershipId] ?? 0) + 1;
    paneGenRef.current[membershipId] = gen;
    const startedAt = nowMs();
    paneStartedRef.current[membershipId] = startedAt;
    setPanePhase((current) => {
      const prev = current[membershipId];
      const keep =
        prev === "ready" || prev === "unavailable" || prev === "blank" ? prev : "loading";
      if (prev === keep) return current;
      return { ...current, [membershipId]: keep };
    });
    try {
      const payload = await fetchDisplayPreviewPersonDay(selectedDisplay, membershipId);
      if (paneEpochRef.current !== epoch || selectedDisplayRef.current !== selectedDisplay) return;
      if (paneGenRef.current[membershipId] !== gen) return;
      if (nowMs() - startedAt >= staleMaxMs()) {
        setPersonDays((current) => ({ ...current, [membershipId]: null }));
        setPanePhase((current) => ({ ...current, [membershipId]: "blank" }));
        return;
      }
      if (payload.installationEpoch !== sessionRef.current.installationEpoch) return;
      if (
        lastSuccessDateRef.current &&
        payload.householdDate !== lastSuccessDateRef.current
      ) {
        return;
      }
      if (
        lastSuccessEpochRef.current !== null &&
        payload.installationEpoch !== lastSuccessEpochRef.current
      ) {
        return;
      }
      if (
        lastSuccessGenerationRef.current !== null &&
        payload.activityGeneration !== lastSuccessGenerationRef.current
      ) {
        return;
      }
      if (payload.displayId !== props.displayId) return;
      const day = {
        ...payload.personDay,
        occurrences: payload.personDay.occurrences.map((occurrence) =>
          stripPreviewCommandMetadata(occurrence),
        ),
        promotedPersonalTasks: payload.personDay.promotedPersonalTasks.filter(
          (task) => !withdrawnPersonalRef.current.has(task.id),
        ),
      };
      paneSuccessStartedRef.current[membershipId] = startedAt;
      setPersonDays((current) => ({ ...current, [membershipId]: day }));
      setPanePhase((current) => ({ ...current, [membershipId]: "ready" }));
    } catch (caught) {
      if (paneEpochRef.current !== epoch || selectedDisplayRef.current !== selectedDisplay) return;
      const apiError = caught as ApiError;
      if (
        apiError.status === 401 ||
        apiError.status === 403 ||
        apiError.code === "UNAUTHORIZED" ||
        apiError.code === "FORBIDDEN"
      ) {
        clearContent();
        setError(errorMessage(caught));
        if (apiError.status === 401 || apiError.code === "UNAUTHORIZED") {
          props.onAuthorityLost();
        }
        return;
      }
      if (apiError.status === 404) {
        if (paneGenRef.current[membershipId] === gen) {
          setPersonDays((current) => ({ ...current, [membershipId]: null }));
        }
        // A day read uses 404 for both an absent person and an inaccessible
        // selected display. Revalidate the display before treating it as local.
        try {
          await fetchDisplayPreviewDashboard(selectedDisplay);
          if (paneEpochRef.current !== epoch || selectedDisplayRef.current !== selectedDisplay || paneGenRef.current[membershipId] !== gen) return;
        } catch (verificationError) {
          if (paneEpochRef.current !== epoch || selectedDisplayRef.current !== selectedDisplay) return;
          clearContent();
          setError(errorMessage(verificationError));
          const verification = verificationError as ApiError;
          if (verification.status === 401 || verification.code === "UNAUTHORIZED") {
            props.onAuthorityLost();
          }
          return;
        }
      }
      if (paneGenRef.current[membershipId] !== gen) return;
      setPanePhase((current) =>
        current[membershipId] === "unavailable"
          ? current
          : { ...current, [membershipId]: "unavailable" },
      );
    }
  });

  const pumpPreviewPersonDays = useEffectEvent(() => {
    const limit = 2;
    while (paneLoadActiveRef.current < limit && paneLoadQueueRef.current.length > 0) {
      const membershipId = paneLoadQueueRef.current.shift();
      if (!membershipId) break;
      paneLoadActiveRef.current += 1;
      void loadPreviewPersonDay(membershipId).finally(() => {
        paneLoadActiveRef.current = Math.max(0, paneLoadActiveRef.current - 1);
        pumpPreviewPersonDays();
      });
    }
  });

  const refreshPreviewPersonDays = useEffectEvent((membershipIds: string[]) => {
    if (organizationRef.current !== "by-person" || detailRef.current) return;
    for (const membershipId of membershipIds) {
      if (!paneLoadQueueRef.current.includes(membershipId)) {
        paneLoadQueueRef.current.push(membershipId);
      }
    }
    pumpPreviewPersonDays();
  });

  const loadDashboard = useEffectEvent(async (reason: "poll" | "sync" | "open") => {
    const startedAt = nowMs();
    const startedWall = Date.now();
    const seq = ++dashSeqRef.current;
    try {
      const payload = await fetchDisplayPreviewDashboard(props.displayId);
      if (blankedAtRef.current !== null && startedWall <= blankedAtRef.current) {
        return;
      }
      if (nowMs() - startedAt > staleMaxMs()) {
        return;
      }
      if (!acceptContext({ ...payload, requestSeq: seq, kind: "dashboard" })) {
        return;
      }
      const rawDashboard = stripPreviewCommandMetadata(payload.dashboard);
      const previousPromoted = new Set(
        (dashboardRef.current?.promotedPersonalTasks ?? []).map((task) => task.id),
      );
      const nextIds = new Set(rawDashboard.promotedPersonalTasks.map((task) => task.id));
      let promotionChanged = previousPromoted.size !== nextIds.size;
      for (const id of previousPromoted) {
        if (!nextIds.has(id)) {
          withdrawnPersonalRef.current.add(id);
          promotionChanged = true;
        }
      }
      for (const id of nextIds) {
        if (!previousPromoted.has(id)) promotionChanged = true;
        withdrawnPersonalRef.current.delete(id);
      }
      // Fence bodies requested before either withdrawal or re-promotion.
      if (promotionChanged) paneEpochRef.current += 1;
      const nextDashboard = filterWithdrawn(rawDashboard);
      blankedAtRef.current = null;
      setDashboard(nextDashboard);
      const members = new Set(nextDashboard.byPerson.map((row) => row.membershipId));
      setPersonDays((current) => {
        const next: Record<string, DisplayPersonDay | null> = {};
        for (const [id, day] of Object.entries(current)) {
          if (!members.has(id)) continue;
          if (!day) {
            next[id] = day;
            continue;
          }
          next[id] = {
            ...day,
            promotedPersonalTasks: day.promotedPersonalTasks.filter(
              (task) => !withdrawnPersonalRef.current.has(task.id),
            ),
          };
        }
        return next;
      });
      setLabel(payload.label);
      setError(null);
      setStale(false);
      lastSuccessStartRef.current = startedAt;
      setLoading(false);
      refreshPreviewPersonDays(nextDashboard.byPerson.map((row) => row.membershipId));
      const currentDetail = detailRef.current;
      if (currentDetail?.kind === "person") {
        if (
          !nextDashboard.byPerson.some(
            (row) => row.membershipId === currentDetail.membershipId,
          )
        ) {
          setPerson(null);
          setDetailUnavailable(true);
        }
      }
      if (
        currentDetail?.kind === "occurrence" ||
        currentDetail?.kind === "routine-person"
      ) {
        const stillListed = nextDashboard.byPerson.some((row) =>
          row.unfinished.some((item) => item.occurrenceId === currentDetail.occurrenceId),
        );
        if (!stillListed) {
          /* keep open; detail reload decides unavailable */
        }
      }
    } catch (caught) {
      if (isDenied(caught)) {
        acceptedDashSeqRef.current = Math.max(acceptedDashSeqRef.current, seq);
        clearContent();
        setError(errorMessage(caught));
        if ((caught as ApiError).status === 401 || (caught as ApiError).code === "UNAUTHORIZED") {
          props.onAuthorityLost();
        }
        return;
      }
      if (reason === "open") {
        setError(errorMessage(caught));
        setLoading(false);
      }
    }
  });

  const loadDetail = useEffectEvent(async () => {
    const current = detailRef.current;
    if (!current) return;
    const startedAt = nowMs();
    const startedWall = Date.now();
    const seq = ++detailSeqRef.current;
    setDetailUnavailable(false);
    try {
      if (current.kind === "person") {
        const payload = await fetchDisplayPreviewPerson(
          props.displayId,
          current.membershipId,
        );
        if (blankedAtRef.current !== null && startedWall <= blankedAtRef.current) return;
        if (nowMs() - startedAt > staleMaxMs()) return;
        if (detailRef.current?.kind !== "person" || detailRef.current.membershipId !== current.membershipId) {
          return;
        }
        if (!acceptContext({ ...payload, requestSeq: seq, kind: "detail" })) return;
        setPerson(payload.person);
        setOccurrence(null);
      } else if (current.kind === "occurrence" || current.kind === "routine-person") {
        const payload = await fetchDisplayPreviewOccurrence(
          props.displayId,
          current.occurrenceId,
        );
        if (blankedAtRef.current !== null && startedWall <= blankedAtRef.current) return;
        if (nowMs() - startedAt > staleMaxMs()) return;
        const stillSame =
          detailRef.current?.kind === current.kind &&
          "occurrenceId" in detailRef.current &&
          detailRef.current.occurrenceId === current.occurrenceId;
        if (!stillSame) return;
        if (!acceptContext({ ...payload, requestSeq: seq, kind: "detail" })) return;
        setOccurrence(stripPreviewCommandMetadata(payload.occurrence));
        setPerson(null);
      }
    } catch (caught) {
      if (isDenied(caught)) {
        acceptedDetailSeqRef.current = Math.max(acceptedDetailSeqRef.current, seq);
        if ((caught as ApiError).status === 404 || (caught as ApiError).code === "NOT_FOUND") {
          setPerson(null);
          setOccurrence(null);
          setDetailUnavailable(true);
          return;
        }
        acceptedDashSeqRef.current = Math.max(acceptedDashSeqRef.current, seq);
        clearContent();
        setError(errorMessage(caught));
        if ((caught as ApiError).status === 401 || (caught as ApiError).code === "UNAUTHORIZED") {
          props.onAuthorityLost();
        }
        return;
      }
      setDetailUnavailable(true);
    }
  });

  useEffect(() => {
    void loadDashboard("open");
  }, [props.displayId]);

  useEffect(() => {
    if (organization !== "by-person" || detail || !dashboard) return;
    refreshPreviewPersonDays(dashboard.byPerson.map((row) => row.membershipId));
  }, [organization, detail]);

  useEffect(() => {
    void loadDashboard("sync");
  }, [props.refreshToken]);

  useEffect(() => {
    if (!detail) {
      setPerson(null);
      setOccurrence(null);
      setDetailUnavailable(false);
      return;
    }
    void loadDetail();
  }, [detail]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadDashboard("poll");
      if (detailRef.current) void loadDetail();
    }, pollMs());
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const started = lastSuccessStartRef.current;
      if (started !== null && nowMs() - started > staleMaxMs()) {
        clearContent();
        setStale(false);
        setLoading(true);
      }
      void loadDashboard("poll");
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const started = lastSuccessStartRef.current;
      if (started === null) return;
      if (nowMs() - started > staleMaxMs()) {
        setStale(true);
        clearContent();
        return;
      }
      const bound = staleMaxMs();
      const now = nowMs();
      const expired: string[] = [];
      for (const [membershipId, phase] of Object.entries(panePhaseRef.current)) {
        if (phase === "blank") continue;
        const started = paneStartedRef.current[membershipId];
        const success = paneSuccessStartedRef.current[membershipId];
        // A refresh cannot renew content until it has actually succeeded.
        const leaseStart = success ?? started;
        if (leaseStart != null && now - leaseStart >= bound) expired.push(membershipId);
      }
      if (expired.length === 0) return;
      for (const membershipId of expired) {
        paneGenRef.current[membershipId] = (paneGenRef.current[membershipId] ?? 0) + 1;
      }
      setPersonDays((current) => {
        const next = { ...current };
        for (const membershipId of expired) next[membershipId] = null;
        return next;
      });
      setPanePhase((current) => {
        const next = { ...current };
        for (const membershipId of expired) next[membershipId] = "blank";
        return next;
      });
    }, 1_000);
    window.__HD_PREVIEW_FORCE_STALE__ = () => {
      lastSuccessStartRef.current = nowMs() - staleMaxMs() - 1;
      setStale(true);
      clearContent();
    };
    return () => {
      window.clearInterval(timer);
      delete window.__HD_PREVIEW_FORCE_STALE__;
    };
  }, []);

  useEffect(() => {
    function measure() {
      const host = hostRef.current;
      if (!host) return;
      const next = fitScale(
        viewport.width,
        viewport.height,
        host.clientWidth,
        host.clientHeight,
      );
      setScale(next);
    }
    measure();
    const observer = new ResizeObserver(measure);
    if (hostRef.current) observer.observe(hostRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [viewport.width, viewport.height]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.source !== frameRef.current?.contentWindow) return;
      if (!isPreviewFrameNav(event.data)) return;
      const message = event.data;
      if (message.type === "hd-preview-ready") {
        setFrameReady(true);
        return;
      }
      if (message.type === "hd-preview-org") {
        setOrganization(message.organization);
        return;
      }
      if (message.type === "hd-preview-open-person") {
        setDetail({
          kind: "person",
          membershipId: message.membershipId,
          originKey: message.originKey,
        });
        return;
      }
      if (message.type === "hd-preview-open-occurrence") {
        setDetail({
          kind: "occurrence",
          occurrenceId: message.occurrenceId,
          originKey: message.originKey,
        });
        return;
      }
      if (message.type === "hd-preview-open-routine") {
        setDetail({
          kind: "routine",
          aggregateKey: message.aggregateKey,
          originKey: message.originKey,
        });
        return;
      }
      if (message.type === "hd-preview-open-routine-person") {
        setDetail({
          kind: "routine-person",
          aggregateKey: message.aggregateKey,
          occurrenceId: message.occurrenceId,
          originKey: message.originKey,
        });
        return;
      }
      if (message.type === "hd-preview-back") {
        setDetail(null);
        setPerson(null);
        setOccurrence(null);
        setDetailUnavailable(false);
        return;
      }
      if (message.type === "hd-preview-back-routine") {
        setDetail({
          kind: "routine",
          aggregateKey: message.aggregateKey,
          originKey: message.originKey,
        });
        return;
      }
      if (message.type === "hd-preview-retry-pane") {
        void loadPreviewPersonDay(message.membershipId);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    const frameWindow = frameRef.current?.contentWindow;
    if (!frameWindow || !frameReady) return;
    const state: PreviewFrameState = {
      type: "hd-preview-state",
      dashboard,
      person,
      occurrence,
      personDays,
      panePhase,
      organization,
      detail,
      loading,
      stale,
      detailUnavailable,
    };
    frameWindow.postMessage(state, window.location.origin);
  }, [
    dashboard,
    person,
    occurrence,
    personDays,
    panePhase,
    organization,
    detail,
    loading,
    stale,
    detailUnavailable,
    frameReady,
  ]);

  function applyViewport(next: PreviewViewport) {
    setViewport(next);
    setCustomWidth(String(next.width));
    setCustomHeight(String(next.height));
    setViewportError(null);
    props.onViewportChange(previewViewportSearch(next));
  }

  function applyCustomViewport() {
    const width = Number(customWidth);
    const height = Number(customHeight);
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 320 ||
      width > 7680 ||
      height < 240 ||
      height > 4320
    ) {
      setViewportError("Enter whole-pixel width 320–7680 and height 240–4320.");
      return;
    }
    applyViewport({ width, height, provenance: "chosen" });
  }

  return (
    <section className="display-preview-host" data-testid="display-preview-host">
      <button type="button" className="back-link" onClick={props.onBack}>
        Back to displays
      </button>
      <div className="display-preview-chrome" data-testid="display-preview-chrome">
        <h1 className="page-heading">{label}</h1>
        <p className="display-preview-banner" role="note" data-testid="display-preview-only">
          Preview only — changes cannot be made here
        </p>
        <p className="meta" data-testid="display-preview-geometry">
          Target {viewport.width} × {viewport.height} CSS px · 16:9 ·{" "}
          {viewport.provenance === "assumed" ? "assumed" : "chosen"} · fit{" "}
          {Math.round(scale * 100)}%
        </p>
        <div className="display-preview-viewport-controls">
          <button
            type="button"
            className={
              viewport.width === PREVIEW_VIEWPORT_PRESETS.uhd.width ? "secondary active" : "secondary"
            }
            onClick={() =>
              applyViewport({ ...PREVIEW_VIEWPORT_PRESETS.uhd, provenance: "chosen" })
            }
          >
            3840 × 2160
          </button>
          <button
            type="button"
            className={
              viewport.width === PREVIEW_VIEWPORT_PRESETS.fhd.width ? "secondary active" : "secondary"
            }
            onClick={() =>
              applyViewport({ ...PREVIEW_VIEWPORT_PRESETS.fhd, provenance: "chosen" })
            }
          >
            1920 × 1080
          </button>
          <label>
            Width
            <input
              inputMode="numeric"
              value={customWidth}
              onChange={(event) => setCustomWidth(event.target.value)}
              data-testid="display-preview-width"
            />
          </label>
          <label>
            Height
            <input
              inputMode="numeric"
              value={customHeight}
              onChange={(event) => setCustomHeight(event.target.value)}
              data-testid="display-preview-height"
            />
          </label>
          <button type="button" className="secondary" onClick={applyCustomViewport}>
            Apply size
          </button>
        </div>
        {viewportError ? (
          <p role="alert" data-testid="display-preview-viewport-error">
            {viewportError}
          </p>
        ) : null}
        {error ? (
          <p role="alert" data-testid="display-preview-error">
            {error}
          </p>
        ) : null}
      </div>
      <div className="display-preview-stage" ref={hostRef} data-testid="display-preview-stage">
        <div
          className="display-preview-scaler"
          style={{
            width: viewport.width * scale,
            height: viewport.height * scale,
          }}
        >
          <iframe
            ref={frameRef}
            title={`Preview of ${label}`}
            src={PREVIEW_FRAME_PATH}
            className="display-preview-frame"
            data-testid="display-preview-frame"
            width={viewport.width}
            height={viewport.height}
            style={{
              width: viewport.width,
              height: viewport.height,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          />
        </div>
      </div>
    </section>
  );
}
