/**
 * Shared By-person family board. Wall and preview pass different adapters;
 * this module does not own session, outbox, or fetch.
 */
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  projectFamilyPane,
  toFamilyPaneOccurrence,
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
  expandedId: string | null;
  scrollTop: number;
  lastActivityAt: number;
  pointerHeld: boolean;
};

const DEFAULT_BROWSE: BrowseState = {
  section: "next",
  expandedId: null,
  scrollTop: 0,
  lastActivityAt: 0,
  pointerHeld: false,
};

export type FamilyPaneCue = {
  membershipId: string;
  displayName: string;
  kind: "pending" | "error";
  message: string;
};

export function familyPaneCues(
  panes: FamilyPaneModel[],
  outbox: DisplayOutboxItem[],
): FamilyPaneCue[] {
  const cues: FamilyPaneCue[] = [];
  for (const pane of panes) {
    const ids = new Set((pane.day?.occurrences ?? []).map((occurrence) => occurrence.id));
    const pending = outbox.some(
      (item) =>
        ids.has(item.occurrenceId) &&
        (item.state === "pending" || item.state === "retrying"),
    );
    const rejected = outbox.some(
      (item) => ids.has(item.occurrenceId) && item.state === "rejected",
    );
    if (pending) {
      cues.push({
        membershipId: pane.membershipId,
        displayName: pane.displayName,
        kind: "pending",
        message: `Saving ${pane.displayName}'s change…`,
      });
    }
    if (rejected) {
      cues.push({
        membershipId: pane.membershipId,
        displayName: pane.displayName,
        kind: "error",
        message: `Could not save ${pane.displayName}'s change. Return to retry.`,
      });
    }
  }
  return cues;
}

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

