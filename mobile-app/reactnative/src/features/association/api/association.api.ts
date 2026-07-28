// ── Association — API wrapper ─────────────────────────────────────────────────
// Typed data layer the screens code against. Mirrors voting.api.ts /
// crowdfunding.api.ts: mock-flagged, flip USE_MOCK (constants) to false once the
// real /associations endpoints land.
// IRON RULE: all monetary amounts are integers in minor units (kobo).

import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  Organisation,
  OrganisationSummary,
  ApplicationResult,
  JoinDraft,
  MemberDashboard,
  MembershipCard,
  MemberProfile,
  MemberProfileSummary,
  MemberDirectoryQuery,
  DuesSummary,
  PaymentReceipt,
  PayInvoiceResult,
} from '../types/association.types';
import { USE_MOCK, ASSOCIATION_API_BASE as BASE } from '../constants/association.constants';
import {
  MOCK_ORGANISATIONS,
  MOCK_DASHBOARD,
  MOCK_MEMBER_CARD,
  MOCK_MEMBERS,
  MOCK_DUES,
  buildReceipt,
  toSummary,
} from './association.mock';
import { getCreatedOrganisation, listCreatedOrganisations } from './association.createdStore';

/** Simulated network latency so loading states render in mock mode. */
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));

// ─── Organisation discovery ───────────────────────────────────────────────────

export async function getOrganisations(search?: string): Promise<OrganisationSummary[]> {
  if (USE_MOCK) {
    await delay();
    // Session-created orgs first, then the seeded mock set.
    const list = [...listCreatedOrganisations(), ...MOCK_ORGANISATIONS].map(toSummary);
    if (!search?.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter(
      (o) => o.name.toLowerCase().includes(q) || (o.acronym ?? '').toLowerCase().includes(q) || o.category.toLowerCase().includes(q),
    );
  }
  const { data } = await api.get(`${BASE}`, { params: { search } });
  return data;
}

export async function getOrganisation(id: string): Promise<Organisation> {
  if (USE_MOCK) {
    await delay();
    // Prefer an org created this session, then fall back to the seeded set.
    const found = getCreatedOrganisation(id) ?? MOCK_ORGANISATIONS.find((o) => o.id === id);
    if (!found) throw new Error('Organisation not found');
    return found;
  }
  // Served at /orgs/:id (not bare /:id) — gin can't route a root path param
  // alongside the many static siblings (/me, /members, /meetings, …).
  const { data } = await api.get(`${BASE}/orgs/${id}`);
  return data;
}

// ─── Join / application flow ──────────────────────────────────────────────────

export async function submitApplication(draft: JoinDraft): Promise<ApplicationResult> {
  if (USE_MOCK) {
    await delay(500);
    const org = MOCK_ORGANISATIONS.find((o) => o.id === draft.organisationId);
    const type = org?.groupType ?? 'CLOSED';
    const status =
      type === 'OPEN' ? 'APPROVED'
      : type === 'PAID' ? 'PENDING_PAYMENT'
      : 'PENDING_CHAPTER';
    return {
      applicationId: `app_${Date.now()}`,
      status,
      organisationName: org?.name ?? 'the organisation',
      submittedAt: new Date().toISOString(),
      message:
        status === 'APPROVED'
          ? 'You are now a member. Welcome aboard!'
          : status === 'PENDING_PAYMENT'
          ? 'Almost there — complete your registration payment to activate membership.'
          : 'Your application has been sent to your state chapter admin for review.',
      nextStep:
        status === 'APPROVED' ? null
        : status === 'PENDING_PAYMENT' ? 'Pay registration fee'
        : 'Awaiting chapter approval',
    };
  }
  // Served at /apply (not /members/apply) — /members is a static collection
  // route with a /:id param sibling, which conflicts with /members/apply in gin.
  const { data } = await api.post(`${BASE}/apply`, draft, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return data;
}

// ─── Member dashboard & identity ──────────────────────────────────────────────

export async function getDashboard(): Promise<MemberDashboard> {
  if (USE_MOCK) { await delay(); return MOCK_DASHBOARD; }
  const { data } = await api.get(`${BASE}/me/dashboard`);
  return data;
}

export async function getMembershipCard(): Promise<MembershipCard> {
  if (USE_MOCK) { await delay(); return MOCK_MEMBER_CARD; }
  const { data } = await api.get(`${BASE}/me/card`);
  return data;
}

// ─── Member directory ─────────────────────────────────────────────────────────

export async function getDirectory(query?: MemberDirectoryQuery): Promise<MemberProfileSummary[]> {
  if (USE_MOCK) {
    await delay();
    let list = MOCK_MEMBERS as MemberProfileSummary[];
    if (query?.search?.trim()) {
      const q = query.search.trim().toLowerCase();
      list = list.filter((m) => m.fullName.toLowerCase().includes(q) || m.memberId.toLowerCase().includes(q));
    }
    if (query?.status) list = list.filter((m) => m.status === query.status);
    return list;
  }
  const { data } = await api.get(`${BASE}/members`, { params: query });
  return data;
}

export async function getMember(id: string): Promise<MemberProfile> {
  if (USE_MOCK) {
    await delay();
    const found = MOCK_MEMBERS.find((m) => m.id === id);
    if (!found) throw new Error('Member not found');
    return found;
  }
  const { data } = await api.get(`${BASE}/members/${id}`);
  return data;
}

// ─── Dues & payments ──────────────────────────────────────────────────────────

export async function getDues(): Promise<DuesSummary> {
  if (USE_MOCK) { await delay(); return MOCK_DUES; }
  const { data } = await api.get(`${BASE}/me/dues`);
  return data;
}

export async function getReceipt(receiptId: string): Promise<PaymentReceipt> {
  if (USE_MOCK) {
    await delay();
    // receiptId is rcpt_<invoiceId> in mock mode
    const invoiceId = receiptId.replace('rcpt_', '');
    return buildReceipt(invoiceId, 'WALLET');
  }
  const { data } = await api.get(`${BASE}/receipts/${receiptId}`);
  return data;
}

export async function payInvoice(
  invoiceId: string,
  method: 'WALLET' | 'PAYSTACK',
): Promise<PayInvoiceResult> {
  if (USE_MOCK) {
    await delay(600);
    return { receiptId: `rcpt_${invoiceId}`, status: 'SUCCESS' };
  }
  // Money mutation → idempotency key required (IRON RULE).
  const { data } = await api.post(
    `${BASE}/dues/${invoiceId}/pay`,
    { method },
    { headers: { 'Idempotency-Key': generateIdempotencyKey() } },
  );
  return data;
}
