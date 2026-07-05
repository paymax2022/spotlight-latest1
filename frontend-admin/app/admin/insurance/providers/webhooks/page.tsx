'use client';

import { useEffect, useState } from 'react';
import { listWebhooks, replayWebhook } from '@/services/insuranceAdminService';
import type { WebhookDelivery } from '@/types/insuranceAdmin';
import { PageHeader, InsuranceTabs, Card, Badge, btn, th, td, label, select, StateBlock, DisclosureNote, timeAgo } from '../../_ui';

const codeStyle: React.CSSProperties = { fontSize: '0.78rem', background: '#f3f4f6', padding: '0.1rem 0.35rem', borderRadius: '0.25rem', wordBreak: 'break-all' };

export default function WebhooksPage() {
  const [data, setData] = useState<WebhookDelivery[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState('');
  const [status, setStatus] = useState('');
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [queuedId, setQueuedId] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      setData(await listWebhooks({ provider: provider || undefined, status: status || undefined }));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [provider, status]);

  async function onReplay(id: string) {
    setSubmittingId(id); setError(null);
    try {
      await replayWebhook(id);
      setQueuedId(id);
      await load();
      setTimeout(() => setQueuedId((cur) => (cur === id ? null : cur)), 4000);
    } catch (e) { setError(String(e)); }
    finally { setSubmittingId(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Webhook deliveries & replay"
        subtitle="Outbound provider webhook deliveries. Replays are idempotent — re-delivery never double-binds a policy."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <InsuranceTabs active="providers" />

      <DisclosureNote>Replays are idempotent — re-delivery is keyed on (provider, external_event_id) and never double-binds or double-pays.</DisclosureNote>

      <Card title="Filters">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
          <div>
            <label style={label()}>Provider</label>
            <select style={select()} value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="">All providers</option>
              <option value="mycover">MyCover.ai</option>
              <option value="octamile">Octamile</option>
            </select>
          </div>
          <div>
            <label style={label()}>Status</label>
            <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="delivered">Delivered</option>
              <option value="failed">Failed</option>
              <option value="pending">Pending</option>
            </select>
          </div>
        </div>
      </Card>

      <Card>
        <StateBlock loading={loading} error={error} empty={!data || data.length === 0} emptyText="No webhook deliveries found.">
          {data && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th()}>ID</th>
                    <th style={th()}>Provider</th>
                    <th style={th()}>Event type</th>
                    <th style={th()}>External ID</th>
                    <th style={th()}>Status</th>
                    <th style={th()}>Attempts</th>
                    <th style={th()}>Last attempt</th>
                    <th style={th()}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((w) => {
                    const canReplay = w.replayable && (w.status === 'failed' || w.status === 'pending');
                    return (
                      <tr key={w.id}>
                        <td style={td()}><code style={codeStyle}>{w.id}</code></td>
                        <td style={td()}><Badge status={w.provider} /></td>
                        <td style={td()}>{w.event_type}</td>
                        <td style={td()}><code style={codeStyle}>{w.external_event_id}</code></td>
                        <td style={td()}><Badge status={w.status} /></td>
                        <td style={td()}>{w.attempts}</td>
                        <td style={td()}>{timeAgo(w.last_attempt_at)}</td>
                        <td style={td()}>
                          {queuedId === w.id ? (
                            <Badge status="pending" label="queued" />
                          ) : canReplay ? (
                            <button
                              onClick={() => onReplay(w.id)}
                              disabled={submittingId === w.id}
                              style={{ ...btn(), opacity: submittingId === w.id ? 0.6 : 1, cursor: submittingId === w.id ? 'not-allowed' : 'pointer' }}
                            >
                              {submittingId === w.id ? 'Replaying…' : 'Replay'}
                            </button>
                          ) : (
                            <span style={{ color: '#9ca3af' }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </StateBlock>
      </Card>
    </div>
  );
}
