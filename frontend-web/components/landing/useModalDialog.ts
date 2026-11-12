'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * Drives a native <dialog> from React state, the way the mock drove it with
 * showModal()/close(): the body keeps its scroll lock while it is open, Escape
 * (which the browser handles on its own) is mirrored back into state, and a
 * click on the backdrop — the area of the element outside its box — closes it.
 *
 * `opener` is the element that asked for the dialog. Closing a modal puts focus
 * back on <body> by itself, so the trigger can only be re-focused after
 * `close()` has run, which is what the second half of the effect does. Keeping
 * the dialog mounted (rather than unmounting it on close) is what makes that
 * ordering reliable.
 *
 * The lock class is `landing-locked`, the port of the mock's `.body-locked`,
 * renamed because that name is generic enough to collide with the theme.
 */
export function useModalDialog(open: boolean, close: () => void, opener?: { current: HTMLElement | null }) {
  const ref = useRef<HTMLDialogElement>(null);
  const handleClose = useCallback(() => close(), [close]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      document.body.classList.add('landing-locked');
      dialog.showModal();
      return () => document.body.classList.remove('landing-locked');
    }
    if (dialog.open) dialog.close();
    const target = opener?.current;
    if (target?.isConnected) target.focus();
  }, [open, opener]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [handleClose]);

  const onSelfClick = useCallback(() => {
    if (ref.current?.open) ref.current.close();
  }, []);

  return { ref, onSelfClick };
}
