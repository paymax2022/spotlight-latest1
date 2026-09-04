import { env } from '@/config/env';
import { operationKey } from './idempotency';
import type {
  VendorRow,
  VendorFilters,
  VendorApplication,
  VendorStatus,
  VendorPayoutRow,
  VendorPayoutFilters,
} from '@/types/vendorsAdmin';

// Vendor oversight admin service.
//
// The estate vendor endpoints are estate-object-scoped (see types note), so the
// directory/approval calls take an estateId per row. There is no cross-estate
// admin aggregate route; the live branches below call the per-estate endpoints
// under /api/finance/estate/:id/... and this service composes the aggregate.
// Mock by default (NEXT_PUBLIC_VENDORS_ADMIN_USE_MOCK=false to go live).
function financeApiBase(): string {
  // Vendor endpoints hang off the finance group: /api/finance/estate/...
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/finance');
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  if (!token) return {};
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

const USE_FIXTURES =
  (process.env.NEXT_PUBLIC_VENDORS_ADMIN_USE_MOCK ?? 'true').toLowerCase() !== 'false';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const vendorFixture: VendorRow[] = [
  {
    id: 'ev_001',
    estateId: 'est_lekki_gardens',
    estateName: 'Lekki Gardens Estate',
    name: 'Emeka Okafor',
    businessName: 'Okafor Plumbing Services',
    category: 'plumbing',
    phone: '+2348030000001',
    specialties: ['pipe repair', 'water heater'],
    status: 'verified',
    verified: true,
    rating: 4.6,
    paidJobs: 14,
    openJobs: 2,
    totalEarnedKobo: 1_820_000,
    createdAt: '2026-04-12T08:00:00Z',
  },
  {
    id: 'ev_002',
    estateId: 'est_lekki_gardens',
    estateName: 'Lekki Gardens Estate',
    name: 'Blessing Ada',
    businessName: 'BrightSpark Electricals',
    category: 'electrical',
    phone: '+2348030000002',
    specialties: ['wiring', 'inverter install'],
    status: 'verified',
    verified: true,
    rating: 4.9,
    paidJobs: 21,
    openJobs: 1,
    totalEarnedKobo: 3_140_000,
    createdAt: '2026-03-02T08:00:00Z',
  },
  {
    id: 'ev_003',
    estateId: 'est_maitama_heights',
    estateName: 'Maitama Heights',
    name: 'Yusuf Danladi',
    businessName: 'CleanCourt Facility Mgmt',
    category: 'cleaning',
    phone: '+2348030000003',
    specialties: ['deep clean', 'landscaping'],
    status: 'pending',
    verified: false,
    rating: 0,
    paidJobs: 0,
    openJobs: 0,
    totalEarnedKobo: 0,
    createdAt: '2026-07-06T08:00:00Z',
  },
  {
    id: 'ev_004',
    estateId: 'est_maitama_heights',
    estateName: 'Maitama Heights',
    name: 'Chidi Nwosu',
    businessName: 'Nwosu Security Systems',
    category: 'security',
    phone: '+2348030000004',
    specialties: ['CCTV', 'access control'],
    status: 'suspended',
    verified: false,
    rating: 3.1,
    paidJobs: 4,
    openJobs: 0,
    totalEarnedKobo: 520_000,
    createdAt: '2026-05-20T08:00:00Z',
  },
];

const applicationFixture: VendorApplication[] = [
  {
    id: 'ev_003',
    estateId: 'est_maitama_heights',
    estateName: 'Maitama Heights',
    applicantName: 'Yusuf Danladi',
    businessName: 'CleanCourt Facility Mgmt',
    category: 'cleaning',
    phone: '+2348030000003',
    specialties: ['deep clean', 'landscaping'],
    bankProvided: true,
    status: 'pending',
    submittedAt: '2026-07-06T08:00:00Z',
  },
  {
    id: 'ev_005',
    estateId: 'est_lekki_gardens',
    estateName: 'Lekki Gardens Estate',
    applicantName: 'Ifeoma Obi',
    businessName: 'GreenThumb Landscapes',
    category: 'landscaping',
    phone: '+2348030000005',
    specialties: ['garden design', 'irrigation'],
    bankProvided: false,
    status: 'pending',
    submittedAt: '2026-07-08T14:30:00Z',
  },
];

const payoutFixture: VendorPayoutRow[] = [
  {
    id: 'vj_1001',
    estateId: 'est_lekki_gardens',
    estateName: 'Lekki Gardens Estate',
    vendorId: 'ev_001',
    vendorName: 'Okafor Plumbing Services',
    title: 'Block C riser leak repair',
    status: 'paid',
    amountKobo: 145_000,
    quoteKobo: 145_000,
    payoutRef: 'estate_vendor_payout:est_lekki_gardens:vj_1001',
    completedAt: '2026-07-04T12:00:00Z',
    paidAt: '2026-07-04T13:10:00Z',
    createdAt: '2026-07-03T09:00:00Z',
  },
  {
    id: 'vj_1002',
    estateId: 'est_lekki_gardens',
    estateName: 'Lekki Gardens Estate',
    vendorId: 'ev_002',
    vendorName: 'BrightSpark Electricals',
    title: 'Estate gate inverter servicing',
    status: 'completed',
    amountKobo: 260_000,
    quoteKobo: 260_000,
    payoutRef: '',
    completedAt: '2026-07-08T16:00:00Z',
    paidAt: null,
    createdAt: '2026-07-07T10:00:00Z',
  },
  {
    id: 'vj_1003',
    estateId: 'est_maitama_heights',
    estateName: 'Maitama Heights',
    vendorId: 'ev_004',
    vendorName: 'Nwosu Security Systems',
    title: 'Perimeter CCTV fault (disputed quote)',
    status: 'in_progress',
    amountKobo: 400_000,
    quoteKobo: 400_000,
    payoutRef: '',
    completedAt: null,
    paidAt: null,
    createdAt: '2026-07-06T11:00:00Z',
  },
];

// ── Directory ─────────────────────────────────────────────────────────────────

// Aggregate of per-estate GET /estate/:id/vendors?status= . In live mode the
// caller would iterate the estates the admin manages; here fixtures stand in.
export async function listVendors(filters: VendorFilters = {}): Promise<VendorRow[]> {
  if (USE_FIXTURES) {
    return vendorFixture.filter((v) => {
      if (filters.status && v.status !== filters.status) return false;
      if (filters.category && v.category !== filters.category) return false;
      if (filters.estateId && v.estateId !== filters.estateId) return false;
      if (filters.q) {
        const q = filters.q.toLowerCase();
        if (
          !v.name.toLowerCase().includes(q) &&
          !v.businessName.toLowerCase().includes(q) &&
          !v.estateName.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }
  // Live: single estate scope required by the backend (estateId).
  if (!filters.estateId) {
    throw new Error('Live mode requires an estateId (estate-scoped vendor endpoint).');
  }
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  const qs = params.toString();
  const res = await fetch(
    `${financeApiBase()}/estate/${encodeURIComponent(filters.estateId)}/vendors${qs ? `?${qs}` : ''}`,
    { cache: 'no-store', headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`Vendor directory failed: ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return (data.data ?? data.vendors ?? []) as VendorRow[];
}

// ── Approval queue ─────────────────────────────────────────────────────────────

// Self-onboarded vendors awaiting verification (status=pending across estates).
export async function listVendorApplications(estateId?: string): Promise<VendorApplication[]> {
  if (USE_FIXTURES) {
    return applicationFixture.filter((a) => !estateId || a.estateId === estateId);
  }
  if (!estateId) throw new Error('Live mode requires an estateId.');
  const res = await fetch(
    `${financeApiBase()}/estate/${encodeURIComponent(estateId)}/vendors?status=pending`,
    { cache: 'no-store', headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`Vendor applications failed: ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return (data.data ?? data.vendors ?? []) as VendorApplication[];
}

// POST /estate/:id/vendors/:vendorId/verify {status}  — approve/suspend a vendor.
export async function setVendorStatus(
  estateId: string,
  vendorId: string,
  status: VendorStatus,
): Promise<{ status: VendorStatus }> {
  // Real, verified live endpoint (see the comment above) — fixture mode
  // refuses loudly instead of reporting a write it did not perform. See
  // docs/audit/ADMIN_SIMULATED_WRITES.md.
  if (USE_FIXTURES) {
    throw new Error(
      'Setting vendor status is unavailable in fixture mode: this console will not report a write it did not perform. ' +
      'Set NEXT_PUBLIC_VENDORS_ADMIN_USE_MOCK=false to make this change against the live backend.',
    );
  }
  const res = await fetch(
    `${financeApiBase()}/estate/${encodeURIComponent(estateId)}/vendors/${encodeURIComponent(vendorId)}/verify`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Idempotency-Key': operationKey('vendor:verify', estateId, vendorId) },
      body: JSON.stringify({ status }),
    },
  );
  if (!res.ok) throw new Error(`Vendor verify failed: ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return { status: (data.status ?? status) as VendorStatus };
}

// ── Payouts / disputes (read-only) ─────────────────────────────────────────────

// Read-only oversight of vendor jobs in the payout lifecycle. There is no admin
// aggregate endpoint and no vendor-dispute surface on the backend; disputed jobs
// are surfaced here by title/state convention only (read-only).
export async function listVendorPayouts(
  filters: VendorPayoutFilters = {},
): Promise<VendorPayoutRow[]> {
  if (USE_FIXTURES) {
    return payoutFixture.filter((p) => {
      if (filters.status && p.status !== filters.status) return false;
      if (filters.estateId && p.estateId !== filters.estateId) return false;
      return true;
    });
  }
  if (!filters.estateId) throw new Error('Live mode requires an estateId.');
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  const qs = params.toString();
  const res = await fetch(
    `${financeApiBase()}/estate/${encodeURIComponent(filters.estateId)}/vendor/jobs${qs ? `?${qs}` : ''}`,
    { cache: 'no-store', headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`Vendor payouts failed: ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return (data.data ?? data.jobs ?? []) as VendorPayoutRow[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function formatKobo(kobo: number): string {
  const naira = kobo / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ageFromNow(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '—';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
