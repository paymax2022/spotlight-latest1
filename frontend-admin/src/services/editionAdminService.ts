/**
 * Rising Star edition administration — prizes & winning positions, versioned
 * rules & regulations, and winner declaration (ADDITIONAL MASTER REQUIREMENTS
 * §1, §2, §4, §6).
 *
 * These endpoints live on the Go connect-voting module's ADMIN group
 * (`/api/connect/admin/contests/...`), guarded by the connect.contests.view /
 * connect.contests.manage RBAC permissions — the same plane the existing contest
 * console already reaches. So this service mirrors connectAdminOpsService: it
 * goes through the same-origin admin proxy via apiRoot(), NOT the web proxy that
 * contestsAdminService (a frontend-web-backed module) uses.
 */
import { apiRoot } from '@/config/env';

function adminBase(): string {
  return `${apiRoot()}/api/connect/admin/contests`;
}

function headers(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  return { 'Content-Type': 'application/json' };
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, { headers: headers(), cache: 'no-store' });
  if (res.status === 401) throw new Error('Sign in again (401).');
  if (res.status === 403) throw new Error('This account lacks the contest permission (403).');
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}

async function sendJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, {
    method,
    headers: headers(),
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error as string;
    } catch {
      /* keep the status-only message */
    }
    throw new Error(msg);
  }
  const j = await res.json();
  return (j?.data ?? j) as T;
}

// ── Types (mirror the Go structs in backend/internal/connect/voting/edition.go) ──

export interface WinningPosition {
  id: string;
  edition_id: string;
  title: string;
  rank: number;
  display_order: number;
  recipients_allowed: number;
  is_active: boolean;
}

export interface EditionPrize {
  id: string;
  edition_id: string;
  position_id?: string | null;
  prize_type: 'cash' | 'non_cash' | 'package';
  title: string;
  amount_kobo?: number | null;
  currency: string;
  description: string;
  fulfilment_conditions: string;
  presentation_timing: string;
  display_order: number;
  is_active: boolean;
}

export interface EditionRules {
  id: string;
  edition_id: string;
  version: number;
  content: Record<string, unknown>;
  status: 'draft' | 'published' | 'archived';
  effective_date?: string | null;
  published_at?: string | null;
}

export interface EditionWinner {
  id: string;
  edition_id: string;
  contestant_id: string;
  position_id?: string | null;
  is_finalist: boolean;
  declaration_status: 'not_declared' | 'finalist' | 'declared' | 'published' | 'revoked';
  announcement_date?: string | null;
  prize_fulfilment_status: 'pending' | 'in_progress' | 'fulfilled' | 'not_applicable';
  admin_notes?: string;
  declared_at?: string | null;
  declared_by?: string | null;
  contestant_name?: string;
  contestant_photo?: string;
  position_title?: string;
  position_rank?: number;
}

export interface EditionStatus {
  edition_id: string;
  winner_methodology: string;
  results_status: string;
}

export const WINNER_METHODOLOGIES = [
  { value: 'public_voting', label: 'Public voting' },
  { value: 'judges_evaluation', label: "Judges' evaluation" },
  { value: 'administrative_selection', label: 'Administrative selection' },
  { value: 'combined_voting_judges', label: 'Combined voting + judges' },
  { value: 'panel_evaluation', label: 'Panel evaluation' },
  { value: 'other', label: 'Other' },
] as const;

export const RESULTS_STATUSES = [
  { value: 'not_declared', label: 'Not Declared' },
  { value: 'finalists_announced', label: 'Finalists Announced' },
  { value: 'winners_declared', label: 'Winners Declared' },
  { value: 'results_published', label: 'Results Published' },
  { value: 'prize_fulfilment_in_progress', label: 'Prize Fulfilment in Progress' },
  { value: 'prizes_fulfilled', label: 'Prizes Fulfilled' },
] as const;

// The §1 suggested default ladder, offered as a one-click seed.
export const DEFAULT_POSITIONS = [
  { title: '1st Place — Overall Winner', rank: 1 },
  { title: '1st Runner-Up', rank: 2 },
  { title: '2nd Runner-Up', rank: 3 },
] as const;

// ── Reads ──

export const listPositions = (editionId: string) =>
  getJson<WinningPosition[]>(`/${editionId}/positions`);
export const listPrizes = (editionId: string) =>
  getJson<EditionPrize[]>(`/${editionId}/edition-prizes`);
export const listRulesVersions = (editionId: string) =>
  getJson<EditionRules[]>(`/${editionId}/rules-versions`);
export const listWinners = (editionId: string) =>
  getJson<EditionWinner[]>(`/${editionId}/winners-admin`);

// ── Mutations ──

export const createPosition = (editionId: string, body: { title: string; rank: number; display_order?: number; recipients_allowed?: number }) =>
  sendJson<WinningPosition>('POST', `/${editionId}/positions`, body);
export const deletePosition = (editionId: string, positionId: string) =>
  sendJson<{ ok: boolean }>('DELETE', `/${editionId}/positions/${positionId}`);

export const createPrize = (editionId: string, body: Partial<EditionPrize>) =>
  sendJson<EditionPrize>('POST', `/${editionId}/edition-prizes`, body);
export const deletePrize = (editionId: string, prizeId: string) =>
  sendJson<{ ok: boolean }>('DELETE', `/${editionId}/edition-prizes/${prizeId}`);

export const createRulesDraft = (editionId: string, body: { content: Record<string, unknown>; effective_date?: string | null }) =>
  sendJson<EditionRules>('POST', `/${editionId}/rules-versions`, body);
export const publishRules = (editionId: string, rulesId: string) =>
  sendJson<EditionRules>('POST', `/${editionId}/rules-versions/${rulesId}/publish`);

export const declareWinner = (editionId: string, body: Partial<EditionWinner>) =>
  sendJson<EditionWinner>('POST', `/${editionId}/winners`, body);
export const setResultsStatus = (editionId: string, body: { results_status?: string; winner_methodology?: string }) =>
  sendJson<EditionStatus>('POST', `/${editionId}/results-status`, body);
