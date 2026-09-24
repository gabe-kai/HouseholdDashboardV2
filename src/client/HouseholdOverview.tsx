import { useEffect, useRef, useState } from "react";
import { DAYPART_LABELS } from "../domain/daypart";
import {
  buildHouseholdOverview,
  type ResponsibilityOverviewRow,
  type RoutineAggregateRow,
  type RoutinePersonRow,
} from "../domain/household-overview";
import { formatStepProgress, workState } from "../domain/progress";
import type { MemberPublic, OccurrenceView } from "../shared/schemas";
import type { PersonalTask } from "./api";

type DrillState =
  | null
  | { kind: "responsibility"; occurrenceId: string; originKey: string }
  | { kind: "routine"; aggregateKey: string; originKey: string }
  | {
      kind: "routine-person";
      aggregateKey: string;
      occurrenceId: string;
      originKey: string;
    };

export function HouseholdOverview(props: {
  occurrences: OccurrenceView[];
  tasks: PersonalTask[];
  memberships: MemberPublic[];
  pendingOccurrenceIds: ReadonlySet<string>;
  canManageResponsibility: boolean;
  managementLinks: Array<{ id: string; label: string; description: string; onOpen: () => void }>;
  onRepairUnassigned?: (definitionId: string) => void;
}) {
  const overview = buildHouseholdOverview(props.occurrences, {
    pendingOccurrenceIds: props.pendingOccurrenceIds,
  });
  const [drill, setDrill] = useState<DrillState>(null);
  const [disappearedNotice, setDisappearedNotice] = useState<string | null>(null);
  const scrollRef = useRef<number>(0);
  const originFocusRef = useRef<string | null>(null);

  const sortedRoutines = overview.routines.map((aggregate) => ({
    ...aggregate,
    people: sortPeopleByFamilyOrder(aggregate.people, props.memberships),
  }));

  useEffect(() => {
    if (!drill) {
      if (originFocusRef.current) {
        const el = document.getElementById(originFocusRef.current);
        el?.focus();
        window.scrollTo(0, scrollRef.current);
        originFocusRef.current = null;
      }
      return;
    }
    if (drill.kind === "responsibility") {
      const stillThere = overview.responsibilities.some(
        (row) => row.id === drill.occurrenceId,
      );
      if (!stillThere) {
        setDisappearedNotice("That work is no longer available. Returning to the overview.");
        setDrill(null);
      }
      return;
    }
    const aggregate = sortedRoutines.find((row) => row.key === drill.aggregateKey);
    if (!aggregate) {
      setDisappearedNotice("That routine summary is no longer available. Returning to the overview.");
      setDrill(null);
      return;
    }
    if (drill.kind === "routine-person") {
      const person = aggregate.people.find((row) => row.occurrenceId === drill.occurrenceId);
      if (!person) {
        setDisappearedNotice("That person's checklist is no longer available.");
        setDrill({
          kind: "routine",
          aggregateKey: drill.aggregateKey,
          originKey: drill.originKey,
        });
      }
    }
  }, [drill, overview.responsibilities, sortedRoutines]);

  function openDrill(next: DrillState, originElementId: string) {
    scrollRef.current = window.scrollY;
    originFocusRef.current = originElementId;
    setDisappearedNotice(null);
    setDrill(next);
  }

  if (drill?.kind === "responsibility") {
    const row = overview.responsibilities.find((item) => item.id === drill.occurrenceId);
    const occurrence = props.occurrences.find((item) => item.id === drill.occurrenceId);
    if (row && occurrence) {
      return (
        <ResponsibilityDetail
          row={row}
          occurrence={occurrence}
          canRepair={
            props.canManageResponsibility && row.accountableMemberId === null
          }
          onRepair={() => props.onRepairUnassigned?.(row.definitionId)}
          onBack={() => setDrill(null)}
        />
      );
    }
  }

  if (drill?.kind === "routine" || drill?.kind === "routine-person") {
    const aggregate = sortedRoutines.find((row) => row.key === drill.aggregateKey);
    if (aggregate && drill.kind === "routine") {
      return (
        <RoutinePeopleDetail
          aggregate={aggregate}
          onOpenPerson={(occurrenceId) =>
            openDrill(
              {
                kind: "routine-person",
                aggregateKey: aggregate.key,
                occurrenceId,
                originKey: drill.originKey,
              },
              `household-routine-${aggregate.key}`,
            )
          }
          onBack={() => setDrill(null)}
        />
      );
    }
    if (aggregate && drill.kind === "routine-person") {
      const occurrence = props.occurrences.find((item) => item.id === drill.occurrenceId);
      const person = aggregate.people.find((row) => row.occurrenceId === drill.occurrenceId);
      if (occurrence && person) {
        return (
          <RoutineChecklistDetail
            aggregate={aggregate}
            person={person}
            occurrence={occurrence}
            onBack={() =>
              setDrill({
                kind: "routine",
                aggregateKey: aggregate.key,
                originKey: drill.originKey,
              })
            }
          />
        );
      }
    }
  }

  return (
    <section className="household-overview">
      <h1 className="page-heading">Household</h1>
      <p className="page-subcopy">What still needs attention across the household today.</p>
      {disappearedNotice ? (
        <p className="status-notice" role="status">
          {disappearedNotice}
        </p>
      ) : null}

      <h2 className="household-overview-heading">Responsibilities</h2>
      {overview.responsibilities.length === 0 ? (
        <p className="meta">No responsibility progress to show right now.</p>
      ) : (
        <ul className="household-overview-list">
          {overview.responsibilities.map((row) => {
            const buttonId = `household-resp-${row.id}`;
            return (
              <li key={row.id}>
                <button
                  type="button"
                  id={buttonId}
                  className={`list-row compact-activity-row ${row.completed ? "completed-quiet" : ""}`}
                  onClick={() =>
                    openDrill(
                      {
                        kind: "responsibility",
                        occurrenceId: row.id,
                        originKey: buttonId,
                      },
                      buttonId,
                    )
                  }
                >
                  <span className="compact-activity-title">{row.title}</span>
                  <span className="meta">
                    {row.accountableMemberName}
                    {row.accountableMemberId === null ? " · Needs assignment" : ""} ·{" "}
                    {row.state} · {row.progressLabel}
                    {row.pending ? " · Pending" : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="household-overview-heading">Routines</h2>
      {sortedRoutines.length === 0 ? (
        <p className="meta">No routine progress to show right now.</p>
      ) : (
        <ul className="household-overview-list">
          {sortedRoutines.map((aggregate) => {
            const buttonId = `household-routine-${aggregate.key}`;
            return (
              <li key={aggregate.key}>
                <button
                  type="button"
                  id={buttonId}
                  className={`list-row compact-activity-row ${
                    aggregate.overallState === "Complete" ? "completed-quiet" : ""
                  }`}
                  onClick={() =>
                    openDrill(
                      {
                        kind: "routine",
                        aggregateKey: aggregate.key,
                        originKey: buttonId,
                      },
                      buttonId,
                    )
                  }
                >
                  <span className="compact-activity-title">{aggregate.displayTitle}</span>
                  <span className="meta">
                    {DAYPART_LABELS[aggregate.daypart] ?? aggregate.daypart} ·{" "}
                    {aggregate.completedCount}/{aggregate.applicableCount} people complete ·{" "}
                    {aggregate.overallState}
                    {aggregate.pending ? " · Pending" : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="household-overview-heading">Household-visible personal tasks</h2>
      {props.tasks.length === 0 ? (
        <p className="meta">None right now.</p>
      ) : (
        <ul className="people-list">
          {props.tasks.map((task) => (
            <li key={task.id} className={`activity-entry ${task.status === "completed" ? "completed-quiet" : ""}`}>
              {props.memberships.find((member) => member.id === task.ownerMembershipId)
                ?.displayName ?? "Household member"}{" "}
              · {task.title} · {task.status}
            </li>
          ))}
        </ul>
      )}

      <h2 className="household-overview-heading">Manage</h2>
      <nav className="household-nav" aria-label="Household management">
        {props.managementLinks.map((item) => (
          <button key={item.id} type="button" className="list-row" onClick={item.onOpen}>
            <span>{item.label}</span>
            <span className="meta">{item.description}</span>
          </button>
        ))}
      </nav>
    </section>
  );
}

function sortPeopleByFamilyOrder(
  people: RoutinePersonRow[],
  memberships: MemberPublic[],
): RoutinePersonRow[] {
  const order = new Map(memberships.map((member) => [member.id, member.sortOrder]));
  return people.slice().sort((a, b) => {
    const orderA = a.accountableMemberId
      ? (order.get(a.accountableMemberId) ?? Number.MAX_SAFE_INTEGER)
      : Number.MAX_SAFE_INTEGER - 1;
    const orderB = b.accountableMemberId
      ? (order.get(b.accountableMemberId) ?? Number.MAX_SAFE_INTEGER)
      : Number.MAX_SAFE_INTEGER - 1;
    if (orderA !== orderB) return orderA - orderB;
    const idA = a.accountableMemberId ?? "";
    const idB = b.accountableMemberId ?? "";
    return idA.localeCompare(idB);
  });
}

function BackButton(props: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="back-link" onClick={props.onClick}>
      {props.label}
    </button>
  );
}

function ResponsibilityDetail(props: {
  row: ResponsibilityOverviewRow;
  occurrence: OccurrenceView;
  canRepair: boolean;
  onRepair?: () => void;
  onBack: () => void;
}) {
  return (
    <div className="focused-state" aria-labelledby="household-resp-detail-heading">
      <BackButton label="Back to Household" onClick={props.onBack} />
      <h1 id="household-resp-detail-heading" className="page-heading">
        {props.occurrence.title}
      </h1>
      <p className="meta">
        {props.row.accountableMemberName} · {props.row.state} · {props.row.progressLabel}
      </p>
      {props.row.accountableMemberId === null ? (
        <p className="status-notice" role="status">
          Nobody is assigned yet.{" "}
          {props.canRepair ? (
            <button type="button" className="text-button" onClick={props.onRepair}>
              Open in Plan to assign
            </button>
          ) : (
            "A responsibility manager can assign someone in Plan."
          )}
        </p>
      ) : null}
      <ReadOnlyChecklist occurrence={props.occurrence} />
    </div>
  );
}

function RoutinePeopleDetail(props: {
  aggregate: RoutineAggregateRow;
  onOpenPerson: (occurrenceId: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="focused-state" aria-labelledby="household-routine-people-heading">
      <BackButton label="Back to Household" onClick={props.onBack} />
      <h1 id="household-routine-people-heading" className="page-heading">
        {props.aggregate.displayTitle}
      </h1>
      <p className="meta">
        {props.aggregate.completedCount}/{props.aggregate.applicableCount} people complete ·{" "}
        {props.aggregate.overallState}
      </p>
      <ul className="household-overview-list">
        {props.aggregate.people.map((person) => (
          <li key={person.occurrenceId}>
            <button
              type="button"
              className="list-row compact-activity-row"
              onClick={() => props.onOpenPerson(person.occurrenceId)}
            >
              <span className="compact-activity-title">{person.accountableMemberName}</span>
              <span className="meta">
                {person.title !== props.aggregate.displayTitle ? `${person.title} · ` : ""}
                {person.state} · {formatStepProgress(person.progress)}
                {person.pending ? " · Pending" : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RoutineChecklistDetail(props: {
  aggregate: RoutineAggregateRow;
  person: RoutinePersonRow;
  occurrence: OccurrenceView;
  onBack: () => void;
}) {
  return (
    <div className="focused-state" aria-labelledby="household-routine-checklist-heading">
      <BackButton label={`Back to ${props.aggregate.displayTitle}`} onClick={props.onBack} />
      <article
        className={`occurrence ${props.occurrence.completed ? "completed" : ""}`}
        data-testid={`occurrence-${props.occurrence.id}`}
        data-kind="routine"
        data-completed={props.occurrence.completed ? "true" : "false"}
      >
        <h1 id="household-routine-checklist-heading" className="page-heading">
          {props.occurrence.title}
        </h1>
        <p className="meta">
          {props.person.accountableMemberName} · {workState(props.occurrence)} ·{" "}
          {formatStepProgress(props.person.progress)}
        </p>
        <ReadOnlyChecklist occurrence={props.occurrence} />
      </article>
    </div>
  );
}

function ReadOnlyChecklist(props: { occurrence: OccurrenceView }) {
  return (
    <ul className="checklist">
      {props.occurrence.steps.map((step) => (
        <li key={step.id} className="step">
          <div className="step-title">
            <strong>{step.text}</strong>
          </div>
          <div className="meta">
            Status:{" "}
            {step.status === "completed"
              ? "Completed"
              : step.status === "not_needed"
                ? "Not needed"
                : "Open"}
          </div>
        </li>
      ))}
    </ul>
  );
}
