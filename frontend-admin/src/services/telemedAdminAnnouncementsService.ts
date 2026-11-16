// Telemedicine admin — platform announcements. Live data only: every call reads or
// writes /api/v1/telemedicine/admin/announcements (contracts/
// telemedicine-admin-announcements.openapi.yaml). The history needs
// telemedicine.admin.view; publishing needs telemedicine.admin.manage, and the
// backend enforces both.
//
// Publishing is a fan-out, not a row insert: the backend writes one unread
// doctor_notifications row per provider account and returns how many it reached,
// so `recipients` is the only honest answer to "did this actually go out".

import { apiV1 } from '@/config/env';

export type AnnouncementTone = 'info' | 'success' | 'warning';

export const ANNOUNCEMENT_TONES: { value: AnnouncementTone; label: string }[] = [
  { value: 'info', label: 'Info (neutral)' },
  { value: 'success', label: 'Success (good news)' },
  { value: 'warning', label: 'Warning (needs attention)' },
];

export interface PublishRequest {
  title: string;
  body: string;
  tone: AnnouncementTone;
  dismissible?: boolean;
  ctaLabel?: string;
  ctaRoute?: string;
}

export interface Published {
  id: string;
  title: string;
  body: string;
  tone: AnnouncementTone;
  dismissible: boolean;
  recipients: number;
  publishedAt: string;
}

/** One publication, grouped back out of the per-recipient rows. */
export interface Campaign {
  id: string;
  title: string;
  body: string;
  tone: AnnouncementTone;
  recipients: number;
  publishedAt: string;
}

function base(): string {
  return `${apiV1()}/telemedicine/admin/announcements`;
}

async function failure(res: Response): Promise<Error> {
  if (res.status === 403) return new Error('You need the telemedicine.admin.manage permission to publish a notice.');
  let msg = `Request failed (${res.status})`;
  try {
    const j = await res.json();
    if (j?.error && typeof j.error === 'string') msg = j.error;
  } catch { /* non-JSON error body */ }
  return new Error(msg);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw await failure(res);
  const j = await res.json();
  return (j?.data ?? j) as T;
}

export async function listAnnouncements(params: { limit?: number } = {}): Promise<Campaign[]> {
  const q = params.limit ? `?limit=${encodeURIComponent(String(params.limit))}` : '';
  return request<Campaign[]>(q);
}

export async function publishAnnouncement(req: PublishRequest): Promise<Published> {
  return request<Published>('', { method: 'POST', body: JSON.stringify(req) });
}
