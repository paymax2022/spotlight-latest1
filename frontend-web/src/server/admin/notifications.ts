import { randomUUID } from 'crypto';

export interface AdminNotification {
  id: string;
  title: string;
  message: string;
  channel: 'email' | 'sms' | 'push' | 'in_app';
  audience: 'all' | 'applicants' | 'contestants' | 'voters' | 'sponsors';
  status: 'queued' | 'sent' | 'failed';
  sentAt?: string;
  createdAt: string;
  createdBy?: string;
}

interface NotificationStore {
  items: Map<string, AdminNotification>;
}

function now() {
  return new Date().toISOString();
}

function getStore(): NotificationStore {
  const key = '__spotlightAdminNotificationStore';
  const g = globalThis as unknown as Record<string, NotificationStore | undefined>;
  if (!g[key]) {
    g[key] = { items: new Map() };
  }
  return g[key] as NotificationStore;
}

export function listNotifications() {
  return Array.from(getStore().items.values());
}

export function queueNotification(input: Omit<AdminNotification, 'id' | 'status' | 'createdAt' | 'sentAt'>) {
  const t = now();
  const item: AdminNotification = {
    id: randomUUID(),
    ...input,
    status: 'sent',
    createdAt: t,
    sentAt: t,
  };
  getStore().items.set(item.id, item);
  return item;
}

