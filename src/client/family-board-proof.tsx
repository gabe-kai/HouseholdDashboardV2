/**
 * Development-only family-board layout proof. No API, DB, auth, or outbox.
 */
import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { isOccurrenceComplete } from "../domain/completion";
import { formatStepProgress, stepProgressCounts, workState } from "../domain/progress";
import { projectPersonalDay } from "../domain/today-projection";
import type { DisplayDashboard, DisplayOccurrenceDetail } from "./display-api";
import { DisplayAuthenticatedSurface } from "./display-presentation";
import {
  DEFAULT_PREVIEW_VIEWPORT,
  PREVIEW_VIEWPORT_PRESETS,
  fitScale,
  parsePreviewViewport,
  type PreviewViewport,
} from "./display-preview";
import "./styles.css";

const FIXTURE_ID = "p0-009a-family-board-crowded-r2";
const IDLE_MS = 90_000;
const PEOPLE = [
  { id: "p-morgan", name: "Morgan Reed", sort: 1 },
  { id: "p-avery", name: "Avery Reed-Longname", sort: 2 },
  { id: "p-jordan", name: "Jordan Reed", sort: 3 },
  { id: "p-casey", name: "Casey Reed", sort: 4 },
  { id: "p-taylor", name: "Taylor Reed", sort: 5 },
  { id: "p-rowan", name: "Rowan Reed", sort: 6 },
] as const;

type ProofScenario = "crowded" | "states" | "family-day";
type ProofLayout = "current" | "concept";
type StepRec = {
  id: string;
  text: string;
  status: "open" | "completed" | "not_needed";
  obligation: "required" | "optional" | "as_needed";
  position: number;
};
type WorkRec = {
  id: string;
  ownerId: string | null;
  title: string;
  kind: "routine" | "responsibility";
  daypart: string;
  definitionId: string;
  steps: StepRec[];
};
type SimAction = {
  workId: string;
  stepId: string;
  status: StepRec["status"];
  state: "pending" | "settled" | "rejected";
  error?: string;
};

function cloneWork(work: WorkRec): WorkRec {
  return { ...work, steps: work.steps.map((step) => ({ ...step })) };
}

