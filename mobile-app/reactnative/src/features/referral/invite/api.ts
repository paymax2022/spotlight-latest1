// ── Referral Invite & Share API ──────────────────────────────────────────────
// Mock-first (USE_MOCK). Live path hits `${REFERRAL_API_BASE}/...`. Invite copy
// is compliant: it points at real product use, never income/recruitment.

import { api } from '@/api/client';
import { USE_MOCK } from '../constants/referral.constants';
import type {
  SharePayload,
  InviteContact,
  VanityLink,
  VanityLinkInput,
  ContextualPrompt,
  ShareContext,
  ShareChannel,
  FunnelStage,
  TrackedInvitee,
  NudgeResult,
  ReferralVertical,
} from './types';

const delay = (ms = 240) => new Promise((r) => setTimeout(r, ms));

function unwrap<T>(res: { data?: { data?: T } & T }): T {
  return (res.data?.data ?? res.data) as T;
}

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const REFERRER_NAME = 'Chidi Nwosu';
const CODE = 'CHIDI-PAY';
const LINK = 'https://spotlight.ng/join?ref=CHIDI-PAY';

// ── Live helpers ─────────────────────────────────────────────────────────────
// The caller's real code comes from the Direct Rewards engine (already live):
//   GET /api/v1/referrals/me/dashboard → { code, ... }
// The invite copy is built client-side from that code (compliant, no income
// promises). The /api/v1/referral/invite/* surface has no backend yet.
const REWARDS_BASE = '/api/v1/referrals';

async function fetchLiveCode(): Promise<string> {
  const res = await api.get(`${REWARDS_BASE}/me/dashboard`);
  const body = unwrap<{ code?: string }>(res);
  return body.code ?? '';
}

function buildLink(code: string): string {
  return code ? `https://spotlight.ng/j/${code}` : 'https://spotlight.ng';
}

function inviteMessage(code: string, link: string): string {
  return (
    `Join me on Spotlight/Paymax. Use my code ${code} or this link: ${link}. ` +
    `Heads up — we both earn only when you actually use Paymax (verify your ID and make a real transaction). No payment to "sign up".`
  );
}

// ── Mock fixtures ─────────────────────────────────────────────────────────────
const MOCK_SHARE: SharePayload = {
  code: CODE,
  link: LINK,
  shortLink: 'https://spot.ng/r/chidi',
  referrerName: REFERRER_NAME,
  message:
    `Join me on Spotlight/Paymax. Use my code ${CODE} or this link: ${LINK}. ` +
    `Heads up — we both earn only when you actually use Paymax (verify your ID and make a real transaction). No payment to "sign up".`,
};

const MOCK_CONTACTS: InviteContact[] = [
  { id: 'c1', name: 'Amara Eze', phoneMasked: '+234 80• ••• •412', alreadyJoined: false },
  { id: 'c2', name: 'Tunde Bakare', phoneMasked: '+234 70• ••• •908', alreadyJoined: false },
  { id: 'c3', name: 'Bola Adeyemi', phoneMasked: '+234 81• ••• •233', alreadyJoined: true },
  { id: 'c4', name: 'Ngozi Okoro', phoneMasked: '+234 90• ••• •771', alreadyJoined: false },
  { id: 'c5', name: 'Emeka Obi', phoneMasked: '+234 80• ••• •550', alreadyJoined: false },
  { id: 'c6', name: 'Fatima Sule', phoneMasked: '+234 70• ••• •019', alreadyJoined: false },
];

const MOCK_VANITY: VanityLink[] = [
  { id: 'v1', alias: 'chidi-lagos', url: 'https://spot.ng/r/chidi-lagos', source: 'instagram', campaign: 'summer', clicks: 84, signups: 9, createdAt: minsAgo(20000) },
  { id: 'v2', alias: 'chidi-bills', url: 'https://spot.ng/r/chidi-bills', source: 'whatsapp', campaign: null, clicks: 31, signups: 4, createdAt: minsAgo(8000) },
];

