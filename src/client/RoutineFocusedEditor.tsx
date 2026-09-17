import type { Daypart, GroupPublic, MemberPublic } from "../shared/schemas";
import { OrderedList } from "./OrderedList";

const DAYPART_LABELS: Record<Daypart, string> = {
  morning: "Morning",
  after_school: "After school",
  evening: "Evening",
  bedtime: "Bedtime",
  anytime: "Anytime",
};

export type EditorDraftStep = {
  text: string;
  obligation: "required" | "as_needed" | "optional";
  logicalItemId?: string;
};

export type EditorDraft = {
  title: string;
  daypart: Daypart;
  weekdays: number[];
  assigneeMemberIds: string[];
  assigneeGroupIds: string[];
  steps: EditorDraftStep[];
  startingDate: string;
};

export type EditorFocus =
  | null
  | "name"
  | "when"
  | "steps"
  | { kind: "step"; index: number; localId: string };

const DAYPART_OPTIONS: Daypart[] = [
  "morning",
  "after_school",
  "evening",
  "bedtime",
  "anytime",
];

const WEEKDAYS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];
const WEEKDAY_SET = [1, 2, 3, 4, 5];
const WEEKEND_SET = [6, 7];

function weekdaysLabel(weekdays: number[]): string {
  const sorted = [...weekdays].sort((a, b) => a - b);
  if (sorted.length === 7 && EVERY_DAY.every((day) => sorted.includes(day))) {
    return "Every day";
  }
  if (
    sorted.length === 5 &&
    WEEKDAY_SET.every((day) => sorted.includes(day)) &&
    sorted.every((day) => WEEKDAY_SET.includes(day))
  ) {
    return "Weekdays";
  }
  if (
    sorted.length === 2 &&
    WEEKEND_SET.every((day) => sorted.includes(day)) &&
    sorted.every((day) => WEEKEND_SET.includes(day))
  ) {
    return "Weekends";
  }
  return sorted
    .map((day) => WEEKDAYS.find((item) => item.value === day)?.label ?? String(day))
    .join(", ");
}

function whoLine(
  draft: EditorDraft,
  people: MemberPublic[],
  groups: GroupPublic[],
): string {
  const parts: string[] = [];
  for (const groupId of draft.assigneeGroupIds) {
    parts.push(groups.find((group) => group.id === groupId)?.name ?? "Group");
  }
  for (const membershipId of draft.assigneeMemberIds) {
    parts.push(people.find((person) => person.id === membershipId)?.displayName ?? "Person");
  }
  return parts.length ? parts.join(", ") : "Nobody selected";
}

function obligationLabel(obligation: EditorDraftStep["obligation"]): string {
  if (obligation === "as_needed") return "As needed";
  if (obligation === "required") return "Required";
  return "Optional";
}

export function RoutineFocusedSummary(props: {
  draft: EditorDraft;
  scheduleMode: boolean;
  people: MemberPublic[];
  groups: GroupPublic[];
  stepLocalIds: string[];
  onOpenName: () => void;
  onOpenWhen: () => void;
  onOpenWho: () => void;
  onOpenSteps: () => void;
  onStartingDateChange?: (value: string) => void;
  startingMin?: string;
}) {
  return (
    <ul className="section-summary">
      <li>
        <button type="button" className="section-summary-row" onClick={props.onOpenName}>
          <strong>Name</strong>
          <span>{props.draft.title.trim() || "Add a name"}</span>
        </button>
      </li>
      {props.scheduleMode ? (
        <li>
          <label className="section-summary-row">
            <strong>Starting</strong>
            <input
              id="routine-starting-date"
              type="date"
              value={props.draft.startingDate}
              min={props.startingMin}
              onChange={(event) => props.onStartingDateChange?.(event.target.value)}
            />
          </label>
        </li>
      ) : null}
      <li>
        <button type="button" className="section-summary-row" onClick={props.onOpenWhen}>
          <strong>When</strong>
          <span>
            {weekdaysLabel(props.draft.weekdays)} · {DAYPART_LABELS[props.draft.daypart]}
          </span>
        </button>
      </li>
      <li>
        <button type="button" className="section-summary-row" onClick={props.onOpenWho}>
          <strong>Who</strong>
          <span>{whoLine(props.draft, props.people, props.groups)}</span>
        </button>
      </li>
      <li>
        <button type="button" className="section-summary-row" onClick={props.onOpenSteps}>
          <strong>Steps</strong>
          <span>
            {props.draft.steps.length} {props.draft.steps.length === 1 ? "step" : "steps"}
          </span>
        </button>
      </li>
    </ul>
  );
}

