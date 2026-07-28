import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type { KycProfile } from '@/types/fintech';

export async function getMyKyc(): Promise<KycProfile> {
  const response = await api.get('/api/v1/kyc/me');
  return response.data?.data ?? response.data;
}

export async function initiateKyc(payload: {
  document_type: string;
  document_number: string;
  requested_tier: number;
}): Promise<{ verification_url?: string; status: string }> {
  const idempotencyKey = generateIdempotencyKey();
  const response = await api.post('/api/v1/kyc/initiate', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return response.data?.data ?? response.data;
}
