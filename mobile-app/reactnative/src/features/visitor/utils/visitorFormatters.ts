import type { AccessCode, AccessCodeStatus } from '../types/visitor.types';

// ── Money ────────────────────────────────────────────────────────────────────
// Amounts are integers in minor units (kobo). Never do float math on money.
export function formatNairaFromKobo(kobo: number): string {
  const naira = Math.round(kobo) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Codes ────────────────────────────────────────────────────────────────────
// Render a numeric code grouped for readability, e.g. "482 913".
export function formatCodeValue(code: string): string {
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`;
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`;
  return code;
}

// ── Time ─────────────────────────────────────────────────────────────────────
export function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
}

// Compact human "time left" until an ISO timestamp.
export function timeUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m left`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m left`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h left`;
}

export function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// Derive a display status (a stored "active" code may be past its validity).
export function effectiveStatus(code: AccessCode): AccessCodeStatus {
  if (code.status !== 'active') return code.status;
  if (new Date(code.validityEnd).getTime() < Date.now()) return 'expired';
  if (code.entriesUsed >= code.maxEntries) return 'used';
  return 'active';
}

export function isActive(code: AccessCode): boolean {
  return effectiveStatus(code) === 'active';
}

// Build the share message body (VM-121/122). Numeric code always included as
// copy-pasteable fallback for when a QR cannot be scanned.
export function buildShareMessage(code: AccessCode): string {
  return [
    `You're invited to ${code.estateName}.`,
    `Host: ${code.hostName} (${code.unitLabel})`,
    `Access code: ${formatCodeValue(code.codeValue)}`,
    `Valid until: ${formatDateTime(code.validityEnd)}`,
    '',
    'Show this code (or the QR) to security at the gate.',
  ].join('\n');
}
