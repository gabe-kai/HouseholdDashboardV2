import { useEffect, useState, type FormEvent } from "react";
import {
  fetchSetupProgress,
  setupCompleteHousehold,
  setupCreateAccount,
  setupExchangeInvitation,
  type MetaInfo,
  type SessionInfo,
} from "./api";
import { newClientId } from "./id";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readInviteFromHash(): string | null {
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const token = params.get("invite");
  return token && token.trim().length > 0 ? token.trim() : null;
}

function clearInviteHash(): void {
  const path = window.location.pathname + window.location.search;
  window.history.replaceState(null, "", path);
}

export type WelcomeSetupProps = {
  meta: MetaInfo | null;
  session: SessionInfo | null;
  onSession: (session: SessionInfo) => void;
  onSetupFinished: (householdName: string) => void;
  /** When signed in but setup incomplete, resume household step only. */
  initialStep?: "account" | "household" | "done";
};

export function ProtectedWelcomeGate(props: {
  meta: MetaInfo | null;
  exchangeError: string | null;
  exchanging: boolean;
}) {
  return (
    <main className="app-shell welcome-shell">
      <section className="panel welcome-panel" data-testid="protected-welcome">
        <p className="eyebrow">Household Dashboard</p>
        <h1 className="page-heading">Set up your household</h1>
        {props.exchanging ? (
          <p className="meta" role="status">
            Preparing your setup invitation…
          </p>
        ) : (
          <p className="meta">
            {props.meta?.ownerConfigured
              ? "Open the setup link from your installation owner. The link uses a private fragment and is exchanged immediately in this browser."
              : "Setup is not available until the deployment owner configures installation ownership."}
          </p>
        )}
        {props.exchangeError ? (
          <p role="alert" className="form-error">
            {props.exchangeError}
          </p>
        ) : null}
        <p className="meta">
          Already have an account?{" "}
          <a href="/today">Sign in</a> after setup is complete.
        </p>
      </section>
    </main>
  );
}

export function WelcomeSetupFlow(props: WelcomeSetupProps) {
  const suggestedTz =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : props.session?.householdTimezone ?? "UTC";

  const [step, setStep] = useState<"account" | "household" | "done">(
    props.initialStep ?? "account",
  );
  const [displayName, setDisplayName] = useState("");
  const [loginName, setLoginName] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [householdName, setHouseholdName] = useState("");
  const [timezone, setTimezone] = useState(suggestedTz);
  const [timezoneConfirmed, setTimezoneConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedHouseholdName, setSavedHouseholdName] = useState("");

  useEffect(() => {
    if (props.initialStep) setStep(props.initialStep);
  }, [props.initialStep]);

  async function submitAccount(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await setupCreateAccount({
        displayName: displayName.trim(),
        loginName: loginName.trim(),
        passphrase,
        mutationId: newClientId(),
      });
      props.onSession(session);
      setPassphrase("");
      setStep("household");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function submitHousehold(event: FormEvent) {
    event.preventDefault();
    if (!timezoneConfirmed) {
      setError("Confirm the household timezone before continuing.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await setupCompleteHousehold({
        name: householdName.trim(),
        timezone: timezone.trim(),
      });
      setSavedHouseholdName(result.name);
      setStep("done");
      props.onSetupFinished(result.name);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell welcome-shell">
      <section className="panel welcome-panel" data-testid="welcome-setup">
        <p className="eyebrow">Required setup</p>
        <h1 className="page-heading">
          {step === "account"
            ? "Your account"
            : step === "household"
              ? "Your household"
              : "Setup complete"}
        </h1>
        {step === "account" ? (
          <form className="form-grid" onSubmit={submitAccount} data-testid="setup-account-form">
            <label>
              Your name
              <input
                autoComplete="name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                required
                data-testid="setup-display-name"
              />
            </label>
            <label>
              Username
              <input
                autoComplete="username"
                value={loginName}
                onChange={(event) => setLoginName(event.target.value)}
                required
                data-testid="setup-login-name"
              />
            </label>
            <label>
              Password
              <div className="password-field">
                <input
                  type={showPassphrase ? "text" : "password"}
                  autoComplete="new-password"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  required
                  minLength={15}
                  data-testid="setup-passphrase"
                />
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setShowPassphrase((v) => !v)}
                >
                  {showPassphrase ? "Hide" : "Show"}
                </button>
              </div>
            </label>
            <p className="meta">Use at least 15 characters. Paste and password managers are supported.</p>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Saving…" : "Continue"}
            </button>
          </form>
        ) : null}

        {step === "household" ? (
          <form className="form-grid" onSubmit={submitHousehold} data-testid="setup-household-form">
            <label>
              Household name
              <input
                value={householdName}
                onChange={(event) => setHouseholdName(event.target.value)}
                required
                data-testid="setup-household-name"
              />
            </label>
            <label>
              Timezone
              <input
                value={timezone}
                onChange={(event) => {
                  setTimezone(event.target.value);
                  setTimezoneConfirmed(false);
                }}
                required
                data-testid="setup-timezone"
              />
            </label>
            <p className="meta">
              Suggested from this device: <strong>{suggestedTz}</strong>. Confirm or edit before
              saving.
            </p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={timezoneConfirmed}
                onChange={(event) => setTimezoneConfirmed(event.target.checked)}
                data-testid="setup-timezone-confirm"
              />
              This timezone is correct for our household
            </label>
            <div className="button-row">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setStep("account")}
              >
                Back
              </button>
              <button type="submit" className="primary" disabled={busy || !timezoneConfirmed}>
                {busy ? "Saving…" : "Save household"}
              </button>
            </div>
          </form>
        ) : null}

        {step === "done" ? (
          <div data-testid="setup-complete">
            <p className="page-subcopy">
              {savedHouseholdName || householdName} is ready. Choose where to go next.
            </p>
            <div className="button-row">
              <a className="primary button-link" href="/today" data-testid="setup-go-today">
                Today
              </a>
              <a className="secondary button-link" href="/household" data-testid="setup-go-household">
                Household
              </a>
            </div>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="form-error">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}

/** Exchange `#invite=` fragment once on load. */
export async function exchangeInviteFromLocation(): Promise<{
  ok: boolean;
  /** True only when a fragment token was present and exchanged. */
  exchanged: boolean;
  error?: string;
}> {
  const token = readInviteFromHash();
  if (!token) return { ok: true, exchanged: false };
  try {
    await setupExchangeInvitation(token);
    clearInviteHash();
    return { ok: true, exchanged: true };
  } catch (caught) {
    clearInviteHash();
    return { ok: false, exchanged: false, error: errorMessage(caught) };
  }
}

export async function resolveSetupStep(
  session: SessionInfo | null,
): Promise<"account" | "household" | "done" | null> {
  if (!session) return "account";
  try {
    const progress = await fetchSetupProgress();
    if (!progress.setupRequired || progress.householdCompletedAt) return "done";
    if (progress.accountCompletedAt) return "household";
    return "account";
  } catch {
    return null;
  }
}

export function isWelcomePath(): boolean {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return path === "/welcome";
}
