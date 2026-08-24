// ── Film Academy — data layer ────────────────────────────────────────────────
// The app and the web app are separate INTERFACES that share an API. These call
// the same /api/academy/* endpoints the web console uses; the screens are native.
//
// Base URL is the shared axios client (EXPO_PUBLIC_API_BASE_URL → frontend-web),
// which is also what proxies every other module's calls.
//
// NOTE ON MONEY: academy_batches stores training_fee_ngn in NAIRA, not kobo.
// It predates the kobo convention used across finance. Do not multiply by 100.

import { api } from '@/api/client';
import type {
  FilmAcademyOverview,
  FilmAcademyApplicationInput,
} from './types';

type Envelope = { data?: unknown };

/** The API returns either the object directly or wrapped in { data }. */
function unwrap<T>(res: Envelope): T {
  const body = res.data as Record<string, unknown> | undefined;
  if (body && typeof body === 'object' && 'data' in body && body.data) {
    return body.data as T;
  }
  return body as T;
}

/**
 * Open cohorts, plus which ones this user already applied to.
 * Works signed-out (appliedBatchIds is simply empty), so the hub can render
 * before the user has an account.
 */
export async function getOverview(): Promise<FilmAcademyOverview> {
  const res = await api.get('/api/academy/apply');
  const body = unwrap<Partial<FilmAcademyOverview>>(res);
  return {
    batches: body?.batches ?? [],
    appliedBatchIds: body?.appliedBatchIds ?? [],
    settings: body?.settings ?? {},
  };
}

/** Submit an application. Requires a signed-in user. */
export async function applyToBatch(input: FilmAcademyApplicationInput): Promise<void> {
  await api.post('/api/academy/apply', input);
}

/** The signed-in user's instalment plan, if the programme issued one. */
export async function getInstallments(): Promise<unknown> {
  const res = await api.get('/api/academy/installments');
  return unwrap(res);
}
