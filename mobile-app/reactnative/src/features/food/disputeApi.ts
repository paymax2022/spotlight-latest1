// FOOD-UAT-F-008 / F-005b: customer-side dispute entry. Lives outside api.ts (owned
// by another change set); talks to the existing Go dispute routes:
//   POST /api/finance/restaurant/orders/:orderId/dispute  { type, description }
//   POST /api/finance/restaurant/disputes/:id/evidence    { url, caption? }
import { api } from '@/api/client';

const BASE = '/api/finance/restaurant';

// Values must match backend foodDisputeTypes (disputes_service.go).
export const DISPUTE_TYPES = [
  { value: 'wrong_item', label: 'Wrong, missing or poor-quality item' },
  { value: 'non_delivery', label: 'Order never arrived' },
  { value: 'no_show', label: 'Rider or restaurant did not show up' },
  { value: 'other', label: 'Something else' },
] as const;

export const DISPUTE_MIN_DESCRIPTION = 20; // mirrors the server's validateRaise

export interface RaisedDispute {
  id: string;
  orderId: string;
  status: string;
}

export async function raiseOrderDispute(orderId: string, type: string, description: string): Promise<RaisedDispute> {
  const res = await api.post(`${BASE}/orders/${encodeURIComponent(orderId)}/dispute`, { type, description: description.trim() });
  const d = res.data?.dispute ?? res.data?.data?.dispute ?? res.data;
  return { id: String(d.id), orderId: String(d.order_id ?? orderId), status: String(d.status ?? 'open') };
}

export async function attachDisputeEvidence(disputeId: string, url: string, caption?: string): Promise<void> {
  await api.post(`${BASE}/disputes/${encodeURIComponent(disputeId)}/evidence`, { url: url.trim(), caption: caption?.trim() || undefined });
}
