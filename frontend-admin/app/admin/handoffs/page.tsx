'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { listHandoffs, updateHandoffStatus } from '@/services/handoffService';
import type { HandoffRow } from '@/types/handoff';
import { Page, PageHeader, Card, colors } from '@/components/ui/vuexy';

export default function AdminHandoffsPage() {
  const searchParams = useSearchParams();
  const sessionIdFilter = (searchParams?.get('sessionId') || '').trim();
  const [rows, setRows] = useState<HandoffRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const data = await listHandoffs(200, sessionIdFilter);
    setRows(data);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [sessionIdFilter]);

  const onUpdate = async (id: string, status: string) => {
    await updateHandoffStatus(id, status);
    await load();
  };

  return (
    <Page>
      <PageHeader title="Handoff Queue" subtitle="Manage callback, email, and WhatsApp escalation requests." />
      <div style={{ marginBottom: 12 }}>
        {sessionIdFilter ? (
          <>
            <p style={{ margin: 0, fontSize: 12, fontFamily: 'monospace', color: colors.muted }}>Filtered by session: {sessionIdFilter}</p>
            <Link href="/admin/handoffs" style={{ color: colors.primary }}>Clear Filter</Link>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: 12, color: colors.muted }}>Showing all sessions</p>
        )}
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {loading ? <p style={{ color: colors.muted }}>Loading handoffs...</p> : null}
        {!loading && rows.length === 0 ? <p style={{ color: colors.muted }}>No handoff requests yet.</p> : null}

        {rows.map((row) => {
          const sessionId = row.session_id || row.sessionId || '';
          return (
            <Card key={row.id} style={{ padding: 12 }}>
              <p style={{ margin: 0, fontSize: 12 }}>
                <strong>{row.handoff_type || '-'}</strong> · {row.destination || '-'}
              </p>
              <p style={{ margin: '6px 0 0 0', fontSize: 12, fontFamily: 'monospace', color: colors.muted }}>
                Session: {sessionId || '-'}
              </p>
              <p style={{ margin: '6px 0 0 0', fontSize: 12, color: colors.muted }}>
                Requested: {row.requested_at ? new Date(row.requested_at).toLocaleString() : '-'}
              </p>
              <p style={{ margin: '6px 0 0 0', fontSize: 12, color: colors.muted }}>
                Resolved: {row.resolved_at ? new Date(row.resolved_at).toLocaleString() : '-'}
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                <select
                  value={row.status || 'pending'}
                  onChange={(e) => void onUpdate(row.id, e.target.value)}
                >
                  <option value="pending">pending</option>
                  <option value="in_progress">in_progress</option>
                  <option value="resolved">resolved</option>
                </select>
                {sessionId ? <Link href={`/admin/chatbot/${encodeURIComponent(sessionId)}`} style={{ color: colors.primary }}>Open Transcript</Link> : null}
              </div>
            </Card>
          );
        })}
      </div>
    </Page>
  );
}