function crowdedWork(): WorkRec[] {
  const morning = (ownerId: string, title: string, id: string): WorkRec => ({
    id,
    ownerId,
    title,
    kind: "routine",
    daypart: "morning",
    definitionId: "def-morning",
    steps: [
      { id: `${id}-s1`, text: "Get dressed", status: "completed", obligation: "required", position: 0 },
      { id: `${id}-s2`, text: "Brush teeth", status: "completed", obligation: "required", position: 1 },
      { id: `${id}-s3`, text: "Pack the unusually long backpack checklist including library books and permission slip", status: "open", obligation: "required", position: 2 },
      { id: `${id}-s4`, text: "Shoes on", status: "open", obligation: "required", position: 3 },
      { id: `${id}-s5`, text: "Out the door", status: "open", obligation: "required", position: 4 },
    ],
  });
  return [
    morning("p-morgan", "Morning routine", "w-morning-morgan"),
    morning("p-avery", "Morning routine", "w-morning-avery"),
    morning("p-jordan", "Morning routine", "w-morning-jordan"),
    morning("p-casey", "Morning routine", "w-morning-casey"),
    morning("p-taylor", "Morning routine", "w-morning-taylor"),
    morning("p-rowan", "Morning routine", "w-morning-rowan"),
    {
      id: "w-homework-morgan",
      ownerId: "p-morgan",
      title: "Homework time",
      kind: "routine",
      daypart: "after_school",
      definitionId: "def-homework",
      steps: [
        { id: "hw-m-1", text: "Start math sheet", status: "open", obligation: "required", position: 0 },
      ],
    },
    {
      id: "w-homework-avery",
      ownerId: "p-avery",
      title: "Homework time",
      kind: "routine",
      daypart: "after_school",
      definitionId: "def-homework",
      steps: [
        { id: "hw-a-1", text: "Read chapter 4", status: "open", obligation: "required", position: 0 },
      ],
    },
    {
      id: "w-house",
      ownerId: "p-jordan",
      title: "House cleaning",
      kind: "responsibility",
      daypart: "after_school",
      definitionId: "def-house",
      steps: [
        { id: "house-1", text: "Living room pickup", status: "open", obligation: "required", position: 0 },
      ],
    },
    {
      id: "w-dinner",
      ownerId: "p-casey",
      title: "Dinner cleanup",
      kind: "responsibility",
      daypart: "evening",
      definitionId: "def-dinner",
      steps: [
        { id: "dinner-1", text: "Clear plates", status: "open", obligation: "required", position: 0 },
      ],
    },
    {
      id: "w-bed-taylor",
      ownerId: "p-taylor",
      title: "Bedtime",
      kind: "routine",
      daypart: "bedtime",
      definitionId: "def-bed",
      steps: [
        { id: "bed-t-1", text: "Pajamas", status: "open", obligation: "required", position: 0 },
      ],
    },
    {
      id: "w-cats",
      ownerId: "p-rowan",
      title: "Cat litter",
      kind: "responsibility",
      daypart: "evening",
      definitionId: "def-cats",
      steps: [
        { id: "cats-1", text: "Scoop both boxes", status: "open", obligation: "required", position: 0 },
        { id: "cats-2", text: "Extra scoop if needed", status: "open", obligation: "as_needed", position: 1 },
      ],
    },
    {
      id: "w-anytime-morgan",
      ownerId: "p-morgan",
      title: "Anytime mail sort",
      kind: "responsibility",
      daypart: "anytime",
      definitionId: "def-mail",
      steps: [
        { id: "mail-1", text: "Sort the mail", status: "open", obligation: "required", position: 0 },
      ],
    },
    {
      id: "w-unassigned",
      ownerId: null,
      title: "Take out recycling",
      kind: "responsibility",
      daypart: "evening",
      definitionId: "def-recycle",
      steps: [
        { id: "rec-1", text: "Bring bin to curb", status: "open", obligation: "required", position: 0 },
      ],
    },
  ];
}

function stateCheckWork(): WorkRec[] {
  return [
    {
      id: "w-empty-morgan",
      ownerId: "p-morgan",
      title: "No assigned checklist",
      kind: "routine",
      daypart: "morning",
      definitionId: "def-empty",
      steps: [],
    },
    {
      id: "w-optional-avery",
      ownerId: "p-avery",
      title: "Required done, optional left",
      kind: "routine",
      daypart: "morning",
      definitionId: "def-opt",
      steps: [
        { id: "opt-1", text: "Required item", status: "completed", obligation: "required", position: 0 },
        { id: "opt-2", text: "Optional stretch", status: "open", obligation: "optional", position: 1 },
      ],
    },
    {
      id: "w-asneeded-jordan",
      ownerId: "p-jordan",
      title: "Unresolved as needed",
      kind: "responsibility",
      daypart: "after_school",
      definitionId: "def-need",
      steps: [
        { id: "need-1", text: "Wipe spill if present", status: "open", obligation: "as_needed", position: 0 },
      ],
    },
    {
      id: "w-anytime-casey",
      ownerId: "p-casey",
      title: "Anytime drawer tidy",
      kind: "responsibility",
      daypart: "anytime",
      definitionId: "def-any",
      steps: [
        { id: "any-1", text: "Tidy junk drawer", status: "open", obligation: "required", position: 0 },
      ],
    },
    ...crowdedWork().filter((work) =>
      ["p-taylor", "p-rowan"].includes(work.ownerId ?? ""),
    ),
    crowdedWork().find((work) => work.id === "w-unassigned")!,
  ];
}

