import axios from 'axios';
import { router } from 'expo-router';
import { createSupabaseClient } from '@/lib/supabase';
import { getDevUrl } from '@/lib/devUrl';

// Base URL points to the frontend-web Next.js server, which hosts server-side
// bill payment operations (wallet debit + provider calls + ledger writes).
// All read-only catalog and wallet data comes directly from Supabase (see each api/*.ts).
const baseURL = getDevUrl(process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000');

export const api = axios.create({
  baseURL,
  timeout: 30_000,
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

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    if (error?.response?.status === 401) {
      try { await createSupabaseClient().auth.signOut(); } catch { /* ignore */ }
      router.replace('/(auth)/login');
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
