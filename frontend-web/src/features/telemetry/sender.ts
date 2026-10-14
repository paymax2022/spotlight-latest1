'use client';

// Deliberately uses bare fetch + the Supabase session token. It must NOT go
// through any shared authed client: those can react to a 401 by signing out.
import { createClient } from '@/lib/supabase/client';
import { env } from '@/src/config/env';
import { createSender } from './senderCore';

export const sendNavigationBatch = createSender({
  getToken: async () => {
    const { data } = await createClient().auth.getSession();
    return data.session?.access_token ?? null;
  },
  baseURL: env.apiBaseUrl,
  post: (url, body, init) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...init.headers },
      body: JSON.stringify(body),
      keepalive: init.keepalive,
    }),
});
