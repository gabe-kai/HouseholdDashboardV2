import { useEffect, useState, type FormEvent } from "react";
import {
  cancelDisplayEnrollment,
  createDisplay,
  fetchDisplays,
  issueDisplayEnrollment,
  revokeDisplay,
  type DisplayListItem,
  type DisplayEnrollmentPayload,
} from "./api";
import { formatDisplayCodeGrouped } from "./display-api";
import { newClientId } from "./id";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatInstant(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function accessLabel(display: DisplayListItem): string {
  if (display.revokedAt) return "Revoked";
  if (display.hasActiveSession) return "Active access";
  if (display.hasOutstandingClaim) return "Setup code outstanding";
  return "Needs setup";
}

export function HouseholdDisplaysView(props: {
  onBack: () => void;
  onSuccessToast: (message: string) => void;
}) {
  const [displays, setDisplays] = useState<DisplayListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [issued, setIssued] = useState<DisplayEnrollmentPayload | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchDisplays();
      setDisplays(next);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    const label = newLabel.trim();
    if (!label || adding) return;
    setAdding(true);
    setError(null);
    try {
      const result = await createDisplay({
        mutationId: newClientId(),
        label,
      });
      setIssued(result.enrollment);
      setNewLabel("");
      props.onSuccessToast(`Created display “${result.display.label}”.`);
      await reload();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setAdding(false);
    }
  }

  async function onGenerateCode(display: DisplayListItem) {
    setBusyId(display.id);
    setError(null);
    try {
      const enrollment = await issueDisplayEnrollment(display.id, {
        mutationId: newClientId(),
        expectedConfigVersion: display.configVersion,
      });
      setIssued(enrollment);
      props.onSuccessToast(`New setup code for “${display.label}”.`);
      await reload();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function onCancelEnrollment(display: DisplayListItem) {
    setBusyId(display.id);
    setError(null);
    try {
      await cancelDisplayEnrollment(display.id, {
        mutationId: newClientId(),
        expectedConfigVersion: display.configVersion,
      });
      if (issued?.displayId === display.id) setIssued(null);
      props.onSuccessToast(`Cancelled setup code for “${display.label}”.`);
      await reload();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function onRevoke(display: DisplayListItem) {
    if (
      !window.confirm(
        `Revoke access for “${display.label}”? The wall will return to setup until a new code is claimed.`,
      )
    ) {
      return;
    }
    setBusyId(display.id);
    setError(null);
    try {
      await revokeDisplay(display.id, {
        mutationId: newClientId(),
        expectedConfigVersion: display.configVersion,
      });
      if (issued?.displayId === display.id) setIssued(null);
      props.onSuccessToast(`Revoked “${display.label}”.`);
      await reload();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function copyCode() {
    if (!issued) return;
    const grouped = formatDisplayCodeGrouped(issued.code);
    try {
      await navigator.clipboard.writeText(grouped);
      setCopyStatus("Copied");
      window.setTimeout(() => setCopyStatus(null), 2000);
    } catch {
      setCopyStatus("Copy failed — select the code manually");
    }
  }

  return (
    <section className="panel household-displays" data-testid="household-displays">
      <button type="button" className="back-link" onClick={props.onBack}>
        Back to Household
      </button>
      <h1 className="page-heading">Household displays</h1>
      <p className="page-subcopy">
        Enroll a dining-room or wall browser as a read-only family dashboard. Setup codes
        expire in ten minutes and are shown once.
      </p>

      {issued ? (
        <div className="display-code-panel" data-testid="display-code-panel" role="status">
          <h2>Setup code for {issued.label}</h2>
          <p className="display-code-value" data-testid="display-issued-code">
            {formatDisplayCodeGrouped(issued.code)}
          </p>
          <p className="meta">
            Expires {formatInstant(issued.expiresAt)}. On the wall browser, open{" "}
            <strong>/display</strong>, stay signed out of personal accounts, and enter this
            code.
          </p>
          <div className="display-code-actions">
            <button type="button" onClick={() => void copyCode()}>
              {copyStatus ?? "Copy"}
            </button>
            <button type="button" className="secondary" onClick={() => setIssued(null)}>
              Done
            </button>
          </div>
        </div>
      ) : null}

      <form className="add-display-form" onSubmit={(event) => void onAdd(event)}>
        <label>
          Display label
          <input
            value={newLabel}
            onChange={(event) => setNewLabel(event.target.value)}
            maxLength={80}
            placeholder="Dining room"
            disabled={adding}
            data-testid="display-label-input"
          />
        </label>
        <button type="submit" disabled={adding || !newLabel.trim()}>
          {adding ? "Creating…" : "Add display"}
        </button>
      </form>

      {loading ? (
        <p className="meta" role="status">
          Loading displays…
        </p>
      ) : null}
      {error ? (
        <p role="alert">{error}</p>
      ) : null}

      {!loading && displays.length === 0 ? (
        <p className="meta">No displays yet. Add one to get a setup code.</p>
      ) : (
        <ul className="people-list display-manager-list">
          {displays.map((display) => (
            <li key={display.id} className="list-row display-manager-row">
              <div>
                <strong data-testid={`display-row-label-${display.id}`}>
                  {display.label}
                </strong>
                <p className="meta">
                  {accessLabel(display)}
                  {display.hasOutstandingClaim && display.claimExpiresAt
                    ? ` · code until ${formatInstant(display.claimExpiresAt)}`
                    : ""}
                  {display.hasActiveSession && display.lastSeenAt
                    ? ` · last contact ${formatInstant(display.lastSeenAt)}`
                    : ""}
                  {display.hasActiveSession && display.absoluteExpiresAt
                    ? ` · access until ${formatInstant(display.absoluteExpiresAt)}`
                    : ""}
                </p>
              </div>
              <div className="display-manager-actions">
                {!display.revokedAt ? (
                  <>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busyId === display.id}
                      onClick={() => void onGenerateCode(display)}
                    >
                      {display.hasOutstandingClaim ? "Replace code" : "Generate new code"}
                    </button>
                    {display.hasOutstandingClaim ? (
                      <button
                        type="button"
                        className="secondary"
                        disabled={busyId === display.id}
                        onClick={() => void onCancelEnrollment(display)}
                      >
                        Cancel setup
                      </button>
                    ) : null}
                    {(display.hasActiveSession || display.hasOutstandingClaim) && (
                      <button
                        type="button"
                        className="danger"
                        disabled={busyId === display.id}
                        onClick={() => void onRevoke(display)}
                        data-testid={`display-revoke-${display.id}`}
                      >
                        Revoke access
                      </button>
                    )}
                  </>
                ) : (
                  <span className="meta">Revoked — add a new display to enroll again</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
