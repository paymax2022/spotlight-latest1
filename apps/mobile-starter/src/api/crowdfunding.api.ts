import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type { Campaign } from '@/types/fintech';

export async function listCampaigns(params?: {
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<Campaign[]> {
  const response = await api.get('/api/v1/crowdfunding/campaigns', { params });
  const data = response.data?.data ?? response.data;
  return Array.isArray(data) ? data : data?.campaigns ?? [];
}

export async function getCampaign(id: string): Promise<Campaign> {
  const response = await api.get(`/api/v1/crowdfunding/campaigns/${id}`);
  return response.data?.data ?? response.data;
}

export async function backCampaign(payload: {
  campaign_id: string;
  amount_kobo: number;
}): Promise<{ contribution_id: string; reference: string }> {
  const idempotencyKey = generateIdempotencyKey();
  const response = await api.post('/api/v1/crowdfunding/contributions', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return response.data?.data ?? response.data;
}
