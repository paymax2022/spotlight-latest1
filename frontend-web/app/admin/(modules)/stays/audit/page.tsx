'use client';

import { useEffect, useState } from 'react';
import { getAudit } from '@/services/staysAdminService';
import type { AuditLog } from '@/types/staysAdmin';
import {
  StaysTabs,
  Card,
  Badge,
  DisclosureNote,
  StateBlock,
  FilterBar,
  label,
  fmtDate,
} from '../_ui';
import { Page, PageHeader, Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader
        title="Audit log & exports"
        subtitle="Immutable record of admin actions across Paymax Stays, plus scheduled compliance exports. Entries are append-only and cannot be edited or deleted."
        actions={<Button variant="outline" sm onClick={load}>Refresh</Button>}
      />
      <StaysTabs active="platform" />

      <DisclosureNote>
        Audit entries are immutable — append-only and tamper-evident. Exports are generated for
        compliance and reconciliation review; they never modify the underlying log.
      </DisclosureNote>

      <Card title="Exports">
        {(!data || data.exports.length === 0) ? (
          <p style={{ color: colors.muted }}>No exports configured.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thCell}>Export</th>
                <th style={thCell}>Range</th>
                <th style={thCell}>Format</th>
                <th style={thCell}>Generated</th>
                <th style={thCell} />
              </tr>
            </thead>
            <tbody>
              {data.exports.map((x) => (
                <tr key={x.id}>
                  <td style={tdCell}>{x.name}</td>
                  <td style={tdCell}>{x.range}</td>
                  <td style={tdCell}><Badge status={x.format} label={x.format.toUpperCase()} /></td>
                  <td style={tdCell}>{x.generated_at ? fmtDate(x.generated_at) : 'never'}</td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                      <Button
                        variant="outline"
                        sm
                        onClick={() => window.alert('Export generation is handled by the compliance pipeline.')}
                      >
                        Generate
                      </Button>
                      <Button
                        variant="primary"
                        sm
                        disabled={!x.generated_at}
                        onClick={() => window.alert('Download will be available once the export is generated.')}
                      >
                        Download
                      </Button>
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
          <Input
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
                  <th style={thCell}>When</th>
                  <th style={thCell}>Actor</th>
                  <th style={thCell}>Action</th>
                  <th style={thCell}>Entity</th>
                  <th style={thCell}>Entity ID</th>
                  <th style={thCell}>Rail</th>
                  <th style={thCell}>IP</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.id}>
                    <td style={tdCell}>{fmtDate(e.created_at)}</td>
                    <td style={tdCell}>{e.actor_masked}</td>
                    <td style={tdCell}><Badge status={e.action} label={e.action} /></td>
                    <td style={tdCell}>{e.entity}</td>
                    <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{e.entity_id}</code></td>
                    <td style={tdCell}>{e.rail ? <Badge status={e.rail} label={e.rail} /> : '—'}</td>
                    <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{e.ip_masked}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </StateBlock>
      </Card>
    </Page>
  );
}
