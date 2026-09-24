import {
  useEffect,
  useId,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import { DAYPART_LABELS } from "../domain/daypart";
import { formatStepProgress, stepProgressCounts, workState } from "../domain/progress";
import { projectPersonalDay } from "../domain/today-projection";
import type { OccurrenceView, StepStatus } from "../shared/schemas";
import {
  createPersonalTask,
  setPersonalTaskStatus,
  type PersonalTask,
} from "./api";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function obligationLabel(obligation: string): string {
  if (obligation === "as_needed") return "As needed";
  if (obligation === "optional") return "Optional";
  return "Required";
}

function statusLabel(status: string): string {
  if (status === "completed") return "Completed";
  if (status === "not_needed") return "Not needed";
  return "Open";
}

type FocusMode = "auto" | "manual" | "collapsed";

export function TodayView(props: {
  occurrences: OccurrenceView[];
  tasks: PersonalTask[];
  pendingOccurrenceIds: ReadonlySet<string>;
  canExecuteRoutine: boolean;
  canExecuteResponsibility: boolean;
  canPersonalize: boolean;
  onOpenPersonalize: () => void;
  onStepChange: (occurrenceId: string, stepId: string, status: StepStatus) => void;
  onTasksChanged: (tasks: PersonalTask[]) => void;
  /** Session/member/date key — reset focus policy when it changes. */
  focusScopeKey: string;
}) {
  const day = projectPersonalDay(props.occurrences, props.tasks);
  const [focusMode, setFocusMode] = useState<FocusMode>("auto");
  const [manualFocusId, setManualFocusId] = useState<string | null>(null);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [showCompletedTasks, setShowCompletedTasks] = useState(false);
  const scopeRef = useRef(props.focusScopeKey);

  useEffect(() => {
    if (scopeRef.current !== props.focusScopeKey) {
      scopeRef.current = props.focusScopeKey;
      setFocusMode("auto");
      setManualFocusId(null);
      setCompletedOpen(false);
    }
  }, [props.focusScopeKey]);

  const recommendedId = day.recommendedFocusId;

  let focusedId: string | null = null;
  if (focusMode === "collapsed") {
    focusedId = null;
  } else if (focusMode === "manual") {
    focusedId = manualFocusId;
  } else {
    focusedId = recommendedId;
  }

  // Keep a pending-focused card open even after optimistic completion.
  if (
    focusedId &&
    props.pendingOccurrenceIds.has(focusedId) &&
    !props.occurrences.some((occurrence) => occurrence.id === focusedId)
  ) {
    // occurrence retained via pending-omitted elsewhere; focus id still valid
  }

  function selectOccurrence(id: string) {
    if (focusedId === id) {
      setFocusMode("collapsed");
      setManualFocusId(null);
      return;
    }
    setFocusMode("manual");
    setManualFocusId(id);
  }

  function expandCompletedOccurrence(id: string) {
    setCompletedOpen(true);
    selectOccurrence(id);
  }

  const hasRecurring =
    props.occurrences.length > 0 || day.openPersonalTasks.length > 0 || day.completedPersonalTasks.length > 0;

  return (
    <section className="today-actionable">
      <h1 className="page-heading">Today</h1>
      {props.canPersonalize ? (
        <div className="today-actions">
          <button type="button" className="btn-ghost" onClick={props.onOpenPersonalize}>
            Personalize
          </button>
        </div>
      ) : null}

      {!hasRecurring ? (
        <div className="empty-state">
          <p>Nothing assigned to you on this household date.</p>
        </div>
      ) : null}

      {day.completed.length > 0 ? (
        <section className="today-section today-section-completed" aria-labelledby="today-completed-heading">
          <button
            type="button"
            className="today-section-toggle"
            aria-expanded={completedOpen}
            id="today-completed-heading"
            onClick={() => setCompletedOpen((open) => !open)}
          >
            <h2>Completed</h2>
            <span className="meta">{day.completed.length} quiet</span>
          </button>
          {completedOpen ? (
            <ul className="today-compact-list">
              {day.completed.map((occurrence) => (
                <li key={occurrence.id}>
                  <CompactOccurrenceRow
                    occurrence={occurrence}
                    expanded={focusedId === occurrence.id}
                    onToggle={() => expandCompletedOccurrence(occurrence.id)}
                    canExecuteRoutine={props.canExecuteRoutine}
                    canExecuteResponsibility={props.canExecuteResponsibility}
                    onStepChange={props.onStepChange}
                    pending={props.pendingOccurrenceIds.has(occurrence.id)}
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {day.next ? (
        <section className="today-section" aria-labelledby="today-next-heading">
          <h2 id="today-next-heading" className="today-section-heading">
            Next
          </h2>
          <CompactOccurrenceRow
            occurrence={day.next}
            expanded={focusedId === day.next.id}
            onToggle={() => selectOccurrence(day.next!.id)}
            canExecuteRoutine={props.canExecuteRoutine}
            canExecuteResponsibility={props.canExecuteResponsibility}
            onStepChange={props.onStepChange}
            pending={props.pendingOccurrenceIds.has(day.next.id)}
            emphasize
          />
        </section>
      ) : null}

      {day.later.length > 0 ? (
        <section className="today-section" aria-labelledby="today-later-heading">
          <h2 id="today-later-heading" className="today-section-heading">
            Later
          </h2>
          <ul className="today-compact-list">
            {day.later.map((occurrence) => (
              <li key={occurrence.id}>
                <CompactOccurrenceRow
                  occurrence={occurrence}
                  expanded={focusedId === occurrence.id}
                  onToggle={() => selectOccurrence(occurrence.id)}
                  canExecuteRoutine={props.canExecuteRoutine}
                  canExecuteResponsibility={props.canExecuteResponsibility}
                  onStepChange={props.onStepChange}
                  pending={props.pendingOccurrenceIds.has(occurrence.id)}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="today-section" aria-labelledby="today-anytime-heading">
        <h2 id="today-anytime-heading" className="today-section-heading">
          Anytime Today
        </h2>
        {day.anytimeOccurrences.length > 0 ? (
          <ul className="today-compact-list">
            {day.anytimeOccurrences.map((occurrence) => (
              <li key={occurrence.id}>
                <CompactOccurrenceRow
                  occurrence={occurrence}
                  expanded={focusedId === occurrence.id}
                  onToggle={() => selectOccurrence(occurrence.id)}
                  canExecuteRoutine={props.canExecuteRoutine}
                  canExecuteResponsibility={props.canExecuteResponsibility}
                  onStepChange={props.onStepChange}
                  pending={props.pendingOccurrenceIds.has(occurrence.id)}
                />
              </li>
            ))}
          </ul>
        ) : null}
        <PersonalTasksBlock
          openTasks={day.openPersonalTasks}
          completedTasks={day.completedPersonalTasks}
          showCompleted={showCompletedTasks}
          onToggleCompleted={() => setShowCompletedTasks((value) => !value)}
          onChanged={props.onTasksChanged}
          allTasks={props.tasks}
        />
      </section>
    </section>
  );
}

function CompactOccurrenceRow(props: {
  occurrence: OccurrenceView;
  expanded: boolean;
  onToggle: () => void;
  canExecuteRoutine: boolean;
  canExecuteResponsibility: boolean;
  onStepChange: (occurrenceId: string, stepId: string, status: StepStatus) => void;
  pending: boolean;
  emphasize?: boolean;
}) {
  const occurrence = props.occurrence;
  const kind = occurrence.kind === "responsibility" ? "responsibility" : "routine";
  const canExecute =
    kind === "responsibility"
      ? props.canExecuteResponsibility
      : props.canExecuteRoutine;
  const progress = stepProgressCounts(occurrence.steps);
  const state = workState(occurrence);
  const headingId = useId();

  return (
    <article
      className={`occurrence today-occurrence ${occurrence.completed ? "completed" : ""} ${
        props.emphasize ? "today-occurrence-next" : ""
      }`}
      data-testid={`occurrence-${occurrence.id}`}
      data-kind={kind}
      data-completed={occurrence.completed ? "true" : "false"}
      data-expanded={props.expanded ? "true" : "false"}
    >
      <button
        type="button"
        className="occurrence-header today-occurrence-header"
        aria-expanded={props.expanded}
        aria-controls={`${headingId}-checklist`}
        id={headingId}
        onClick={props.onToggle}
      >
        <div>
          <h3 className="today-occurrence-title">{occurrence.title}</h3>
          <div className="meta">
            {DAYPART_LABELS[occurrence.daypart] ?? occurrence.daypart} · {state} ·{" "}
            {formatStepProgress(progress)}
            {props.pending ? " · Pending" : ""}
          </div>
        </div>
        <span aria-hidden="true">{props.expanded ? "▾" : "▸"}</span>
      </button>
      {props.expanded ? (
        <ul className="checklist" id={`${headingId}-checklist`}>
          {occurrence.steps.map((step) => (
            <li key={step.id} className="step" data-testid={`step-${step.id}`}>
              <div className="step-title">
                <strong>{step.text}</strong>
                <span className="obligation">
                  {obligationLabel(step.obligation)}
                  {step.source === "personal" ? " · Personal" : ""}
                </span>
              </div>
              <div className="meta" data-testid={`step-status-${step.id}`}>
                Status: {statusLabel(step.status)}
              </div>
              {canExecute ? (
                <div className="step-actions">
                  <button
                    type="button"
                    aria-pressed={step.status === "open"}
                    aria-label={`Mark ${step.text} open`}
                    onClick={() => props.onStepChange(occurrence.id, step.id, "open")}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    aria-pressed={step.status === "completed"}
                    aria-label={`Mark ${step.text} completed`}
                    onClick={() => props.onStepChange(occurrence.id, step.id, "completed")}
                  >
                    Done
                  </button>
                  {step.obligation === "as_needed" ? (
                    <button
                      type="button"
                      aria-pressed={step.status === "not_needed"}
                      aria-label={`Mark ${step.text} not needed today`}
                      onClick={() => props.onStepChange(occurrence.id, step.id, "not_needed")}
                    >
                      Not needed
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function PersonalTasksBlock(props: {
  openTasks: PersonalTask[];
  completedTasks: PersonalTask[];
  showCompleted: boolean;
  onToggleCompleted: () => void;
  allTasks: PersonalTask[];
  onChanged: (tasks: PersonalTask[]) => void;
}) {
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState<"private" | "household">("private");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const result = await createPersonalTask(title, visibility);
      props.onChanged([result.task, ...props.allTasks]);
      setTitle("");
      setAdding(false);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function setStatus(task: PersonalTask, status: "open" | "completed") {
    setError(null);
    try {
      const result = await setPersonalTaskStatus(task.id, status);
      props.onChanged(
        props.allTasks.map((current) => (current.id === task.id ? result.task : current)),
      );
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <div className="today-personal-tasks">
      <div className="today-personal-tasks-header">
        <h3 className="today-subsection-heading">Personal tasks</h3>
        {!adding ? (
          <button type="button" className="secondary" onClick={() => setAdding(true)}>
            Add task
          </button>
        ) : null}
      </div>
      {adding ? (
        <form className="inline-form" onSubmit={create}>
          <label className="grow">
            <span className="sr-only">New personal task</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Add a personal task"
              required
              autoFocus
            />
          </label>
          <label>
            <span className="sr-only">Task visibility</span>
            <select
              aria-label="Task visibility"
              value={visibility}
              onChange={(event) =>
                setVisibility(event.target.value as "private" | "household")
              }
            >
              <option value="private">Private</option>
              <option value="household">Household</option>
            </select>
          </label>
          <button type="submit" className="secondary">
            Save
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setAdding(false);
              setError(null);
            }}
          >
            Cancel
          </button>
        </form>
      ) : null}
      <TaskList tasks={props.openTasks} onStatus={setStatus} />
      {props.completedTasks.length > 0 ? (
        <>
          <button
            type="button"
            className="text-button"
            aria-expanded={props.showCompleted}
            onClick={props.onToggleCompleted}
          >
            {props.showCompleted ? "Hide" : "Show"} completed personal tasks (
            {props.completedTasks.length})
          </button>
          {props.showCompleted ? (
            <>
              <p className="meta">
                Completed personal tasks are not dated to this household day.
              </p>
              <TaskList tasks={props.completedTasks} onStatus={setStatus} />
            </>
          ) : null}
        </>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

function TaskList(props: {
  tasks: PersonalTask[];
  onStatus: (task: PersonalTask, status: "open" | "completed") => void;
}) {
  if (props.tasks.length === 0) return null;
  return (
    <ul className="people-list">
      {props.tasks.map((task) => (
        <li key={task.id} className="activity-entry">
          <span>
            {task.title}
            <span className="meta">
              {" "}
              · {task.visibility === "household" ? "Household" : "Private"} · {task.status}
            </span>
          </span>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              props.onStatus(task, task.status === "completed" ? "open" : "completed")
            }
          >
            {task.status === "completed" ? "Undo" : "Done"}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** @deprecated kept for type exports if needed externally */
export type TodayExpandedProps = {
  expanded: Record<string, boolean>;
  setExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
};
