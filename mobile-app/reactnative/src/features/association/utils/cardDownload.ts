// ── Association — Membership card download ────────────────────────────────────
// The Download button used to open an Alert saying it was "not available in this
// preview build" — which on react-native-web is a silent no-op, so the button
// did nothing at all.
//
// The card is captured from the rendered view rather than redrawn, so what is
// saved is exactly what the member sees, including the QR code, and the card
// design has only one definition.

import { Platform } from 'react-native';
import { captureRef } from 'react-native-view-shot';


export type SaveOutcome = 'saved' | 'shared' | 'dismissed' | 'unsupported' | 'failed';

/** Filesystem-safe file name for a member's card. */
export function cardFileName(memberId: string): string {
  const safe = (memberId || 'card').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `membership-card-${safe || 'card'}.png`;
}

/**
 * Capture the card view and hand it to the platform's save flow.
 *
 * Web and native diverge because there is no single mechanism:
 *   • web    — capture to a data URI and click a synthetic <a download>. This is
 *              the surface the app is previewed on, so it must not be the
 *              branch that degrades.
 *   • native — capture to a temp file, rename it so the share sheet shows
 *              "membership-card-<id>.png" rather than a random capture name,
 *              then open the share sheet, which is what "Save to Files" and
 *              "Save Image" live behind on both platforms.
 *
 * `ref` is the captured view; pass the card view, not the screen.
 */
export async function saveMembershipCard(ref: unknown, memberId: string): Promise<SaveOutcome> {
  const fileName = cardFileName(memberId);
  try {
    if (Platform.OS === 'web') {
      // react-native-view-shot ships a web implementation, but its exported
      // captureRef cannot reach it: captureRef calls findNodeHandle on anything
      // that is not already a node handle, and findNodeHandle throws outright on
      // react-native-web ("findNodeHandle is not supported on web"). So the web
      // path goes straight to html2canvas — which is what that web build uses
      // anyway — against the DOM element the ref holds.
      const node = ((ref as { current?: unknown } | null)?.current ?? ref) as HTMLElement | null;
      if (typeof document === 'undefined' || !node) return 'unsupported';
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(node, { backgroundColor: null, scale: 2, useCORS: true });
      const dataUri = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUri;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return 'saved';
    }

    const tmpUri = await captureRef(ref as never, { format: 'png', quality: 1, result: 'tmpfile' });

    // Lazily required so the web bundle never pulls in the native modules.
    const Sharing = require('expo-sharing');
    if (!(await Sharing.isAvailableAsync())) return 'unsupported';

    let shareUri = tmpUri;
    try {
      const { File, Paths } = require('expo-file-system');
      const named = new File(Paths.cache, fileName);
      // The capture name is a random temp string; copying to a named file is
      // purely so the save dialog shows something a member would recognise. A
      // failure here must not lose the capture, so it falls back to the temp
      // file rather than aborting the save.
      new File(tmpUri).copy(named);
      shareUri = named.uri;
    } catch { /* keep tmpUri */ }

    await Sharing.shareAsync(shareUri, {
      mimeType: 'image/png',
      dialogTitle: 'Save membership card',
      UTI: 'public.png',
    });
    return 'shared';
  } catch (err) {
    // Logged rather than swallowed: a capture failure is silent to the user
    // apart from a generic message, and the cause (a tainted canvas, a missing
    // node, a permissions prompt) is only visible here.
    console.warn('[association] membership card save failed', err);
    return 'failed';
  }
}
