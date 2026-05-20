import { env } from '@/config/env';
import type { CompetitionOverview, OpenMicCompetition } from '@/types/competitions';

export async function getCompetitionOverview(): Promise<CompetitionOverview | null> {
  const headers: Record<string, string> = {};
  const adminKey = process.env.NEXT_PUBLIC_ADMIN_API_KEY || '';
  if (adminKey) headers['x-admin-api-key'] = adminKey;

  const res = await fetch(`${env.apiBaseUrl}/admin/competitions/overview`, {
    cache: 'no-store',
    credentials: 'include',
    headers,
  });
  const payload = await res.json();
  if (!res.ok || !payload?.success || !payload?.overview) return null;
  return payload.overview as CompetitionOverview;
}

export async function listOpenMicCompetitions(limit = 100): Promise<OpenMicCompetition[]> {
  const headers: Record<string, string> = {};
  const adminKey = process.env.NEXT_PUBLIC_ADMIN_API_KEY || '';
  if (adminKey) headers['x-admin-api-key'] = adminKey;

  const url = new URL(`${env.apiBaseUrl}/admin/competitions/open-mic`);
  url.searchParams.set('limit', String(limit));

  const res = await fetch(url.toString(), {
    cache: 'no-store',
    credentials: 'include',
    headers,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.competitions)) return [];
  return payload.competitions as OpenMicCompetition[];
}

export async function createOpenMicCompetition(input: {
  name: string;
  slug?: string;
  description?: string;
  status?: string;
  category?: string;
  start_date?: string;
  end_date?: string;
  is_featured?: boolean;
  entry_fee_ngn?: number;
  vote_price_ngn?: number;
  rules_text?: string;
  eligibility_text?: string;
}): Promise<OpenMicCompetition | null> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const adminKey = process.env.NEXT_PUBLIC_ADMIN_API_KEY || '';
  if (adminKey) headers['x-admin-api-key'] = adminKey;

  const res = await fetch(`${env.apiBaseUrl}/admin/competitions/open-mic`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.competition) return null;
  return payload.competition as OpenMicCompetition;
}
