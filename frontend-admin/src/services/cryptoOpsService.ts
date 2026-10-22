// Crypto operations console: the operational controls (trading pause, withdrawal kill switch,
// market switch, per-trade limit, customer banner), measured provider health, the audit-log
// search, a manual reconcile trigger and the deposit list. Backed by
// /api/v1/admin/crypto/{controls,provider-health,audit,reconciler/run,deposits}
// (backend/internal/cryptosvc, RBAC crypto.admin). Controls are SAFETY configuration: the
// client validates before it sends, never fakes a write in fixture mode, and keys each change
// by its content so a double-click dedupes and a different change never reuses a key.

import { apiV1 } from '@/config/env';
import { operationKey } from './idempotency';
import type {
  CryptoAuditFilter, CryptoAuditPage, CryptoControlsResponse, CryptoControlsUpdate, CryptoControlsVersion,
  CryptoDepositRow, CryptoDepositStatus, CryptoProviderHealth, CryptoReconcileRunResult,
} from '@/types/cryptoAdmin';

const USE_MOCK = (process.env.NEXT_PUBLIC_CRYPTO_ADMIN_USE_MOCK ?? 'false').toLowerCase() === 'true';
const base = () => `${apiV1()}/admin/crypto`;
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const ASSET_RE = /^[A-Za-z0-9]{2,12}$/;
const MAX_REASON = 500;
const MAX_BANNER = 280;
const MAX_DISABLED = 100;

/** Thrown when the controls changed since the operator loaded them (HTTP 409 version_conflict). */
export class ControlsConflictError extends Error {
  constructor(message = 'version_conflict') {
    super(message);
    this.name = 'ControlsConflictError';
  }
}

async function errorText(res: Response, fallback: string): Promise<string> {
  try {
    const b = await res.json();
    const code = typeof b?.error === 'string' ? b.error : b?.error?.message;
    return code ? `${fallback}: ${code}${b?.detail ? ` (${b.detail})` : ''}` : `${fallback}: ${res.status}`;
  } catch {
    return `${fallback}: ${res.status}`;
  }
}

/** Client-side mirror of the backend rules. null = valid. */
export function validateControlsUpdate(u: CryptoControlsUpdate, ceilingKobo: number): string | null {
  if (!Number.isInteger(u.expected_version) || u.expected_version < 0) return 'Missing controls version — reload the page.';
  if (!Number.isSafeInteger(u.max_quote_kobo) || u.max_quote_kobo < 0 || u.max_quote_kobo > ceilingKobo) {
    return `The per-trade limit must be a whole naira amount between ₦0 (no extra limit) and ₦${(ceilingKobo / 100).toLocaleString('en-NG')}.`;
  }
  if (u.disabled_assets.length > MAX_DISABLED) return `At most ${MAX_DISABLED} markets can be switched off.`;
  for (const a of u.disabled_assets) {
    if (!ASSET_RE.test(a.trim())) return `"${a}" is not a valid asset code.`;
    if (a.trim().toUpperCase() === 'NGN') return 'NGN is not a crypto market.';
  }
  if (u.banner) {
    const m = u.banner.message.trim();
    if (!m) return 'A banner needs a message (or remove the banner).';
    if ([...m].length > MAX_BANNER) return `The banner message must be at most ${MAX_BANNER} characters.`;
    if (!['info', 'warning', 'critical'].includes(u.banner.severity)) return 'Choose a banner severity.';
  }
  const reason = u.reason.trim();
  if (!reason) return 'A reason is required (it is recorded in the audit log).';
  if (reason.length > MAX_REASON) return `The reason must be at most ${MAX_REASON} characters.`;
  return null;
}

/** Trim, upper-case, de-duplicate and sort, so equal states give equal bodies and keys. */
export function normaliseControlsUpdate(u: CryptoControlsUpdate): CryptoControlsUpdate {
  return {
    ...u,
    disabled_assets: Array.from(new Set(u.disabled_assets.map((a) => a.trim().toUpperCase()).filter(Boolean))).sort(),
    banner: u.banner ? { message: u.banner.message.trim(), severity: u.banner.severity } : null,
    reason: u.reason.trim(),
  };
}

function contentHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const FIXTURE_REFUSAL =
  'is unavailable in fixture mode: this console will not report a change it did not make. ' +
  'Unset NEXT_PUBLIC_CRYPTO_ADMIN_USE_MOCK to make this change against the live backend.';

