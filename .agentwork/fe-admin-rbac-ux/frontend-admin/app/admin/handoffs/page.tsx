'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { listHandoffs, updateHandoffStatus } from '@/services/handoffService';
import type { HandoffRow } from '@/types/handoff';

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
    <div>
      <h1>Handoff Queue</h1>
      <p>Manage callback, email, and WhatsApp escalation requests.</p>
      <div style={{ marginTop: 8 }}>
        {sessionIdFilter ? (
          <>
            <p style={{ margin: 0, fontSize: 12, fontFamily: 'monospace' }}>Filtered by session: {sessionIdFilter}</p>
            <Link href="/admin/handoffs">Clear Filter</Link>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: 12 }}>Showing all sessions</p>
        )}
      </div>

      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        {loading ? <p>Loading handoffs...</p> : null}
        {!loading && rows.length === 0 ? <p>No handoff requests yet.</p> : null}

        {rows.map((row) => {
          const sessionId = row.session_id || row.sessionId || '';
          return (
            <article key={row.id} style={{ border: '1px solid #2a2a2a', padding: 12 }}>
              <p style={{ margin: 0, fontSize: 12 }}>
                <strong>{row.handoff_type || '-'}</strong> · {row.destination || '-'}
              </p>
              <p style={{ margin: '6px 0 0 0', fontSize: 12, fontFamily: 'monospace' }}>
                Session: {sessionId || '-'}
              </p>
              <p style={{ margin: '6px 0 0 0', fontSize: 12 }}>
                Requested: {row.requested_at ? new Date(row.requested_at).toLocaleString() : '-'}
              </p>
              <p style={{ margin: '6px 0 0 0', fontSize: 12 }}>
                Resolved: {row.resolved_at ? new Date(row.resolved_at).toLocaleString() : '-'}
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                <select
                  value={row.status || 'pending'}
                  onChange={(e) => void onUpdate(row.id, e.target.value)}
                  style={{ border: '1px solid #2a2a2a', padding: '4px 8px', background: 'transparent' }}
                >
                  <option value="pending">pending</option>
                  <option value="in_progress">in_progress</option>
                  <option value="resolved">resolved</option>
                </select>
                {sessionId ? <Link href={`/admin/chatbot/${encodeURIComponent(sessionId)}`}>Open Transcript</Link> : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
