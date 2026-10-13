import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Daypart, MemberPublic } from "../shared/schemas";
import { DEFAULT_APPLICABILITY } from "../domain/applicability";
import {
  fetchGuideProgress,
  fetchPeople,
  fetchSchoolCalendar,
  guideCompletePeople,
  guideDismiss,
  guideFinish,
  guideSavePerson,
  guideSaveSchool,
  guideSaveWork,
  previewDraftResponsibility,
  previewDraftRoutine,
  type GuideProgress,
  type GuideWorkPreviewBasis,
  type SchoolCalendarPublic,
  type SchoolYearPublic,
  type SessionInfo,
} from "./api";
import { newClientId } from "./id";

type GuideStep = "people" | "school" | "work" | "recap";

const STEP_ORDER: GuideStep[] = ["people", "school", "work", "recap"];
const WEEKDAYS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];
const DAYPARTS: Daypart[] = ["morning", "after_school", "evening", "bedtime", "anytime"];

type YearDraft = {
  clientKey: string;
  id?: string;
  startDate: string;
  endDate: string;
  usualWeekdays: number[];
  exceptions: Array<{
    id?: string;
    name: string;
    startDate: string;
    endDate: string;
  }>;
};

type WorkStepDraft = { text: string; obligation: "required" | "optional" };

function errorMessage(caught: unknown): string {
  if (caught && typeof caught === "object" && "message" in caught) {
    return String((caught as { message: unknown }).message);
  }
  return "Something went wrong";
}

/** Resume at the first unfinished optional step; finished alone does not skip unfinished work. */
function initialStep(progress: GuideProgress): GuideStep {
  if (progress.firstWorkStatus !== "not_chosen") return "recap";
  if (progress.schoolStatus !== "not_chosen") return "work";
  if (progress.peopleStatus !== "not_chosen") return "school";
  return "people";
}

function yearsFromPublic(years: SchoolYearPublic[]): YearDraft[] {
  return years.map((year) => ({
    clientKey: year.id,
    id: year.id,
    startDate: year.startDate,
    endDate: year.endDate,
    usualWeekdays: [...year.usualWeekdays],
    exceptions: year.exceptions.map((exception) => ({
      id: exception.id,
      name: exception.name,
      startDate: exception.startDate,
      endDate: exception.endDate,
    })),
  }));
}

function emptyYearDraft(): YearDraft {
  return {
    clientKey: newClientId(),
    startDate: "",
    endDate: "",
    usualWeekdays: [1, 2, 3, 4, 5],
    exceptions: [],
  };
}

function schoolSnapshot(years: YearDraft[], version: number): string {
  return JSON.stringify({ version, years });
}

function workSnapshot(input: {
  workKind: string;
  workTitle: string;
  daypart: Daypart;
  weekdays: number[];
  steps: WorkStepDraft[];
  audienceIds: string[];
  audienceGroupIds: string[];
  ownerId: string;
  assignmentMode: string;
}): string {
  return JSON.stringify(input);
}

export type GuidedSetupProps = {
  session: SessionInfo;
  memberships: MemberPublic[];
  onMembershipsChange: (people: MemberPublic[]) => void;
  onDirtyChange: (dirty: boolean) => void;
  onNavigateToday: () => void;
  onNavigateHousehold: () => void;
  onNavigatePeople?: () => void;
  onBack: () => void;
  guideRefreshToken?: number;
};

