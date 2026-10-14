import axios from 'axios';
import { createSupabaseClient } from '@/lib/supabase';
import { getDevUrl } from '@/lib/devUrl';
import { resolveApiBaseUrl } from '@/lib/apiBaseUrl';
import type { NavEvent } from './buffer';

// Deliberately a PLAIN axios instance: the shared `api` client signs the user
// out on a 401, and background telemetry must never be able to do that.
const http = axios.create({
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
});

export async function sendNavigationBatch(batch: NavEvent[]): Promise<void> {
  try {
    if (batch.length === 0) return;
    const { data: { session } } = await createSupabaseClient().auth.getSession();
    const token = session?.access_token;
    if (!token) return;
    const baseURL = getDevUrl(resolveApiBaseUrl());
    await http.post(
      '/api/v1/telemetry/navigation',
      { events: batch.map(({ surface, route, occurred_at }) => ({ surface, route, occurred_at })) },
      { baseURL, headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true },
    );
  } catch { /* swallow everything: telemetry is best-effort */ }
}
