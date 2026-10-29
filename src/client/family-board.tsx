/**
 * Shared By-person family board. Wall and preview pass different adapters;
 * this module does not own session, outbox, or fetch.
 */
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  familyPaneItemsForSection,
  projectFamilyPane,
  type FamilyPaneSection,
} from "../domain/family-wall-projection";
import type { Daypart } from "../domain/daypart";
import { DAYPART_LABELS } from "../domain/daypart";
import type { StepStatus } from "../shared/schemas";
import type {
  DisplayDashboard,
  DisplayOccurrenceDetail,
  DisplayPersonDay,
} from "./display-api";
import type { DisplayOutboxItem } from "./display-outbox";
import type { ResponsibilityOverviewRow } from "../domain/household-overview";

export type FamilyPanePhase = "loading" | "ready" | "unavailable" | "blank";

export type FamilyPaneModel = {
  membershipId: string;
  displayName: string;
  sortOrder: number;
  status: "pending" | "active";
  phase: FamilyPanePhase;
  day: DisplayPersonDay | null;
  progressLabel: string | null;
};

type BrowseState = {
  section: FamilyPaneSection;
  scrollTop: number;
  lastActivityAt: number;
  pointerHeld: boolean;
};

const DEFAULT_BROWSE: BrowseState = {
  section: "next",
  scrollTop: 0,
  lastActivityAt: 0,
  pointerHeld: false,
};

function statusLabel(status: string): string {
  if (status === "completed") return "Done";
  if (status === "not_needed") return "Not needed";
  if (status === "open") return "Open";
  return status;
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
  const active = items.find((item) => item.state === "pending" || item.state === "retrying");
  if (active) {
    return {
      kind: "pending",
      text: active.state === "retrying" ? "Saving…" : "Pending…",
    };
  }
  return null;
}

function paneHasPending(outbox: DisplayOutboxItem[], day: DisplayPersonDay | null): boolean {
  if (!day) return false;
  const ids = new Set(day.occurrences.map((occurrence) => occurrence.id));
  return outbox.some(
    (item) =>
      ids.has(item.occurrenceId) &&
      (item.state === "pending" || item.state === "retrying"),
  );
}

function emptyCopy(kind: ReturnType<typeof projectFamilyPane>["emptyKind"]): string {
  if (kind === "filtered-omission") return "Nothing on the board today";
  if (kind === "anytime-only") return "Anytime work";
  if (kind === "complete-optional") return "Required work is done · optional still open";
  if (kind === "complete") return "All assigned work is done";
  if (kind === "later-remaining") return "More work later";
  return "No assigned work today";
}

