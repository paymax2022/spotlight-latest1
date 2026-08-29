// ── Crowdfunding — Identity verification status ──────────────────────────────
// Crowdfunding has no bespoke KYC of its own: creators go through the platform's
// shared identity verification (finance/kyc), the same one every other vertical
// uses. This talks to /api/finance/kyc/me directly rather than through
// src/api/kyc.api.ts, whose getKycProfile()/initiateKyc() point at /api/v1/kyc/*
// — routes the backend doesn't register (only /api/v1/kyc/status|limits|tier1-3
// exist there; /me and /initiate live under /api/finance/kyc). That mismatch is
// a separate, pre-existing bug affecting other modules too (arena, marketplace,
// referral, fractionalre, property, PaymentSheet) — out of scope here; flagged
// separately. This file calls the correct, verified-working path directly.

import { api } from '@/api/client';

export type KycStatus = 'unverified' | 'pending' | 'verified' | 'failed' | 'suspended' | string;

export interface KycProfile {
  tier: number;
  requestedTier: number | null;
  status: KycStatus;
  phoneVerified: boolean;
  submittedAt: string | null;
  verifiedAt: string | null;
  documentType: string | null;
}

function mapProfile(data: Record<string, unknown>): KycProfile {
  return {
    tier:          Number(data.kyc_tier ?? 0),
    requestedTier: data.requested_tier != null ? Number(data.requested_tier) : null,
    status:        String(data.kyc_status ?? 'unverified') as KycStatus,
    phoneVerified: Boolean(data.phone_verified ?? false),
    submittedAt:   data.kyc_submitted_at != null ? String(data.kyc_submitted_at) : null,
    verifiedAt:    data.kyc_verified_at != null ? String(data.kyc_verified_at) : null,
    documentType:  data.document_type != null ? String(data.document_type) : null,
  };
}

/** GET /api/finance/kyc/me — current tier and status for the authenticated user. */
export async function getKycProfile(): Promise<KycProfile> {
  const res = await api.get('/api/finance/kyc/me');
  return mapProfile((res.data ?? {}) as Record<string, unknown>);
}
