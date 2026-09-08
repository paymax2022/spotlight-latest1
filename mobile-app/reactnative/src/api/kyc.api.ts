import { api } from '@/api/client';

export type KycStatus = 'unverified' | 'pending' | 'verified' | 'rejected' | string;
export type KycDocumentType = 'BVN' | 'NIN' | 'PASSPORT' | 'DRIVERS_LICENSE';

export interface KycProfile {
  tier: number;
  requestedTier: number | null;
  status: KycStatus;
  phoneVerified: boolean;
  submittedAt: string | null;
  verifiedAt: string | null;
}

function mapProfile(data: Record<string, unknown>): KycProfile {
  return {
    tier:          Number(data.kyc_tier ?? 0),
    requestedTier: data.requested_tier != null ? Number(data.requested_tier) : null,
    status:        String(data.kyc_status ?? 'unverified') as KycStatus,
    phoneVerified: Boolean(data.phone_verified ?? false),
    submittedAt:   data.kyc_submitted_at != null ? String(data.kyc_submitted_at) : null,
    verifiedAt:    data.kyc_verified_at != null ? String(data.kyc_verified_at) : null,
  };
}

/** GET /api/finance/kyc/me — current tier and status for the authenticated user. */
export async function getKycProfile(): Promise<KycProfile> {
  const res  = await api.get('/api/finance/kyc/me');
  const data = (res.data?.data ?? res.data) as Record<string, unknown>;
  return mapProfile(data);
}

/** POST /api/finance/kyc/initiate — submit a document to begin verification. */
export async function initiateKyc(payload: {
  documentType: KycDocumentType;
  documentNumber: string;
  requestedTier?: number;
}): Promise<{ status: KycStatus; requestedTier: number | null; submittedAt: string | null }> {
  const res  = await api.post('/api/finance/kyc/initiate', {
    requested_tier: payload.requestedTier ?? 1,
    document_type:  payload.documentType,
    document_ref:   payload.documentNumber,
    bvn:            payload.documentType === 'BVN' ? payload.documentNumber : undefined,
    nin:            payload.documentType === 'NIN' ? payload.documentNumber : undefined,
  });
  const data = (res.data?.data ?? res.data) as Record<string, unknown>;
  return {
    status:        String(data.kyc_status ?? 'pending') as KycStatus,
    requestedTier: data.requested_tier != null ? Number(data.requested_tier) : null,
    submittedAt:   data.kyc_submitted_at != null ? String(data.kyc_submitted_at) : null,
  };
}
