import { api } from '@/api/client';
import type {
  WinningPosition, EditionPrize, EditionRules, EditionWinner, RulesAcceptance,
} from '../types/edition.types';

// Rising Star edition reads/writes for the public mobile app. Same Go member
// group as the rest of voting (/api/v1/connect), so the bearer token the axios
// client already attaches authorises these too. Winners and rules returned here
// are pre-gated server-side: an unpublished winner or absent published rules
// simply never arrives.
const BASE = '/api/v1/connect';

function unwrap<T>(res: { data: unknown }, fallback: T): T {
  const body = res.data as { data?: T } | T;
  return ((body as { data?: T })?.data ?? body ?? fallback) as T;
}

export async function getEditionRules(contestId: string): Promise<EditionRules | null> {
  try {
    const res = await api.get(`${BASE}/contests/${contestId}/rules`);
    return unwrap<EditionRules | null>(res, null);
  } catch {
    return null; // no published rules → the screen hides the section
  }
}

export async function getEditionWinners(contestId: string): Promise<EditionWinner[]> {
  try {
    const res = await api.get(`${BASE}/contests/${contestId}/winners`);
    return unwrap<EditionWinner[]>(res, []);
  } catch {
    return [];
  }
}

export async function getEditionPositions(contestId: string): Promise<WinningPosition[]> {
  try {
    const res = await api.get(`${BASE}/contests/${contestId}/positions`);
    return unwrap<WinningPosition[]>(res, []);
  } catch {
    return [];
  }
}

export async function getEditionPrizes(contestId: string): Promise<EditionPrize[]> {
  try {
    const res = await api.get(`${BASE}/contests/${contestId}/edition-prizes`);
    return unwrap<EditionPrize[]>(res, []);
  } catch {
    return [];
  }
}

/**
 * Record the authenticated registrant's acceptance of the edition's CURRENT
 * published rules — the affirmative gate §5 requires before registration
 * completes. The user is taken from the bearer token server-side, so the client
 * only supplies the application id (the draft the gate was captured against) and
 * an optional rulesId (the server pins the live published version regardless).
 * Throws on failure so the registration flow can block submission (never a silent
 * success).
 */
export async function acceptEditionRules(contestId: string, applicationId?: string, rulesId?: string): Promise<RulesAcceptance> {
  const res = await api.post(`${BASE}/contests/${contestId}/rules-acceptance`, {
    application_id: applicationId ?? '',
    rules_id: rulesId ?? '',
  });
  return unwrap<RulesAcceptance>(res, undefined as unknown as RulesAcceptance);
}

export async function getMyRulesAcceptance(contestId: string): Promise<RulesAcceptance | null> {
  try {
    const res = await api.get(`${BASE}/contests/${contestId}/rules-acceptance`);
    return unwrap<RulesAcceptance | null>(res, null);
  } catch {
    return null;
  }
}

// ── Slug-based registration gate ──────────────────────────────────────────────
// The registration draft carries contestSlug, not the connect_contests UUID, and
// at submit time there is no contestants row yet. These resolve the edition from
// the slug server-side and key acceptance on the authenticated user + application.

/**
 * The published rules for the edition a registration slug resolves to, or null
 * when the slug has no edition or no published rules — in which case the
 * registration gate is skipped (an edition that never configured rules keeps
 * registering unchanged, satisfying "existing registration remains intact").
 */
export async function getEditionRulesBySlug(slug: string): Promise<EditionRules | null> {
  if (!slug) return null;
  try {
    const res = await api.get(`${BASE}/editions/by-slug/${encodeURIComponent(slug)}/rules`);
    return unwrap<EditionRules | null>(res, null);
  } catch {
    return null;
  }
}

/**
 * Record the authenticated registrant's acceptance for the edition a slug
 * resolves to. The registration-submit gate: throws on failure so submission is
 * blocked rather than silently completing without acceptance (§5, criterion #11).
 */
export async function acceptEditionRulesBySlug(slug: string, applicationId?: string, rulesId?: string): Promise<RulesAcceptance> {
  const res = await api.post(`${BASE}/editions/by-slug/${encodeURIComponent(slug)}/rules-acceptance`, {
    application_id: applicationId ?? '',
    rules_id: rulesId ?? '',
  });
  return unwrap<RulesAcceptance>(res, undefined as unknown as RulesAcceptance);
}

/** The authenticated user's existing acceptance for a slug's edition, or null. */
export async function getMyRulesAcceptanceBySlug(slug: string): Promise<RulesAcceptance | null> {
  if (!slug) return null;
  try {
    const res = await api.get(`${BASE}/editions/by-slug/${encodeURIComponent(slug)}/rules-acceptance`);
    return unwrap<RulesAcceptance | null>(res, null);
  } catch {
    return null;
  }
}
