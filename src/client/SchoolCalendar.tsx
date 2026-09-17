import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { validateSchoolCalendarDraft, type SchoolYearInput } from "../domain/school-calendar";
import {
  fetchSchoolCalendar,
  saveSchoolCalendar,
  type SchoolCalendarPublic,
  type SchoolYearPublic,
} from "./api";
import { newClientId } from "./id";

const WEEKDAYS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

const DEFAULT_USUAL_WEEKDAYS = [1, 2, 3, 4, 5];

type YearDraft = SchoolYearInput & { clientKey: string };

function FocusHeading(props: { id: string; children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.focus();
    node.scrollIntoView({ block: "nearest" });
  }, []);
  return (
    <h2 id={props.id} ref={ref} tabIndex={-1} className="focus-heading">
      {props.children}
    </h2>
  );
}

function BackButton(props: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="back-link" onClick={props.onClick}>
      {props.label}
    </button>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function weekdaysLabel(weekdays: number[]): string {
  const sorted = [...weekdays].sort((a, b) => a - b);
  return sorted
    .map((day) => WEEKDAYS.find((item) => item.value === day)?.label ?? String(day))
    .join(", ");
}

function emptyYearDraft(today: string): YearDraft {
  return {
    clientKey: newClientId(),
    startDate: today,
    endDate: today,
    usualWeekdays: [...DEFAULT_USUAL_WEEKDAYS],
    exceptions: [],
  };
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

function draftSnapshot(years: YearDraft[]): string {
  return JSON.stringify(
    years.map((year) => ({
      id: year.id ?? null,
      startDate: year.startDate,
      endDate: year.endDate,
      usualWeekdays: [...year.usualWeekdays].sort((a, b) => a - b),
      exceptions: year.exceptions.map((exception) => ({
        id: exception.id ?? null,
        name: exception.name.trim(),
        startDate: exception.startDate,
        endDate: exception.endDate,
      })),
    })),
  );
}

function issuesForPath(
  issues: Array<{ path: string; message: string }>,
  path: string,
): string[] {
  return issues.filter((issue) => issue.path === path).map((issue) => issue.message);
}

function CalendarSummary(props: { calendar: SchoolCalendarPublic }) {
  if (!props.calendar.configured || props.calendar.years.length === 0) {
    return (
      <div className="empty-state">
        <p>Not set up</p>
        <p className="meta">
          School-day and no-school steps need a calendar before they can run.
        </p>
      </div>
    );
  }

  return (
    <ul className="simple-list">
      {props.calendar.years.map((year) => (
        <li key={year.id}>
          <strong>
            {year.startDate} – {year.endDate}
          </strong>
          <span className="meta">Usual days: {weekdaysLabel(year.usualWeekdays)}</span>
          {year.exceptions.length > 0 ? (
            <ul className="simple-list">
              {year.exceptions.map((exception) => (
                <li key={exception.id}>
                  {exception.name}: {exception.startDate}
                  {exception.endDate !== exception.startDate
                    ? ` – ${exception.endDate}`
                    : ""}
                </li>
              ))}
            </ul>
          ) : (
            <span className="meta">No exceptions</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function SchoolCalendarView(props: {
  today: string;
  canManage: boolean;
  refreshToken?: number;
  onSuccessToast?: (message: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onBack: () => void;
  fetchCalendar?: typeof fetchSchoolCalendar;
  saveCalendar?: typeof saveSchoolCalendar;
}) {
  const loadCalendar = props.fetchCalendar ?? fetchSchoolCalendar;
  const persistCalendar = props.saveCalendar ?? saveSchoolCalendar;

  const [calendar, setCalendar] = useState<SchoolCalendarPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draftYears, setDraftYears] = useState<YearDraft[]>([]);
  const [baselineSnapshot, setBaselineSnapshot] = useState("");
  const [fieldIssues, setFieldIssues] = useState<Array<{ path: string; message: string }>>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loadGenerationRef = useRef(0);

  const dirty =
    editing && baselineSnapshot !== "" && draftSnapshot(draftYears) !== baselineSnapshot;

  useEffect(() => {
    props.onDirtyChange?.(dirty);
  }, [dirty, props.onDirtyChange]);

  useEffect(() => {
    const generation = ++loadGenerationRef.current;
    setLoading(true);
    setError(null);
    void loadCalendar()
      .then((result) => {
        if (generation !== loadGenerationRef.current) return;
        setCalendar(result.calendar);
      })
      .catch((caught) => {
        if (generation !== loadGenerationRef.current) return;
        setError(errorMessage(caught));
      })
      .finally(() => {
        if (generation === loadGenerationRef.current) setLoading(false);
      });
  }, [loadCalendar, props.refreshToken]);

  function beginEdit() {
    if (!calendar) return;
    const years =
      calendar.years.length > 0 ? yearsFromPublic(calendar.years) : [emptyYearDraft(props.today)];
    const snapshot = draftSnapshot(years);
    setDraftYears(years);
    setBaselineSnapshot(snapshot);
    setFieldIssues([]);
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraftYears([]);
    setBaselineSnapshot("");
    setFieldIssues([]);
    setError(null);
  }

  function updateYear(clientKey: string, patch: Partial<YearDraft>) {
    setDraftYears((current) =>
      current.map((year) => (year.clientKey === clientKey ? { ...year, ...patch } : year)),
    );
  }

  function removeYear(clientKey: string) {
    setDraftYears((current) => current.filter((year) => year.clientKey !== clientKey));
  }

  function addYear() {
    setDraftYears((current) => [...current, emptyYearDraft(props.today)]);
  }

  function addException(clientKey: string) {
    setDraftYears((current) =>
      current.map((year) =>
        year.clientKey === clientKey
          ? {
              ...year,
              exceptions: [
                ...year.exceptions,
                {
                  id: undefined,
                  name: "",
                  startDate: year.startDate,
                  endDate: year.startDate,
                },
              ],
            }
          : year,
      ),
    );
  }

  function updateException(
    clientKey: string,
    index: number,
    patch: Partial<YearDraft["exceptions"][number]>,
  ) {
    setDraftYears((current) =>
      current.map((year) => {
        if (year.clientKey !== clientKey) return year;
        const exceptions = year.exceptions.map((exception, i) =>
          i === index ? { ...exception, ...patch } : exception,
        );
        return { ...year, exceptions };
      }),
    );
  }

  function removeException(clientKey: string, index: number) {
    setDraftYears((current) =>
      current.map((year) =>
        year.clientKey === clientKey
          ? {
              ...year,
              exceptions: year.exceptions.filter((_, i) => i !== index),
            }
          : year,
      ),
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!calendar || busy) return;
    const issues = validateSchoolCalendarDraft(draftYears);
    setFieldIssues(issues);
    if (issues.length > 0) {
      setError("Fix the highlighted fields before saving.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await persistCalendar({
        mutationId: newClientId(),
        expectedVersion: calendar.version,
        years: draftYears.map(({ clientKey: _clientKey, ...year }) => year),
      });
      setCalendar(result.calendar);
      setEditing(false);
      setBaselineSnapshot("");
      setDraftYears([]);
      setFieldIssues([]);
      props.onDirtyChange?.(false);
      props.onSuccessToast?.("School calendar saved.");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const generalIssues = issuesForPath(fieldIssues, "years");

  return (
    <section className="panel people-groups">
      <div className="focused-state" aria-labelledby="school-calendar-heading">
        <BackButton label="Back to Household" onClick={props.onBack} />
        <FocusHeading id="school-calendar-heading">School calendar</FocusHeading>
        {loading ? <p className="meta">Loading calendar…</p> : null}
        {error ? (
          <p role="alert" className="form-error">
            {error}
          </p>
        ) : null}
        {!loading && calendar && !editing ? (
          <>
            {calendar.configured && calendar.effectiveFrom ? (
              <p className="meta">Effective from {calendar.effectiveFrom}</p>
            ) : null}
            <CalendarSummary calendar={calendar} />
            {props.canManage ? (
              <div className="button-row">
                <button type="button" className="primary" onClick={beginEdit}>
                  Edit
                </button>
              </div>
            ) : (
              <p className="meta">Only calendar managers can edit the school calendar.</p>
            )}
          </>
        ) : null}
        {!loading && calendar && editing ? (
          <form className="form-grid" onSubmit={submit}>
            {generalIssues.map((message) => (
              <p key={message} role="alert" className="form-error">
                {message}
              </p>
            ))}
            {draftYears.map((year, yearIndex) => {
              const yearPrefix = `years[${yearIndex}]`;
              const yearIssues = [
                ...issuesForPath(fieldIssues, yearPrefix),
                ...issuesForPath(fieldIssues, `${yearPrefix}.endDate`),
                ...issuesForPath(fieldIssues, `${yearPrefix}.usualWeekdays`),
              ];
              return (
                <fieldset key={year.clientKey} className="calendar-year-block">
                  <legend>School year {yearIndex + 1}</legend>
                  {yearIssues.map((message) => (
                    <p key={message} role="alert" className="form-error">
                      {message}
                    </p>
                  ))}
                  <label>
                    Start date
                    <input
                      type="date"
                      value={year.startDate}
                      disabled={busy}
                      onChange={(event) =>
                        updateYear(year.clientKey, { startDate: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    End date
                    <input
                      type="date"
                      value={year.endDate}
                      disabled={busy}
                      onChange={(event) =>
                        updateYear(year.clientKey, { endDate: event.target.value })
                      }
                    />
                  </label>
                  <fieldset disabled={busy}>
                    <legend>Usual school weekdays</legend>
                    <div className="weekday-row">
                      {WEEKDAYS.map((day) => (
                        <label key={day.value}>
                          <input
                            type="checkbox"
                            checked={year.usualWeekdays.includes(day.value)}
                            onChange={(event) => {
                              const usualWeekdays = event.target.checked
                                ? [...year.usualWeekdays, day.value]
                                : year.usualWeekdays.filter((value) => value !== day.value);
                              updateYear(year.clientKey, { usualWeekdays });
                            }}
                          />
                          {day.label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div className="calendar-exceptions">
                    <h3>No-school exceptions</h3>
                    {year.exceptions.length === 0 ? (
                      <p className="meta">No exceptions for this year.</p>
                    ) : null}
                    {year.exceptions.map((exception, exceptionIndex) => {
                      const exPath = `${yearPrefix}.exceptions[${exceptionIndex}]`;
                      const exIssues = [
                        ...issuesForPath(fieldIssues, exPath),
                        ...issuesForPath(fieldIssues, `${exPath}.name`),
                        ...issuesForPath(fieldIssues, `${exPath}.endDate`),
                      ];
                      return (
                        <div key={`${year.clientKey}-ex-${exceptionIndex}`} className="step-editor">
                          {exIssues.map((message) => (
                            <p key={message} role="alert" className="form-error">
                              {message}
                            </p>
                          ))}
                          <label>
                            Name
                            <input
                              value={exception.name}
                              disabled={busy}
                              onChange={(event) =>
                                updateException(year.clientKey, exceptionIndex, {
                                  name: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            Start date
                            <input
                              type="date"
                              value={exception.startDate}
                              disabled={busy}
                              onChange={(event) =>
                                updateException(year.clientKey, exceptionIndex, {
                                  startDate: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            End date
                            <input
                              type="date"
                              value={exception.endDate}
                              disabled={busy}
                              onChange={(event) =>
                                updateException(year.clientKey, exceptionIndex, {
                                  endDate: event.target.value,
                                })
                              }
                            />
                          </label>
                          <button
                            type="button"
                            className="text-button"
                            disabled={busy}
                            onClick={() => removeException(year.clientKey, exceptionIndex)}
                          >
                            Remove exception
                          </button>
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => addException(year.clientKey)}
                    >
                      Add exception
                    </button>
                  </div>
                  {draftYears.length > 1 ? (
                    <button
                      type="button"
                      className="text-button danger-text"
                      disabled={busy}
                      onClick={() => removeYear(year.clientKey)}
                    >
                      Remove school year
                    </button>
                  ) : null}
                </fieldset>
              );
            })}
            <button type="button" disabled={busy} onClick={addYear}>
              Add school year
            </button>
            <div className="button-row">
              <button type="submit" className="primary" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
              <button type="button" disabled={busy} onClick={cancelEdit}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </section>
  );
}