export function GuidedSetupView(props: GuidedSetupProps) {
  const [progress, setProgress] = useState<GuideProgress | null>(null);
  const [step, setStep] = useState<GuideStep>("people");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictHint, setConflictHint] = useState<string | null>(null);
  const [people, setPeople] = useState<MemberPublic[]>(props.memberships);

  const [personName, setPersonName] = useState("");
  const [personClass, setPersonClass] = useState<"adult" | "child">("child");
  const [addingAnother, setAddingAnother] = useState(false);

  const [pinnedCalendarVersion, setPinnedCalendarVersion] = useState(0);
  const [yearDrafts, setYearDrafts] = useState<YearDraft[]>([]);
  const [schoolBaseline, setSchoolBaseline] = useState("");
  const [calendarConfigured, setCalendarConfigured] = useState(false);

  const [workKind, setWorkKind] = useState<"routine" | "responsibility" | "both" | "skip">(
    "routine",
  );
  const [workTitle, setWorkTitle] = useState("Morning checklist");
  const [daypart, setDaypart] = useState<Daypart>("morning");
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [workSteps, setWorkSteps] = useState<WorkStepDraft[]>([
    { text: "Get ready", obligation: "required" },
  ]);
  const [audienceIds, setAudienceIds] = useState<string[]>([]);
  const [audienceGroupIds, setAudienceGroupIds] = useState<string[]>([]);
  const [ownerId, setOwnerId] = useState("");
  const [assignmentMode, setAssignmentMode] = useState<"fixed" | "take_turns" | "weekly">(
    "fixed",
  );
  const [workBaseline, setWorkBaseline] = useState("");
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewBasis, setPreviewBasis] = useState<GuideWorkPreviewBasis | null>(null);
  const [savedWorkSummary, setSavedWorkSummary] = useState<string[]>([]);

  // Stable mutation IDs retained until the ambiguous result resolves.
  const personMutationRef = useRef(newClientId());
  const peopleCompleteMutationRef = useRef(newClientId());
  const schoolMutationRef = useRef(newClientId());
  const schoolInnerMutationRef = useRef(newClientId());
  const workMutationRef = useRef(newClientId());
  const finishMutationRef = useRef(newClientId());
  const dismissMutationRef = useRef(newClientId());
  const dirtyRef = useRef(false);
  const loadGenerationRef = useRef(0);

  const schoolDirty =
    schoolBaseline !== "" &&
    schoolSnapshot(yearDrafts, pinnedCalendarVersion) !== schoolBaseline;
  const workDirty =
    step === "work" &&
    workBaseline !== "" &&
    workSnapshot({
      workKind,
      workTitle,
      daypart,
      weekdays,
      steps: workSteps,
      audienceIds,
      audienceGroupIds,
      ownerId,
      assignmentMode,
    }) !== workBaseline;
  const peopleDirty = personName.trim().length > 0;
  const dirty =
    (peopleDirty && step === "people") ||
    (schoolDirty && step === "school") ||
    workDirty;

  useEffect(() => {
    dirtyRef.current = dirty;
    props.onDirtyChange(step === "recap" ? false : dirty);
  }, [dirty, step, props]);

  function applyLoadedCalendar(calendar: SchoolCalendarPublic | null | undefined) {
    const version = calendar?.version ?? 0;
    setPinnedCalendarVersion(version);
    setCalendarConfigured(Boolean(calendar?.configured && (calendar.years?.length ?? 0) > 0));
    const years =
      calendar?.configured && calendar.years.length > 0
        ? yearsFromPublic(calendar.years)
        : [emptyYearDraft()];
    setYearDrafts(years);
    setSchoolBaseline(schoolSnapshot(years, version));
  }

  function resetWorkBaseline(nextPeople: MemberPublic[]) {
    const managerId = props.session.member.id;
    const defaults = {
      workKind: "routine" as const,
      workTitle: "Morning checklist",
      daypart: "morning" as Daypart,
      weekdays: [1, 2, 3, 4, 5],
      steps: [{ text: "Get ready", obligation: "required" as const }],
      audienceIds: nextPeople.filter((p) => !p.departed).map((p) => p.id),
      audienceGroupIds: [] as string[],
      ownerId: managerId,
      assignmentMode: "fixed" as const,
    };
    setWorkKind(defaults.workKind);
    setWorkTitle(defaults.workTitle);
    setDaypart(defaults.daypart);
    setWeekdays(defaults.weekdays);
    setWorkSteps(defaults.steps);
    setAudienceIds(defaults.audienceIds);
    setAudienceGroupIds(defaults.audienceGroupIds);
    setOwnerId(defaults.ownerId);
    setAssignmentMode(defaults.assignmentMode);
    setPreviewText(null);
    setPreviewBasis(null);
    setWorkBaseline(workSnapshot(defaults));
  }

  async function loadGuide(options?: { force?: boolean }) {
    const generation = ++loadGenerationRef.current;
    const [guide, list, calendar] = await Promise.all([
      fetchGuideProgress(),
      fetchPeople(),
      fetchSchoolCalendar().catch(() => null),
    ]);
    if (generation !== loadGenerationRef.current) return;
    if (!options?.force && dirtyRef.current) {
      setConflictHint(
        "Someone else updated setup while you were editing. Keep your draft, or discard to refresh.",
      );
      return;
    }
    setConflictHint(null);
    setProgress(guide);
    setStep(initialStep(guide));
    setPeople(list.people);
    props.onMembershipsChange(list.people);
    applyLoadedCalendar(calendar?.calendar ?? null);
    resetWorkBaseline(list.people);
    setPersonName("");
    setSavedWorkSummary(
      guide.workDefinitionIds.map((id) => `Saved work ${id.slice(0, 8)}…`),
    );
  }

  useEffect(() => {
    void loadGuide({ force: true }).catch((caught) => setError(errorMessage(caught)));
    // Dirty retention is enforced inside loadGuide; force:true is only used on mount/token bumps.
  }, [props.guideRefreshToken, props.session.member.id, props.session.installationEpoch]);

  const others = useMemo(
    () => people.filter((p) => p.id !== props.session.member.id && !p.departed),
    [people, props.session.member.id],
  );
  const manager = people.find((p) => p.id === props.session.member.id) ?? null;

  function invalidatePreview() {
    setPreviewText(null);
    setPreviewBasis(null);
  }

  function guard() {
    if (!progress) throw new Error("Guide not loaded");
    return {
      expectedGuideVersion: progress.guideVersion,
      installationEpoch: props.session.installationEpoch,
    };
  }

  async function savePerson(event: FormEvent) {
    event.preventDefault();
    if (!progress) return;
    setBusy(true);
    setError(null);
    try {
      const result = await guideSavePerson({
        mutationId: personMutationRef.current,
        ...guard(),
        displayName: personName.trim(),
        classification: personClass,
      });
      personMutationRef.current = newClientId();
      setProgress(result.progress);
      const list = await fetchPeople();
      setPeople(list.people);
      props.onMembershipsChange(list.people);
      setPersonName("");
      setAddingAnother(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function completePeople(status: "completed" | "skipped") {
    if (!progress) return;
    setBusy(true);
    setError(null);
    try {
      const result = await guideCompletePeople({
        mutationId: peopleCompleteMutationRef.current,
        ...guard(),
        status,
      });
      peopleCompleteMutationRef.current = newClientId();
      setProgress(result.progress);
      setPersonName("");
      setStep("school");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function saveSchool(status: "completed" | "skipped") {
    if (!progress) return;
    setBusy(true);
    setError(null);
    try {
      const result = await guideSaveSchool({
        mutationId: schoolMutationRef.current,
        ...guard(),
        status,
        ...(status === "completed"
          ? {
              calendar: {
                mutationId: schoolInnerMutationRef.current,
                expectedVersion: pinnedCalendarVersion,
                years: yearDrafts.map((year) => ({
                  ...(year.id ? { id: year.id } : {}),
                  startDate: year.startDate,
                  endDate: year.endDate,
                  usualWeekdays: year.usualWeekdays,
                  exceptions: year.exceptions.map((exception) => ({
                    ...(exception.id ? { id: exception.id } : {}),
                    name: exception.name,
                    startDate: exception.startDate,
                    endDate: exception.endDate,
                  })),
                })),
              },
            }
          : {}),
      });
      schoolMutationRef.current = newClientId();
      schoolInnerMutationRef.current = newClientId();
      setProgress(result.progress);
      if (result.calendar) {
        applyLoadedCalendar(result.calendar);
      } else {
        // Not now: keep existing calendar facts; only progress advances.
        setSchoolBaseline(schoolSnapshot(yearDrafts, pinnedCalendarVersion));
      }
      setStep("work");
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      if (/updated elsewhere|reload and review/i.test(message)) {
        setConflictHint("Calendar changed elsewhere. Refresh to review, or keep editing your draft.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    if (!progress || workKind === "skip") return;
    setBusy(true);
    setError(null);
    try {
      const calendar = await fetchSchoolCalendar();
      const lines: string[] = [];
      let reviewedRoutineParticipantIds: string[] | undefined;
      let reviewedResponsibilityOwnerId: string | null | undefined;
      const steps = workSteps
        .filter((s) => s.text.trim())
        .map((s) => ({
          text: s.text.trim(),
          obligation: s.obligation,
          applicability: DEFAULT_APPLICABILITY,
        }));
      if (workKind === "routine" || workKind === "both") {
        const routinePreview = await previewDraftRoutine({
          mutationId: newClientId(),
          title: workTitle.trim(),
          daypart,
          weekdays,
          assigneeMemberIds: audienceIds,
          assigneeGroupIds: audienceGroupIds,
          steps,
        });
        const first = routinePreview.preview.find((d) => d.applicable);
        reviewedRoutineParticipantIds = first?.participantMemberIds ?? [];
        lines.push(
          `Routine “${workTitle.trim()}”: ${first ? `${first.householdDate} · ${first.participantNames.join(", ") || "no participants"} · ${first.stepCount} steps` : routinePreview.nextKnownDate ? `next ${routinePreview.nextKnownDate}` : routinePreview.noKnownReason ?? "no known date"}`,
        );
        for (const day of routinePreview.preview.filter((d) => d.applicable).slice(0, 7)) {
          lines.push(
            `  ${day.householdDate}: ${day.participantNames.join(", ") || "—"} (${day.stepCount} steps)`,
          );
        }
      }
      if (workKind === "responsibility" || workKind === "both") {
        const respPreview = await previewDraftResponsibility({
          mutationId: newClientId(),
          title: workTitle.trim() || "Shared responsibility",
          daypart: workKind === "both" ? "anytime" : daypart,
          weekdays,
          accountableMemberId: assignmentMode === "fixed" ? ownerId || undefined : undefined,
          assignment: {
            mode: assignmentMode,
            anchorDate: props.session.householdDate,
            fixedMemberId: assignmentMode === "fixed" ? ownerId || null : null,
            cycleOrder: assignmentMode === "take_turns" ? audienceIds : undefined,
            weeklyMap: {},
          },
          steps,
          scheduledAdditions: [],
        });
        const first = respPreview.preview.find((d) => d.applicable);
        reviewedResponsibilityOwnerId = first?.accountableMemberId ?? null;
        lines.push(
          `Responsibility “${workTitle.trim() || "Shared responsibility"}”: ${first ? `${first.householdDate} · ${first.accountableMemberName ?? "Unassigned"}` : respPreview.nextKnownDate ? `next ${respPreview.nextKnownDate}` : respPreview.noKnownReason ?? "no known date"}`,
        );
        for (const day of respPreview.preview.filter((d) => d.applicable).slice(0, 7)) {
          lines.push(`  ${day.householdDate}: ${day.accountableMemberName ?? "Unassigned"}`);
        }
      }
      setPreviewText(lines.join("\n"));
      setPreviewBasis({
        householdDate: props.session.householdDate,
        calendarVersion: calendar.calendar.version,
        audienceGroupIds: [...audienceGroupIds],
        reviewedRoutineParticipantIds,
        reviewedResponsibilityOwnerId,
      });
    } catch (caught) {
      setError(errorMessage(caught));
      invalidatePreview();
    } finally {
      setBusy(false);
    }
  }

  async function saveWork(status: "completed" | "skipped") {
    if (!progress) return;
    if (status === "completed" && workKind !== "skip" && !previewBasis) {
      setError("Review the work before saving");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const steps = workSteps
        .filter((s) => s.text.trim())
        .map((s) => ({
          text: s.text.trim(),
          obligation: s.obligation,
          applicability: DEFAULT_APPLICABILITY,
        }));
      const routine =
        status === "completed" && (workKind === "routine" || workKind === "both")
          ? {
              mutationId: newClientId(),
              title: workTitle.trim(),
              daypart,
              weekdays,
              assigneeMemberIds: audienceIds,
              assigneeGroupIds: audienceGroupIds,
              steps,
            }
          : undefined;
      const responsibility =
        status === "completed" && (workKind === "responsibility" || workKind === "both")
          ? {
              mutationId: newClientId(),
              title: workTitle.trim() || "Shared responsibility",
              daypart: workKind === "both" ? ("anytime" as Daypart) : daypart,
              weekdays,
              accountableMemberId: assignmentMode === "fixed" ? ownerId || undefined : undefined,
              assignment: {
                mode: assignmentMode,
                anchorDate: props.session.householdDate,
                fixedMemberId: assignmentMode === "fixed" ? ownerId || null : null,
                cycleOrder: assignmentMode === "take_turns" ? audienceIds : undefined,
                weeklyMap: {},
              },
              steps,
              scheduledAdditions: [],
            }
          : undefined;
      const result = await guideSaveWork({
        mutationId: workMutationRef.current,
        ...guard(),
        status: status === "skipped" || workKind === "skip" ? "skipped" : "completed",
        routine,
        responsibility,
        previewHouseholdDate: previewBasis?.householdDate,
        previewBasis: previewBasis ?? undefined,
      });
      workMutationRef.current = newClientId();
      setProgress(result.progress);
      const summary: string[] = [];
      if (result.routine) {
        const title = result.routine.revisions[0]?.title ?? (workTitle.trim() || "Routine");
        summary.push(`Routine “${title}”`);
      }
      if (result.responsibility) {
        const title =
          result.responsibility.revisions[0]?.title ?? (workTitle.trim() || "Responsibility");
        summary.push(`Responsibility “${title}”`);
      }
      setSavedWorkSummary(summary);
      invalidatePreview();
      setStep("recap");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function finishAndGo(target: "today" | "household", dismiss: boolean) {
    if (!progress) return;
    setBusy(true);
    setError(null);
    try {
      const result = await guideFinish({
        mutationId: finishMutationRef.current,
        ...guard(),
        dismiss,
      });
      finishMutationRef.current = newClientId();
      setProgress(result.progress);
      if (target === "today") props.onNavigateToday();
      else props.onNavigateHousehold();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  /** Save and finish later: leave at the saved boundary without marking finished. */
  function saveAndFinishLater() {
    if (dirty) {
      setError("Keep editing or discard your draft before leaving");
      return;
    }
    props.onNavigateToday();
  }

  async function dismissChecklist() {
    if (!progress) return;
    setBusy(true);
    setError(null);
    try {
      const result = await guideDismiss({
        mutationId: dismissMutationRef.current,
        ...guard(),
      });
      dismissMutationRef.current = newClientId();
      setProgress(result.progress);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function discardDraftAndRefresh() {
    dirtyRef.current = false;
    setPersonName("");
    setError(null);
    try {
      await loadGuide({ force: true });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  if (!progress) {
    return (
      <section className="panel guided-setup" data-testid="guided-setup">
        <p className="meta">{error ?? "Loading setup…"}</p>
      </section>
    );
  }

  return (
    <section className="panel guided-setup" data-testid="guided-setup">
      <button type="button" className="back-link" onClick={props.onBack}>
        Back to Household
      </button>
      <h1 className="page-heading">Finish setup</h1>

      <nav
        className="guide-rail guided-setup-rail"
        aria-label="Setup steps"
        data-testid="guide-rail"
      >
        {STEP_ORDER.map((item) => {
          const status =
            item === "people"
              ? progress.peopleStatus
              : item === "school"
                ? progress.schoolStatus
                : item === "work"
                  ? progress.firstWorkStatus
                  : progress.finishedAt
                    ? "completed"
                    : "not_chosen";
          return (
            <button
              key={item}
              type="button"
              className={step === item ? "guide-rail-active is-current" : undefined}
              data-testid={`guide-rail-${item}`}
              data-step={item}
              onClick={() => setStep(item)}
            >
              {item === "people"
                ? "Your people"
                : item === "school"
                  ? "School days"
                  : item === "work"
                    ? "First work"
                    : "Recap"}
              <span className="meta"> {status.replace("_", " ")}</span>
            </button>
          );
        })}
      </nav>

      <div className="guide-progress-phone" data-testid="guide-progress-phone" aria-hidden>
        Step {STEP_ORDER.indexOf(step) + 1} of {STEP_ORDER.length}
      </div>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {conflictHint ? (
        <div className="notice" data-testid="guide-conflict">
          <p>{conflictHint}</p>
          <button type="button" onClick={() => void discardDraftAndRefresh()}>
            Discard and refresh
          </button>
        </div>
      ) : null}

      {step === "people" ? (
        <div
          className={`guide-step${step === "people" ? " is-current" : ""}`}
          data-testid="guide-step-people"
        >
          <h2>Your people</h2>
          <p className="meta">You appear once. Add others with Member + Approval defaults.</p>
          {manager ? (
            <p data-testid="guide-manager-once">
              <strong>{manager.displayName}</strong> (you)
            </p>
          ) : null}
          <ul className="simple-list" data-testid="guide-people-list">
            {others.map((person) => (
              <li key={person.id}>
                {person.displayName} · {person.classification}
              </li>
            ))}
          </ul>
          {(addingAnother || others.length === 0 || personName) && (
            <form className="stack-form" onSubmit={savePerson} data-testid="guide-add-person">
              <label>
                Name
                <input
                  value={personName}
                  onChange={(event) => setPersonName(event.target.value)}
                  data-testid="guide-person-name"
                  required
                />
              </label>
              <label>
                Adult or child
                <select
                  value={personClass}
                  onChange={(event) =>
                    setPersonClass(event.target.value as "adult" | "child")
                  }
                  data-testid="guide-person-class"
                >
                  <option value="adult">Adult</option>
                  <option value="child">Child</option>
                </select>
              </label>
              <button type="submit" className="primary" disabled={busy}>
                Save person
              </button>
            </form>
          )}
          <div className="button-row">
            <button
              type="button"
              data-testid="guide-add-another"
              onClick={() => setAddingAnother(true)}
            >
              Add another person
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              data-testid="guide-people-continue"
              onClick={() => void completePeople("completed")}
            >
              Continue
            </button>
          </div>
          <p className="meta">
            Correction, removal, and sign-in stay available in{" "}
            <a href="/household/people">People</a>.
          </p>
        </div>
      ) : null}

      {step === "school" ? (
        <div className="guide-step is-current" data-testid="guide-school">
          <h2>School days</h2>
          <p className="meta">
            Confirm usual weekdays. Leave year dates empty until you know them
            {calendarConfigured ? "; existing years and exceptions are preserved." : "."}
          </p>
          {yearDrafts.map((year, index) => (
            <fieldset key={year.clientKey} className="stack-form">
              <legend>School year {index + 1}</legend>
              <label>
                Start
                <input
                  type="date"
                  value={year.startDate}
                  onChange={(event) =>
                    setYearDrafts((current) =>
                      current.map((item) =>
                        item.clientKey === year.clientKey
                          ? { ...item, startDate: event.target.value }
                          : item,
                      ),
                    )
                  }
                  data-testid={index === 0 ? "guide-school-start" : undefined}
                />
              </label>
              <label>
                End
                <input
                  type="date"
                  value={year.endDate}
                  onChange={(event) =>
                    setYearDrafts((current) =>
                      current.map((item) =>
                        item.clientKey === year.clientKey
                          ? { ...item, endDate: event.target.value }
                          : item,
                      ),
                    )
                  }
                  data-testid={index === 0 ? "guide-school-end" : undefined}
                />
              </label>
              <div className="weekday-row">
                {WEEKDAYS.map((day) => (
                  <label key={day.value}>
                    <input
                      type="checkbox"
                      checked={year.usualWeekdays.includes(day.value)}
                      onChange={(event) =>
                        setYearDrafts((current) =>
                          current.map((item) =>
                            item.clientKey === year.clientKey
                              ? {
                                  ...item,
                                  usualWeekdays: event.target.checked
                                    ? [...item.usualWeekdays, day.value]
                                    : item.usualWeekdays.filter((value) => value !== day.value),
                                }
                              : item,
                          ),
                        )
                      }
                    />
                    {day.label}
                  </label>
                ))}
              </div>
              {year.exceptions.length > 0 ? (
                <ul className="simple-list">
                  {year.exceptions.map((exception, exIndex) => (
                    <li key={exception.id ?? `${year.clientKey}-ex-${exIndex}`}>
                      {exception.name}: {exception.startDate}
                      {exception.endDate !== exception.startDate
                        ? ` – ${exception.endDate}`
                        : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="meta">No exceptions on this year</p>
              )}
            </fieldset>
          ))}
          <div className="button-row">
            <button
              type="button"
              onClick={() =>
                setYearDrafts((current) => [...current, emptyYearDraft()])
              }
            >
              Add year
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              data-testid="guide-school-save"
              onClick={() => void saveSchool("completed")}
            >
              Save calendar
            </button>
            <button
              type="button"
              disabled={busy}
              data-testid="guide-school-not-now"
              onClick={() => void saveSchool("skipped")}
            >
              Not now
            </button>
          </div>
        </div>
      ) : null}

      {step === "work" ? (
        <div className="guide-step is-current" data-testid="guide-work">
          <h2>First work</h2>
          <p className="meta">
            Routine: each selected person gets a checklist. Responsibility: one owner per
            applicable day.
          </p>
          <label>
            Kind
            <select
              value={workKind}
              onChange={(event) => {
                setWorkKind(event.target.value as typeof workKind);
                invalidatePreview();
              }}
              data-testid="guide-work-kind"
            >
              <option value="routine">Routine</option>
              <option value="responsibility">Responsibility</option>
              <option value="both">Both</option>
              <option value="skip">Finish setup for now</option>
            </select>
          </label>
          {workKind !== "skip" ? (
            <div className="stack-form">
              <label>
                Name
                <input
                  value={workTitle}
                  onChange={(event) => {
                    setWorkTitle(event.target.value);
                    invalidatePreview();
                  }}
                  data-testid="guide-work-title"
                />
              </label>
              <label>
                Daypart
                <select
                  value={daypart}
                  onChange={(event) => {
                    setDaypart(event.target.value as Daypart);
                    invalidatePreview();
                  }}
                  data-testid="guide-work-daypart"
                >
                  {DAYPARTS.map((part) => (
                    <option key={part} value={part}>
                      {part}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend>Recurrence</legend>
                <div className="weekday-row">
                  {WEEKDAYS.map((day) => (
                    <label key={day.value}>
                      <input
                        type="checkbox"
                        checked={weekdays.includes(day.value)}
                        onChange={(event) => {
                          setWeekdays((current) =>
                            event.target.checked
                              ? [...current, day.value]
                              : current.filter((value) => value !== day.value),
                          );
                          invalidatePreview();
                        }}
                      />
                      {day.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>Ordered steps</legend>
                {workSteps.map((stepRow, index) => (
                  <label key={`step-${index}`}>
                    Step {index + 1}
                    <input
                      value={stepRow.text}
                      onChange={(event) => {
                        setWorkSteps((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, text: event.target.value }
                              : item,
                          ),
                        );
                        invalidatePreview();
                      }}
                      data-testid={index === 0 ? "guide-work-step" : undefined}
                    />
                  </label>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setWorkSteps((current) => [
                      ...current,
                      { text: "New step", obligation: "required" },
                    ]);
                    invalidatePreview();
                  }}
                >
                  Add step
                </button>
              </fieldset>
              {(workKind === "routine" || workKind === "both") && (
                <fieldset>
                  <legend>Routine audience</legend>
                  {people
                    .filter((person) => !person.departed)
                    .map((person) => (
                      <label key={person.id}>
                        <input
                          type="checkbox"
                          checked={audienceIds.includes(person.id)}
                          onChange={(event) => {
                            setAudienceIds((current) =>
                              event.target.checked
                                ? [...current, person.id]
                                : current.filter((id) => id !== person.id),
                            );
                            invalidatePreview();
                          }}
                        />
                        {person.displayName}
                      </label>
                    ))}
                </fieldset>
              )}
              {(workKind === "responsibility" || workKind === "both") && (
                <>
                  <label>
                    Assignment
                    <select
                      value={assignmentMode}
                      onChange={(event) => {
                        setAssignmentMode(event.target.value as typeof assignmentMode);
                        invalidatePreview();
                      }}
                      data-testid="guide-assignment-mode"
                    >
                      <option value="fixed">Fixed owner</option>
                      <option value="take_turns">Take turns</option>
                      <option value="weekly">Weekly</option>
                    </select>
                  </label>
                  {assignmentMode === "fixed" ? (
                    <label>
                      Owner
                      <select
                        value={ownerId}
                        onChange={(event) => {
                          setOwnerId(event.target.value);
                          invalidatePreview();
                        }}
                        data-testid="guide-work-owner"
                      >
                        <option value="">Unassigned</option>
                        {people
                          .filter((person) => !person.departed)
                          .map((person) => (
                            <option key={person.id} value={person.id}>
                              {person.displayName}
                            </option>
                          ))}
                      </select>
                    </label>
                  ) : null}
                </>
              )}
              {previewText ? (
                <pre className="guide-preview" data-testid="guide-work-preview">
                  {previewText}
                </pre>
              ) : null}
              <div className="button-row">
                <button
                  type="button"
                  disabled={busy}
                  data-testid="guide-work-review"
                  onClick={() => void runPreview()}
                >
                  Review
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={busy || !previewText}
                  data-testid="guide-work-save"
                  onClick={() => void saveWork("completed")}
                >
                  Save work
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={busy}
              data-testid="guide-work-finish-for-now"
              onClick={() => void saveWork("skipped")}
            >
              Finish setup for now
            </button>
          )}
        </div>
      ) : null}

      {step === "recap" ? (
        <div className="guide-step is-current" data-testid="guide-recap">
          <h2>You are ready for Today</h2>
          <ul className="simple-list">
            <li>People: {progress.peopleStatus.replace("_", " ")}</li>
            <li>School: {progress.schoolStatus.replace("_", " ")}</li>
            <li>First work: {progress.firstWorkStatus.replace("_", " ")}</li>
          </ul>
          {manager ? <p>Manager: {manager.displayName}</p> : null}
          {others.length > 0 ? (
            <p>Family: {others.map((person) => person.displayName).join(", ")}</p>
          ) : null}
          {savedWorkSummary.length > 0 ? (
            <ul className="simple-list" data-testid="guide-recap-work">
              {savedWorkSummary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="meta">No first work saved yet — you can return from Settings.</p>
          )}
          <div className="button-row">
            <button
              type="button"
              className="primary"
              disabled={busy}
              data-testid="guide-go-today"
              onClick={() => void finishAndGo("today", false)}
            >
              Go to Today
            </button>
            <button
              type="button"
              disabled={busy}
              data-testid="guide-view-household"
              onClick={() => void finishAndGo("household", false)}
            >
              View household
            </button>
          </div>
          <p className="meta">
            Optional: <a href="/household/displays">Set up the wall display</a> ·{" "}
            <a href="/household/people">Set up sign-in</a>
          </p>
          {!progress.dismissedAt ? (
            <button type="button" disabled={busy} onClick={() => void dismissChecklist()}>
              Dismiss finish-setup reminder
            </button>
          ) : null}
        </div>
      ) : null}

      {step !== "recap" ? (
        <div className="button-row guide-exit-row">
          <button
            type="button"
            data-testid="guide-save-finish-later"
            onClick={saveAndFinishLater}
          >
            Save and finish later
          </button>
        </div>
      ) : null}
    </section>
  );
}
