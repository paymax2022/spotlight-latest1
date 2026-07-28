import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type { Dispute, OpenDisputePayload } from '@/types/fintech';

export async function listMyDisputes(params?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<Dispute[]> {
  const response = await api.get('/api/v1/disputes', { params });
  const data = response.data?.data ?? response.data;
  return Array.isArray(data) ? data : data?.disputes ?? [];
}

export async function openDispute(payload: OpenDisputePayload): Promise<Dispute> {
  const idempotencyKey = generateIdempotencyKey();
  const response = await api.post('/api/v1/disputes', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return response.data?.data ?? response.data;
}
