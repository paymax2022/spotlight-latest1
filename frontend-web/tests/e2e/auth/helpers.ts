/**
 * Shared helpers for the AUTH-module E2E validation specs.
 *
 * - Mailpit/Inbucket polling for OTP codes and recovery links.
 * - provisionVerifiedUser: register a throwaway account through the real BFF
 *   and confirm its email straight in Postgres (fixture setup only — the
 *   register.spec journey proves the real verify path; other specs just need a
 *   verified account that is NOT one of the shared fixtures).
 * - psql: read/assert platform state via the supabase_db container (no local
 *   psql binary on this machine).
 *
 * Fixture users are NEVER registered/reset/locked by these helpers — every
 * account touched here is one this run created itself.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { APIRequestContext } from '@playwright/test';

export const GO_BACKEND_URL = process.env.E2E_GO_BACKEND_URL || 'http://localhost:8080';
export const ADMIN_WEB_URL = process.env.E2E_ADMIN_WEB_URL || 'http://localhost:3001';
const MAILPIT_URL = process.env.E2E_MAILPIT_URL || 'http://localhost:54324';

function readEnvFileValue(key: string, file: string): string {
  try {
    const line = readFileSync(file, 'utf8')
      .split('\n')
      .find((l) => l.startsWith(`${key}=`));
    return line?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '') ?? '';
  } catch {
    return '';
  }
}

// The admin console's two-gate chain: RequireAdmin (x-admin-api-key header) then
// RequireAdminConsoleRole (verified bearer + RBAC role). Probes that want to
// reach the role gate must send the key, exactly like the admin-proxy does.
export const ADMIN_API_KEY =
  process.env.E2E_ADMIN_API_KEY ||
  readEnvFileValue('ADMIN_API_KEY', resolve(__dirname, '../../../../backend/.env')) ||
  readEnvFileValue('ADMIN_API_KEY', resolve(__dirname, '../../../../frontend-admin/.env.local'));

export function uniqueEmail(tag = 'e2e'): string {
  return `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@paymax.test`;
}

// ── Mailpit (Inbucket exposes the Mailpit-compatible /api/v1/* surface) ───────

export interface CapturedMessage {
  id: string;
  subject: string;
  text: string;
  html: string;
}

interface MailpitSearchHit {
  ID: string;
  Subject?: string;
  To?: Array<{ Address?: string }>;
}

async function listCandidateIds(
  request: APIRequestContext,
  email: string,
): Promise<MailpitSearchHit[]> {
  // Mailpit search syntax. Inbucket's compat layer honours to:<addr>.
  const search = await request.get(
    `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=10`,
  );
  if (search.ok()) {
    const body = (await search.json()) as { messages?: MailpitSearchHit[] };
    if (body.messages?.length) return body.messages;
  }
  // Fallback: list latest messages and filter client-side. Covers the case
  // where the search query grammar differs between Mailpit and Inbucket.
  const list = await request.get(`${MAILPIT_URL}/api/v1/messages?limit=50`);
  if (!list.ok()) return [];
  const body = (await list.json()) as { messages?: MailpitSearchHit[] };
  const wanted = email.toLowerCase();
  return (body.messages ?? []).filter((m) =>
    (m.To ?? []).some((t) => (t.Address ?? '').toLowerCase().includes(wanted)),
  );
}

export async function fetchMessage(
  request: APIRequestContext,
  id: string,
): Promise<CapturedMessage | null> {
  const res = await request.get(`${MAILPIT_URL}/api/v1/message/${id}`);
  if (!res.ok()) return null;
  const body = (await res.json()) as { Subject?: string; Text?: string; HTML?: string };
  return { id, subject: body.Subject ?? '', text: body.Text ?? '', html: body.HTML ?? '' };
}

/**
 * Poll Mailpit until a message addressed to `email` (optionally with a subject
 * match) shows up. Returns null on timeout — callers decide pass/fail.
 */
export async function waitForEmail(
  request: APIRequestContext,
  email: string,
  opts: { timeoutMs?: number; subjectIncludes?: RegExp } = {},
): Promise<CapturedMessage | null> {
  const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
  while (Date.now() < deadline) {
    try {
      const hits = await listCandidateIds(request, email);
      // Mailpit returns newest first — walk them in that order.
      for (const hit of hits) {
        if (opts.subjectIncludes && !(opts.subjectIncludes.test(hit.Subject ?? ''))) continue;
        const msg = await fetchMessage(request, hit.ID);
        if (msg) return msg;
      }
    } catch {
      // Mailpit hiccup — keep polling until the deadline.
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
  return null;
}

export function extractOtpCode(msg: CapturedMessage, length = 6): string | null {
  const haystack = `${msg.text}\n${msg.html}`;
  const match = haystack.match(new RegExp(`\\b(\\d{${length}})\\b`));
  return match?.[1] ?? null;
}

/** Pull the GoTrue /auth/v1/verify link out of a recovery/confirmation email. */
export function extractVerifyLink(msg: CapturedMessage): string | null {
  const haystack = `${msg.text}\n${msg.html}`;
  const match = haystack.match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/);
  if (!match) return null;
  return match[0].replace(/&amp;/g, '&');
}

// ── Postgres via the supabase_db container (no local psql on this machine) ────

export function psql(sql: string): string {
  return execSync(
    `docker exec supabase_db_spotlight psql -U postgres -d postgres -tAc ${JSON.stringify(sql)}`,
    { encoding: 'utf8' },
  ).trim();
}

export interface ProvisionedUser {
  email: string;
  password: string;
  userId: string;
}

/**
 * Register + verify a throwaway account. Registration goes through the real
 * BFF (/api/auth/register → Go → GoTrue). Confirmation is fixture setup, so it
 * is applied directly in Postgres (auth.users.email_confirmed_at +
 * platform_users.email_verified_at) rather than driving the Mailpit flow a
 * second time — register.spec.ts already proves the real verify path.
 */
export async function provisionVerifiedUser(
  request: APIRequestContext,
  tag = 'e2e',
  password = 'E2eLocalPass123!',
): Promise<ProvisionedUser> {
  const email = uniqueEmail(tag);
  const res = await request.post('/api/auth/register', {
    data: { fullName: 'E2E Auth User', email, password },
  });
  const body = (await res.json().catch(() => null)) as { user?: { id?: string } } | null;
  if (!res.ok() || !body?.user?.id) {
    throw new Error(`provisioning register failed (${res.status()}): ${JSON.stringify(body)}`);
  }
  const userId = body.user.id;
  psql(
    `update auth.users set email_confirmed_at = now() where id = '${userId}';` +
      `update public.platform_users set email_verified_at = now() where id = '${userId}';`,
  );
  return { email, password, userId };
}
