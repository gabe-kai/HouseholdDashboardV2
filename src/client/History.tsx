import { useEffect, useState, type FormEvent } from "react";
import type {
  HistoryOccurrenceDetail,
  HistoryOccurrenceSummary,
  MemberPublic,
  StepStatus,
} from "../shared/schemas";
import {
  fetchHistory,
  fetchHistoryOccurrence,
  fetchRoutines,
  type Routine,
} from "./api";
import { DAYPART_LABELS } from "./Routines";
import type { HistoryFilters } from "./nav";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function addDays(date: string, days: number): string {
  const instant = new Date(`${date}T12:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

function obligationLabel(obligation: string): string {
  if (obligation === "as_needed") return "As needed";
  if (obligation === "required") return "Required";
  if (obligation === "optional") return "Optional";
  return obligation;
}

function statusLabel(status: StepStatus): string {
  if (status === "not_needed") return "Not needed";
  if (status === "completed") return "Completed";
  return "Open";
}

function formatInstant(value: string | null | undefined): string {
  if (!value) return "Unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function progressLabel(counts: HistoryOccurrenceSummary["counts"]): string {
  return `${counts.completed} completed · ${counts.notNeeded} not needed · ${counts.open} open`;
}

function groupByPersonThenDate(
  occurrences: HistoryOccurrenceSummary[],
  peopleOrder: Map<string, number>,
): Array<{
  date: string;
  people: Array<{ memberId: string; memberName: string; rows: HistoryOccurrenceSummary[] }>;
}> {
  const byDate = new Map<string, HistoryOccurrenceSummary[]>();
  for (const occurrence of occurrences) {
    const list = byDate.get(occurrence.householdDate) ?? [];
    list.push(occurrence);
    byDate.set(occurrence.householdDate, list);
  }
  const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));
  return dates.map((date) => {
    const rows = byDate.get(date) ?? [];
    const byPerson = new Map<string, HistoryOccurrenceSummary[]>();
    const names = new Map<string, string>();
    for (const row of rows) {
      const list = byPerson.get(row.accountableMemberId) ?? [];
      list.push(row);
      byPerson.set(row.accountableMemberId, list);
      names.set(row.accountableMemberId, row.accountableMemberName);
    }
    const people = [...byPerson.entries()]
      .sort((a, b) => {
        const orderA = peopleOrder.get(a[0]) ?? Number.MAX_SAFE_INTEGER;
        const orderB = peopleOrder.get(b[0]) ?? Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) return orderA - orderB;
        return (names.get(a[0]) ?? "").localeCompare(names.get(b[0]) ?? "", undefined, {
          sensitivity: "base",
        });
      })
      .map(([memberId, personRows]) => ({
        memberId,
        memberName: names.get(memberId) ?? "Household member",
        rows: personRows,
      }));
    return { date, people };
  });
}

function filtersEqual(a?: HistoryFilters, b?: HistoryFilters): boolean {
  return (
    (a?.date ?? "") === (b?.date ?? "") &&
    (a?.from ?? "") === (b?.from ?? "") &&
    (a?.to ?? "") === (b?.to ?? "") &&
    (a?.personId ?? "") === (b?.personId ?? "") &&
    (a?.routineId ?? "") === (b?.routineId ?? "") &&
    (a?.status ?? "") === (b?.status ?? "") &&
    (a?.kind ?? "") === (b?.kind ?? "")
  );
}

export function HistoryView(props: {
  householdDate: string;
  memberships: MemberPublic[];
  filters?: HistoryFilters;
  occurrenceId?: string;
  refreshToken?: number;
  onFiltersChange: (filters: HistoryFilters) => void;
  onOpenOccurrence: (occurrenceId: string, filters: HistoryFilters) => void;
  onBack: () => void;
  onBackToSummary: (filters: HistoryFilters) => void;
  onActivityGeneration?: (generation: number) => void;
  onOpenPreview?: () => void;
}) {
  if (props.occurrenceId) {
    return (
      <HistoryDetailView
        occurrenceId={props.occurrenceId}
        filters={props.filters}
        refreshToken={props.refreshToken}
        onBack={() => props.onBackToSummary(props.filters ?? {})}
        onActivityGeneration={props.onActivityGeneration}
      />
    );
  }
  return (
    <HistorySummaryView
      householdDate={props.householdDate}
      memberships={props.memberships}
      filters={props.filters}
      refreshToken={props.refreshToken}
      onFiltersChange={props.onFiltersChange}
      onOpenOccurrence={props.onOpenOccurrence}
      onBack={props.onBack}
      onActivityGeneration={props.onActivityGeneration}
      onOpenPreview={props.onOpenPreview}
    />
  );
}

function HistorySummaryView(props: {
  householdDate: string;
  memberships: MemberPublic[];
  filters?: HistoryFilters;
  refreshToken?: number;
  onFiltersChange: (filters: HistoryFilters) => void;
  onOpenOccurrence: (occurrenceId: string, filters: HistoryFilters) => void;
  onBack: () => void;
  onActivityGeneration?: (generation: number) => void;
  onOpenPreview?: () => void;
}) {
  const activeDate = props.filters?.date || props.householdDate;
  const rangeMode = Boolean(props.filters?.from || props.filters?.to);
  const [showRange, setShowRange] = useState(rangeMode);
  const [showFilters, setShowFilters] = useState(
    Boolean(
      props.filters?.personId ||
        props.filters?.routineId ||
        props.filters?.status ||
        props.filters?.kind,
    ),
  );
  const [occurrences, setOccurrences] = useState<HistoryOccurrenceSummary[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [futureMessage, setFutureMessage] = useState<string | null>(null);

  const peopleOrder = new Map(
    [...props.memberships]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
      .map((person, index) => [person.id, person.sortOrder ?? index]),
  );

  useEffect(() => {
    void fetchRoutines(true)
      .then((result) => setRoutines(result.routines))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void load();
  }, [props.filters, props.householdDate, props.refreshToken]);

  async function load() {
    const filters = props.filters ?? {};
    const requestDate = filters.date || (!filters.from && !filters.to ? activeDate : undefined);
    const householdToday = props.householdDate;
    if (requestDate && requestDate > householdToday) {
      setOccurrences([]);
      setFutureMessage(
        "Future dates are outside History. Use routine Preview to see upcoming expectations.",
      );
      setError(null);
      return;
    }
    if (filters.to && filters.to > householdToday) {
      setOccurrences([]);
      setFutureMessage(
        "Future dates are outside History. Use routine Preview to see upcoming expectations.",
      );
      setError(null);
      return;
    }
    setFutureMessage(null);
    setLoading(true);
    setError(null);
    try {
      const result = await fetchHistory({
        date: requestDate,
        from: filters.from,
        to: filters.to,
        personId: filters.personId,
        routineId: filters.routineId,
        status: filters.status,
        kind: filters.kind,
      });
      setOccurrences(result.occurrences);
      props.onActivityGeneration?.(result.activityGeneration);
    } catch (caught) {
      setError(errorMessage(caught));
      setOccurrences([]);
    } finally {
      setLoading(false);
    }
  }

  function commitFilters(next: HistoryFilters) {
    const cleaned: HistoryFilters = {};
    if (next.date) cleaned.date = next.date;
    if (next.from) cleaned.from = next.from;
    if (next.to) cleaned.to = next.to;
    if (next.personId) cleaned.personId = next.personId;
    if (next.routineId) cleaned.routineId = next.routineId;
    if (next.status) cleaned.status = next.status;
    if (next.kind) cleaned.kind = next.kind;
    if (!filtersEqual(cleaned, props.filters)) {
      props.onFiltersChange(cleaned);
    }
  }

  function goDay(delta: number) {
    const nextDate = addDays(activeDate, delta);
    commitFilters({
      ...props.filters,
      date: nextDate,
      from: undefined,
      to: undefined,
    });
    setShowRange(false);
  }

  function onDateInput(value: string) {
    commitFilters({
      ...props.filters,
      date: value,
      from: undefined,
      to: undefined,
    });
  }

  function onRangeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const from = String(form.get("from") ?? "");
    const to = String(form.get("to") ?? "");
    commitFilters({
      personId: props.filters?.personId,
      routineId: props.filters?.routineId,
      status: props.filters?.status,
      kind: props.filters?.kind,
      from: from || undefined,
      to: to || undefined,
      date: undefined,
    });
  }

  const grouped = groupByPersonThenDate(occurrences, peopleOrder);
  const sortedPeople = [...props.memberships].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
  );

  return (
    <section className="panel history-view">
      <button type="button" className="back-link" onClick={props.onBack}>
        Back to Household
      </button>
      <h1 className="page-heading">History</h1>
      <p className="page-subcopy">Recorded household work for this household.</p>

      <div className="history-date-nav" role="group" aria-label="Date">
        <button type="button" className="secondary" onClick={() => goDay(-1)}>
          Previous day
        </button>
        <label className="field-label history-date-field">
          Day
          <input
            type="date"
            value={activeDate}
            max={props.householdDate}
            onChange={(event) => onDateInput(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="secondary"
          disabled={activeDate >= props.householdDate}
          onClick={() => goDay(1)}
        >
          Next day
        </button>
      </div>

      <button
        type="button"
        className="text-button"
        onClick={() => setShowRange((open) => !open)}
        aria-expanded={showRange}
      >
        {showRange ? "Hide date range" : "Date range…"}
      </button>
      {showRange ? (
        <form className="form-grid history-range" onSubmit={onRangeSubmit}>
          <label>
            From
            <input
              name="from"
              type="date"
              defaultValue={props.filters?.from ?? activeDate}
              max={props.householdDate}
            />
          </label>
          <label>
            To
            <input
              name="to"
              type="date"
              defaultValue={props.filters?.to ?? activeDate}
              max={props.householdDate}
            />
          </label>
          <button type="submit" className="secondary">
            Apply range
          </button>
        </form>
      ) : null}

      <button
        type="button"
        className="text-button"
        onClick={() => setShowFilters((open) => !open)}
        aria-expanded={showFilters}
      >
        {showFilters ? "Hide filters" : "Filters…"}
      </button>
      {showFilters ? (
        <div className="form-grid history-filters">
          <label>
            Person
            <select
              value={props.filters?.personId ?? ""}
              onChange={(event) =>
                commitFilters({
                  ...props.filters,
                  date: props.filters?.from || props.filters?.to ? undefined : activeDate,
                  personId: event.target.value || undefined,
                })
              }
            >
              <option value="">Everyone</option>
              {sortedPeople.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Work
            <select
              value={props.filters?.kind ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                commitFilters({
                  ...props.filters,
                  date: props.filters?.from || props.filters?.to ? undefined : activeDate,
                  kind:
                    value === "routine" || value === "responsibility" ? value : undefined,
                });
              }}
            >
              <option value="">All work</option>
              <option value="routine">Routines</option>
              <option value="responsibility">Responsibilities</option>
            </select>
          </label>
          <label>
            Routine
            <select
              value={props.filters?.routineId ?? ""}
              onChange={(event) =>
                commitFilters({
                  ...props.filters,
                  date: props.filters?.from || props.filters?.to ? undefined : activeDate,
                  routineId: event.target.value || undefined,
                })
              }
            >
              <option value="">All routines</option>
              {routines.map((routine) => {
                const title = routine.revisions.at(-1)?.title ?? "Routine";
                return (
                  <option key={routine.id} value={routine.id}>
                    {title}
                  </option>
                );
              })}
            </select>
          </label>
          <label>
            Status
            <select
              value={props.filters?.status ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                commitFilters({
                  ...props.filters,
                  date: props.filters?.from || props.filters?.to ? undefined : activeDate,
                  status:
                    value === "complete" || value === "incomplete" ? value : undefined,
                });
              }}
            >
              <option value="">All</option>
              <option value="complete">Complete</option>
              <option value="incomplete">Incomplete</option>
            </select>
          </label>
        </div>
      ) : null}

      {loading ? <p className="meta" role="status">Loading…</p> : null}
      {futureMessage ? (
        <div className="status-notice" role="status">
          <p>{futureMessage}</p>
          {props.onOpenPreview ? (
            <button type="button" className="secondary" onClick={props.onOpenPreview}>
              Open Preview from Today
            </button>
          ) : null}
        </div>
      ) : null}
      {!loading && !futureMessage && occurrences.length === 0 ? (
        <p className="meta" role="status">
          No recorded household work for this selection.
        </p>
      ) : null}

      {grouped.map((day) => (
        <section key={day.date} className="history-day">
          <h2 className="history-day-heading">{day.date}</h2>
          {day.people.map((person) => (
            <div key={`${day.date}-${person.memberId}`} className="history-person-block">
              <h3 className="history-person-heading">{person.memberName}</h3>
              <ul className="history-summary-list">
                {person.rows.map((occurrence) => (
                  <li key={occurrence.id}>
                    <button
                      type="button"
                      className="history-summary-row list-row"
                      onClick={() =>
                        props.onOpenOccurrence(occurrence.id, {
                          ...(props.filters ?? {}),
                          date:
                            props.filters?.from || props.filters?.to
                              ? props.filters?.date
                              : activeDate,
                        })
                      }
                    >
                      <span className="history-summary-title">{occurrence.title}</span>
                      <span className="meta">
                        {occurrence.kind === "responsibility" ? "Responsibility" : "Routine"} ·{" "}
                        {DAYPART_LABELS[occurrence.daypart] ?? occurrence.daypart} ·{" "}
                        {occurrence.completed ? "Complete" : "Incomplete"} ·{" "}
                        {progressLabel(occurrence.counts)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}

      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

function HistoryDetailView(props: {
  occurrenceId: string;
  filters?: HistoryFilters;
  refreshToken?: number;
  onBack: () => void;
  onActivityGeneration?: (generation: number) => void;
}) {
  const [detail, setDetail] = useState<HistoryOccurrenceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load();
  }, [props.occurrenceId, props.refreshToken]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchHistoryOccurrence(props.occurrenceId);
      setDetail(result.occurrence);
      props.onActivityGeneration?.(result.activityGeneration);
    } catch (caught) {
      setDetail(null);
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel history-view">
      <button type="button" className="back-link" onClick={props.onBack}>
        Back to History
      </button>
      {loading ? <p className="meta" role="status">Loading…</p> : null}
      {!loading && !detail ? (
        <div className="status-notice" role="status">
          <h1 className="page-heading">Occurrence unavailable</h1>
          <p>
            This routine or responsibility record is no longer available. It may have been cleared
            or is not visible for this account.
          </p>
          <button type="button" className="primary" onClick={props.onBack}>
            Return to History
          </button>
        </div>
      ) : null}
      {detail ? (
        <>
          <h1 className="page-heading">{detail.title}</h1>
          <p className="meta">
            {detail.householdDate} · {DAYPART_LABELS[detail.daypart] ?? detail.daypart} ·{" "}
            {detail.kind === "responsibility" ? "Responsibility" : "Routine"} ·{" "}
            {detail.accountableMemberName} ·{" "}
            {detail.completed ? "Complete" : "Incomplete"}
          </p>
          <ol className="step-list">
            {detail.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.text}</strong>
                  <div className="meta">
                    {statusLabel(step.status)}
                    {step.obligation ? ` · ${obligationLabel(step.obligation)}` : ""}
                    {step.source ? ` · ${step.source}` : ""}
                    {step.applicabilityReason ? ` · ${step.applicabilityReason}` : ""}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="text-button"
            aria-expanded={showEvidence}
            onClick={() => setShowEvidence((open) => !open)}
          >
            {showEvidence ? "Hide action evidence" : "Show action evidence"}
          </button>
          {showEvidence ? (
            detail.reports.length === 0 ? (
              <p className="meta">Action evidence unavailable for this occurrence.</p>
            ) : (
              <ul className="history-evidence-list">
                {detail.reports.map((report) => {
                  const performerName = report.performerMemberId
                    ? report.performerMemberId === report.actingMemberId
                      ? report.actingMemberName
                      : report.performerMemberId
                    : null;
                  return (
                  <li key={report.id}>
                    <strong>{report.actingMemberName ?? "Unknown actor"}</strong>
                    <div className="meta">
                      {statusLabel(report.resultingState)} · performed{" "}
                      {formatInstant(report.performedAt)} · recorded{" "}
                      {formatInstant(report.recordedAt)}
                      {performerName
                        ? ` · performer ${performerName}`
                        : report.performerMemberId === null
                          ? " · performer unknown"
                          : ""}
                    </div>
                  </li>
                  );
                })}
              </ul>
            )
          ) : null}
        </>
      ) : null}
      {error && detail ? <p role="alert">{error}</p> : null}
    </section>
  );
}