const MOCK_CONTROLS: CryptoControlsResponse = {
  ceiling_kobo: 1_000_000_000_00,
  current: { version: 0, trading_paused: false, withdrawals_paused: false, disabled_assets: [], max_quote_kobo: 1_000_000_000_00, banner: null, reason: 'FIXTURE: nothing stored', created_by: 'system' },
  history: [],
};

/** null = the backend has no controls route (crypto disabled on this environment). */
export async function getControls(): Promise<CryptoControlsResponse | null> {
  if (USE_MOCK) return structuredClone(MOCK_CONTROLS);
  const res = await fetch(`${base()}/controls`, { cache: 'no-store', headers: JSON_HEADERS });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await errorText(res, 'Could not load the controls'));
  const b = await res.json();
  return { current: b.current, ceiling_kobo: b.ceiling_kobo, history: b.history ?? [] } as CryptoControlsResponse;
}

/** SAFETY mutation: validated, content-keyed, refused in fixture mode. */
export async function updateControls(u: CryptoControlsUpdate, ceilingKobo: number): Promise<{ created: boolean; current: CryptoControlsVersion }> {
  const bad = validateControlsUpdate(u, ceilingKobo);
  if (bad) throw new Error(bad);
  if (USE_MOCK) throw new Error(`Changing the crypto controls ${FIXTURE_REFUSAL}`);
  const body = normaliseControlsUpdate(u);
  const json = JSON.stringify(body);
  const res = await fetch(`${base()}/controls`, {
    method: 'PUT',
    headers: { ...JSON_HEADERS, 'Idempotency-Key': operationKey('crypto:controls', body.expected_version, contentHash(json)) },
    body: json,
  });
  if (res.status === 409) {
    const err = await res.json().catch(() => ({} as { error?: string }));
    if (err?.error === 'version_conflict') throw new ControlsConflictError();
    throw new Error(`Change refused: ${err?.error ?? 'conflict'}`);
  }
  if (!res.ok) throw new Error(await errorText(res, 'Controls update failed'));
  const out = await res.json();
  return { created: out.created !== false, current: out.current as CryptoControlsVersion };
}

/** null = the swap pipeline is not mounted on this environment. */
export async function getProviderHealth(): Promise<CryptoProviderHealth | null> {
  if (USE_MOCK) return { provider: 'fixture', checked_at: new Date().toISOString(), status: 'unknown' };
  const res = await fetch(`${base()}/provider-health`, { cache: 'no-store', headers: JSON_HEADERS });
  if (res.status === 404 || res.status === 503) return null;
  if (!res.ok) throw new Error(await errorText(res, 'Provider health fetch failed'));
  return (await res.json()).health as CryptoProviderHealth;
}

/** null = the swap pipeline (and its audit search) is not mounted here. */
export async function searchAudit(f: CryptoAuditFilter): Promise<CryptoAuditPage | null> {
  if (USE_MOCK) return { entries: [] };
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && String(v).trim() !== '') q.set(k, String(v).trim());
  const res = await fetch(`${base()}/audit?${q}`, { cache: 'no-store', headers: JSON_HEADERS });
  if (res.status === 404 || res.status === 503) return null;
  if (!res.ok) throw new Error(await errorText(res, 'Audit search failed'));
  const b = await res.json();
  return { entries: b.entries ?? [], next_before: b.next_before };
}

/** Manual sync: one reconcile pass. Re-reads provider state; cannot edit a balance. */
export async function runReconciler(): Promise<CryptoReconcileRunResult> {
  if (USE_MOCK) throw new Error(`Running the reconciler ${FIXTURE_REFUSAL}`);
  const res = await fetch(`${base()}/reconciler/run`, { method: 'POST', headers: JSON_HEADERS });
  if (res.status === 503) throw new Error('No reconciler runs on this environment (the swap pipeline is off).');
  if (!res.ok) throw new Error(await errorText(res, 'Reconcile run failed'));
  return (await res.json()).result as CryptoReconcileRunResult;
}

/** null = deposits are not available on this environment. */
export async function listDeposits(status: CryptoDepositStatus | '' = ''): Promise<CryptoDepositRow[] | null> {
  if (USE_MOCK) return [];
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  const res = await fetch(`${base()}/deposits${q}`, { cache: 'no-store', headers: JSON_HEADERS });
  if (res.status === 404 || res.status === 503) return null;
  if (!res.ok) throw new Error(await errorText(res, 'Deposit list failed'));
  return ((await res.json()).deposits ?? []) as CryptoDepositRow[];
}
