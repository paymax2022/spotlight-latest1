import axios from 'axios';
import { createSupabaseClient } from '@/lib/supabase';
import { getDevUrl } from '@/lib/devUrl';
import { resolveApiBaseUrl } from '@/lib/apiBaseUrl';
import { createSender } from './senderCore';

// Deliberately a PLAIN axios instance: the shared `api` client signs the user
// out on a 401, and background telemetry must never be able to do that.
// (Guarded by sender.test.ts.)
const http = axios.create({
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
});

export const sendNavigationBatch = createSender({
  get baseURL() { return getDevUrl(resolveApiBaseUrl()); },
  getToken: async () => {
    const { data: { session } } = await createSupabaseClient().auth.getSession();
    return session?.access_token;
  },
  post: (url, body, config) => http.post(url, body, config),
});
