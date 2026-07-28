import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type { RideEstimate, RideBooking } from '@/types/fintech';

export async function estimateRide(params: {
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
}): Promise<RideEstimate[]> {
  const response = await api.get('/api/v1/transport/estimate', { params });
  const data = response.data?.data ?? response.data;
  return Array.isArray(data) ? data : data?.estimates ?? [];
}

export async function bookRide(payload: {
  pickup_address: string;
  dropoff_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  vehicle_type: string;
}): Promise<RideBooking> {
  const idempotencyKey = generateIdempotencyKey();
  const response = await api.post('/api/v1/transport/rides', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return response.data?.data ?? response.data;
}
