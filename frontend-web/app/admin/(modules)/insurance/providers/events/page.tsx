'use client';

import { useEffect, useState } from 'react';
import { listProviderEvents } from '@/services/insuranceAdminService';
import type { ProviderEvent } from '@/types/insuranceAdmin';
import { InsuranceTabs, StateBlock, DisclosureNote, timeAgo, fmtDate } from '../../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const codeStyle = { fontSize: 12, background: colors.headBg, padding: '0.1rem 0.35rem', borderRadius: 4, wordBreak: 'break-all' } as const;
const fieldLabel = { display: 'block', fontSize: 12, fontWeight: 600, color: colors.muted, marginBottom: 4 } as const;

type DupFilter = 'all' | 'dup' | 'nondup';

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s === 'mycover' || s === 'octamile') return colors.info;
  return colors.secondary;
}

export default function ProviderEventsPage() {
  const [data, setData] = useState<ProviderEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState('');
  const [eventType, setEventType] = useState('');
  const [dup, setDup] = useState<DupFilter>('all');

  async function load() {
    setLoading(true); setError(null);
    try {
      setData(await listProviderEvents({
        provider: provider || undefined,
        event_type: eventType || undefined,
        duplicate: dup === 'all' ? undefined : dup === 'dup',
      }));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [provider, dup]);

  return (
    <Page>
      <PageHeader
        title="Provider event log"
        subtitle="Inbound provider events. Idempotent ingest — duplicate (provider, external_event_id) is dropped via unique constraint."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <InsuranceTabs active="providers" />

      <DisclosureNote>Idempotent ingest — a repeated (provider, external_event_id) is recorded as a duplicate and dropped (never re-processed).</DisclosureNote>

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
            <label style={fieldLabel}>Event type</label>
            <Input placeholder="e.g. policy.bound" value={eventType} onChange={(e) => setEventType(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(); }} />
          </div>
          <div>
            <label style={fieldLabel}>Duplicate</label>
            <select value={dup} onChange={(e) => setDup(e.target.value as DupFilter)}>
              <option value="all">All</option>
              <option value="dup">Duplicates only</option>
              <option value="nondup">Non-duplicates</option>
            </select>
          </div>
          <div>
            <Button variant="primary" onClick={load}>Apply</Button>
          </div>
        </div>
      </Card>

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <div style={{ padding: 14 }}>
          <StateBlock loading={loading} error={error} empty={!data || data.length === 0} emptyText="No provider events found.">
            {data && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thCell}>ID</th>
                      <th style={thCell}>Provider</th>
                      <th style={thCell}>Event type</th>
                      <th style={thCell}>External ID</th>
                      <th style={thCell}>Signature</th>
                      <th style={thCell}>Processed</th>
                      <th style={thCell}>Duplicate</th>
                      <th style={thCell}>Payload</th>
                      <th style={thCell}>Received</th>
                      <th style={thCell}>Processed at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((e) => (
                      <tr key={e.id}>
                        <td style={tdCell}><code style={codeStyle}>{e.id}</code></td>
                        <td style={tdCell}><Badge text={e.provider} color={statusColor(e.provider)} /></td>
                        <td style={tdCell}>{e.event_type}</td>
                        <td style={tdCell}><code style={codeStyle}>{e.external_event_id}</code></td>
                        <td style={tdCell}><Badge text={e.signature_verified ? 'verified' : 'failed'} color={e.signature_verified ? colors.success : colors.danger} /></td>
                        <td style={tdCell}><Badge text={e.processed ? 'processed' : 'pending'} color={e.processed ? colors.success : colors.warning} /></td>
                        <td style={tdCell}>{e.duplicate ? <Badge text="duplicate" color={colors.danger} /> : <span style={{ color: colors.muted }}>—</span>}</td>
                        <td style={tdCell}><code style={codeStyle}>{e.payload_ref}</code></td>
                        <td style={tdCell}>{timeAgo(e.received_at)}</td>
                        <td style={tdCell}>{e.processed_at ? fmtDate(e.processed_at) : '—'}</td>
                      </tr>
                    ))}
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
