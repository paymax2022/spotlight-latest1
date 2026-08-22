import { env } from '@/config/env';
import type { CompetitionOverview, OpenMicCompetition } from '@/types/competitions';

export async function getCompetitionOverview(): Promise<CompetitionOverview | null> {
  const headers: Record<string, string> = {};

  try {
    const res = await fetch(`${env.apiBaseUrl}/admin/competitions/overview`, {
      cache: 'no-store',
      credentials: 'include',
      headers,
    });

    if (!res.ok) {
      console.error(`Competition overview fetch failed: ${res.status} ${res.statusText}`);
      return null;
    }

    const payload = await res.json();
    if (!payload?.success) {
      console.error('Competition overview returned success: false', payload?.error);
      return null;
    }

    // Return overview data or null if empty
    return payload.overview as CompetitionOverview;
  } catch (error) {
    console.error('Failed to fetch competition overview:', error);
    // Check if backend is accessible
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      console.error(`Cannot reach backend at ${env.apiBaseUrl}. Is the Go backend running on port 8091?`);
    }
    return null;
  }
}

export async function listOpenMicCompetitions(limit = 100): Promise<OpenMicCompetition[]> {
  const headers: Record<string, string> = {};

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