function shownEmpty(projection: ReturnType<typeof projectFamilyPane>): boolean {
  return projection.recommendedFocusId === null && projection.emptyKind !== null;
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
  const returnFocusRef = useRef<string | null>(null);
  const returnScrollRef = useRef<Record<string, { section: FamilyPaneSection; scrollTop: number }>>({});

  useEffect(() => {
    if (enlarged || !returnFocusRef.current) return;
    document.getElementById(returnFocusRef.current)?.focus();
    returnFocusRef.current = null;
  }, [enlarged]);

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

  function restoreBoardScroll(id: string) {
    const saved = returnScrollRef.current[id];
    delete returnScrollRef.current[id];
    if (saved && browseFor(id).section === saved.section) {
      patchBrowse(id, { scrollTop: saved.scrollTop });
    }
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
        restoreBoardScroll(pane.membershipId);
        returnFocusRef.current = enlargeOriginRef.current;
        setEnlarged(null);
        continue;
      }
      if (state.section !== "next" || state.expandedId) {
        patchBrowse(pane.membershipId, { section: "next", expandedId: null, scrollTop: 0 });
      }
    }
  });

  useEffect(() => {
    const timer = window.setInterval(() => tickIdle(), 250);
    return () => window.clearInterval(timer);
  }, []);

  const primaryPanes = props.panes.slice(0, 6);
  const overflowPanes = props.panes.slice(6);

  function renderPane(pane: FamilyPaneModel) {
    return (
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
          const current = browseFor(pane.membershipId);
          returnScrollRef.current[pane.membershipId] = { section: current.section, scrollTop: current.scrollTop };
          enlargeOriginRef.current = `family-enlarge-${pane.membershipId}`;
          setEnlarged(pane.membershipId);
          markActivity(pane.membershipId);
        }}
        onBackFamily={() => {
          restoreBoardScroll(pane.membershipId);
          returnFocusRef.current = enlargeOriginRef.current;
          setEnlarged(null);
        }}
        onRetry={() => props.onRetryPane(pane.membershipId)}
        onStepChange={props.onStepChange}
        onOpenPersonalDetail={props.onOpenPersonalDetail}
      />
    );
  }

  return (
    <section className="family-board-proof-stage" data-testid="family-board">
      <div className="family-board-grid" data-testid="display-by-person">
        {primaryPanes.map((pane) => renderPane(pane))}
      </div>
      {overflowPanes.length > 0 ? (
        <div className="family-board-overflow" data-testid="family-board-overflow">
          {overflowPanes.map((pane) => renderPane(pane))}
        </div>
      ) : null}
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
  const pendingIds = new Set(
    props.outbox
      .filter((item) => item.state === "pending" || item.state === "retrying")
      .map((item) => item.occurrenceId),
  );
  const lastNextRef = useRef<{ occurrenceId: string; stepId: string } | null>(null);
  const pinned = lastNextRef.current && pendingIds.has(lastNextRef.current.occurrenceId)
    ? lastNextRef.current
    : null;
  const projection = projectFamilyPane(occurrences.map((occurrence) => {
    const row = toFamilyPaneOccurrence(occurrence);
    if (occurrence.id !== pinned?.occurrenceId) return row;
    // Project the pending recommendation as still open until it settles. The
    // rendered step keeps its optimistic state and pending feedback.
    return {
      ...row,
      completed: false,
      startedAt: row.startedAt ?? "in-progress",
      steps: row.steps.map((step) => "id" in step && step.id === pinned.stepId
        ? { ...step, status: "open" as const }
        : step),
    };
  }), { filteredOmission: day?.filteredOmission });
  const recommended = occurrences.find(
    (occurrence) => occurrence.id === (pinned?.occurrenceId ?? projection.recommendedFocusId),
  );
  const expandedId =
    browse.section === "next" ? recommended?.id : browse.expandedId;
  const expanded = occurrences.find((occurrence) => occurrence.id === expandedId) ?? null;
  const firstOpenStep = pinned
    ? recommended?.steps.find((step) => step.id === pinned.stepId)
    : recommended?.steps
        .slice()
        .sort((a, b) => a.position - b.position)
        .find((step) => step.status === "open");
  if (!pinned) {
    lastNextRef.current = recommended && firstOpenStep
      ? { occurrenceId: recommended.id, stepId: firstOpenStep.id }
      : null;
  }

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
        {pane.phase === "ready" && recommended && firstOpenStep ? null : (
          <p className="display-person-status">
            {pane.phase === "loading"
              ? "Updating…"
              : pane.phase === "blank"
                ? "This person's board expired"
                : pane.phase === "unavailable"
                  ? "Couldn't load this person"
                  : day?.filteredOmission && occurrences.length === 0
                    ? "Nothing on the board today"
                    : pane.progressLabel ?? "No assigned work today"}
          </p>
        )}
        {pane.phase === "unavailable" || pane.phase === "blank" ? (
          <button
            type="button"
            className="family-board-hit"
            data-testid={`family-retry-${pane.membershipId}`}
            onClick={props.onRetry}
          >
            Retry
          </button>
        ) : null}
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
      {pane.phase === "ready" && recommended && firstOpenStep ? (
        <div
          className="family-board-current"
          data-testid={`family-current-${pane.membershipId}`}
        >
          <h3 className="display-work-title">{recommended.title}</h3>
          <p
            className="display-work-meta display-person-status"
            data-testid={`family-next-${pane.membershipId}`}
          >
            {recommended.progressLabel} · {firstOpenStep.text}
            {firstOpenStep.additionHeading ? ` · ${firstOpenStep.additionHeading}` : firstOpenStep.source === "personal" ? " · Personal addition" : ""}
          </p>
          <div className="family-board-current-toolbar">
            <PaneStepActions
              occurrence={recommended}
              step={firstOpenStep}
              outbox={props.outbox}
              savedFlashByStep={props.savedFlashByStep}
              canAct={props.canAct}
              emphasize
              onStepChange={props.onStepChange}
              onActivity={props.onActivity}
            />
            <button
              type="button"
              className="family-board-hit"
              data-testid={`family-back-next-${pane.membershipId}`}
              onClick={() => props.onBrowse({ section: "next", expandedId: null, scrollTop: 0 })}
            >
              Back to next task
            </button>
            <button
              type="button"
              className="family-board-hit"
              data-testid={`family-earlier-${pane.membershipId}`}
              onClick={() =>
                props.onBrowse({
                  section: "earlier",
                  expandedId: projection.earlier[0]?.id ?? null,
                })
              }
            >
              Earlier
            </button>
            <button
              type="button"
              className="family-board-hit"
              data-testid={`family-upcoming-${pane.membershipId}`}
              onClick={() => props.onBrowse({ section: "upcoming", expandedId: null })}
            >
              Coming up
            </button>
            <button
              type="button"
              className="family-board-hit"
              data-testid={`family-more-${pane.membershipId}`}
              onClick={() => props.onBrowse({ section: "more", expandedId: null })}
            >
              More
            </button>
          </div>
        </div>
      ) : pane.phase === "ready" && day ? (
        <nav className="family-board-pane-nav" aria-label={`${pane.displayName} sections`}>
          <button
            type="button"
            className="family-board-hit"
            data-testid={`family-back-next-${pane.membershipId}`}
            onClick={() => props.onBrowse({ section: "next", expandedId: null, scrollTop: 0 })}
          >
            Back to next task
          </button>
          <button
            type="button"
            className="family-board-hit"
            data-testid={`family-earlier-${pane.membershipId}`}
            onClick={() =>
              props.onBrowse({
                section: "earlier",
                expandedId: projection.earlier[0]?.id ?? null,
              })
            }
          >
            Earlier
          </button>
          <button
            type="button"
            className="family-board-hit"
            data-testid={`family-upcoming-${pane.membershipId}`}
            onClick={() => props.onBrowse({ section: "upcoming", expandedId: null })}
          >
            Coming up
          </button>
          <button
            type="button"
            className="family-board-hit"
            data-testid={`family-more-${pane.membershipId}`}
            onClick={() => props.onBrowse({ section: "more", expandedId: null })}
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
            This person&apos;s board expired.
          </p>
        ) : null}
        {pane.phase === "unavailable" ? (
          <p className="display-status" role="status" data-testid={`family-unavailable-${pane.membershipId}`}>
            Couldn&apos;t load this person.
          </p>
        ) : null}
        {pane.phase === "ready" && day ? (
          <>
            {!recommended && shownEmpty(projection) ? (
              <p
                className="display-empty display-person-status"
                data-testid={`family-empty-${pane.membershipId}`}
                data-empty-kind={projection.emptyKind ?? "none"}
              >
                {emptyCopy(projection.emptyKind)}
              </p>
            ) : null}
            {expanded && browse.section !== "next" ? (
              <PaneOccurrence
                occurrence={expanded}
                emphasize={expanded.id === recommended?.id}
                firstOpenStepId={
                  expanded.id === recommended?.id
                    ? firstOpenStep?.id ?? null
                    : expanded.steps.find((step) => step.status === "open")?.id ?? null
                }
                omitStepId={
                  expanded.id === recommended?.id
                    ? firstOpenStep?.id ?? null
                    : null
                }
                outbox={props.outbox}
                savedFlashByStep={props.savedFlashByStep}
                canAct={props.canAct}
                onStepChange={props.onStepChange}
                onActivity={props.onActivity}
              />
            ) : null}
            {browse.section === "next" && recommended ? (
              <PaneOccurrence
                occurrence={recommended}
                emphasize
                firstOpenStepId={firstOpenStep?.id ?? null}
                omitStepId={firstOpenStep?.id ?? null}
                outbox={props.outbox}
                savedFlashByStep={props.savedFlashByStep}
                canAct={props.canAct}
                onStepChange={props.onStepChange}
                onActivity={props.onActivity}
              />
            ) : null}
            {browse.section === "upcoming" || browse.section === "more" ? (
              <ul className="display-work-list" data-testid={`family-upcoming-list-${pane.membershipId}`}>
                {(browse.section === "more"
                  ? [...projection.upcoming, ...projection.more]
                  : projection.upcoming
                ).map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="family-board-hit display-work-row"
                      data-testid={`family-heading-${item.id}`}
                      onClick={() =>
                        props.onBrowse({
                          section: browse.section,
                          expandedId: item.id,
                          scrollTop: 0,
                        })
                      }
                    >
                      <span className="display-work-title">{item.title}</span>
                      <span className="display-work-meta">
                        {item.daypart
                          ? DAYPART_LABELS[item.daypart as Daypart] ?? item.daypart
                          : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {browse.section === "earlier" ? (
              <ul className="display-work-list" data-testid={`family-earlier-list-${pane.membershipId}`}>
                {projection.earlier.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="family-board-hit display-work-row"
                      data-testid={`family-heading-${item.id}`}
                      onClick={() =>
                        props.onBrowse({
                          section: "earlier",
                          expandedId: item.id,
                          scrollTop: 0,
                        })
                      }
                    >
                      <span className="display-work-title">{item.title}</span>
                    </button>
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
  omitStepId?: string | null;
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
  const remaining = props.occurrence.steps
    .slice()
    .sort((a, b) => a.position - b.position)
    .filter((step) => step.id !== props.omitStepId);
  if (remaining.length === 0) {
    return null;
  }
  return (
    <div
      data-testid={`family-work-${props.occurrence.id}`}
      className={props.emphasize ? "family-board-next" : undefined}
    >
      {props.omitStepId ? null : <h3 className="display-work-title">{props.occurrence.title}</h3>}
      <ol className="display-step-list">
        {remaining.map((step) => (
          <PaneStepRow
            key={step.id}
            occurrence={props.occurrence}
            step={step}
            nextStep={props.emphasize && step.id === props.firstOpenStepId}
            outbox={props.outbox}
            savedFlashByStep={props.savedFlashByStep}
            canAct={props.canAct}
            onStepChange={props.onStepChange}
            onActivity={props.onActivity}
          />
        ))}
      </ol>
    </div>
  );
}

function PaneStepActions(props: {
  occurrence: DisplayOccurrenceDetail;
  step: DisplayOccurrenceDetail["steps"][number];
  outbox: DisplayOutboxItem[];
  savedFlashByStep: Record<string, number>;
  canAct: boolean;
  emphasize?: boolean;
  onStepChange: (
    occurrence: DisplayOccurrenceDetail,
    stepId: string,
    status: StepStatus,
  ) => void;
  onActivity: () => void;
}) {
  const { step } = props;
  const executable = props.canAct && Boolean(props.occurrence.accountableMemberId);
  const feedback = stepFeedback(props.outbox, props.occurrence.id, step.id);
  const savedKey = `${props.occurrence.id}:${step.id}`;
  const showSaved = !feedback && typeof props.savedFlashByStep[savedKey] === "number";
  return (
    <div
      className="family-board-current-actions"
      data-testid={`family-step-${step.id}`}
      data-next-step={props.emphasize ? "true" : undefined}
    >
      {feedback ? (
        <span className="status-pill" data-kind={feedback.kind === "error" ? "error" : "pending"} role="status">
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
    </div>
  );
}

function PaneStepRow(props: {
  occurrence: DisplayOccurrenceDetail;
  step: DisplayOccurrenceDetail["steps"][number];
  nextStep: boolean;
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
  const { step } = props;
  const executable = props.canAct && Boolean(props.occurrence.accountableMemberId);
  const feedback = stepFeedback(props.outbox, props.occurrence.id, step.id);
  const savedKey = `${props.occurrence.id}:${step.id}`;
  const showSaved = !feedback && typeof props.savedFlashByStep[savedKey] === "number";
  const quiet = step.status === "completed" || step.status === "not_needed";
  return (
    <li
      key={step.id}
      className={quiet ? "display-step completed-quiet" : "display-step"}
      data-testid={`family-step-${step.id}`}
      data-next-step={props.nextStep ? "true" : undefined}
    >
      <span className="display-work-title">{step.text}</span>
      <span className="display-work-meta">
        {statusLabel(step.status)}
        {step.obligation === "optional" ? " · Optional" : ""}
        {step.obligation === "as_needed" ? " · As needed" : ""}
        {step.additionHeading ? ` · ${step.additionHeading}` : step.source === "personal" ? " · Personal addition" : ""}
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
}

export function unassignedRows(dashboard: DisplayDashboard): ResponsibilityOverviewRow[] {
  return dashboard.byWork.responsibilities.filter((row) => row.accountableMemberId === null);
}
