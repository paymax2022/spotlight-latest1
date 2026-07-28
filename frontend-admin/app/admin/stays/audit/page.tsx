'use client';

import { useEffect, useState } from 'react';
import { getAudit } from '@/services/staysAdminService';
import type { AuditLog } from '@/types/staysAdmin';
import {
  PageHeader,
  StaysTabs,
  Card,
  Badge,
  DisclosureNote,
  StateBlock,
  FilterBar,
  btn,
  btnPrimary,
  th,
  td,
  input,
  label,
  fmtDate,
} from '../_ui';

export default function StaysAuditPage() {
  const [data, setData] = useState<AuditLog | null>(null);
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getAudit(action ? { action } : undefined)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [action]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Audit log & exports"
        subtitle="Immutable record of admin actions across Paymax Stays, plus scheduled compliance exports. Entries are append-only and cannot be edited or deleted."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <StaysTabs active="platform" />

      <DisclosureNote>
        Audit entries are immutable — append-only and tamper-evident. Exports are generated for
        compliance and reconciliation review; they never modify the underlying log.
      </DisclosureNote>

      <Card title="Exports">
        {(!data || data.exports.length === 0) ? (
          <p style={{ color: '#6b7280' }}>No exports configured.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th()}>Export</th>
                <th style={th()}>Range</th>
                <th style={th()}>Format</th>
                <th style={th()}>Generated</th>
                <th style={th()} />
              </tr>
            </thead>
            <tbody>
              {data.exports.map((x) => (
                <tr key={x.id}>
                  <td style={td()}>{x.name}</td>
                  <td style={td()}>{x.range}</td>
                  <td style={td()}><Badge status={x.format} label={x.format.toUpperCase()} /></td>
                  <td style={td()}>{x.generated_at ? fmtDate(x.generated_at) : 'never'}</td>
                  <td style={td()}>
                    <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                      <button
                        style={btn()}
                        onClick={() => window.alert('Export generation is handled by the compliance pipeline.')}
                      >
                        Generate
                      </button>
                      <button
                        style={x.generated_at ? btnPrimary() : { ...btn(), opacity: 0.5, cursor: 'not-allowed' }}
                        disabled={!x.generated_at}
                        onClick={() => window.alert('Download will be available once the export is generated.')}
                      >
                        Download
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <FilterBar>
        <div>
          <label style={label()}>Filter by action</label>
          <input
            style={input()}
            placeholder="e.g. refund.decide"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          />
        </div>
      </FilterBar>

      <Card title="Audit entries">
        <StateBlock
          loading={loading}
          error={error}
          empty={!data || data.entries.length === 0}
          emptyText="No audit entries match the filter."
        >
          {data && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>When</th>
                  <th style={th()}>Actor</th>
                  <th style={th()}>Action</th>
                  <th style={th()}>Entity</th>
                  <th style={th()}>Entity ID</th>
                  <th style={th()}>Rail</th>
                  <th style={th()}>IP</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.id}>
                    <td style={td()}>{fmtDate(e.created_at)}</td>
                    <td style={td()}>{e.actor_masked}</td>
                    <td style={td()}><Badge status={e.action} label={e.action} /></td>
                    <td style={td()}>{e.entity}</td>
                    <td style={td()}><code style={{ fontSize: '0.78rem' }}>{e.entity_id}</code></td>
                    <td style={td()}>{e.rail ? <Badge status={e.rail} label={e.rail} /> : '—'}</td>
                    <td style={td()}><code style={{ fontSize: '0.78rem' }}>{e.ip_masked}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </StateBlock>
      </Card>
    </div>
  );
}
