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
    requestedTier: data.kyc_requested_tier != null ? Number(data.kyc_requested_tier) : null,
    status:        String(data.kyc_status ?? 'unverified') as KycStatus,
    phoneVerified: Boolean(data.phone_verified ?? false),
    submittedAt:   data.submitted_at != null ? String(data.submitted_at) : null,
    verifiedAt:    data.verified_at != null ? String(data.verified_at) : null,
  };
}

/** GET /api/v1/kyc/me — current tier and status for the authenticated user. */
export async function getKycProfile(): Promise<KycProfile> {
  const res  = await api.get('/api/v1/kyc/me');
  const data = (res.data?.data ?? res.data) as Record<string, unknown>;
  return mapProfile(data);
}

/** POST /api/v1/kyc/initiate — submit a document to begin verification. */
export async function initiateKyc(payload: {
  documentType: KycDocumentType;
  documentNumber: string;
  phone?: string;
  requestedTier?: number;
}): Promise<{ status: KycStatus; requestedTier: number | null; submittedAt: string | null }> {
  const res  = await api.post('/api/v1/kyc/initiate', {
    document_type:   payload.documentType,
    document_number: payload.documentNumber,
    phone:           payload.phone,
    requested_tier:  payload.requestedTier ?? 1,
  });
  const data = (res.data?.data ?? res.data) as Record<string, unknown>;
  return {
    status:        String(data.kyc_status ?? 'pending') as KycStatus,
    requestedTier: data.kyc_requested_tier != null ? Number(data.kyc_requested_tier) : null,
    submittedAt:   data.submitted_at != null ? String(data.submitted_at) : null,
  };
}
