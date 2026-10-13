import { FormEvent, useEffect, useMemo, useState } from "react";
import type { MemberPublic } from "../shared/schemas";
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
  type SessionInfo,
} from "./api";
import { newClientId } from "./id";

type GuideStep = "people" | "school" | "work" | "recap";

const STEP_ORDER: GuideStep[] = ["people", "school", "work", "recap"];

function errorMessage(caught: unknown): string {
  if (caught && typeof caught === "object" && "message" in caught) {
    return String((caught as { message: unknown }).message);
  }
  return "Something went wrong";
}

function initialStep(progress: GuideProgress): GuideStep {
  if (progress.firstWorkStatus !== "not_chosen" || progress.finishedAt) return "recap";
  if (progress.schoolStatus !== "not_chosen") return "work";
  if (progress.peopleStatus !== "not_chosen") return "school";
  return "people";
}

export type GuidedSetupProps = {
  session: SessionInfo;
  memberships: MemberPublic[];
  onMembershipsChange: (people: MemberPublic[]) => void;
  onDirtyChange: (dirty: boolean) => void;
  onNavigateToday: () => void;
  onNavigateHousehold: () => void;
  onBack: () => void;
  guideRefreshToken?: number;
};

export function GuidedSetupView(props: GuidedSetupProps) {
  const [progress, setProgress] = useState<GuideProgress | null>(null);
  const [step, setStep] = useState<GuideStep>("people");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<MemberPublic[]>(props.memberships);

  // People draft
  const [personName, setPersonName] = useState("");
  const [personClass, setPersonClass] = useState<"adult" | "child">("child");
  const [addingAnother, setAddingAnother] = useState(false);

  // School draft
  const [schoolStart, setSchoolStart] = useState("");
  const [schoolEnd, setSchoolEnd] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);

  // Work draft
  const [workKind, setWorkKind] = useState<"routine" | "responsibility" | "both">("routine");
  const [workTitle, setWorkTitle] = useState("Morning checklist");
  const [workStep, setWorkStep] = useState("Get ready");
  const [audienceIds, setAudienceIds] = useState<string[]>([]);
  const [ownerId, setOwnerId] = useState("");
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewDate, setPreviewDate] = useState<string | null>(null);

  const dirty =
    personName.trim().length > 0 ||
    schoolStart.length > 0 ||
    schoolEnd.length > 0 ||
    (workTitle.trim().length > 0 && workStep.trim().length > 0 && step === "work");

  useEffect(() => {
    props.onDirtyChange(Boolean(dirty && step !== "recap"));
  }, [dirty, step, props]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [guide, list, calendar] = await Promise.all([
          fetchGuideProgress(),
          fetchPeople(),
          fetchSchoolCalendar().catch(() => null),
        ]);
        if (cancelled) return;
        setProgress(guide);
        setStep(initialStep(guide));
        setPeople(list.people);
        props.onMembershipsChange(list.people);
        const managerId = props.session.member.id;
        setAudienceIds(list.people.map((p) => p.id));
        setOwnerId(managerId);
        const cal = calendar?.calendar;
        if (cal?.configured && cal.years[0]) {
          setSchoolStart(cal.years[0].startDate);
          setSchoolEnd(cal.years[0].endDate);
          setWeekdays(cal.years[0].usualWeekdays);
        } else {
          const year = new Date().getFullYear();
          setSchoolStart(`${year}-09-01`);
          setSchoolEnd(`${year + 1}-06-15`);
        }
      } catch (caught) {
        if (!cancelled) setError(errorMessage(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.guideRefreshToken, props.onMembershipsChange, props.session.member.id]);

  const stepIndex = STEP_ORDER.indexOf(step);
  const others = useMemo(
    () => people.filter((p) => p.id !== props.session.member.id && !p.departed),
    [people, props.session.member.id],
  );
  const manager = people.find((p) => p.id === props.session.member.id) ?? null;

  async function savePerson(event: FormEvent) {
    event.preventDefault();
    if (!progress) return;
    setBusy(true);
    setError(null);
    try {
      const result = await guideSavePerson({
        mutationId: newClientId(),
        expectedGuideVersion: progress.guideVersion,
        displayName: personName.trim(),
        classification: personClass,
      });
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
        mutationId: newClientId(),
        expectedGuideVersion: progress.guideVersion,
        status,
      });
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
        mutationId: newClientId(),
        expectedGuideVersion: progress.guideVersion,
        status,
        ...(status === "completed"
          ? {
              calendar: {
                mutationId: newClientId(),
                expectedVersion: (await fetchSchoolCalendar()).calendar.version,
                years: [
                  {
                    startDate: schoolStart,
                    endDate: schoolEnd,
                    usualWeekdays: weekdays,
                    exceptions: [],
                  },
                ],
              },
            }
          : {}),
      });
      setProgress(result.progress);
      setStep("work");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    setBusy(true);
    setError(null);
    setPreviewText(null);
    try {
      const mutationId = newClientId();
      const steps = [{ text: workStep.trim(), obligation: "required" as const }];
      const weekdaysAll = [1, 2, 3, 4, 5, 6, 7];
      if (workKind === "routine" || workKind === "both") {
        const result = await previewDraftRoutine({
          mutationId,
          title: workTitle.trim(),
          daypart: "morning",
          assigneeMemberIds: audienceIds,
          assigneeGroupIds: [],
          weekdays: weekdaysAll,
          steps,
        });
        const applicable = result.preview.filter((d) => d.applicable);
        const first = applicable[0];
        setPreviewDate(props.session.householdDate);
        setPreviewText(
          first
            ? `${first.title} for ${first.participantNames.join(", ")} on ${first.householdDate} (${first.stepCount} steps)`
            : result.nextKnownDate
              ? `No work in the next seven days; next known date ${result.nextKnownDate}`
              : result.noKnownReason ?? "No applicable dates",
        );
      } else {
        const result = await previewDraftResponsibility({
          mutationId,
          title: workTitle.trim(),
          daypart: "anytime",
          accountableMemberId: ownerId || props.session.member.id,
          weekdays: weekdaysAll,
          steps,
        });
        const applicable = result.preview.filter((d) => d.applicable);
        const first = applicable[0];
        setPreviewDate(props.session.householdDate);
        setPreviewText(
          first
            ? `${first.title} — ${first.accountableMemberName ?? "Unassigned"} on ${first.householdDate}`
            : result.nextKnownDate
              ? `No work in the next seven days; next known date ${result.nextKnownDate}`
              : result.noKnownReason ?? "No applicable dates",
        );
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function saveWork(status: "completed" | "skipped") {
    if (!progress) return;
    setBusy(true);
    setError(null);
    try {
      const weekdaysAll = [1, 2, 3, 4, 5, 6, 7];
      const steps = [{ text: workStep.trim() || "Get ready", obligation: "required" as const }];
      const result = await guideSaveWork({
        mutationId: newClientId(),
        expectedGuideVersion: progress.guideVersion,
        status,
        previewHouseholdDate: previewDate ?? props.session.householdDate,
        ...(status === "completed" && (workKind === "routine" || workKind === "both")
          ? {
              routine: {
                mutationId: newClientId(),
                title: workTitle.trim() || "Morning checklist",
                daypart: "morning" as const,
                assigneeMemberIds: audienceIds.length
                  ? audienceIds
                  : [props.session.member.id],
                assigneeGroupIds: [],
                weekdays: weekdaysAll,
                steps,
              },
            }
          : {}),
        ...(status === "completed" && (workKind === "responsibility" || workKind === "both")
          ? {
              responsibility: {
                mutationId: newClientId(),
                title: workTitle.trim() || "Household job",
                daypart: "anytime" as const,
                accountableMemberId: ownerId || props.session.member.id,
                weekdays: weekdaysAll,
                steps,
              },
            }
          : {}),
      });
      setProgress(result.progress);
      setStep("recap");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function finishGuide(dismissChecklist: boolean) {
    if (!progress) return;
    setBusy(true);
    setError(null);
    try {
      const result = await guideFinish({
        mutationId: newClientId(),
        expectedGuideVersion: progress.guideVersion,
        dismiss: dismissChecklist,
      });
      setProgress(result.progress);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function dismissChecklist() {
    if (!progress) return;
    setBusy(true);
    setError(null);
    try {
      const result = await guideDismiss({
        mutationId: newClientId(),
        expectedGuideVersion: progress.guideVersion,
      });
      setProgress(result.progress);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function toggleWeekday(day: number) {
    setWeekdays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort(),
    );
  }

  function toggleAudience(id: string) {
    setAudienceIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }

  return (
    <section className="panel guided-setup" data-testid="guided-setup">
      <button type="button" className="back-link" onClick={props.onBack}>
        Back
      </button>
      <div className="guided-setup-layout">
        <aside className="guided-setup-rail" aria-label="Setup progress">
          <p className="eyebrow">Household setup</p>
          <ol className="guided-setup-steps">
            {STEP_ORDER.map((name, index) => (
              <li
                key={name}
                className={
                  name === step ? "is-current" : index < stepIndex ? "is-done" : undefined
                }
                data-testid={`guide-step-${name}`}
              >
                {name === "people"
                  ? "Your people"
                  : name === "school"
                    ? "School days"
                    : name === "work"
                      ? "First work"
                      : "Recap"}
              </li>
            ))}
          </ol>
        </aside>

        <div className="guided-setup-main">
          <p className="guided-setup-phone-progress meta" data-testid="guide-phone-progress">
            Step {stepIndex + 1} of {STEP_ORDER.length}
          </p>
          <h1 className="page-heading">
            {step === "people"
              ? "Your people"
              : step === "school"
                ? "School days"
                : step === "work"
                  ? "First work"
                  : "You're ready"}
          </h1>

          {step === "people" ? (
            <div data-testid="guide-people">
              <p className="page-subcopy">
                You are already in the household. Add family members with Member access and
                Approval required by default.
              </p>
              <ul className="guide-people-list" data-testid="guide-people-list">
                {manager ? (
                  <li data-testid="guide-manager-once">
                    <strong>{manager.displayName}</strong> <span className="meta">You · Manager</span>
                  </li>
                ) : null}
                {others.map((person) => (
                  <li key={person.id}>
                    <strong>{person.displayName}</strong>{" "}
                    <span className="meta">{person.classification ?? "person"}</span>
                  </li>
                ))}
              </ul>
              {(addingAnother || others.length === 0 || personName) && (
                <form className="form-grid" onSubmit={savePerson} data-testid="guide-add-person">
                  <label>
                    Name
                    <input
                      value={personName}
                      onChange={(event) => setPersonName(event.target.value)}
                      required
                      data-testid="guide-person-name"
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
                    {busy ? "Saving…" : "Add person"}
                  </button>
                </form>
              )}
              <div className="button-row">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setAddingAnother(true)}
                  data-testid="guide-add-another"
                >
                  Add another person
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => void completePeople("completed")}
                  data-testid="guide-people-continue"
                >
                  Continue
                </button>
              </div>
            </div>
          ) : null}

          {step === "school" ? (
            <div data-testid="guide-school">
              <p className="page-subcopy">
                Optional. Confirm usual school weekdays for this year, or choose Not now.
              </p>
              <div className="form-grid">
                <label>
                  Year start
                  <input
                    type="date"
                    value={schoolStart}
                    onChange={(event) => setSchoolStart(event.target.value)}
                    data-testid="guide-school-start"
                  />
                </label>
                <label>
                  Year end
                  <input
                    type="date"
                    value={schoolEnd}
                    onChange={(event) => setSchoolEnd(event.target.value)}
                    data-testid="guide-school-end"
                  />
                </label>
                <fieldset>
                  <legend>Usual weekdays</legend>
                  {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                    <label key={day} className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={weekdays.includes(day)}
                        onChange={() => toggleWeekday(day)}
                      />
                      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][day - 1]}
                    </label>
                  ))}
                </fieldset>
              </div>
              <div className="button-row">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void saveSchool("skipped")}
                  data-testid="guide-school-not-now"
                >
                  Not now
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={busy || !schoolStart || !schoolEnd || weekdays.length === 0}
                  onClick={() => void saveSchool("completed")}
                  data-testid="guide-school-save"
                >
                  Save school days
                </button>
              </div>
            </div>
          ) : null}

          {step === "work" ? (
            <div data-testid="guide-work">
              <p className="page-subcopy">
                A routine gives each selected person a checklist. A responsibility has one
                accountable owner per day. Review before saving.
              </p>
              <div className="form-grid">
                <label>
                  Kind
                  <select
                    value={workKind}
                    onChange={(event) =>
                      setWorkKind(event.target.value as "routine" | "responsibility" | "both")
                    }
                    data-testid="guide-work-kind"
                  >
                    <option value="routine">Routine</option>
                    <option value="responsibility">Responsibility</option>
                    <option value="both">Both</option>
                  </select>
                </label>
                <label>
                  Name
                  <input
                    value={workTitle}
                    onChange={(event) => setWorkTitle(event.target.value)}
                    data-testid="guide-work-title"
                  />
                </label>
                <label>
                  First step
                  <input
                    value={workStep}
                    onChange={(event) => setWorkStep(event.target.value)}
                    data-testid="guide-work-step"
                  />
                </label>
                {workKind !== "responsibility" ? (
                  <fieldset>
                    <legend>Routine audience</legend>
                    {people
                      .filter((p) => !p.departed)
                      .map((person) => (
                        <label key={person.id} className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={audienceIds.includes(person.id)}
                            onChange={() => toggleAudience(person.id)}
                          />
                          {person.displayName}
                        </label>
                      ))}
                  </fieldset>
                ) : null}
                {workKind !== "routine" ? (
                  <label>
                    Responsibility owner
                    <select
                      value={ownerId}
                      onChange={(event) => setOwnerId(event.target.value)}
                      data-testid="guide-work-owner"
                    >
                      {people
                        .filter((p) => !p.departed)
                        .map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.displayName}
                          </option>
                        ))}
                    </select>
                  </label>
                ) : null}
              </div>
              {previewText ? (
                <p className="status-notice" data-testid="guide-work-preview">
                  {previewText}
                </p>
              ) : null}
              <div className="button-row">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void runPreview()}
                  data-testid="guide-work-review"
                >
                  Review
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void saveWork("skipped")}
                  data-testid="guide-work-finish-for-now"
                >
                  Finish setup for now
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={busy || !previewText}
                  onClick={() => void saveWork("completed")}
                  data-testid="guide-work-save"
                >
                  Save work
                </button>
              </div>
            </div>
          ) : null}

          {step === "recap" && progress ? (
            <div data-testid="guide-recap">
              <p className="page-subcopy">
                People: {progress.peopleStatus}. School: {progress.schoolStatus}. First work:{" "}
                {progress.firstWorkStatus}.
              </p>
              <ul className="guide-people-list">
                {people
                  .filter((p) => !p.departed)
                  .map((person) => (
                    <li key={person.id}>{person.displayName}</li>
                  ))}
              </ul>
              <div className="button-row">
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => {
                    void finishGuide(false).then(() => props.onNavigateToday());
                  }}
                  data-testid="guide-go-today"
                >
                  Go to Today
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    void finishGuide(false).then(() => props.onNavigateHousehold());
                  }}
                  data-testid="guide-go-household"
                >
                  View household
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => void dismissChecklist()}
                  data-testid="guide-dismiss-checklist"
                >
                  Dismiss checklist
                </button>
              </div>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="form-error">
              {error}
            </p>
          ) : null}

          {step !== "recap" ? (
            <p className="meta">
              <button
                type="button"
                className="text-button"
                disabled={busy || !progress}
                onClick={() => {
                  void finishGuide(true).then(() => props.onNavigateToday());
                }}
                data-testid="guide-save-finish-later"
              >
                Save and finish later
              </button>
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** Reload guide progress after sync invalidation when the draft is clean. */
export async function refreshGuideIfClean(
  dirty: boolean,
  onProgress: (progress: GuideProgress) => void,
): Promise<void> {
  if (dirty) return;
  onProgress(await fetchGuideProgress());
}
