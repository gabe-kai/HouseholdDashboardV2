import { useMemo, useState } from "react";

function listTimeZones(): string[] {
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.("timeZone");
    if (supported && supported.length > 0) return [...supported].sort();
  } catch {
    /* fall through */
  }
  return [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Phoenix",
    "America/Toronto",
    "America/Vancouver",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Asia/Tokyo",
    "Australia/Sydney",
    "UTC",
  ].sort();
}

function friendlyLabel(zone: string, now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "long",
    }).formatToParts(now);
    const name = parts.find((p) => p.type === "timeZoneName")?.value;
    return name ? `${zone.replace(/_/g, " ")} — ${name}` : zone.replace(/_/g, " ");
  } catch {
    return zone.replace(/_/g, " ");
  }
}

function sampleLocalTime(zone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(now);
  } catch {
    return "Invalid timezone";
  }
}

export function isValidIanaTimezoneClient(zone: string): boolean {
  if (!zone.trim()) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: zone.trim() });
    return true;
  } catch {
    return false;
  }
}

export type TimezonePickerProps = {
  value: string;
  suggested: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  id?: string;
  "data-testid"?: string;
};

export function TimezonePicker(props: TimezonePickerProps) {
  const zones = useMemo(() => listTimeZones(), []);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      const preferred = [props.suggested, props.value].filter(Boolean);
      const rest = zones.filter((z) => !preferred.includes(z));
      return [...new Set([...preferred, ...rest])].slice(0, 40);
    }
    return zones
      .filter((z) => {
        const label = friendlyLabel(z).toLowerCase();
        return z.toLowerCase().includes(q) || label.includes(q);
      })
      .slice(0, 40);
  }, [query, zones, props.suggested, props.value]);

  const valid = isValidIanaTimezoneClient(props.value);
  const sample = valid ? sampleLocalTime(props.value) : null;

  return (
    <div className="timezone-picker" data-testid={props["data-testid"] ?? "timezone-picker"}>
      <label>
        Search timezones
        <input
          type="search"
          value={query}
          disabled={props.disabled}
          placeholder="City or region"
          onChange={(event) => setQuery(event.target.value)}
          data-testid="setup-timezone-search"
          autoComplete="off"
        />
      </label>
      <label>
        Home timezone
        <select
          id={props.id}
          value={valid ? props.value : ""}
          disabled={props.disabled}
          required
          data-testid="setup-timezone"
          onChange={(event) => {
            props.onChange(event.target.value);
            setQuery("");
          }}
        >
          {!valid ? <option value="">Choose a timezone…</option> : null}
          {filtered.map((zone) => (
            <option key={zone} value={zone}>
              {friendlyLabel(zone)}
            </option>
          ))}
          {valid && !filtered.includes(props.value) ? (
            <option value={props.value}>{friendlyLabel(props.value)}</option>
          ) : null}
        </select>
      </label>
      <p className="meta" data-testid="setup-timezone-suggestion">
        Suggested from this device: <strong>{props.suggested}</strong>
        {props.suggested !== props.value ? " — not applied until you choose it." : null}
      </p>
      {sample ? (
        <p className="meta timezone-sample" data-testid="setup-timezone-sample">
          Sample home time now: <strong>{sample}</strong>
        </p>
      ) : (
        <p className="meta form-warning" role="status">
          Choose a valid IANA timezone.
        </p>
      )}
    </div>
  );
}
