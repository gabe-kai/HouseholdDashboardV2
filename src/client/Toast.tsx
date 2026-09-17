import { useEffect, useRef, useState } from "react";

export type ToastMessage = {
  id: string;
  text: string;
  /** Optional secondary action (e.g. Preview). */
  actionLabel?: string;
  onAction?: () => void;
};

const DEFAULT_TTL_MS = 5_000;

export function useToast(ttlMs = DEFAULT_TTL_MS) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearToast() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setToast(null);
  }

  function showToast(
    text: string,
    options?: { actionLabel?: string; onAction?: () => void },
  ) {
    if (timerRef.current) clearTimeout(timerRef.current);
    const id = `toast-${Date.now()}`;
    setToast({
      id,
      text,
      actionLabel: options?.actionLabel,
      onAction: options?.onAction,
    });
    timerRef.current = setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
      timerRef.current = null;
    }, ttlMs);
  }

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { toast, showToast, clearToast };
}

export function ToastHost(props: {
  toast: ToastMessage | null;
  onDismiss: () => void;
}) {
  if (!props.toast) return null;
  return (
    <div className="toast-host" role="status" aria-live="polite">
      <div className="toast">
        <span>{props.toast.text}</span>
        {props.toast.actionLabel && props.toast.onAction ? (
          <button type="button" className="text-button" onClick={props.toast.onAction}>
            {props.toast.actionLabel}
          </button>
        ) : null}
        <button type="button" className="text-button" onClick={props.onDismiss} aria-label="Dismiss">
          Dismiss
        </button>
      </div>
    </div>
  );
}
