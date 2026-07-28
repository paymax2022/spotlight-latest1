'use client';

import { useEffect, useState } from 'react';
import { listMessages } from '@/services/staysExtranetService';
import type { GuestMessage } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, PropertyScopeNote, Badge, StateBlock, btn, btnPrimary, input, timeAgo } from '../_ui';

export default function InboxPage() {
  const [rows, setRows] = useState<GuestMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [sent, setSent] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { const m = await listMessages(); setRows(m); if (m[0]) setActive(m[0].id); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const thread = rows.find((r) => r.id === active);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Inbox — guest messaging" subtitle="Reply to guest questions before and during their stay. Faster replies improve your ranking and reviews." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ExtranetTabs active="reservations" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No guest messages yet.">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 320px) 1fr', gap: '1rem', alignItems: 'start' }}>
          <Card title={`Conversations (${rows.length})`}>
            <div style={{ display: 'grid', gap: '0.4rem' }}>
              {rows.map((m) => (
                <button key={m.id} onClick={() => { setActive(m.id); setSent(null); }} style={{ textAlign: 'left', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.6rem 0.7rem', background: active === m.id ? '#f5f3ff' : '#fff', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '0.85rem' }}>{m.guest_name}</strong>
                    {m.unread > 0 ? <Badge status="high" label={`${m.unread} new`} /> : null}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{m.reservation_ref} · {timeAgo(m.updated_at)}</div>
                  <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.25rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.last_message}</div>
                </button>
              ))}
            </div>
          </Card>

          <Card title={thread ? `${thread.guest_name} · ${thread.reservation_ref}` : 'Select a conversation'}>
            {thread ? (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1rem' }}>
                  <div style={{ alignSelf: thread.from === 'guest' ? 'flex-start' : 'flex-end', maxWidth: '75%', background: thread.from === 'guest' ? '#f3f4f6' : '#ede9fe', borderRadius: '0.6rem', padding: '0.55rem 0.75rem', fontSize: '0.85rem' }}>
                    {thread.last_message}
                    <div style={{ fontSize: '0.68rem', color: '#9ca3af', marginTop: '0.25rem' }}>{thread.from === 'guest' ? thread.guest_name : 'You'} · {timeAgo(thread.updated_at)}</div>
                  </div>
                  {sent ? (
                    <div style={{ alignSelf: 'flex-end', maxWidth: '75%', background: '#ede9fe', borderRadius: '0.6rem', padding: '0.55rem 0.75rem', fontSize: '0.85rem' }}>{sent}<div style={{ fontSize: '0.68rem', color: '#9ca3af', marginTop: '0.25rem' }}>You · just now</div></div>
                  ) : null}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input style={input()} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Type a reply…" />
                  <button style={btnPrimary()} disabled={!reply} onClick={() => { setSent(reply); setReply(''); }}>Send</button>
                </div>
              </>
            ) : <p style={{ color: '#6b7280' }}>Select a conversation to view.</p>}
          </Card>
        </div>
      </StateBlock>
    </div>
  );
}
