'use client';

import { useEffect, useState } from 'react';
import { listSprayPayouts, formatNaira, type SprayPayout } from '@/services/sprayAdminService';
import { PageHeader, SprayTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, btn, th, td, label, select, fmtDate } from '../_ui';
import { colors } from '@/components/ui/vuexy';

export default function SprayPayoutsPage() {
  const [rows, setRows] = useState<SprayPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listSprayPayouts({ status: status || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Spray payouts" subtitle="Settlement of pooled spray funds to event beneficiaries." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <SprayTabs active="payouts" />
      <DisclosureNote>Mock-only — the backend exposes <strong>no spray payout admin route</strong> yet. This view documents the intended settlement surface; wire it to a real endpoint once added.</DisclosureNote>

      <FilterBar>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No payouts match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Payout</th><th style={th()}>Event</th><th style={th()}>Beneficiary</th><th style={th()}>Amount</th>
              <th style={th()}>Status</th><th style={th()}>Created</th>
            </tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{p.id}</code></td>
                  <td style={td()}>{p.event_name}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{p.context_ref}</div></td>
                  <td style={td()}>{p.beneficiary_masked}</td>
                  <td style={td()}>{formatNaira(p.amount_kobo)}</td>
                  <td style={td()}><Badge status={p.status} /></td>
                  <td style={td()}>{fmtDate(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
