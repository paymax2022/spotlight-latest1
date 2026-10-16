'use client';

import { useCallback, useEffect, useState } from 'react';
import { AdminUsersRequestError, getLoginActivity, getSecurityEvents } from '@/services/usersService';
import { Card, Button, colors } from '@/components/ui/vuexy';

type Row = Record<string, unknown>;

const text = (v: unknown): string | null => {
  if (typeof v === 'string') return v.trim() ? v : null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
};

const when = (v: unknown): string | null => {
  const s = text(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString();
};

const join = (parts: Array<string | null>) => parts.filter((p): p is string => !!p).join(' · ');

const loginLine = (r: Row) =>
  join([when(r.created_at), text(r.status), text(r.email), text(r.ip_address), text(r.failure_reason)]) || '(no details)';

const eventLine = (r: Row) =>
  join([when(r.created_at), text(r.action) ?? text(r.type), text(r.severity), text(r.ip_address), text(r.status)]) ||
  '(no details)';

/**
 * Read-only login and security activity for the admin user profile. Lists are
 * rendered in the order received (backend returns newest first).
 */
export function ActivityPanel({ userId }: { userId: string }) {
  const [logins, setLogins] = useState<Row[]>([]);
  const [events, setEvents] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const [l, e] = await Promise.all([getLoginActivity(userId), getSecurityEvents(userId)]);
      setLogins(Array.isArray(l) ? l : []);
      setEvents(Array.isArray(e) ? e : []);
    } catch (err) {
      if (err instanceof AdminUsersRequestError && err.status === 403) {
        setForbidden(true);
      } else {
        setError(err instanceof Error ? err.message : 'Loading activity failed.');
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const section = (title: string, rows: Row[], empty: string, testId: string, line: (r: Row) => string) => (
    <div style={{ display: 'grid', gap: 6 }}>
      <strong style={{ fontSize: 13, color: colors.text }}>{title}</strong>
      {rows.length === 0 ? (
        <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>{empty}</p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
          {rows.map((r, i) => (
            <li key={text(r?.id) ?? i} data-testid={testId} style={{ fontSize: 13, color: colors.text }}>
              {line(r && typeof r === 'object' ? r : {})}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  let body;
  if (loading) {
    body = <p style={{ color: colors.muted, fontSize: 13 }}>Loading activity…</p>;
  } else if (forbidden) {
    body = <p style={{ color: colors.muted, fontSize: 13 }}>You don&apos;t have permission to view this.</p>;
  } else if (error) {
    body = (
      <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
        <p style={{ color: colors.danger, fontSize: 13, margin: 0 }}>{error}</p>
        <Button variant="outline" sm onClick={() => void load()}>Retry</Button>
      </div>
    );
  } else {
    body = (
      <div style={{ display: 'grid', gap: 16 }}>
        {section('Login activity', logins, 'No login activity', 'login-activity-row', loginLine)}
        {section('Security events', events, 'No security events', 'security-event-row', eventLine)}
      </div>
    );
  }

  return (
    <div data-testid="activity-panel">
      <Card title="Login & Security Activity">
        <div style={{ marginTop: 8 }}>{body}</div>
      </Card>
    </div>
  );
}
