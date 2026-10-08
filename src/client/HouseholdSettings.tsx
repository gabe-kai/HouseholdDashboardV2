import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  clearRoutineActivity,
  createHouseholdBackup,
  deleteHouseholdBackup,
  fetchLifecycleRecovery,
  householdReset,
  householdRestore,
  listHouseholdBackups,
  previewHouseholdBackup,
  reauthenticatePassphrase,
  type HouseholdBackupMeta,
  type HouseholdBackupPreview,
} from "./api";
import { newClientId } from "./id";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatBackupWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
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
  onRestoreComplete: () => void;
  onSuccessToast: (message: string) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetPassphrase, setResetPassphrase] = useState("");
  const [resetStep, setResetStep] = useState<"scope" | "confirm" | "password">("scope");
  const [saveBackupBeforeReset, setSaveBackupBeforeReset] = useState(false);
  const [resetBackupLabel, setResetBackupLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clearDialogRef = useRef<HTMLDialogElement>(null);
  const resetDialogRef = useRef<HTMLDialogElement>(null);

  const [backups, setBackups] = useState<HouseholdBackupMeta[]>([]);
  const [backupLabel, setBackupLabel] = useState("");
  const [backupPassphrase, setBackupPassphrase] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<HouseholdBackupMeta | null>(null);
  const [deletePassphrase, setDeletePassphrase] = useState("");
  const [restoreTarget, setRestoreTarget] = useState<HouseholdBackupPreview | null>(null);
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [saveBackupBeforeRestore, setSaveBackupBeforeRestore] = useState(false);
  const [restoreBackupLabel, setRestoreBackupLabel] = useState("");

  async function refreshBackups() {
    if (!props.canManageLifecycle) return;
    const result = await listHouseholdBackups();
    setBackups(result.backups);
  }

  useEffect(() => {
    if (!props.canManageLifecycle) return;
    void refreshBackups().catch((caught) => setError(errorMessage(caught)));
  }, [props.canManageLifecycle]);

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
    setSaveBackupBeforeReset(false);
    setResetBackupLabel("");
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

  async function submitCreateBackup(event: FormEvent) {
    event.preventDefault();
    if (busy || !props.canManageLifecycle) return;
    setBusy(true);
    setError(null);
    try {
      await reauthenticatePassphrase(backupPassphrase);
      await createHouseholdBackup({
        mutationId: newClientId(),
        label: backupLabel.trim() || null,
      });
      setBackupLabel("");
      setBackupPassphrase("");
      await refreshBackups();
      props.onSuccessToast("Backup saved.");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function submitDeleteBackup(event: FormEvent) {
    event.preventDefault();
    if (busy || !deleteTarget) return;
    setBusy(true);
    setError(null);
    try {
      await reauthenticatePassphrase(deletePassphrase);
      await deleteHouseholdBackup(deleteTarget.id, newClientId());
      setDeleteTarget(null);
      setDeletePassphrase("");
      await refreshBackups();
      props.onSuccessToast("Backup deleted.");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function openRestore(backup: HouseholdBackupMeta) {
    setError(null);
    setBusy(true);
    try {
      const preview = await previewHouseholdBackup(backup.id);
      setRestoreTarget(preview);
      setSaveBackupBeforeRestore(false);
      setRestoreBackupLabel("");
      setRestorePassphrase("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function submitRestore(event: FormEvent) {
    event.preventDefault();
    if (busy || !restoreTarget || !props.canManageLifecycle) return;
    setBusy(true);
    setError(null);
    try {
      await reauthenticatePassphrase(restorePassphrase);
      let result: Awaited<ReturnType<typeof householdRestore>>;
      try {
        result = await householdRestore({
          mutationId: newClientId(),
          backupId: restoreTarget.id,
          expectedDigest: restoreTarget.contentDigest,
          expectedEpoch: props.installationEpoch,
          confirmationText: "RESTORE",
          saveBackupBeforeRestore,
          backupLabel: restoreBackupLabel.trim() || null,
        });
      } catch (restoreErr) {
        const recovered = await fetchLifecycleRecovery().catch(() => null);
        if (
          !recovered ||
          recovered.status !== "completed" ||
          !recovered.result ||
          recovered.kind !== "household_restore"
        ) {
          throw restoreErr;
        }
        result = recovered.result as Awaited<ReturnType<typeof householdRestore>>;
      }
      setRestoreTarget(null);
      props.onSuccessToast(
        `Restored “${result.restoredBackup.householdName}”. Sign in with a restored manager password.`,
      );
      props.onRestoreComplete();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
      setRestorePassphrase("");
    }
  }

  async function submitResetPassword(event: FormEvent) {
    event.preventDefault();
    if (busy || !props.canManageLifecycle) return;
    if (resetConfirmText.trim() !== "RESET") {
      setError("Type RESET exactly to continue.");
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
          saveBackupBeforeReset,
          backupLabel: resetBackupLabel.trim() || null,
        });
      } catch (resetErr) {
        const recovered = await fetchLifecycleRecovery().catch(() => null);
        if (!recovered || recovered.status !== "completed" || !recovered.result) {
          throw resetErr;
        }
        result = recovered.result as Awaited<ReturnType<typeof householdReset>>;
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
          : result.preOperationBackup
            ? "Household reset completed; a backup was saved first."
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

      {props.canManageLifecycle ? (
        <div className="settings-section settings-action" data-testid="backups-section">
          <h2>Backups</h2>
          <p className="meta">
            Saved household snapshots stay on this server through reset. Provider/host snapshots may
            also exist separately.
          </p>
          <form className="stack-form" onSubmit={submitCreateBackup}>
            <label>
              Optional label
              <input
                value={backupLabel}
                onChange={(event) => setBackupLabel(event.target.value)}
                maxLength={80}
                data-testid="backup-label"
              />
            </label>
            <label>
              Passphrase
              <input
                type="password"
                autoComplete="current-password"
                value={backupPassphrase}
                onChange={(event) => setBackupPassphrase(event.target.value)}
                required
                data-testid="backup-passphrase"
              />
            </label>
            <button type="submit" disabled={busy} data-testid="backup-create">
              {busy ? "Working…" : "Create backup"}
            </button>
          </form>
          <ul className="backup-list" data-testid="backup-list">
            {backups.length === 0 ? (
              <li className="meta">No saved backups yet.</li>
            ) : (
              backups.map((backup) => (
                <li key={backup.id} data-testid={`backup-row-${backup.id}`}>
                  <div>
                    <strong>{backup.householdName}</strong>
                    {backup.label ? ` — ${backup.label}` : ""}
                    <div className="meta">{formatBackupWhen(backup.createdAt)}</div>
                  </div>
                  <div className="backup-row-actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => void openRestore(backup)}
                      data-testid={`backup-restore-${backup.id}`}
                    >
                      Restore…
                    </button>
                    <button
                      type="button"
                      className="danger"
                      disabled={busy}
                      onClick={() => {
                        setDeleteTarget(backup);
                        setDeletePassphrase("");
                        setError(null);
                      }}
                      data-testid={`backup-delete-${backup.id}`}
                    >
                      Delete…
                    </button>
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}

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
            Starts setup over with an empty household database. Existing saved backups are kept.
            Saving a new backup before reset is optional and off by default.
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

      {error && !confirmOpen && !resetOpen && !deleteTarget && !restoreTarget ? (
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

      {deleteTarget ? (
        <dialog className="confirm-dialog" open data-testid="backup-delete-dialog">
          <form onSubmit={submitDeleteBackup}>
            <h2>Delete this backup?</h2>
            <p>
              Remove “{deleteTarget.householdName}
              {deleteTarget.label ? ` — ${deleteTarget.label}` : ""}” from{" "}
              {formatBackupWhen(deleteTarget.createdAt)}. The active household is not changed.
            </p>
            <label>
              Passphrase
              <input
                type="password"
                autoComplete="current-password"
                value={deletePassphrase}
                onChange={(event) => setDeletePassphrase(event.target.value)}
                required
              />
            </label>
            <div className="confirm-dialog-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button type="submit" className="danger" disabled={busy}>
                {busy ? "Deleting…" : "Delete backup"}
              </button>
            </div>
            {error ? <p role="alert">{error}</p> : null}
          </form>
        </dialog>
      ) : null}

      {restoreTarget ? (
        <dialog className="confirm-dialog" open data-testid="backup-restore-dialog">
          <form onSubmit={submitRestore}>
            <h2>Restore this household?</h2>
            <p>
              Replace{" "}
              {restoreTarget.currentHouseholdName
                ? `“${restoreTarget.currentHouseholdName}”`
                : "the current household"}{" "}
              with saved “{restoreTarget.householdName}” from{" "}
              {formatBackupWhen(restoreTarget.createdAt)}.
            </p>
            <ul>
              {restoreTarget.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={saveBackupBeforeRestore}
                onChange={(event) => setSaveBackupBeforeRestore(event.target.checked)}
                data-testid="restore-save-backup"
              />
              Save a backup of the current household before restoring (off by default)
            </label>
            {saveBackupBeforeRestore ? (
              <label>
                Optional label for current-state backup
                <input
                  value={restoreBackupLabel}
                  onChange={(event) => setRestoreBackupLabel(event.target.value)}
                  maxLength={80}
                />
              </label>
            ) : null}
            <label>
              Passphrase
              <input
                type="password"
                autoComplete="current-password"
                value={restorePassphrase}
                onChange={(event) => setRestorePassphrase(event.target.value)}
                required
                data-testid="restore-passphrase"
              />
            </label>
            <p className="meta">Type RESTORE is implied by confirming this action.</p>
            <div className="confirm-dialog-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setRestoreTarget(null)}
              >
                Cancel
              </button>
              <button type="submit" className="danger" disabled={busy} data-testid="restore-submit">
                {busy ? "Restoring…" : "Restore household"}
              </button>
            </div>
            {error ? <p role="alert">{error}</p> : null}
          </form>
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
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={saveBackupBeforeReset}
                  onChange={(event) => setSaveBackupBeforeReset(event.target.checked)}
                  data-testid="reset-save-backup"
                />
                Save a backup before resetting (off by default)
              </label>
              {saveBackupBeforeReset ? (
                <label>
                  Optional backup label
                  <input
                    value={resetBackupLabel}
                    onChange={(event) => setResetBackupLabel(event.target.value)}
                    maxLength={80}
                    data-testid="reset-backup-label"
                  />
                </label>
              ) : null}
              <p className="meta">
                Existing saved backups survive. Host/provider snapshots may also exist separately.
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
