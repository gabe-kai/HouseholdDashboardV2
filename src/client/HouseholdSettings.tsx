import { useRef, useState, type FormEvent } from "react";
import {
  clearRoutineActivity,
  fetchLifecycleRecovery,
  householdReset,
  reauthenticatePassphrase,
} from "./api";
import { newClientId } from "./id";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function HouseholdSettingsView(props: {
  expectedGeneration: number;
  installationEpoch: number;
  householdTimezone: string;
  canClearActivity: boolean;
  canManageLifecycle: boolean;
  onBack: () => void;
  onCleared: (activityGeneration: number) => void;
  onResetComplete: () => void;
  onSuccessToast: (message: string) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetPassphrase, setResetPassphrase] = useState("");
  const [resetStep, setResetStep] = useState<"scope" | "confirm" | "password">("scope");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clearDialogRef = useRef<HTMLDialogElement>(null);
  const resetDialogRef = useRef<HTMLDialogElement>(null);

  function openClearConfirm() {
    setError(null);
    setConfirmOpen(true);
    queueMicrotask(() => clearDialogRef.current?.showModal());
  }

  function closeClearConfirm() {
    clearDialogRef.current?.close();
    setConfirmOpen(false);
  }

  function openResetDialog() {
    setError(null);
    setResetStep("scope");
    setResetConfirmText("");
    setResetPassphrase("");
    setResetOpen(true);
    queueMicrotask(() => resetDialogRef.current?.showModal());
  }

  function closeResetDialog() {
    resetDialogRef.current?.close();
    setResetOpen(false);
  }

  async function confirmClear() {
    if (busy || !props.canClearActivity) return;
    setBusy(true);
    setError(null);
    try {
      const result = await clearRoutineActivity({
        mutationId: newClientId(),
        expectedGeneration: props.expectedGeneration,
        acknowledgedScope: "routines_and_responsibilities",
      });
      closeClearConfirm();
      props.onCleared(result.activityGeneration);
      props.onSuccessToast("Activity history was cleared.");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function submitResetPassword(event: FormEvent) {
    event.preventDefault();
    if (busy || !props.canManageLifecycle) return;
    if (resetConfirmText.trim() !== "RESET") {
      setError('Type RESET exactly to continue.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await reauthenticatePassphrase(resetPassphrase);
      let result: Awaited<ReturnType<typeof householdReset>>;
      try {
        result = await householdReset({
          mutationId: newClientId(),
          confirmationText: "RESET",
          expectedEpoch: props.installationEpoch,
        });
      } catch (resetErr) {
        // Lost/interrupted response: continuation cookie can still recover the commit.
        const recovered = await fetchLifecycleRecovery().catch(() => null);
        if (!recovered || recovered.status !== "completed" || !recovered.result) {
          throw resetErr;
        }
        result = recovered.result;
      }
      try {
        sessionStorage.setItem("hd.lifecycle.lastResetOp", result.operationId);
      } catch {
        /* ignore quota / private mode */
      }
      closeResetDialog();
      props.onSuccessToast(
        result.cleanupFailures.length > 0
          ? "Household reset completed with cleanup items still pending."
          : "Household reset completed.",
      );
      props.onResetComplete();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
      setResetPassphrase("");
    }
  }

  return (
    <section className="panel household-settings">
      <button type="button" className="back-link" onClick={props.onBack}>
        Back to Household
      </button>
      <h1 className="page-heading">Settings</h1>

      <div className="settings-section">
        <h2>Household details</h2>
        <p className="meta">
          Timezone: {props.householdTimezone}. Name and timezone were set during setup; changing
          timezone after activity exists is not available in this release.
        </p>
      </div>

      {props.canClearActivity ? (
        <div className="settings-section settings-action">
          <h2>Data &amp; testing</h2>
          <h3>Clear activity history</h3>
          <p className="meta">
            Removes recorded routine and responsibility checklists and progress for this household
            so evaluation can restart. People, access, groups, plans, calendars, and personal tasks
            remain.
          </p>
          <button type="button" className="danger" onClick={openClearConfirm} disabled={busy}>
            Clear activity history…
          </button>
        </div>
      ) : null}

      {props.canManageLifecycle ? (
        <div className="settings-section settings-action" data-testid="reset-household-section">
          <h2>Reset household</h2>
          <p className="meta">
            Starts setup over with an empty household database. Saved operator backups on disk are
            kept; this action does not create a new backup.
          </p>
          <button type="button" className="danger" onClick={openResetDialog} disabled={busy}>
            Reset household…
          </button>
        </div>
      ) : null}

      {!props.canClearActivity && !props.canManageLifecycle ? (
        <p className="meta" role="status">
          No settings actions are available for this session.
        </p>
      ) : null}

      {error && !confirmOpen && !resetOpen ? (
        <p role="alert">{error}</p>
      ) : null}

      {confirmOpen ? (
        <dialog
          ref={clearDialogRef}
          className="confirm-dialog"
          onCancel={(event) => {
            event.preventDefault();
            if (!busy) closeClearConfirm();
          }}
          onClose={() => setConfirmOpen(false)}
        >
          <h2>Clear activity history?</h2>
          <p>
            This clears recorded routine and responsibility activity for the whole household,
            including today&apos;s progress and older unsynced checklist changes on other devices.
            People, access, groups, routines, responsibilities, personalization, calendars, and
            personal tasks remain. The app has no Undo.
          </p>
          <div className="confirm-dialog-actions">
            <button type="button" className="secondary" disabled={busy} onClick={closeClearConfirm}>
              Cancel
            </button>
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => void confirmClear()}
            >
              {busy ? "Clearing…" : "Clear history"}
            </button>
          </div>
          {error ? <p role="alert">{error}</p> : null}
        </dialog>
      ) : null}

      {resetOpen ? (
        <dialog
          ref={resetDialogRef}
          className="confirm-dialog reset-household-dialog"
          data-testid="reset-household-dialog"
          onCancel={(event) => {
            event.preventDefault();
            if (!busy) closeResetDialog();
          }}
          onClose={() => setResetOpen(false)}
        >
          {resetStep === "scope" ? (
            <>
              <h2>Reset household?</h2>
              <p>
                This replaces all household data with a fresh empty database (installation epoch{" "}
                {props.installationEpoch} → next). The following will be cleared:
              </p>
              <ul className="reset-scope-list">
                <li>Accounts, access links, and sign-in sessions</li>
                <li>People and groups</li>
                <li>Routines, responsibilities, plans, and school calendar</li>
                <li>Personal work and proposals</li>
                <li>Execution history and today&apos;s progress</li>
                <li>Wall displays and pending device actions</li>
              </ul>
              <p className="meta">
                Saved backups already on this server survive. No new backup will be created before
                reset.
              </p>
              <div className="confirm-dialog-actions">
                <button type="button" className="secondary" disabled={busy} onClick={closeResetDialog}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={() => setResetStep("confirm")}
                >
                  Continue
                </button>
              </div>
            </>
          ) : null}

          {resetStep === "confirm" ? (
            <>
              <h2>Type RESET to confirm</h2>
              <label>
                Confirmation
                <input
                  value={resetConfirmText}
                  onChange={(event) => setResetConfirmText(event.target.value)}
                  autoComplete="off"
                  data-testid="reset-confirm-text"
                />
              </label>
              <div className="confirm-dialog-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setResetStep("scope")}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={busy || resetConfirmText.trim() !== "RESET"}
                  onClick={() => setResetStep("password")}
                >
                  Continue
                </button>
              </div>
            </>
          ) : null}

          {resetStep === "password" ? (
            <form onSubmit={submitResetPassword}>
              <h2>Confirm your password</h2>
              <p className="meta">
                Enter your current passphrase to authorize reset. Your session ends when reset
                completes.
              </p>
              <label>
                Passphrase
                <input
                  type="password"
                  autoComplete="current-password"
                  value={resetPassphrase}
                  onChange={(event) => setResetPassphrase(event.target.value)}
                  required
                  data-testid="reset-passphrase"
                />
              </label>
              <div className="confirm-dialog-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setResetStep("confirm")}
                >
                  Back
                </button>
                <button type="submit" className="danger" disabled={busy} data-testid="reset-submit">
                  {busy ? "Resetting…" : "Reset and start setup"}
                </button>
              </div>
            </form>
          ) : null}

          {error ? <p role="alert">{error}</p> : null}
        </dialog>
      ) : null}
    </section>
  );
}
