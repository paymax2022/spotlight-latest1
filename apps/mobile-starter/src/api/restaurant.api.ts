import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  Restaurant,
  RestaurantDetail,
  RestaurantOrder,
  OrderResult,
  OrderTracking,
} from '@/types/fintech';

export async function listRestaurants(params?: {
  cuisine?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<Restaurant[]> {
  const response = await api.get('/api/v1/restaurant/vendors', { params });
  const data = response.data?.data ?? response.data;
  return Array.isArray(data) ? data : data?.vendors ?? [];
}

export async function getRestaurant(id: string): Promise<RestaurantDetail> {
  const response = await api.get(`/api/v1/restaurant/vendors/${id}`);
  return response.data?.data ?? response.data;
}

export async function placeRestaurantOrder(payload: RestaurantOrder): Promise<OrderResult> {
  const idempotencyKey = generateIdempotencyKey();
  const response = await api.post('/api/v1/restaurant/orders', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return response.data?.data ?? response.data;
}

export async function getOrderTracking(orderId: string): Promise<OrderTracking> {
  const response = await api.get(`/api/v1/restaurant/orders/${orderId}/track`);
  return response.data?.data ?? response.data;
}

export async function listMyOrders(): Promise<OrderTracking[]> {
  const response = await api.get('/api/v1/restaurant/orders');
  const data = response.data?.data ?? response.data;
  return Array.isArray(data) ? data : data?.orders ?? [];
}
