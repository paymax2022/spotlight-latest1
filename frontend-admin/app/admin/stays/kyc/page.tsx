'use client';

import { useEffect, useState } from 'react';
import { listKyc, decideKyc } from '@/services/staysAdminService';
import type { KycCase, KycStatus } from '@/types/staysAdmin';
import {
  StaysTabs,
  Badge,
  StateBlock,
  FilterBar,
  DisclosureNote,
  label,
  select,
  timeAgo,
} from '../_ui';
import { Page, PageHeader, Button, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES: KycStatus[] = ['pending', 'approved', 'rejected', 'needs_info'];

export default function StaysKycPage() {
  const [rows, setRows] = useState<KycCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listKyc(status ? { status } : undefined)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function decide(id: string, next: KycStatus) {
    setBusyId(id); setError(null);
    try {
      await decideKyc(id, { status: next });
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Hotelier KYC & verification"
        subtitle="Review business registration, CAC and bank verification for direct-rail hoteliers before they can list inventory and receive Naira payouts."
        actions={<Button variant="outline" sm onClick={load}>Refresh</Button>}
      />
      <StaysTabs active="trust" />

      <DisclosureNote>
        Approval gates listing and payout eligibility. Cases with risk flags are highlighted —
        verify CAC and bank ownership before approving. All decisions are audit-logged.
      </DisclosureNote>

      <FilterBar>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
      </FilterBar>

      <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No KYC cases found.">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thCell}>Business</th>
              <th style={thCell}>Hotelier</th>
              <th style={thCell}>City</th>
              <th style={thCell}>CAC</th>
              <th style={thCell}>Docs</th>
              <th style={thCell}>Bank</th>
              <th style={thCell}>Risk flags</th>
              <th style={thCell}>Status</th>
              <th style={thCell}>Submitted</th>
              <th style={thCell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const flagged = r.risk_flags.length > 0;
              const busy = busyId === r.id;
              return (
                <tr key={r.id} style={flagged ? { background: tint(colors.danger, 0.08) } : undefined}>
                  <td style={tdCell}>{r.business_name}</td>
                  <td style={tdCell}>{r.hotelier_masked}</td>
                  <td style={tdCell}>{r.city}</td>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{r.cac_number_masked}</code></td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                      {r.doc_types.length === 0 ? '—' : r.doc_types.map((d) => <Badge key={d} status={d} label={d.replace(/_/g, ' ')} />)}
                    </div>
                  </td>
                  <td style={tdCell}><Badge status={r.bank_verified ? 'bank_verified' : 'pending'} label={r.bank_verified ? 'Verified' : 'Unverified'} /></td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                      {flagged ? r.risk_flags.map((f) => <Badge key={f} status="high" label={f.replace(/_/g, ' ')} />) : '—'}
                    </div>
                  </td>
                  <td style={tdCell}><Badge status={r.status} /></td>
                  <td style={tdCell}>{timeAgo(r.submitted_at)}</td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                      <Button variant="primary" sm disabled={busy} onClick={() => decide(r.id, 'approved')}>Approve</Button>
                      <Button variant="danger" sm disabled={busy} onClick={() => decide(r.id, 'rejected')}>Reject</Button>
                      <Button variant="outline" sm disabled={busy} onClick={() => decide(r.id, 'needs_info')}>Needs info</Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </StateBlock>
    </Page>
  );
}