function toOccurrence(work: WorkRec): DisplayOccurrenceDetail {
  const completed = isOccurrenceComplete(work.steps);
  const progress = stepProgressCounts(work.steps);
  return {
    id: work.id,
    definitionId: work.definitionId,
    revisionId: `rev-${work.definitionId}`,
    title: work.title,
    kind: work.kind,
    daypart: work.daypart,
    householdDate: "2026-10-27",
    accountableMemberId: work.ownerId,
    accountableMemberName:
      PEOPLE.find((person) => person.id === work.ownerId)?.name ?? "Unassigned",
    completed,
    state: workState({ completed, startedAt: null, steps: work.steps }),
    progress,
    progressLabel: formatStepProgress(progress),
    steps: work.steps.map((step) => ({
      id: step.id,
      text: step.text,
      status: step.status,
      obligation: step.obligation,
      position: step.position,
    })),
  };
}

function toDashboard(works: WorkRec[]): DisplayDashboard {
  const occurrences = works.map(toOccurrence);
  const byPerson = PEOPLE.map((person) => {
    const mine = occurrences.filter((item) => item.accountableMemberId === person.id);
    const unfinished = mine.filter((item) => !item.completed);
    const progress = stepProgressCounts(mine.flatMap((item) => item.steps));
    const allComplete = mine.length > 0 && mine.every((item) => item.completed);
    const anyBegun = mine.some((item) => item.steps.some((step) => step.status !== "open"));
    return {
      membershipId: person.id,
      displayName: person.name,
      sortOrder: person.sort,
      status: "active" as const,
      recurringState:
        mine.length === 0
          ? ("No assigned work today" as const)
          : allComplete
            ? ("Complete" as const)
            : anyBegun
              ? ("In progress" as const)
              : ("Not started" as const),
      progress: mine.length === 0 ? null : progress,
      progressLabel: mine.length === 0 ? null : formatStepProgress(progress),
      unfinished: unfinished.map((item) => ({
        occurrenceId: item.id,
        title: item.title,
        kind: item.kind,
      })),
      promotedPersonalTasks:
        person.id === "p-casey"
          ? [{ id: "task-promoted", title: "Return library books" }]
          : [],
    };
  });
  const responsibilities = occurrences
    .filter((item) => item.kind === "responsibility")
    .map((item) => ({
      id: item.id,
      title: item.title,
      accountableMemberId: item.accountableMemberId,
      accountableMemberName: item.accountableMemberName,
      completed: item.completed,
      state: item.state,
      progress: item.progress,
      progressLabel: item.progressLabel,
      daypart: item.daypart,
    }));
  const routines = [
    {
      key: "morning",
      displayTitle: "Morning routine",
      daypart: "morning",
      completedCount: occurrences.filter(
        (item) => item.definitionId === "def-morning" && item.completed,
      ).length,
      applicableCount: occurrences.filter((item) => item.definitionId === "def-morning").length,
      overallState: "In progress" as const,
      people: occurrences
        .filter((item) => item.definitionId === "def-morning")
        .map((item) => ({
          occurrenceId: item.id,
          accountableMemberId: item.accountableMemberId,
          accountableMemberName: item.accountableMemberName,
          completed: item.completed,
          state: item.state,
        })),
    },
  ];
  return {
    householdDate: "2026-10-27",
    timezone: "America/New_York",
    serverTime: "2026-10-27T14:00:00.000Z",
    activityGeneration: 1,
    byPerson,
    byWork: { responsibilities, routines } as DisplayDashboard["byWork"],
    promotedPersonalTasks: [
      {
        id: "task-promoted",
        title: "Return library books",
        ownerMembershipId: "p-casey",
        ownerDisplayName: "Casey Reed",
      },
    ],
  };
}

function applyStatus(works: WorkRec[], workId: string, stepId: string, status: StepRec["status"]): WorkRec[] {
  return works.map((work) => {
    if (work.id !== workId) return work;
    return {
      ...work,
      steps: work.steps.map((step) => (step.id === stepId ? { ...step, status } : step)),
    };
  });
}

