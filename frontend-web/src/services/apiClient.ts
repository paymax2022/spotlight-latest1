import { env } from '@/config/env';

export async function getPublicHealth() {
  const res = await fetch(`${env.apiBaseUrl}/public/health`, { cache: 'no-store' });
  return res.json();
}
