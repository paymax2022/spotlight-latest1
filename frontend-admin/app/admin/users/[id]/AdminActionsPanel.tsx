'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminUsersRequestError, getAuditLogsForUser, type AdminAuditEntry } from '@/services/usersService';
import { Card, Button, colors } from '@/components/ui/vuexy';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-NG');
}

const th = { textAlign: 'left' as const, padding: '6px 8px', color: colors.muted, fontWeight: 600 };
const td = { padding: '6px 8px', wordBreak: 'break-word' as const };

/**
 * Read-only list of admin actions taken on this user (GET /admin/audit-logs, audit.logs.view). Every
 * value is backend text and is rendered as text only. No mutation controls.
 */
export function AdminActionsPanel({ userId }: { userId: string }) {
  const [rows, setRows] = useState<AdminAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  // Incremented per load(); results of superseded requests are ignored.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const myId = ++requestId.current;
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const res = await getAuditLogsForUser(userId);
      if (myId !== requestId.current) return;
      setRows(res);
    } catch (err) {
      if (myId !== requestId.current) return;
      setRows([]);
      if (err instanceof AdminUsersRequestError && err.status === 403) {
        setForbidden(true);
      } else {
        setError(err instanceof Error ? err.message : 'Loading admin actions failed.');
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
    body = <p style={{ color: colors.muted, fontSize: 13 }}>Loading admin actions…</p>;
  } else if (forbidden) {
    body = <p style={{ color: colors.muted, fontSize: 13 }}>You don&apos;t have permission to view this.</p>;

  } else if (error) {
    body = (
      <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
        <p style={{ color: colors.danger, fontSize: 13, margin: 0 }}>{error}</p>
        <Button variant="outline" sm onClick={() => void load()}>Retry</Button>
      </div>
    );
  } else if (rows.length === 0) {
    body = <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>No admin actions recorded</p>;
  } else {
    body = (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={th}>Action</th>
              <th style={th}>Module</th>
              <th style={th}>Actor</th>
              <th style={th}>Severity</th>
              <th style={th}>Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={td}>{r.action}</td>
                <td style={td}>{r.module}</td>
                <td style={td}>{r.actor_user_id}</td>
                <td style={td}>{r.severity}</td>
                <td style={td}>{formatDate(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div data-testid="admin-actions-panel">
      <Card title="Admin actions">
        <div style={{ marginTop: 8 }}>{body}</div>
      </Card>
    </div>
  );
}
