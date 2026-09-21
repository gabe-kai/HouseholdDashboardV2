import { useRef, useState } from "react";
import { clearRoutineActivity } from "./api";
import { newClientId } from "./id";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function HouseholdSettingsView(props: {
  expectedGeneration: number;
  canClearActivity: boolean;
  onBack: () => void;
  onCleared: (activityGeneration: number) => void;
  onSuccessToast: (message: string) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  function openConfirm() {
    setError(null);
    setConfirmOpen(true);
    queueMicrotask(() => dialogRef.current?.showModal());
  }

  function closeConfirm() {
    dialogRef.current?.close();
    setConfirmOpen(false);
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
      closeConfirm();
      props.onCleared(result.activityGeneration);
      props.onSuccessToast("Activity history was cleared.");
    } catch (caught) {
      setError(errorMessage(caught));
      // Never toast success on failure.
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel household-settings">
      <button type="button" className="back-link" onClick={props.onBack}>
        Back to Household
      </button>
      <h1 className="page-heading">Settings</h1>
      <h2>Data &amp; testing</h2>
      <p className="page-subcopy">
        Tools for evaluation and local testing. Household setup stays in place.
      </p>

      {props.canClearActivity ? (
        <div className="settings-action">
          <h3>Clear activity history</h3>
          <p className="meta">
            Removes recorded routine and responsibility checklists and progress for this household
            so evaluation can restart. People, access, groups, plans, calendars, and personal tasks
            remain.
          </p>
          <button type="button" className="danger" onClick={openConfirm} disabled={busy}>
            Clear activity history…
          </button>
        </div>
      ) : (
        <p className="meta" role="status">
          Activity clear is not available for this session.
        </p>
      )}

      {error ? <p role="alert">{error}</p> : null}

      {confirmOpen ? (
        <dialog
          ref={dialogRef}
          className="confirm-dialog"
          onCancel={(event) => {
            event.preventDefault();
            if (!busy) closeConfirm();
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
            <button type="button" className="secondary" disabled={busy} onClick={closeConfirm}>
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
    </section>
  );
}
