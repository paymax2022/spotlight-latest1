'use client';

import { createClient } from '@/lib/supabase/client';

export async function getAccessToken(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

export async function authHeaders(json = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  const token = await getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function adminAuthHeaders(json = false): Promise<Record<string, string>> {
  return {
    ...(await authHeaders(json)),
    'x-spotlight-role': 'admin',
  };
}