export function NameSectionEditor(props: {
  value: string;
  onChange: (value: string) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="form-grid">
      <label>
        Name
        <input
          autoFocus
          value={props.value}
          placeholder="Routine name"
          onChange={(event) => props.onChange(event.target.value)}
        />
      </label>
      <div className="button-row">
        <button type="button" className="primary" onClick={props.onDone}>
          Done
        </button>
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function WhenSectionEditor(props: {
  daypart: Daypart;
  weekdays: number[];
  onChange: (next: { daypart: Daypart; weekdays: number[] }) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  function setPreset(preset: "every" | "weekdays" | "weekends") {
    props.onChange({
      daypart: props.daypart,
      weekdays:
        preset === "every"
          ? [...EVERY_DAY]
          : preset === "weekdays"
            ? [...WEEKDAY_SET]
            : [...WEEKEND_SET],
    });
  }
  return (
    <div className="form-grid">
      <label>
        Daypart
        <select
          value={props.daypart}
          onChange={(event) =>
            props.onChange({
              daypart: event.target.value as Daypart,
              weekdays: props.weekdays,
            })
          }
        >
          {DAYPART_OPTIONS.map((daypart) => (
            <option key={daypart} value={daypart}>
              {DAYPART_LABELS[daypart]}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>When</legend>
        <div className="button-row">
          <button type="button" onClick={() => setPreset("every")}>
            Every day
          </button>
          <button type="button" onClick={() => setPreset("weekdays")}>
            Weekdays
          </button>
          <button type="button" onClick={() => setPreset("weekends")}>
            Weekends
          </button>
        </div>
        <div className="weekday-row">
          {WEEKDAYS.map((day) => (
            <label key={day.value}>
              <input
                type="checkbox"
                checked={props.weekdays.includes(day.value)}
                onChange={(event) =>
                  props.onChange({
                    daypart: props.daypart,
                    weekdays: event.target.checked
                      ? [...props.weekdays, day.value]
                      : props.weekdays.filter((value) => value !== day.value),
                  })
                }
              />
              {day.label}
            </label>
          ))}
        </div>
        <p className="meta">{weekdaysLabel(props.weekdays)}</p>
      </fieldset>
      <div className="button-row">
        <button type="button" className="primary" onClick={props.onDone}>
          Done
        </button>
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function StepsSectionEditor(props: {
  steps: EditorDraftStep[];
  stepLocalIds: string[];
  onChange: (steps: EditorDraftStep[], localIds: string[]) => void;
  onEditStep: (index: number, localId: string) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const items = props.steps.map((step, index) => ({
    id: props.stepLocalIds[index] ?? `step-${index}`,
    label: step.text.trim() || `Step ${index + 1}`,
    step,
    index,
  }));

  return (
    <div className="form-grid">
      <OrderedList
        listLabel="Routine steps"
        items={items}
        onReorder={(next) => {
          props.onChange(
            next.map((item) => item.step),
            next.map((item) => item.id),
          );
        }}
        renderRow={(item) => (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              const index = props.stepLocalIds.indexOf(item.id);
              props.onEditStep(index >= 0 ? index : item.index, item.id);
            }}
          >
            <strong>{item.step.text.trim() || "Untitled step"}</strong>
            <span className="meta"> {obligationLabel(item.step.obligation)}</span>
          </button>
        )}
      />
      <button
        type="button"
        onClick={() => {
          const localId = `local-${Date.now()}`;
          props.onChange(
            [...props.steps, { text: "New step", obligation: "required" }],
            [...props.stepLocalIds, localId],
          );
        }}
      >
        Add step
      </button>
      <div className="button-row">
        <button type="button" className="primary" onClick={props.onDone}>
          Done
        </button>
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function StepRowEditor(props: {
  step: EditorDraftStep;
  canRemove: boolean;
  onChange: (step: EditorDraftStep) => void;
  onRemove: () => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="form-grid">
      <label>
        Step text
        <input
          autoFocus
          value={props.step.text}
          onChange={(event) => props.onChange({ ...props.step, text: event.target.value })}
        />
      </label>
      <label>
        Obligation
        <select
          value={props.step.obligation}
          onChange={(event) =>
            props.onChange({
              ...props.step,
              obligation: event.target.value as EditorDraftStep["obligation"],
            })
          }
        >
          <option value="required">Required</option>
          <option value="as_needed">As needed</option>
          <option value="optional">Optional</option>
        </select>
      </label>
      <div className="button-row">
        <button type="button" className="primary" onClick={props.onDone}>
          Done
        </button>
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="text-button"
          disabled={!props.canRemove}
          onClick={props.onRemove}
        >
          Remove
        </button>
      </div>
    </div>
  );
}
