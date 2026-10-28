/**
 * Shared current-wall presentation. Live wall and selected-display preview
 * both render through these components; only the data/action adapter differs.
 */
import { DAYPART_LABELS } from "../domain/daypart";
import type {
  ResponsibilityOverviewRow,
  RoutineAggregateRow,
} from "../domain/household-overview";
import type { StepStatus } from "../shared/schemas";
import type {
  DisplayDashboard,
  DisplayOccurrenceDetail,
  DisplayPersonDetail,
} from "./display-api";
import type { DisplayOutboxItem } from "./display-outbox";

export type DisplayOrganization = "by-person" | "by-work";

export type DisplayDetailState =
  | { kind: "person"; membershipId: string; originKey: string }
  | { kind: "occurrence"; occurrenceId: string; originKey: string }
  | { kind: "routine"; aggregateKey: string; originKey: string }
  | {
      kind: "routine-person";
      aggregateKey: string;
      occurrenceId: string;
      originKey: string;
    };

export type PendingOverviewCue = {
  occurrenceId: string;
  title: string;
};

function needsAssignmentRows(dashboard: DisplayDashboard): ResponsibilityOverviewRow[] {
  return dashboard.byWork.responsibilities.filter((row) => row.accountableMemberId === null);
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

export function formatDisplayClock(
  serverTimeIso: string,
  timezone: string,
  elapsedMs: number,
): { weekday: string; date: string; time: string } {
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

export function DisplayAuthenticatedSurface(props: {
  dashboard: DisplayDashboard;
  organization: DisplayOrganization;
  detail: DisplayDetailState | null;
  personDetail: DisplayPersonDetail | null;
  occurrenceDetail: DisplayOccurrenceDetail | null;
  outbox: DisplayOutboxItem[];
  savedFlashByStep: Record<string, number>;
  canAct: boolean;
  loading: boolean;
  stale: boolean;
  pendingCue: PendingOverviewCue | null;
  retiredNotices: Array<{ mutationId: string; message: string }>;
  clockElapsedMs: number;
  readonlyNote: string;
  onDismissRetiredNotice: (mutationId: string) => void;
  onOrganizationChange: (next: DisplayOrganization) => void;
  onOpenPerson: (membershipId: string, originKey: string) => void;
  onOpenResponsibility: (occurrenceId: string, originKey: string) => void;
  onOpenRoutine: (aggregateKey: string, originKey: string) => void;
  onOpenPendingCue: (occurrenceId: string) => void;
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
  const clock = formatDisplayClock(
    props.dashboard.serverTime,
    props.dashboard.timezone,
    props.clockElapsedMs,
  );
  return (
    <div className="display-shell" data-testid="display-shell">
      <header className="display-header">
        <div className="display-clock" data-testid="display-clock">
          <div className="display-weekday">{clock.weekday}</div>
          <div className="display-date">{clock.date}</div>
          <div className="display-time">{clock.time}</div>
        </div>
        <p className="display-readonly-note" role="note">
          {props.readonlyNote}
        </p>
        {props.stale ? (
          <p className="display-stale" role="status">
            Offline — showing last update
          </p>
        ) : null}
        {props.outbox.some((item) => item.state === "pending" || item.state === "retrying") ? (
          <p className="display-stale" role="status">
            <span className="status-pill" data-kind="pending">
              Saving checklist changes…
            </span>
          </p>
        ) : null}
      </header>
      {props.detail ? (
        <DisplayDetailPanel
          detail={props.detail}
          dashboard={props.dashboard}
          personDetail={props.personDetail}
          occurrenceDetail={props.occurrenceDetail}
          outbox={props.outbox}
          savedFlashByStep={props.savedFlashByStep}
          canAct={props.canAct}
          loading={props.loading && !props.personDetail && !props.occurrenceDetail}
          onBack={props.onBack}
          onStepChange={props.onStepChange}
          onOpenOccurrence={props.onOpenOccurrence}
          onOpenRoutinePerson={props.onOpenRoutinePerson}
          onBackToRoutine={props.onBackToRoutine}
        />
      ) : (
        <DisplayOverview
          dashboard={props.dashboard}
          organization={props.organization}
          loading={props.loading}
          pendingCue={props.pendingCue}
          retiredNotices={props.retiredNotices}
          onDismissRetiredNotice={props.onDismissRetiredNotice}
          onOrganizationChange={props.onOrganizationChange}
          onOpenPerson={props.onOpenPerson}
          onOpenResponsibility={props.onOpenResponsibility}
          onOpenRoutine={props.onOpenRoutine}
          onOpenPendingCue={props.onOpenPendingCue}
        />
      )}
    </div>
  );
}

export function DisplayOverview(props: {
  dashboard: DisplayDashboard;
  organization: DisplayOrganization;
  loading: boolean;
  pendingCue: PendingOverviewCue | null;
  retiredNotices: Array<{ mutationId: string; message: string }>;
  onDismissRetiredNotice: (mutationId: string) => void;
  onOrganizationChange: (next: DisplayOrganization) => void;
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
                    {(person.promotedPersonalTasks ?? []).length > 0 ? (
                      <span
                        className="display-person-personal"
                        data-testid={`display-person-promoted-${person.membershipId}`}
                      >
                        Personal ·{" "}
                        {(person.promotedPersonalTasks ?? [])
                          .slice(0, 3)
                          .map((task) => task.title)
                          .join(" · ")}
                        {(person.promotedPersonalTasks ?? []).length > 3
                          ? ` · +${(person.promotedPersonalTasks ?? []).length - 3} more`
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

export function DisplayByWork(props: {
  dashboard: DisplayDashboard;
  onOpenResponsibility: (occurrenceId: string, originKey: string) => void;
  onOpenRoutine: (aggregateKey: string, originKey: string) => void;
}) {
  const { responsibilities, routines } = props.dashboard.byWork;
  const unassigned = responsibilities.filter((row) => row.accountableMemberId === null);
  const assigned = responsibilities.filter((row) => row.accountableMemberId !== null);

  return (
    <div data-testid="display-by-work">
      {(props.dashboard.promotedPersonalTasks ?? []).length > 0 ? (
        <div className="display-promoted-personal" data-testid="display-promoted-personal">
          <h2 className="display-section-title">Personal on wall</h2>
          <ul className="display-work-list">
            {(props.dashboard.promotedPersonalTasks ?? []).map((task) => (
              <li key={task.id}>
                <div className="display-work-row display-personal-row">
                  <span className="display-work-title">{task.title}</span>
                  <span className="display-work-meta">
                    {task.ownerDisplayName} · Personal
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
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

export function DisplayDetailPanel(props: {
  detail: NonNullable<DisplayDetailState>;
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
        ) : props.loading ? (
          <p className="display-status" role="status">
            Loading…
          </p>
        ) : (
          <p className="display-status" role="status" data-testid="display-detail-unavailable">
            This person is no longer available.{" "}
            <button type="button" className="display-back" onClick={props.onBack}>
              Retry
            </button>
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
        ) : props.loading ? (
          <p className="display-status" role="status">
            Loading…
          </p>
        ) : (
          <p className="display-status" role="status" data-testid="display-detail-unavailable">
            This checklist is no longer available.{" "}
            <button type="button" className="display-back" onClick={props.onBack}>
              Retry
            </button>
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
              <span className="display-work-meta">
                {task.status}
                {task.showOnSharedDashboard ? " · Shared dashboard" : ""}
              </span>
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
