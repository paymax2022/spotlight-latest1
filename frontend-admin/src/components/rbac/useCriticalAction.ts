'use client';

import { useCallback, useState } from 'react';

type Options = {
  /** The execute path — runs the real mutation (single-control). */
  action: (reason: string) => Promise<void>;
  /**
   * Maker-checker path — submits the action for a SECOND operator's approval
   * instead of executing it. When `dualControl` is true AND this is provided,
   * confirm() calls this instead of `action`. The backend is the authority: it
   * must record the request, forbid the maker from self-approving, and only apply
   * the change once a different authorized operator approves. This hook only wires
   * the client to that flow.
   */
  requestApproval?: (reason: string) => Promise<void>;
  dualControl?: boolean;
  /** Runs after a successful action/approval (e.g. refetch the list). */
  onDone?: () => void;
};

/**
 * Standardises high-impact / money / regulatory admin actions: a confirm step with
 * a captured reason, an in-flight busy state, surfaced errors, and an optional
 * maker-checker approval route. Pair with <ConfirmDialog requireReason busy … />.
 *
 *   const reverse = useCriticalAction({ action: (reason) => reverseTransfer(id, reason), onDone: refetch });
 *   <button onClick={reverse.ask} disabled={reverse.busy}>Reverse</button>
 *   <ConfirmDialog open={reverse.open} level="critical" requireReason busy={reverse.busy}
 *     title="Reverse transfer" confirmLabel="Reverse"
 *     onConfirm={reverse.confirm} onCancel={reverse.cancel} />
 *   {reverse.error && <p role="alert">{reverse.error}</p>}
 */
export function useCriticalAction({ action, requestApproval, dualControl = false, onDone }: Options) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback(() => {
    setError(null);
    setOpen(true);
  }, []);

  const cancel = useCallback(() => {
    if (!busy) setOpen(false);
  }, [busy]);

  const confirm = useCallback(
    async (reason: string) => {
      setBusy(true);
      setError(null);
      try {
        if (dualControl && requestApproval) await requestApproval(reason);
        else await action(reason);
        setOpen(false);
        onDone?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The action could not be completed. Please try again.');
      } finally {
        setBusy(false);
      }
    },
    [action, requestApproval, dualControl, onDone],
  );

  return {
    open,
    busy,
    error,
    ask,
    cancel,
    confirm,
    /** Whether confirm() will route to the approval path (drives ConfirmDialog's dualControl UI). */
    dualControl: dualControl && Boolean(requestApproval),
  };
}