function CurrentProof(props: {
  works: WorkRec[];
  failDetail: boolean;
  onNavigate: (kind: string, id: string) => void;
  onRetry: () => void;
}) {
  const dashboard = toDashboard(props.works);
  const [organization, setOrganization] = useState<"by-person" | "by-work">("by-person");
  const [detailId, setDetailId] = useState<string | null>(null);
  const occurrence = props.works.find((work) => work.id === detailId);
  return (
    <DisplayAuthenticatedSurface
      dashboard={dashboard}
      organization={organization}
      detail={
        detailId
          ? { kind: "occurrence", occurrenceId: detailId, originKey: detailId }
          : null
      }
      personDetail={null}
      occurrenceDetail={
        props.failDetail && detailId
          ? null
          : occurrence
            ? toOccurrence(occurrence)
            : null
      }
      outbox={[]}
      savedFlashByStep={{}}
      canAct={false}
      loading={false}
      stale={false}
      pendingCue={null}
      retiredNotices={[]}
      clockElapsedMs={0}
      readonlyNote="Fictional current layout — preview only"
      onDismissRetiredNotice={() => undefined}
      onOrganizationChange={setOrganization}
      onOpenPerson={(membershipId) => props.onNavigate("person", membershipId)}
      onOpenResponsibility={(occurrenceId) => {
        setDetailId(occurrenceId);
        props.onNavigate("occurrence", occurrenceId);
      }}
      onOpenRoutine={(aggregateKey) => props.onNavigate("routine", aggregateKey)}
      onOpenPendingCue={() => undefined}
      onBack={() => {
        if (props.failDetail) props.onRetry();
        setDetailId(null);
      }}
      onStepChange={() => undefined}
      onOpenOccurrence={(occurrenceId) => setDetailId(occurrenceId)}
      onOpenRoutinePerson={(_key, occurrenceId) => setDetailId(occurrenceId)}
      onBackToRoutine={() => setDetailId(null)}
    />
  );
}

