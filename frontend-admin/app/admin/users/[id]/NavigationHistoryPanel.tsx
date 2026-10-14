'use client';

import { useCallback, useEffect, useState } from 'react';
import { AdminUsersRequestError, getUserNavigation } from '@/services/usersService';
import { Card, Button, colors } from '@/components/ui/vuexy';

type NavEvent = { surface: string; route: string; occurred_at: string };

const when = (s: string): string => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString();
};

/**
 * Read-only navigation history (recent screen/page visits) for the admin user
 * profile. Rendered in the order received (backend returns newest first).
 */
export function NavigationHistoryPanel({ userId }: { userId: string }) {
  const [events, setEvents] = useState<NavEvent[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const res = await getUserNavigation(userId);
      setEnabled(res.enabled);
      setEvents(Array.isArray(res.events) ? res.events : []);
    } catch (err) {
      if (err instanceof AdminUsersRequestError && err.status === 403) {
        setForbidden(true);
      } else {
        setError(err instanceof Error ? err.message : 'Loading navigation history failed.');
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const muted = { color: colors.muted, fontSize: 13, margin: 0 } as const;
  let body;
  if (loading) {
    body = <p style={muted}>Loading navigation history…</p>;
  } else if (forbidden) {
    body = <p style={muted}>You don&apos;t have permission to view this.</p>;
  } else if (error) {
    body = (
      <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
        <p style={{ color: colors.danger, fontSize: 13, margin: 0 }}>{error}</p>
        <Button variant="outline" sm onClick={() => void load()}>Retry</Button>
      </div>
    );
  } else if (!enabled) {
    body = <p style={muted}>Navigation telemetry not enabled</p>;
  } else if (events.length === 0) {
    body = <p style={muted}>No navigation history</p>;
  } else {
    body = (
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
        {events.map((e, i) => (
          <li
            key={`${e.occurred_at}-${i}`}
            data-testid="navigation-row"
            style={{ fontSize: 13, color: colors.text, display: 'flex', gap: 8, alignItems: 'center' }}
          >
            <span style={{ color: colors.muted }}>{when(e.occurred_at)}</span>
            <span
              style={{
                fontSize: 11,
                padding: '1px 6px',
                borderRadius: 4,
                border: `1px solid ${colors.muted}`,
                color: colors.muted,
              }}
            >
              {e.surface}
            </span>
            <span>{e.route}</span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div data-testid="navigation-history-panel">
      <Card title="Navigation History">
        <div style={{ marginTop: 8 }}>{body}</div>
      </Card>
    </div>
  );
}
