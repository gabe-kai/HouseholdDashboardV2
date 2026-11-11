import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { StepStatus } from "../shared/schemas";
import type { DisplayOccurrenceDetail } from "./display-api";
import { FamilyBoard, unassignedRows } from "./family-board";
import {
  DisplayAuthenticatedSurface,
  type DisplayDetailState,
  type DisplayOrganization,
} from "./display-presentation";
import {
  isPreviewFrameState,
  type PreviewFrameState,
} from "./display-preview";
import "./styles.css";

declare global {
  interface Window {
    __HD_PREVIEW_NOW_MS?: number;
  }
}

function postNav(message: Record<string, unknown>) {
  if (window.parent === window) return;
  window.parent.postMessage(message, window.location.origin);
}

function PreviewFrameApp() {
  const [state, setState] = useState<PreviewFrameState>({
    type: "hd-preview-state",
    dashboard: null,
    person: null,
    occurrence: null,
    organization: "by-person",
    detail: null,
    personDays: {},
    panePhase: {},
    loading: true,
    stale: false,
    detailUnavailable: false,
  });
  const previousDetail = useRef<DisplayDetailState | null>(null);
  const focusAfterLoad = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousDetail.current;
    if (previous && !state.detail) focusAfterLoad.current = previous.originKey;
    if (previous?.kind === "occurrence" && state.detail?.kind === "person") focusAfterLoad.current = previous.originKey;
    previousDetail.current = state.detail;
    if (focusAfterLoad.current && (!state.detail || state.person)) {
      const target = document.getElementById(focusAfterLoad.current);
      if (target) { target.focus(); focusAfterLoad.current = null; }
    }
  }, [state.detail, state.person]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.source !== window.parent) return;
      if (!isPreviewFrameState(event.data)) return;
      setState(event.data);
    }
    window.addEventListener("message", onMessage);
    postNav({ type: "hd-preview-ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!state.dashboard) {
    return (
      <div className="display-shell" data-testid="display-preview-frame-empty">
        <p className="display-status" role="status">
          {state.stale
            ? "Preview expired. Refresh from Household displays."
            : state.loading
              ? "Loading preview…"
              : "No preview data."}
        </p>
      </div>
    );
  }

  const detail: DisplayDetailState | null = state.detailUnavailable
    ? state.detail
    : state.detail;

  return (
    <DisplayAuthenticatedSurface
      dashboard={state.dashboard}
      organization={state.organization}
      detail={detail}
      personDetail={state.person}
      occurrenceDetail={state.occurrence}
      outbox={[]}
      savedFlashByStep={{}}
      canAct={false}
      loading={state.loading || Boolean(detail && !state.person && !state.occurrence && !state.detailUnavailable)}
      stale={state.stale}
      pendingCue={null}
      retiredNotices={[]}
      clockElapsedMs={0}
      readonlyNote="Preview only — changes cannot be made here"
      onDismissRetiredNotice={() => undefined}
      onOrganizationChange={(organization: DisplayOrganization) =>
        postNav({ type: "hd-preview-org", organization })
      }
      onOpenPerson={(membershipId, originKey) =>
        postNav({ type: "hd-preview-open-person", membershipId, originKey })
      }
      onOpenResponsibility={(occurrenceId, originKey) =>
        postNav({ type: "hd-preview-open-occurrence", occurrenceId, originKey })
      }
      onOpenRoutine={(aggregateKey, originKey) =>
        postNav({ type: "hd-preview-open-routine", aggregateKey, originKey })
      }
      onOpenPendingCue={() => undefined}
      onBack={() => postNav({ type: "hd-preview-back" })}
      onRetry={() => {
        if (detail?.kind === "person") postNav({ type: "hd-preview-open-person", membershipId: detail.membershipId, originKey: detail.originKey });
        if (detail?.kind === "occurrence") postNav({ type: "hd-preview-open-occurrence", occurrenceId: detail.occurrenceId, originKey: detail.originKey });
      }}
      onStepChange={(
        _occurrence: DisplayOccurrenceDetail,
        _stepId: string,
        _status: StepStatus,
      ) => undefined}
      onOpenOccurrence={(occurrenceId, originKey) =>
        postNav({ type: "hd-preview-open-occurrence", occurrenceId, originKey })
      }
      onOpenRoutinePerson={(aggregateKey, occurrenceId, originKey) =>
        postNav({
          type: "hd-preview-open-routine-person",
          aggregateKey,
          occurrenceId,
          originKey,
        })
      }
      onBackToRoutine={(aggregateKey, originKey) =>
        postNav({ type: "hd-preview-back-routine", aggregateKey, originKey })
      }
      personBoard={
        <FamilyBoard
          panes={state.dashboard.byPerson.map((person) => ({
            membershipId: person.membershipId,
            displayName: person.displayName,
            sortOrder: person.sortOrder,
            status: person.status,
            phase: state.panePhase[person.membershipId] ?? "loading",
            progressLabel: person.progressLabel,
            day: state.personDays[person.membershipId] ?? null,
          }))}
          unassigned={unassignedRows(state.dashboard)}
          outbox={[]}
          savedFlashByStep={{}}
          canAct={false}
          active={!detail && state.organization === "by-person"}
          idleMs={90_000}
          nowMs={() =>
            typeof window.__HD_PREVIEW_NOW_MS === "number"
              ? window.__HD_PREVIEW_NOW_MS
              : performance.now()
          }
          onRetryPane={(membershipId) =>
            postNav({ type: "hd-preview-retry-pane", membershipId })
          }
          onStepChange={() => undefined}
          onOpenUnassigned={(occurrenceId, originKey) =>
            postNav({ type: "hd-preview-open-occurrence", occurrenceId, originKey })
          }
          onOpenPersonalDetail={(membershipId, originKey) =>
            postNav({ type: "hd-preview-open-person", membershipId, originKey })
          }
        />
      }
    />
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <PreviewFrameApp />
    </StrictMode>,
  );
}
