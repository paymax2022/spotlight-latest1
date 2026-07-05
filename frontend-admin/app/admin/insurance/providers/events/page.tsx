'use client';

import { useEffect, useState } from 'react';
import { listProviderEvents } from '@/services/insuranceAdminService';
import type { ProviderEvent } from '@/types/insuranceAdmin';
import { PageHeader, InsuranceTabs, Card, Badge, btn, th, td, input, label, select, StateBlock, DisclosureNote, timeAgo, fmtDate } from '../../_ui';

const codeStyle: React.CSSProperties = { fontSize: '0.78rem', background: '#f3f4f6', padding: '0.1rem 0.35rem', borderRadius: '0.25rem', wordBreak: 'break-all' };

type DupFilter = 'all' | 'dup' | 'nondup';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Provider event log"
        subtitle="Inbound provider events. Idempotent ingest — duplicate (provider, external_event_id) is dropped via unique constraint."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <InsuranceTabs active="providers" />

      <DisclosureNote>Idempotent ingest — a repeated (provider, external_event_id) is recorded as a duplicate and dropped (never re-processed).</DisclosureNote>

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
            <label style={label()}>Event type</label>
            <input style={input()} placeholder="e.g. policy.bound" value={eventType} onChange={(e) => setEventType(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(); }} />
          </div>
          <div>
            <label style={label()}>Duplicate</label>
            <select style={select()} value={dup} onChange={(e) => setDup(e.target.value as DupFilter)}>
              <option value="all">All</option>
              <option value="dup">Duplicates only</option>
              <option value="nondup">Non-duplicates</option>
            </select>
          </div>
          <div>
            <button onClick={load} style={btn()}>Apply</button>
          </div>
        </div>
      </Card>

      <Card>
        <StateBlock loading={loading} error={error} empty={!data || data.length === 0} emptyText="No provider events found.">
          {data && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th()}>ID</th>
                    <th style={th()}>Provider</th>
                    <th style={th()}>Event type</th>
                    <th style={th()}>External ID</th>
                    <th style={th()}>Signature</th>
                    <th style={th()}>Processed</th>
                    <th style={th()}>Duplicate</th>
                    <th style={th()}>Payload</th>
                    <th style={th()}>Received</th>
                    <th style={th()}>Processed at</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((e) => (
                    <tr key={e.id}>
                      <td style={td()}><code style={codeStyle}>{e.id}</code></td>
                      <td style={td()}><Badge status={e.provider} /></td>
                      <td style={td()}>{e.event_type}</td>
                      <td style={td()}><code style={codeStyle}>{e.external_event_id}</code></td>
                      <td style={td()}><Badge status={e.signature_verified ? 'active' : 'failed'} label={e.signature_verified ? 'verified' : 'failed'} /></td>
                      <td style={td()}><Badge status={e.processed ? 'active' : 'pending'} label={e.processed ? 'processed' : 'pending'} /></td>
                      <td style={td()}>{e.duplicate ? <Badge status="failed" label="duplicate" /> : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                      <td style={td()}><code style={codeStyle}>{e.payload_ref}</code></td>
                      <td style={td()}>{timeAgo(e.received_at)}</td>
                      <td style={td()}>{e.processed_at ? fmtDate(e.processed_at) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </StateBlock>
      </Card>
    </div>
  );
}
