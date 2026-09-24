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
  ElectionSummary,
  ElectionDetail,
  ElectionStatus,
  VoteReceipt,
  CardVerification,
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

// Every write below has a real live endpoint (verified against
// backend/internal/association/routes.go and a full green run of
// backend/tests/association), so fixture mode has nothing to add and refuses
// loudly instead of reporting a write it did not perform — mirrors
// frontend-admin's crowdfundingAdminService.ts NOT_IN_FIXTURE_MODE pattern.
const notInFixtureMode = (action: string) =>
  new Error(`${action} is unavailable in fixture mode: this app will not report a write it did not perform. Set EXPO_PUBLIC_ASSOCIATION_USE_MOCK=false to send this against the live backend.`);

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
  if (USE_MOCK) throw notInFixtureMode('Submitting a membership application');
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

/**
 * Verify a scanned membership-card QR token. Authenticity + live standing are
 * decided server-side; an invalid/forged/expired/arrears card returns
 * `{ valid:false, reason }` rather than throwing. In mock mode the holder's own
 * card token verifies valid; anything else is INVALID_SIGNATURE.
 */
export async function verifyMembershipCard(token: string): Promise<CardVerification> {
  if (USE_MOCK) {
    await delay();
    const t = (token || '').trim();
    if (t && t === MOCK_MEMBER_CARD.qrPayload) {
      const overdue = MOCK_MEMBER_CARD.paymentStanding === 'OVERDUE';
      const inactive = MOCK_MEMBER_CARD.status !== 'ACTIVE';
      return {
        valid: !overdue && !inactive,
        reason: inactive ? 'REVOKED' : overdue ? 'ARREARS' : undefined,
        memberId: MOCK_MEMBER_CARD.memberId,
        fullName: MOCK_MEMBER_CARD.fullName,
        organisationName: MOCK_MEMBER_CARD.organisationName,
        organisationAcronym: MOCK_MEMBER_CARD.organisationAcronym,
        categoryLabel: MOCK_MEMBER_CARD.categoryLabel,
        status: MOCK_MEMBER_CARD.status,
        paymentStanding: MOCK_MEMBER_CARD.paymentStanding,
        validThrough: MOCK_MEMBER_CARD.validThrough,
        verifiedAt: new Date().toISOString(),
      };
    }
    return { valid: false, reason: 'INVALID_SIGNATURE', verifiedAt: new Date().toISOString() };
  }
  const { data } = await api.post(`${BASE}/cards/verify`, { token });
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
  if (USE_MOCK) throw notInFixtureMode('Paying a dues invoice');
  // Money mutation → idempotency key required (IRON RULE).
  const { data } = await api.post(
    `${BASE}/dues/${invoiceId}/pay`,
    { method },
    { headers: { 'Idempotency-Key': generateIdempotencyKey() } },
  );
  return data;
}

// ─── Elections (TS-13) ────────────────────────────────────────────────────────
// Wired to /associations/elections. In mock mode a single VOTING election is
// served with a small in-memory ballot state so the vote flow is demoable.

const MOCK_ELECTION: ElectionDetail = {
  id: 'elec_mock_1',
  title: '2026 National Executive Election',
  description: 'Elect your incoming national executive council. One vote per position — your ballot is secret.',
  status: 'VOTING' as ElectionStatus,
  votingOpensAt: '2026-07-01T09:00:00Z',
  votingClosesAt: '2026-08-30T17:00:00Z',
  eligible: true,
  sealedResults: true,
  positions: [
    {
      id: 'pos_pres', title: 'President', seats: 1, hasVoted: false,
      candidates: [
        { id: 'c_pres_a', name: 'Dr. Amaka Obi', manifesto: 'Transparency in dues, quarterly town halls, and a members’ welfare fund.', status: 'APPROVED' },
        { id: 'c_pres_b', name: 'Engr. Tunde Bello', manifesto: 'Digitise the register, expand CPD, and negotiate group insurance for members.', status: 'APPROVED' },
      ],
    },
    {
      id: 'pos_sec', title: 'Secretary', seats: 1, hasVoted: false,
      candidates: [
        { id: 'c_sec_a', name: 'Barr. Ngozi Eze', manifesto: 'Minutes circulated within 48 hours and an open official-records portal.', status: 'APPROVED' },
        { id: 'c_sec_b', name: 'Mr. Kofi Mensah', manifesto: 'Streamlined committees and a shared, versioned document library.', status: 'APPROVED' },
      ],
    },
  ],
};

// positionId -> { hasVoted, receipt } (mock ballot state).
const mockBallots: Record<string, { receipt: string }> = {};

export async function getElections(): Promise<ElectionSummary[]> {
  if (USE_MOCK) {
    await delay();
    return [{
      id: MOCK_ELECTION.id, title: MOCK_ELECTION.title, status: MOCK_ELECTION.status,
      votingOpensAt: MOCK_ELECTION.votingOpensAt, votingClosesAt: MOCK_ELECTION.votingClosesAt,
      positionCount: MOCK_ELECTION.positions.length,
    }];
  }
  const { data } = await api.get(`${BASE}/elections`);
  return data;
}

export async function getElection(id: string): Promise<ElectionDetail> {
  if (USE_MOCK) {
    await delay();
    return {
      ...MOCK_ELECTION,
      positions: MOCK_ELECTION.positions.map((p) => ({ ...p, hasVoted: Boolean(mockBallots[p.id]) })),
    };
  }
  const { data } = await api.get(`${BASE}/elections/${id}`);
  return data;
}

export async function castVote(electionId: string, positionId: string, candidateId: string): Promise<VoteReceipt> {
  // Election integrity: a vote must never be faked as cast — mock mode must
  // refuse loudly rather than fabricate a receipt for a ballot that was never
  // recorded server-side.
  if (USE_MOCK) throw notInFixtureMode('Casting a vote');
  const { data } = await api.post(
    `${BASE}/elections/${electionId}/vote`,
    { positionId, candidateId },
    { headers: { 'Idempotency-Key': generateIdempotencyKey() } },
  );
  return data;
}

