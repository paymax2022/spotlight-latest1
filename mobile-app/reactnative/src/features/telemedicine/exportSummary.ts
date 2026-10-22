// "Download" on the visit summary has to produce the record the patient just
// read, or it shouldn't be on the screen at all. The summary is rendered from
// doctor-entered text of every shape (diagnosis, notes, follow-up, an
// arbitrarily long medication list), so it is captured from the view rather than
// redrawn into a fixed template — what saves is what the patient saw.
//
// Web and native have no single mechanism, mirroring the membership-card save:
//   • web    — html2canvas against the DOM node, then a synthetic <a download>.
//   • native — captureRef to a temp file, then the share sheet, which is where
//              "Save to Files" lives on both platforms.

import { Platform } from 'react-native';

export type ExportOutcome = 'saved' | 'shared' | 'unsupported' | 'failed';

/** Filesystem-safe file name for a visit summary. */
export function summaryFileName(appointmentId: string): string {
  const safe = (appointmentId || 'visit').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `visit-summary-${safe || 'visit'}.png`;
}

/**
 * Capture the rendered summary and hand it to the platform's save flow.
 * `ref` is the summary's view (or the DOM node on web), not the screen.
 */
export async function exportVisitSummary(ref: unknown, fileName: string): Promise<ExportOutcome> {
  try {
    if (Platform.OS === 'web') {
      const node = ((ref as { current?: unknown } | null)?.current ?? ref) as HTMLElement | null;
      if (typeof document === 'undefined' || !node) return 'unsupported';
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(node, { backgroundColor: null, scale: 2, useCORS: true });
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return 'saved';
    }

    // Lazily required so the web bundle never pulls in the native modules.
    const { captureRef } = require('react-native-view-shot');
    const Sharing = require('expo-sharing');
    if (!(await Sharing.isAvailableAsync())) return 'unsupported';

    const tmpUri = await captureRef(ref as never, { format: 'png', quality: 1, result: 'tmpfile' });
    let shareUri = tmpUri;
    try {
      const { File, Paths } = require('expo-file-system');
      // A capture name is meaningless to a patient; the share sheet should show
      // "visit-summary-<id>.png". A failure here must not lose the capture.
      new File(tmpUri).copy(new File(Paths.cache, fileName));
      shareUri = new File(Paths.cache, fileName).uri;
    } catch { /* keep tmpUri */ }

    await Sharing.shareAsync(shareUri, {
      mimeType: 'image/png',
      dialogTitle: 'Save visit summary',
      UTI: 'public.png',
    });
    return 'shared';
  } catch {
    return 'failed';
  }
}
