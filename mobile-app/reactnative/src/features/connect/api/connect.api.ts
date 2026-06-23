import { api } from '@/api/client';
import { USE_MOCK, CONNECT_API_BASE } from '../constants/connect.constants';
import type { ConnectConfig } from '../types/connect.types';

// Mirrors the public.connect_config seed (visibility='public' rows only).
const MOCK_CONFIG: ConnectConfig = {
  'feature.connect.enabled': true,
  'discovery.daily_match_limit': 20,
  'discovery.daily_like_limit': 50,
  'discovery.super_like_daily_limit': 1,
  'chat.rate_limit_per_min': 20,
  'safety.location_default': 'approximate',
  'verification.required_level_for_chat': 'l1',
};

// getConnectConfig returns the backend-owned, mobile-readable config. The app
// must read these values rather than hard-coding flags/limits.
export async function getConnectConfig(): Promise<ConnectConfig> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 300));
    return { ...MOCK_CONFIG };
  }
  const res = await api.get(`${CONNECT_API_BASE}/config`);
  return (res.data?.data ?? res.data) as ConnectConfig;
}
