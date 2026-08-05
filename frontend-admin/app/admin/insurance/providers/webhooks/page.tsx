'use client';

import { useEffect, useState } from 'react';
import { listWebhooks, replayWebhook } from '@/services/insuranceAdminService';
import type { WebhookDelivery } from '@/types/insuranceAdmin';
import { InsuranceTabs, StateBlock, DisclosureNote, timeAgo } from '../../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const codeStyle: React.CSSProperties = { fontSize: 12, background: colors.headBg, padding: '0.1rem 0.35rem', borderRadius: 4, wordBreak: 'break-all' };
const fieldLabel: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: colors.muted, marginBottom: 4 };

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s === 'delivered') return colors.success;
  if (s === 'failed') return colors.danger;
  if (s === 'pending') return colors.warning;
  if (s === 'mycover' || s === 'octamile') return colors.info;
  return colors.secondary;
}

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
    <Page>
      <PageHeader
        title="Webhook deliveries & replay"
        subtitle="Outbound provider webhook deliveries. Replays are idempotent — re-delivery never double-binds a policy."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <InsuranceTabs active="providers" />

      <DisclosureNote>Replays are idempotent — re-delivery is keyed on (provider, external_event_id) and never double-binds or double-pays.</DisclosureNote>

      <Card title="Filters" style={{ marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, alignItems: 'end' }}>
          <div>
            <label style={fieldLabel}>Provider</label>
            <select value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="">All providers</option>
              <option value="mycover">MyCover.ai</option>
              <option value="octamile">Octamile</option>
            </select>
          </div>
          <div>
            <label style={fieldLabel}>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="delivered">Delivered</option>
              <option value="failed">Failed</option>
              <option value="pending">Pending</option>
            </select>
          </div>
        </div>
      </Card>

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <div style={{ padding: 14 }}>
          <StateBlock loading={loading} error={error} empty={!data || data.length === 0} emptyText="No webhook deliveries found.">
            {data && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thCell}>ID</th>
                      <th style={thCell}>Provider</th>
                      <th style={thCell}>Event type</th>
                      <th style={thCell}>External ID</th>
                      <th style={thCell}>Status</th>
                      <th style={thCell}>Attempts</th>
                      <th style={thCell}>Last attempt</th>
                      <th style={thCell}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((w) => {
                      const canReplay = w.replayable && (w.status === 'failed' || w.status === 'pending');
                      return (
                        <tr key={w.id}>
                          <td style={tdCell}><code style={codeStyle}>{w.id}</code></td>
                          <td style={tdCell}><Badge text={w.provider} color={statusColor(w.provider)} /></td>
                          <td style={tdCell}>{w.event_type}</td>
                          <td style={tdCell}><code style={codeStyle}>{w.external_event_id}</code></td>
                          <td style={tdCell}><Badge text={w.status} color={statusColor(w.status)} /></td>
                          <td style={tdCell}>{w.attempts}</td>
                          <td style={tdCell}>{timeAgo(w.last_attempt_at)}</td>
                          <td style={tdCell}>
                            {queuedId === w.id ? (
                              <Badge text="queued" color={colors.warning} />
                            ) : canReplay ? (
                              <Button variant="outline" sm onClick={() => onReplay(w.id)} disabled={submittingId === w.id}>
                                {submittingId === w.id ? 'Replaying…' : 'Replay'}
                              </Button>
                            ) : (
                              <span style={{ color: colors.muted }}>—</span>
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
        </div>
      </Card>
    </Page>
  );
}
