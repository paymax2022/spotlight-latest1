/**
 * Turn a provider reason ("dojah: no matching record") into a sentence a member
 * can read. The gateway stores what the provider said verbatim, including its
 * name and lower-case phrasing, which looks broken in the UI.
 */
export function cleanProviderReason(reason?: string | null): string | null {
  if (!reason) return null;
  const cleaned = reason.replace(/^(dojah|smileid|youverify|mock):\s*/i, '').trim();
  if (!cleaned) return null;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1) + (cleaned.endsWith('.') ? '' : '.');
}