const MOCK_CONTEXTUAL: Record<ShareContext, ContextualPrompt> = {
  paid_bill: {
    context: 'paid_bill',
    title: 'Bill paid — invite a friend?',
    body: 'You just paid a bill in seconds. Friends earn rewards only after they verify and transact for real.',
    message: `I just paid a bill on Paymax in seconds. Try it with my code ${CODE}: ${LINK} — we both earn only when you actually use it.`,
  },
  won_contest: {
    context: 'won_contest',
    title: 'You won — share the moment',
    body: 'Tell friends how you won. Rewards come from their genuine activity, not from signing up.',
    message: `I just won on Spotlight! Join with my code ${CODE}: ${LINK}. We both earn when you really use Paymax.`,
  },
  listed_property: {
    context: 'listed_property',
    title: 'Property listed — refer landlords',
    body: 'Invite people who would genuinely list or rent. Rewards follow real, verified activity.',
    message: `I list properties on Spotlight. Join with my code ${CODE}: ${LINK} — rewards only on real activity.`,
  },
  sent_money: {
    context: 'sent_money',
    title: 'Transfer sent — spread the word',
    body: 'Friends earn only after they verify and make genuine transactions.',
    message: `Sending money on Paymax is easy. Use my code ${CODE}: ${LINK}. We both earn on real use, not signups.`,
  },
  first_savings: {
    context: 'first_savings',
    title: 'Saved with Paymax — invite a friend',
    body: 'Invite people who will genuinely save. Earnings depend on their real activity.',
    message: `I started saving on Paymax. Join with my code ${CODE}: ${LINK} — earnings tie to real activity only.`,
  },
};

const MOCK_TRACKED: TrackedInvitee[] = [
  { id: 't1', name: 'Amara Eze', channel: 'whatsapp', stage: 'activated', invitedAt: minsAgo(20000), lastActivityAt: minsAgo(12), earnedKobo: 100_000, nudgeable: false },
  { id: 't2', name: 'Tunde Bakare', channel: 'sms', stage: 'signed_up', invitedAt: minsAgo(14000), lastActivityAt: minsAgo(140), earnedKobo: 0, nudgeable: true },
  { id: 't3', name: 'Bola Adeyemi', channel: 'social', stage: 'kyc', invitedAt: minsAgo(9000), lastActivityAt: minsAgo(1500), earnedKobo: 50_000, nudgeable: true },
  { id: 't4', name: 'Ngozi Okoro', channel: 'whatsapp', stage: 'clicked', invitedAt: minsAgo(7000), lastActivityAt: minsAgo(5400), earnedKobo: 0, nudgeable: true },
  { id: 't5', name: 'Emeka Obi', channel: 'copy', stage: 'invited', invitedAt: minsAgo(3000), lastActivityAt: minsAgo(3000), earnedKobo: 0, nudgeable: false },
];

const MOCK_VERTICALS: ReferralVertical[] = [
  { id: 'property', label: 'Property', icon: 'House', blurb: 'Refer landlords and renters.', message: `List or rent property on Spotlight — join with ${CODE}: ${LINK}` },
  { id: 'bills', label: 'Bills', icon: 'Zap', blurb: 'Airtime, data, power, TV.', message: `Pay bills fast on Paymax — join with ${CODE}: ${LINK}` },
  { id: 'savings', label: 'Savings', icon: 'PiggyBank', blurb: 'Goals and group savings.', message: `Save smarter on Paymax — join with ${CODE}: ${LINK}` },
  { id: 'miniapps', label: 'Mini-apps', icon: 'Grid3x3', blurb: 'Transport, telemedicine, more.', message: `Explore Paymax mini-apps — join with ${CODE}: ${LINK}` },
];

// ── Calls ─────────────────────────────────────────────────────────────────────
export async function getSharePayload(): Promise<SharePayload> {
  if (USE_MOCK) {
    await delay(200);
    return { ...MOCK_SHARE };
  }
  // Live: build the share payload from the caller's real referral code.
  const code = await fetchLiveCode();
  const link = buildLink(code);
  return {
    code,
    link,
    shortLink: link, // TODO(referral phase3): no short-link service yet.
    referrerName: '', // TODO(referral phase3): backend exposes no display name here.
    message: inviteMessage(code, link),
  };
}

export async function getContacts(): Promise<InviteContact[]> {
  if (USE_MOCK) {
    await delay(320);
    return MOCK_CONTACTS.map((c) => ({ ...c }));
  }
  // TODO(referral phase3): no backend contact-matching endpoint. Device contacts
  // are read client-side (native contact picker) — return empty here.
  return [];
}

