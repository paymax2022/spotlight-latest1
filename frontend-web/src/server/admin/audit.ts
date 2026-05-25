import { randomUUID } from 'crypto';

export interface AdminAuditEvent {
  id: string;
  adminUser: string;
  role: string;
  action: string;
  module: string;
  entityType: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
  ipAddress?: string;
  timestamp: string;
}

type AuditStore = { events: AdminAuditEvent[] };

function getStore(): AuditStore {
  const key = '__spotlightAdminAuditStore';
  const globalObj = globalThis as unknown as Record<string, AuditStore | undefined>;
  if (!globalObj[key]) globalObj[key] = { events: [] };
  return globalObj[key] as AuditStore;
}

export function addAuditEvent(input: Omit<AdminAuditEvent, 'id' | 'timestamp'>) {
  const store = getStore();
  const event: AdminAuditEvent = {
    ...input,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
  };
  store.events.unshift(event);
  if (store.events.length > 2000) store.events.length = 2000;
  return event;
}

export function listAuditEvents(limit = 100) {
  return getStore().events.slice(0, Math.max(1, Math.min(limit, 500)));
}