function ConceptPane(props: {
  personId: string;
  name: string;
  works: WorkRec[];
  section: "next" | "earlier" | "upcoming" | "more";
  scrollTop: number;
  pending: SimAction | null;
  rejected: SimAction | null;
  enlarged: boolean;
  clockMs: number;
  lastActivity: number;
  onSection: (section: "next" | "earlier" | "upcoming" | "more") => void;
  onScroll: (top: number) => void;
  onActivity: () => void;
  onEnlarge: () => void;
  onBackFamily: () => void;
  onAction: (workId: string, stepId: string, status: StepRec["status"]) => void;
  familyDay: boolean;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const mine = props.works.filter((work) => work.ownerId === props.personId);
  const projection = projectPersonalDay(
    mine.map((work) => ({
      id: work.id,
      definitionId: work.definitionId,
      daypart: work.daypart as "morning" | "after_school" | "evening" | "bedtime" | "anytime",
      completed: isOccurrenceComplete(work.steps),
      startedAt: work.steps.some((step) => step.status !== "open") ? "x" : null,
      steps: work.steps,
      title: work.title,
    })),
    [],
  );
  const focus = mine.find((work) => work.id === projection.recommendedFocusId) ?? mine[0];
  const earlier = mine.filter(
    (work) =>
      work.id !== focus?.id &&
      ["morning", "after_school"].includes(work.daypart) &&
      !isOccurrenceComplete(work.steps) &&
      work.daypart !== focus.daypart,
  );
  const upcoming = [
    mine.find((work) => work.title === "Homework time"),
    mine.find((work) => work.title === "House cleaning"),
    mine.find((work) => work.title === "Dinner cleanup"),
    mine.find((work) => work.title === "Bedtime"),
    mine.find((work) => work.title === "Cat litter"),
  ].filter((work): work is WorkRec => {
    if (!work) return false;
    return work.id !== focus?.id;
  });

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = props.scrollTop;
  }, [props.scrollTop, props.enlarged]);

  const idleDue =
    props.clockMs - props.lastActivity >= IDLE_MS &&
    props.pending === null &&
    props.section !== "next";

  useEffect(() => {
    if (idleDue) props.onSection("next");
  }, [idleDue, props]);

  const shown =
    props.section === "earlier"
      ? earlier
      : props.section === "upcoming" || props.section === "more"
        ? upcoming
        : focus
          ? [focus]
          : [];

  return (
    <article
      className={`family-board-pane ${props.enlarged ? "enlarged" : ""}`}
      data-testid={`family-pane-${props.personId}`}
      data-section={props.section}
    >
      <header className="family-board-pane-header">
        <h2 className="display-person-name">{props.name}</h2>
        {props.enlarged ? (
          <button
            type="button"
            className="family-board-hit"
            id={`family-back-${props.personId}`}
            data-testid={`family-back-${props.personId}`}
            onClick={props.onBackFamily}
          >
            Back to family
          </button>
        ) : (
          <button
            type="button"
            className="family-board-hit"
            id={`family-enlarge-${props.personId}`}
            data-testid={`family-enlarge-${props.personId}`}
            onClick={props.onEnlarge}
          >
            Enlarge
          </button>
        )}
      </header>
      <div
        ref={bodyRef}
        className="family-board-pane-body"
        data-testid={`family-scroll-${props.personId}`}
        onScroll={(event) => props.onScroll(event.currentTarget.scrollTop)}
        onPointerDown={props.onActivity}
        onKeyDown={props.onActivity}
      >
        <nav className="display-org-toggle" aria-label={`${props.name} sections`}>
          <button type="button" className="family-board-hit" onClick={() => props.onSection("next")}>
            Back to next task
          </button>
          <button type="button" className="family-board-hit" onClick={() => props.onSection("earlier")}>
            Earlier
          </button>
          <button type="button" className="family-board-hit" onClick={() => props.onSection("upcoming")}>
            Coming up
          </button>
          <button type="button" className="family-board-hit" onClick={() => props.onSection("more")}>
            More sections
          </button>
        </nav>
        {shown.length === 0 || (focus && focus.steps.length === 0 && props.section === "next") ? (
          <p className="display-empty" data-testid={`family-empty-${props.personId}`}>
            No assigned checklist
          </p>
        ) : (
          shown.map((work) => {
            const occurrence = toOccurrence(work);
            return (
              <div key={work.id} data-testid={`family-work-${work.id}`}>
                <h3 className="display-work-title">{work.title}</h3>
                <p
                  className="display-work-meta"
                  data-testid={
                    props.section === "next" ? `family-next-${props.personId}` : undefined
                  }
                >
                  {occurrence.state} · {occurrence.progressLabel}
                </p>
                <ol className="display-step-list">
                  {work.steps.map((step) => (
                    <li key={step.id} className="display-step" data-testid={`family-step-${step.id}`}>
                      <span className="display-work-title">{step.text}</span>
                      <span className="display-work-meta">
                        {step.status === "completed"
                          ? "Done"
                          : step.status === "not_needed"
                            ? "Not needed"
                            : "Open"}
                        {step.obligation === "optional" ? " · Optional" : ""}
                        {step.obligation === "as_needed" ? " · As needed" : ""}
                      </span>
                      <div className="display-step-actions">
                        <button
                          type="button"
                          className="family-board-hit"
                          data-testid={`family-done-${step.id}`}
                          onClick={() =>
                            props.onAction(
                              work.id,
                              step.id,
                              step.status === "completed" ? "open" : "completed",
                            )
                          }
                        >
                          {step.status === "completed" ? "Reopen" : "Done"}
                        </button>
                        {step.obligation === "as_needed" ? (
                          <button
                            type="button"
                            className="family-board-hit"
                            data-testid={`family-not-needed-${step.id}`}
                            onClick={() => props.onAction(work.id, step.id, "not_needed")}
                          >
                            Not needed
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
                {props.pending?.workId === work.id ? (
                  <p className="status-pill" data-kind="pending" role="status">
                    Saving…
                  </p>
                ) : null}
                {props.rejected?.workId === work.id ? (
                  <p
                    className="status-pill"
                    data-kind="error"
                    role="status"
                    data-testid={`family-error-${work.id}`}
                  >
                    {props.rejected.error ?? "Could not save"}
                  </p>
                ) : null}
              </div>
            );
          })
        )}
        {props.section === "upcoming" ? (
          <ul className="display-work-list" data-testid={`family-upcoming-${props.personId}`}>
            {["Homework time", "House cleaning", "Dinner cleanup", "Bedtime", "Cat litter"].map(
              (heading) => (
                <li key={heading} className="display-work-meta">
                  {heading}
                </li>
              ),
            )}
          </ul>
        ) : null}
        {props.section === "upcoming" || props.section === "earlier" ? (
          <div
            className="family-board-scroll-spacer"
            data-testid={`family-scroll-spacer-${props.personId}`}
          />
        ) : null}
        {props.personId === "p-casey" ? (
          <p className="display-work-meta" data-testid="family-promoted-view-only">
            Return library books · view only · not in recurring counts
          </p>
        ) : null}
        {props.familyDay ? (
          <div data-testid={`family-day-${props.personId}`}>
            <h3 className="display-section-title">School — fictional</h3>
            <p className="display-work-title" data-testid={`family-school-${props.personId}`}>
              {props.personId === "p-avery"
                ? "Science fair paragraph"
                : props.personId === "p-jordan"
                  ? "Spelling list"
                  : "Reading log"}
            </p>
            <h3 className="display-section-title">Meals — fictional</h3>
            <p className="display-work-title" data-testid="family-meals-shared">
              Shared: pasta and salad at 5:30
            </p>
            <h3 className="display-section-title">Calendar — fictional</h3>
            <p
              className="display-work-title"
              data-testid={`family-calendar-${props.personId}`}
            >
              Early release Friday 2026-10-30 · Avery and Jordan · Today vs Later
            </p>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ConceptBoard(props: {
  works: WorkRec[];
  familyDay: boolean;
  clockMs: number;
  holdMode: "none" | "hold" | "reject";
  onWorks: (next: WorkRec[]) => void;
}) {
  const [sections, setSections] = useState<Record<string, "next" | "earlier" | "upcoming" | "more">>(
    {},
  );
  const [scrolls, setScrolls] = useState<Record<string, number>>({});
  const [activity, setActivity] = useState<Record<string, number>>({});
  const [enlarged, setEnlarged] = useState<string | null>(null);
  const [pending, setPending] = useState<SimAction | null>(null);
  const [rejected, setRejected] = useState<SimAction | null>(null);
  const enlargeOriginRef = useRef<HTMLElement | null>(null);

  function markActivity(personId: string) {
    setActivity((current) => ({ ...current, [personId]: props.clockMs }));
  }

  function runAction(workId: string, stepId: string, status: StepRec["status"]) {
    const action: SimAction = { workId, stepId, status, state: "pending" };
    if (props.holdMode === "hold") {
      setPending(action);
      return;
    }
    if (props.holdMode === "reject") {
      setRejected({ ...action, state: "rejected", error: "Simulated reject" });
      return;
    }
    props.onWorks(applyStatus(props.works, workId, stepId, status));
    setPending(null);
    setRejected(null);
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (window.__HD_PROOF_SETTLE__ && pending) {
        window.__HD_PROOF_SETTLE__ = undefined;
        props.onWorks(applyStatus(props.works, pending.workId, pending.stepId, pending.status));
        setPending(null);
      }
      if (window.__HD_PROOF_REJECT__ && pending) {
        window.__HD_PROOF_REJECT__ = undefined;
        setRejected({ ...pending, state: "rejected", error: "Simulated reject" });
        setPending(null);
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [pending, props]);

  return (
    <div className="family-board-proof-stage" data-testid="family-board-concept" data-clock={props.clockMs}>
      <div className="family-board-grid" data-testid="family-board-grid">
        {PEOPLE.map((person) => (
          <ConceptPane
            key={person.id}
            personId={person.id}
            name={person.name}
            works={props.works}
            section={sections[person.id] ?? "next"}
            scrollTop={scrolls[person.id] ?? 0}
            pending={pending}
            rejected={rejected}
            enlarged={enlarged === person.id}
            clockMs={enlarged && enlarged !== person.id ? activity[person.id] ?? 0 : props.clockMs}
            lastActivity={activity[person.id] ?? 0}
            onSection={(section) => {
              markActivity(person.id);
              setSections((current) => ({ ...current, [person.id]: section }));
            }}
            onScroll={(top) => setScrolls((current) => ({ ...current, [person.id]: top }))}
            onActivity={() => markActivity(person.id)}
            onEnlarge={() => {
              enlargeOriginRef.current = document.getElementById(
                `family-enlarge-${person.id}`,
              );
              setEnlarged(person.id);
            }}
            onBackFamily={() => {
              setEnlarged(null);
              enlargeOriginRef.current?.focus();
            }}
            onAction={(workId, stepId, status) => {
              markActivity(person.id);
              runAction(workId, stepId, status);
            }}
            familyDay={props.familyDay}
          />
        ))}
      </div>
      {props.works.some((work) => work.ownerId === null) ? (
        <aside className="family-board-unassigned" data-testid="family-unassigned">
          <h2 className="display-section-title">Unassigned</h2>
          <p className="display-work-title">Take out recycling</p>
          <p className="display-work-meta">Outside person panes · no claim control on this board</p>
        </aside>
      ) : null}
    </div>
  );
}

declare global {
  interface Window {
    __HD_PROOF_CLOCK_MS?: number;
    __HD_PROOF_SETTLE__?: true;
    __HD_PROOF_REJECT__?: true;
  }
}

function ProofInner() {
  const params = new URLSearchParams(window.location.search);
  const [layout, setLayout] = useState<ProofLayout>(
    params.get("layout") === "current" ? "current" : "concept",
  );
  const [scenario, setScenario] = useState<ProofScenario>(
    params.get("scenario") === "states"
      ? "states"
      : params.get("scenario") === "family-day"
        ? "family-day"
        : "crowded",
  );
  const [works, setWorks] = useState<WorkRec[]>(() =>
    crowdedWork().map(cloneWork),
  );
  const [failDetail, setFailDetail] = useState(params.get("failDetail") === "1");
  const [holdMode, setHoldMode] = useState<"none" | "hold" | "reject">(
    params.get("hold") === "hold" ? "hold" : params.get("hold") === "reject" ? "reject" : "none",
  );
  const [resetTick, setResetTick] = useState(0);
  const [clockMs, setClockMs] = useState(0);
  const [viewport, setViewport] = useState<PreviewViewport>(() =>
    parsePreviewViewport(window.location.search),
  );
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const source =
      scenario === "states" ? stateCheckWork() : crowdedWork();
    setWorks(source.map(cloneWork));
  }, [scenario]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockMs((ms) =>
        typeof window.__HD_PROOF_CLOCK_MS === "number" ? window.__HD_PROOF_CLOCK_MS : ms + 250,
      );
    }, 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    function measure() {
      if (!stageRef.current) return;
      setScale(
        fitScale(
          viewport.width,
          viewport.height,
          stageRef.current.clientWidth,
          stageRef.current.clientHeight,
        ),
      );
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [viewport]);

  const surface = params.get("surface");
  const board = useMemo(() => {
    if (layout === "current") {
      return (
        <CurrentProof
          works={works}
          failDetail={failDetail}
          onNavigate={() => undefined}
          onRetry={() => setFailDetail(false)}
        />
      );
    }
    return (
      <ConceptBoard
        works={works}
        familyDay={scenario === "family-day"}
        clockMs={clockMs}
        holdMode={holdMode}
        onWorks={setWorks}
      />
    );
  }, [layout, works, failDetail, scenario, clockMs, holdMode]);

  if (surface === "board") {
    return (
      <div
        data-testid="family-board-surface"
        data-fixture={FIXTURE_ID}
        style={{ width: viewport.width, height: viewport.height, overflow: "hidden" }}
      >
        {board}
      </div>
    );
  }

  const iframeSrc = `${window.location.pathname}?surface=board&layout=${layout}&scenario=${scenario}&preset=${
    viewport.width === 1920 ? "fhd" : "uhd"
  }${failDetail ? "&failDetail=1" : ""}&hold=${holdMode}&reset=${resetTick}`;

  return (
    <section className="family-board-proof" data-testid="family-board-proof">
      <div className="family-board-proof-chrome">
        <h1 className="page-heading">Family board proof</h1>
        <p className="meta" data-testid="family-board-meta">
          Fixture {FIXTURE_ID} · target {viewport.width}×{viewport.height} ·{" "}
          {viewport.provenance} · fit {Math.round(scale * 100)}% · fictional only
        </p>
        <div className="display-preview-viewport-controls">
          <button
            type="button"
            className={layout === "current" ? "secondary active" : "secondary"}
            data-testid="proof-layout-current"
            onClick={() => setLayout("current")}
          >
            Current layout
          </button>
          <button
            type="button"
            className={layout === "concept" ? "secondary active" : "secondary"}
            data-testid="proof-layout-concept"
            onClick={() => setLayout("concept")}
          >
            Family board concept
          </button>
          <button type="button" className="secondary" data-testid="proof-reset" onClick={() => {
            setWorks((scenario === "states" ? stateCheckWork() : crowdedWork()).map(cloneWork));
            setHoldMode("none");
            setFailDetail(false);
            setResetTick((tick) => tick + 1);
          }}>
            Reset simulation
          </button>
          <button type="button" className="secondary" onClick={() => setScenario("crowded")}>
            Crowded day
          </button>
          <button type="button" className="secondary" data-testid="proof-scenario-states" onClick={() => setScenario("states")}>
            State checks
          </button>
          <button type="button" className="secondary" data-testid="proof-scenario-family" onClick={() => setScenario("family-day")}>
            Family day — fictional concept
          </button>
          <button type="button" className="secondary" onClick={() => setViewport({ ...PREVIEW_VIEWPORT_PRESETS.uhd, provenance: "chosen" })}>
            3840 × 2160
          </button>
          <button type="button" className="secondary" onClick={() => setViewport({ ...PREVIEW_VIEWPORT_PRESETS.fhd, provenance: "chosen" })}>
            1920 × 1080
          </button>
          <button type="button" className="secondary" data-testid="proof-hold" onClick={() => setHoldMode("hold")}>
            Hold next action
          </button>
          <button type="button" className="secondary" data-testid="proof-fail-detail" onClick={() => setFailDetail(true)}>
            Fail next detail
          </button>
        </div>
      </div>
      <div className="display-preview-stage" ref={stageRef}>
        <div
          className="display-preview-scaler"
          style={{ width: viewport.width * scale, height: viewport.height * scale }}
        >
          <iframe
            title="Family board proof surface"
            src={iframeSrc}
            className="display-preview-frame"
            data-testid="family-board-frame"
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

if (!import.meta.env.DEV) {
  document.body.textContent = "This proof is not available in production builds.";
} else {
  const rootEl = document.getElementById("root");
  if (rootEl) {
    createRoot(rootEl).render(
      <StrictMode>
        <ProofInner />
      </StrictMode>,
    );
  }
}

void DEFAULT_PREVIEW_VIEWPORT;