export async function inviteContacts(ids: string[]): Promise<{ ok: true; invited: number }> {
  if (USE_MOCK) {
    await delay(360);
    return { ok: true, invited: ids.length };
  }
  // TODO(referral phase3): no backend invite-send endpoint. Invites go out via the
  // native share sheet client-side; treat as a no-op success.
  return { ok: true, invited: ids.length };
}

export async function getVanityLinks(): Promise<VanityLink[]> {
  if (USE_MOCK) {
    await delay(260);
    return MOCK_VANITY.map((v) => ({ ...v }));
  }
  // TODO(referral phase3): no backend vanity-link/UTM service yet.
  return [];
}

export async function createVanityLink(input: VanityLinkInput): Promise<VanityLink> {
  if (USE_MOCK) {
    await delay(340);
    const alias = input.alias.trim().toLowerCase().replace(/\s+/g, '-');
    return {
      id: `v${Math.floor(Math.random() * 9000 + 1000)}`,
      alias,
      url: `https://spot.ng/r/${alias}`,
      source: input.source ?? null,
      campaign: input.campaign ?? null,
      clicks: 0,
      signups: 0,
      createdAt: new Date().toISOString(),
    };
  }
  // TODO(referral phase3): no backend vanity-link service — do not fabricate a
  // persisted alias that would not survive a refresh.
  throw new Error('Custom invite links are not available yet.');
}

export async function getContextualPrompt(context: ShareContext): Promise<ContextualPrompt> {
  if (USE_MOCK) {
    await delay(180);
    return { ...MOCK_CONTEXTUAL[context] };
  }
  // Live: reuse the compliant per-context copy, interpolating the real code/link.
  const code = await fetchLiveCode();
  const link = buildLink(code);
  const meta = MOCK_CONTEXTUAL[context];
  return {
    context,
    title: meta.title,
    body: meta.body,
    message: meta.message.split(CODE).join(code).split(LINK).join(link),
  };
}

export async function getTrackedInvitees(): Promise<TrackedInvitee[]> {
  if (USE_MOCK) {
    await delay(300);
    return MOCK_TRACKED.map((t) => ({ ...t }));
  }
  // Live: derive from the Direct Rewards engine's referred-users list.
  const res = await api.get(`${REWARDS_BASE}/me/referrals`, { params: { limit: 100 } });
  const body = unwrap<{
    referrals?: Array<{
      referred_user_id: string;
      masked_contact: string;
      joined_at: string;
      active: boolean;
      lifetime_earned_kobo: number;
    }>;
  }>(res);
  return (body.referrals ?? []).map((r) => ({
    id: r.referred_user_id,
    name: r.masked_contact,
    // TODO(referral phase3): backend does not record invite channel / last-activity.
    channel: 'copy' as ShareChannel,
    stage: (r.active ? 'activated' : 'signed_up') as FunnelStage,
    invitedAt: r.joined_at,
    lastActivityAt: r.joined_at,
    earnedKobo: Math.trunc(r.lifetime_earned_kobo ?? 0),
    nudgeable: !r.active,
  }));
}

export async function nudgeInvitee(_id: string): Promise<NudgeResult> {
  if (USE_MOCK) {
    await delay(280);
    const target = MOCK_TRACKED.find((t) => t.id === _id);
    if (!target) return { ok: false, error: 'rate_limited' };
    if (target.stage === 'activated') return { ok: false, error: 'already_activated' };
    if (!target.nudgeable) return { ok: false, error: 'opted_out' };
    return { ok: true };
  }
  // TODO(referral phase3): no backend nudge endpoint. A nudge is a client-side
  // re-share via the native share sheet — treat as best-effort success.
  return { ok: true };
}

export async function getVerticals(): Promise<ReferralVertical[]> {
  if (USE_MOCK) {
    await delay(200);
    return MOCK_VERTICALS.map((v) => ({ ...v }));
  }
  // Live: static compliant per-vertical copy with the caller's real code/link.
  const code = await fetchLiveCode();
  const link = buildLink(code);
  return MOCK_VERTICALS.map((v) => ({
    ...v,
    message: v.message.split(CODE).join(code).split(LINK).join(link),
  }));
}
