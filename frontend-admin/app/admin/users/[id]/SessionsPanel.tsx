'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminUsersRequestError, getUserSessions, type UserSession } from '@/services/usersService';
import { Card, Button, colors } from '@/components/ui/vuexy';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-NG');
}

const th = { textAlign: 'left' as const, padding: '6px 8px', color: colors.muted, fontWeight: 600 };
const td = { padding: '6px 8px', wordBreak: 'break-word' as const };

/**
 * Read-only active sessions panel (GET /admin/users/:id/sessions). A 503 means session hardening
 * is disabled in this environment (no Retry). Backend values are rendered as text only. No
 * force-logout or other mutation controls.
 */
export function SessionsPanel({ userId }: { userId: string }) {
  const [rows, setRows] = useState<UserSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [disabled, setDisabled] = useState(false);
  // Incremented per load(); results of superseded requests are ignored.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const myId = ++requestId.current;
    setLoading(true);
    setError(null);
    setForbidden(false);
    setDisabled(false);
    try {
      const res = await getUserSessions(userId);
      if (myId !== requestId.current) return;
      setRows(res);
    } catch (err) {
      if (myId !== requestId.current) return;
      setRows([]);
      if (err instanceof AdminUsersRequestError && err.status === 503) {
        setDisabled(true);
      } else if (err instanceof AdminUsersRequestError && err.status === 403) {
        setForbidden(true);
      } else {
        setError(err instanceof Error ? err.message : 'Loading sessions failed.');
      }
    } finally {
      if (myId === requestId.current) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  let body;
  if (loading) {
    body = <p style={{ color: colors.muted, fontSize: 13 }}>Loading sessions…</p>;
  } else if (forbidden) {
    body = <p style={{ color: colors.muted, fontSize: 13 }}>You don&apos;t have permission to view this.</p>;
  } else if (disabled) {
    body = <p style={{ color: colors.muted, fontSize: 13 }}>Session hardening is not enabled in this environment.</p>;
  } else if (error) {
    body = (
      <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
        <p style={{ color: colors.danger, fontSize: 13, margin: 0 }}>{error}</p>
        <Button variant="outline" sm onClick={() => void load()}>Retry</Button>
      </div>
    );
  } else if (rows.length === 0) {
    body = <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>No active sessions</p>;
  } else {
    body = (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={th}>Device</th>
              <th style={th}>IP</th>
              <th style={th}>User agent</th>
              <th style={th}>Last seen</th>
              <th style={th}>Expires</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={td}>{r.device}</td>
                <td style={td}>{r.ip}</td>
                <td style={td}>{r.userAgent}</td>
                <td style={td}>{formatDate(r.lastSeenAt)}</td>
                <td style={td}>{formatDate(r.expiresAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div data-testid="sessions-panel">
      <Card title="Sessions">
        <div style={{ marginTop: 8 }}>{body}</div>
      </Card>
    </div>
  );
}
