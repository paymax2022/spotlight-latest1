import axios from 'axios';
import { createSupabaseClient } from '@/lib/supabase';
import { getDevUrl } from '@/lib/devUrl';
import { resolveApiBaseUrl } from '@/lib/apiBaseUrl';
import { promptSignIn } from '@/lib/authRedirect';

// Base URL points to the frontend-web Next.js server, which hosts server-side
// bill payment operations (wallet debit + provider calls + ledger writes).
// All read-only catalog and wallet data comes directly from Supabase (see each api/*.ts).
const baseURL = getDevUrl(resolveApiBaseUrl());

declare module 'axios' {
  interface AxiosRequestConfig {
    /**
     * Suppress the global 401 → sign-out + redirect for this request. Set it on
     * advisory/background reads only; every user-initiated request should keep the
     * default so an expired session is surfaced immediately.
     */
    skipAuthRedirect?: boolean;
    /** Internal: set once a 401 has been retried after a session refresh. */
    _authRetried?: boolean;
  }
}

export const api = axios.create({
  baseURL,
  timeout: 60_000, // Increased from 30s to 60s for slower staging backend
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
});

api.interceptors.request.use(async (config) => {
  try {
    const supabase = createSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      config.headers.Authorization = `Bearer ${session.access_token}`;
    }
  } catch { /* proceed unauthenticated */ }
  return config;
});

// One refresh shared by every request that 401s at the same moment, so a burst
// of parallel queries on an expired token costs one refresh, not one each.
let refreshInFlight: Promise<string | null> | null = null;
function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= (async () => {
    try {
      const { data, error } = await createSupabaseClient().auth.refreshSession();
      return error ? null : data.session?.access_token ?? null;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    // A 401 normally means the session is gone, so sign out and bounce to login.
    // ADVISORY reads opt out with `skipAuthRedirect: true`: a background check that
    // merely informs the UI (e.g. the checkout's KYC spend pre-check) must never be
    // able to log someone out on its own — if the session really is dead, the user's
    // next real request will 401 and take this path anyway.
    if (error?.response?.status === 401 && !error?.config?.skipAuthRedirect) {
      // An access token that expired in flight is not a dead session: refresh
      // once and replay. A 401 means the server acted on nothing, so the replay
      // is safe for mutations too.
      const original = error.config;
      if (original && !original._authRetried) {
        const token = await refreshAccessToken();
        if (token) {
          original._authRetried = true;
          original.headers.Authorization = `Bearer ${token}`;
          return api.request(original);
        }
      }
      // Local scope: the default (global) revokes the user's other devices too.
      try { await createSupabaseClient().auth.signOut({ scope: 'local' }); } catch { /* ignore */ }
      // Come BACK here after signing in, via the shared guarded prompt. The login
      // never passed one, so an expired session cost the user their place as well
      // as their session. Routing through promptSignIn also collapses this with the
      // react-query global handler, so ONE dead session causes ONE navigation
      // rather than a router.replace storm.
      promptSignIn();
    }
    // Surface the server-provided reason (e.g. "This feature requires KYC Tier 1…",
    // insufficient-balance, tier-limit) instead of axios's generic "Request failed
    // with status code 4xx", which hides the cause from onError alerts.
    const serverMsg = error?.response?.data?.error ?? error?.response?.data?.message;
    if (typeof serverMsg === 'string' && serverMsg.trim()) {
      error.message = serverMsg;
    }
    return Promise.reject(error);
  },
);