export function FamilyBoard(props: {
  panes: FamilyPaneModel[];
  unassigned: ResponsibilityOverviewRow[];
  outbox: DisplayOutboxItem[];
  savedFlashByStep: Record<string, number>;
  canAct: boolean;
  idleMs: number;
  nowMs: () => number;
  onRetryPane: (membershipId: string) => void;
  onStepChange: (
    occurrence: DisplayOccurrenceDetail,
    stepId: string,
    status: StepStatus,
  ) => void;
  onOpenUnassigned: (occurrenceId: string, originKey: string) => void;
  onOpenPersonalDetail: (membershipId: string, originKey: string) => void;
}) {
  const [browse, setBrowse] = useState<Record<string, BrowseState>>({});
  const browseRef = useRef(browse);
  browseRef.current = browse;
  const [enlarged, setEnlarged] = useState<string | null>(null);
  const enlargeOriginRef = useRef<string | null>(null);

  function browseFor(
    id: string,
    source: Record<string, BrowseState> = browseRef.current,
  ): BrowseState {
    return source[id] ?? DEFAULT_BROWSE;
  }

  function patchBrowse(id: string, patch: Partial<BrowseState>, touchActivity = false) {
    setBrowse((current) => {
      const prev = current[id] ?? DEFAULT_BROWSE;
      const nextRow: BrowseState = {
        ...prev,
        ...patch,
        lastActivityAt: touchActivity ? props.nowMs() : (patch.lastActivityAt ?? prev.lastActivityAt),
      };
      const next = { ...current, [id]: nextRow };
      browseRef.current = next;
      return next;
    });
  }

  function markActivity(id: string) {
    patchBrowse(id, {}, true);
  }

  const tickIdle = useEffectEvent(() => {
    const now = props.nowMs();
    for (const pane of props.panes) {
      const state = browseFor(pane.membershipId, browseRef.current);
      const pending = paneHasPending(props.outbox, pane.day);
      const focused =
        typeof document !== "undefined" &&
        document.activeElement instanceof HTMLElement &&
        Boolean(document.activeElement.closest(`[data-pane-id="${pane.membershipId}"]`));
      if (state.pointerHeld || pending || focused) continue;
      if (state.lastActivityAt <= 0) continue;
      if (now - state.lastActivityAt < props.idleMs) continue;
      if (enlarged === pane.membershipId) {
        const origin = enlargeOriginRef.current;
        setEnlarged(null);
        queueMicrotask(() => {
          if (origin) document.getElementById(origin)?.focus();
        });
        continue;
      }
      if (state.section !== "next") {
        patchBrowse(pane.membershipId, { section: "next", scrollTop: 0 });
      }
    }
  });

  useEffect(() => {
    const timer = window.setInterval(() => tickIdle(), 250);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="family-board-proof-stage" data-testid="family-board">
      <div className="family-board-grid" data-testid="display-by-person">
        {props.panes.map((pane) => (
          <FamilyPane
            key={pane.membershipId}
            pane={pane}
            browse={browseFor(pane.membershipId)}
            enlarged={enlarged === pane.membershipId}
            hiddenByEnlarge={Boolean(enlarged) && enlarged !== pane.membershipId}
            outbox={props.outbox}
            savedFlashByStep={props.savedFlashByStep}
            canAct={props.canAct}
            onBrowse={(patch) => patchBrowse(pane.membershipId, patch, true)}
            onActivity={() => markActivity(pane.membershipId)}
            onPointerHeld={(held) => patchBrowse(pane.membershipId, { pointerHeld: held })}
            onEnlarge={() => {
              enlargeOriginRef.current = `family-enlarge-${pane.membershipId}`;
              setEnlarged(pane.membershipId);
              markActivity(pane.membershipId);
            }}
            onBackFamily={() => {
              const origin = enlargeOriginRef.current;
              setEnlarged(null);
              queueMicrotask(() => {
                if (origin) document.getElementById(origin)?.focus();
              });
            }}
            onRetry={() => props.onRetryPane(pane.membershipId)}
            onStepChange={props.onStepChange}
            onOpenPersonalDetail={props.onOpenPersonalDetail}
          />
        ))}
      </div>
      {props.unassigned.length > 0 ? (
        <div className="family-board-unassigned" data-testid="display-needs-assignment">
          <h2 className="display-section-title">Needs an owner</h2>
          <ul className="display-work-list">
            {props.unassigned.map((row) => {
              const origin = `display-unassigned-${row.id}`;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    id={origin}
                    className="display-work-row family-board-hit"
                    onClick={() => props.onOpenUnassigned(row.id, origin)}
                    data-testid={`family-unassigned-${row.id}`}
                  >
                    <span className="display-work-title">{row.title}</span>
                    <span className="display-work-meta">
                      Needs an owner · {row.state} · {row.progressLabel}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function FamilyPane(props: {
  pane: FamilyPaneModel;
  browse: BrowseState;
  enlarged: boolean;
  hiddenByEnlarge: boolean;
  outbox: DisplayOutboxItem[];
  savedFlashByStep: Record<string, number>;
  canAct: boolean;
  onBrowse: (patch: Partial<BrowseState>) => void;
  onActivity: () => void;
  onPointerHeld: (held: boolean) => void;
  onEnlarge: () => void;
  onBackFamily: () => void;
  onRetry: () => void;
  onStepChange: (
    occurrence: DisplayOccurrenceDetail,
    stepId: string,
    status: StepStatus,
  ) => void;
  onOpenPersonalDetail: (membershipId: string, originKey: string) => void;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const { pane, browse } = props;
  const day = pane.day;
  const occurrences = day?.occurrences ?? [];
  const projection = projectFamilyPane(
    occurrences.map((occurrence) => ({
      id: occurrence.id,
      definitionId: occurrence.definitionId,
      daypart: occurrence.daypart as Daypart,
      completed: occurrence.completed,
      startedAt: occurrence.steps.some((step) => step.status !== "open") ? "x" : null,
      steps: occurrence.steps,
      title: occurrence.title,
    })),
  );
  const shownIds = new Set(
    familyPaneItemsForSection(projection, browse.section).map((item) => item.id),
  );
  const pendingIds = new Set(
    props.outbox
      .filter((item) => item.state === "pending" || item.state === "retrying")
      .map((item) => item.occurrenceId),
  );
  const shown = occurrences.filter(
    (occurrence) => shownIds.has(occurrence.id) || pendingIds.has(occurrence.id),
  );

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = browse.scrollTop;
  }, [browse.scrollTop, props.enlarged, browse.section]);

  return (
    <article
      className={`family-board-pane ${props.enlarged ? "enlarged" : ""}`}
      data-testid={`family-pane-${pane.membershipId}`}
      data-pane-id={pane.membershipId}
      data-section={browse.section}
      data-phase={pane.phase}
      hidden={props.hiddenByEnlarge}
    >
      <header className="family-board-pane-header">
        <h2 className="display-person-name">{pane.displayName}</h2>
        <p className="display-person-status">
          {pane.phase === "loading"
            ? "Updating…"
            : pane.phase === "blank"
              ? "This person's board expired"
              : pane.phase === "unavailable"
                ? "Couldn't load this person"
                : pane.progressLabel ?? "No assigned work today"}
        </p>
        {props.enlarged ? (
          <button
            type="button"
            className="family-board-hit"
            id={`family-back-${pane.membershipId}`}
            data-testid={`family-back-${pane.membershipId}`}
            onClick={props.onBackFamily}
          >
            Back to family
          </button>
        ) : (
          <button
            type="button"
            className="family-board-hit"
            id={`family-enlarge-${pane.membershipId}`}
            data-testid={`family-enlarge-${pane.membershipId}`}
            onClick={props.onEnlarge}
          >
            Enlarge
          </button>
        )}
        {paneHasPending(props.outbox, day) ? (
          <p
            className="status-pill"
            data-kind="pending"
            role="status"
            data-testid={`family-pending-${pane.membershipId}`}
          >
            Saving…
          </p>
        ) : null}
        {day &&
        props.outbox.some((item) => {
          const ids = new Set(day.occurrences.map((occurrence) => occurrence.id));
          return ids.has(item.occurrenceId) && item.state === "rejected";
        }) ? (
          <p
            className="status-pill"
            data-kind="error"
            role="status"
            data-testid={`family-error-${pane.membershipId}`}
          >
            Could not save a change. Return here to retry.
          </p>
        ) : null}
      </header>
      {pane.phase === "ready" && day ? (
        <nav className="family-board-pane-nav" aria-label={`${pane.displayName} sections`}>
          <button
            type="button"
            className="family-board-hit"
            data-testid={`family-back-next-${pane.membershipId}`}
            onClick={() => props.onBrowse({ section: "next", scrollTop: 0 })}
          >
            Back to next task
          </button>
          <button
            type="button"
            className="family-board-hit"
            data-testid={`family-earlier-${pane.membershipId}`}
            onClick={() => props.onBrowse({ section: "earlier" })}
          >
            Earlier
          </button>
          <button
            type="button"
            className="family-board-hit"
            data-testid={`family-upcoming-${pane.membershipId}`}
            onClick={() => props.onBrowse({ section: "upcoming" })}
          >
            Coming up
          </button>
          <button
            type="button"
            className="family-board-hit"
            data-testid={`family-more-${pane.membershipId}`}
            onClick={() => props.onBrowse({ section: "more" })}
          >
            More
          </button>
        </nav>
      ) : null}
      <div
        ref={bodyRef}
        className="family-board-pane-body"
        data-testid={`family-scroll-${pane.membershipId}`}
        onScroll={(event) => props.onBrowse({ scrollTop: event.currentTarget.scrollTop })}
        onPointerDown={() => {
          props.onPointerHeld(true);
          props.onActivity();
        }}
        onPointerUp={() => props.onPointerHeld(false)}
        onPointerCancel={() => props.onPointerHeld(false)}
        onPointerLeave={() => props.onPointerHeld(false)}
        onLostPointerCapture={() => props.onPointerHeld(false)}
        onKeyDown={props.onActivity}
      >
        {pane.phase === "loading" ? (
          <p className="display-status" role="status" data-testid={`family-loading-${pane.membershipId}`}>
            Loading…
          </p>
        ) : null}
        {pane.phase === "blank" ? (
          <p className="display-status" role="status" data-testid={`family-blank-${pane.membershipId}`}>
            This person&apos;s board expired.{" "}
            <button
              type="button"
              className="family-board-hit"
              data-testid={`family-retry-${pane.membershipId}`}
              onClick={props.onRetry}
            >
              Retry
            </button>
          </p>
        ) : null}
        {pane.phase === "unavailable" ? (
          <p className="display-status" role="status" data-testid={`family-unavailable-${pane.membershipId}`}>
            Couldn&apos;t load this person.{" "}
            <button
              type="button"
              className="family-board-hit"
              data-testid={`family-retry-${pane.membershipId}`}
              onClick={props.onRetry}
            >
              Retry
            </button>
          </p>
        ) : null}
        {pane.phase === "ready" && day ? (
          <>
            {shown.length === 0 ? (
              <p
                className="display-empty display-person-status"
                data-testid={`family-empty-${pane.membershipId}`}
                data-empty-kind={projection.emptyKind ?? "none"}
              >
                {emptyCopy(projection.emptyKind)}
              </p>
            ) : (
              shown.map((occurrence) => (
                <PaneOccurrence
                  key={occurrence.id}
                  occurrence={occurrence}
                  emphasize={
                    browse.section === "next" && occurrence.id === projection.recommendedFocusId
                  }
                  firstOpenStepId={
                    occurrence.id === projection.recommendedFocusId
                      ? projection.firstOpenStepId
                      : null
                  }
                  personId={pane.membershipId}
                  outbox={props.outbox}
                  savedFlashByStep={props.savedFlashByStep}
                  canAct={props.canAct}
                  onStepChange={props.onStepChange}
                  onActivity={props.onActivity}
                />
              ))
            )}
            {browse.section === "upcoming" || browse.section === "more" ? (
              <ul className="display-work-list" data-testid={`family-upcoming-list-${pane.membershipId}`}>
                {[...projection.upcoming, ...projection.more].map((item) => (
                  <li key={item.id} className="display-work-meta">
                    {item.title}
                    {item.daypart
                      ? ` · ${DAYPART_LABELS[item.daypart as Daypart] ?? item.daypart}`
                      : ""}
                  </li>
                ))}
              </ul>
            ) : null}
            {day.promotedPersonalTasks.length > 0 ? (
              <div data-testid={`display-person-promoted-${pane.membershipId}`}>
                {day.promotedPersonalTasks.map((task) => (
                  <p key={task.id} className="display-work-meta">
                    {task.title} · view only · not in recurring counts
                  </p>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              className="family-board-hit"
              id={`display-person-${pane.membershipId}`}
              data-testid={`family-personal-${pane.membershipId}`}
              onClick={() =>
                props.onOpenPersonalDetail(pane.membershipId, `display-person-${pane.membershipId}`)
              }
            >
              Shared personal work
            </button>
          </>
        ) : null}
      </div>
    </article>
  );
}

function PaneOccurrence(props: {
  occurrence: DisplayOccurrenceDetail;
  emphasize: boolean;
  firstOpenStepId: string | null;
  personId: string;
  outbox: DisplayOutboxItem[];
  savedFlashByStep: Record<string, number>;
  canAct: boolean;
  onStepChange: (
    occurrence: DisplayOccurrenceDetail,
    stepId: string,
    status: StepStatus,
  ) => void;
  onActivity: () => void;
}) {
  const executable = props.canAct && Boolean(props.occurrence.accountableMemberId);
  return (
    <div
      data-testid={`family-work-${props.occurrence.id}`}
      className={props.emphasize ? "family-board-next" : undefined}
    >
      <h3 className="display-work-title">{props.occurrence.title}</h3>
      <p
        className="display-work-meta display-person-status"
        data-testid={props.emphasize ? `family-next-${props.personId}` : undefined}
      >
        {props.occurrence.state} · {props.occurrence.progressLabel}
      </p>
      <ol className="display-step-list">
        {props.occurrence.steps
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((step) => {
            const feedback = stepFeedback(props.outbox, props.occurrence.id, step.id);
            const savedKey = `${props.occurrence.id}:${step.id}`;
            const showSaved =
              !feedback && typeof props.savedFlashByStep[savedKey] === "number";
            const quiet = step.status === "completed" || step.status === "not_needed";
            const nextStep = props.emphasize && step.id === props.firstOpenStepId;
            return (
              <li
                key={step.id}
                className={quiet ? "display-step completed-quiet" : "display-step"}
                data-testid={`family-step-${step.id}`}
                data-next-step={nextStep ? "true" : undefined}
              >
                <span className="display-work-title">{step.text}</span>
                <span className="display-work-meta">
                  {statusLabel(step.status)}
                  {step.obligation === "optional" ? " · Optional" : ""}
                  {step.obligation === "as_needed" ? " · As needed" : ""}
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
                      className="display-step-action family-board-hit"
                      aria-pressed={step.status === "completed"}
                      aria-label={`Mark ${step.text} done`}
                      data-testid={`display-step-done-${step.id}`}
                      onClick={() => {
                        props.onActivity();
                        props.onStepChange(
                          props.occurrence,
                          step.id,
                          step.status === "completed" ? "open" : "completed",
                        );
                      }}
                    >
                      {step.status === "completed" ? "Reopen" : "Done"}
                    </button>
                    {step.obligation === "as_needed" ? (
                      <button
                        type="button"
                        className="display-step-action family-board-hit"
                        aria-pressed={step.status === "not_needed"}
                        aria-label={`Mark ${step.text} not needed`}
                        data-testid={`display-step-not-needed-${step.id}`}
                        onClick={() => {
                          props.onActivity();
                          props.onStepChange(
                            props.occurrence,
                            step.id,
                            step.status === "not_needed" ? "open" : "not_needed",
                          );
                        }}
                      >
                        {step.status === "not_needed" ? "Reopen" : "Not needed"}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className="display-work-meta">
                    {statusLabel(step.status)}
                    {!props.occurrence.accountableMemberId
                      ? " · Assign this work in the household app"
                      : ""}
                  </p>
                )}
              </li>
            );
          })}
      </ol>
    </div>
  );
}

export function unassignedRows(dashboard: DisplayDashboard): ResponsibilityOverviewRow[] {
  return dashboard.byWork.responsibilities.filter((row) => row.accountableMemberId === null);
}
