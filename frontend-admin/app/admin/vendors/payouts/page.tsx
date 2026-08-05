'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { VendorPayoutFilters, VendorPayoutRow } from '@/types/vendorsAdmin';
import { listVendorPayouts, formatKobo, ageFromNow } from '@/services/vendorsAdminService';
import { JobStatusBadge } from '../statusBadge';
import { useVendorPermissions, VENDOR_PERMS } from '../_ui';
import { Page, PageHeader, Card, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUS_OPTIONS = ['', 'available', 'accepted', 'en_route', 'in_progress', 'completed', 'paid', 'rejected'];

const defaultFilters: VendorPayoutFilters = { status: '', estateId: '' };

// A job flagged as disputed by convention (title contains "dispute"); the backend
// has no vendor-dispute surface, so this is read-only signalling only.
function isDisputed(r: VendorPayoutRow): boolean {
  return /dispute/i.test(r.title);
}

export default function VendorPayoutsPage() {
  const { can } = useVendorPermissions();
  const canView = can(VENDOR_PERMS.view);

  const [filters, setFilters] = useState<VendorPayoutFilters>(defaultFilters);
  const [rows, setRows] = useState<VendorPayoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await listVendorPayouts(filters));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const paid = rows.filter((r) => r.status === 'paid');
  const awaiting = rows.filter((r) => r.status === 'completed');
  const disputed = rows.filter(isDisputed);
  const paidTotal = paid.reduce((s, r) => s + r.amountKobo, 0);

  return (
    <Page>
      <p><Link href="/admin/vendors">← Back to Vendor Directory</Link></p>

      <PageHeader
        title="Vendor Payouts & Disputes"
        subtitle="Read-only oversight of the estate vendor payout lifecycle (available → accepted → … → completed → paid). Payouts are idempotent, kobo-denominated, and posted server-side as a balanced double-entry (DEBIT estate settlement → CREDIT vendor wallet). This surface does not trigger money movement."
      />

      <Card style={{ marginBottom: 12, background: `${colors.warning}14`, borderColor: colors.warning }}>
        <p style={{ margin: 0, fontSize: 12, color: colors.warning }}>
          ⚠ Read-only. The backend exposes vendor jobs + RequestVendorPayout (vendor-initiated) but has
          NO admin payout-run or vendor-dispute route. Disputed jobs are flagged here by convention only.
        </p>
      </Card>

      {error ? <p style={{ color: colors.danger }}>{error}</p> : null}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <Card style={{ padding: 12 }}><div style={{ fontSize: 11, color: colors.muted }}>Paid (visible)</div><strong>{formatKobo(paidTotal)}</strong></Card>
        <Card style={{ padding: 12 }}><div style={{ fontSize: 11, color: colors.muted }}>Awaiting payout</div><strong>{awaiting.length}</strong></Card>
        <Card style={{ padding: 12 }}><div style={{ fontSize: 11, color: colors.muted }}>Disputed</div><strong style={{ color: disputed.length ? colors.danger : undefined }}>{disputed.length}</strong></Card>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
          {STATUS_OPTIONS.map((v) => <option key={v} value={v}>{v ? v.replace(/_/g, ' ') : 'All statuses'}</option>)}
        </select>
        <Button variant="outline" sm onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Apply'}</Button>
        <Button variant="secondary" sm onClick={() => setFilters(defaultFilters)} disabled={loading}>Reset</Button>
        <span style={{ fontSize: 12, color: colors.muted }}>{rows.length} job(s)</span>
      </div>

      {!loading && rows.length === 0 ? (
        <p style={{ color: colors.muted, marginTop: 24 }}>No vendor jobs match the current filters.</p>
      ) : null}

      {rows.length > 0 && canView ? (
        <Card style={{ padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Job', 'Estate', 'Vendor', 'Status', 'Amount', 'Payout ref', 'Completed', 'Paid'].map((h) => (
                  <th key={h} style={thCell}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdCell}>
                    {r.title}
                    {isDisputed(r) ? <span style={{ color: colors.danger, marginLeft: 6, fontSize: 11 }}>● disputed</span> : null}
                    <div style={{ fontSize: 11, color: colors.muted, fontFamily: 'monospace' }}>{r.id}</div>
                  </td>
                  <td style={tdCell}>{r.estateName}</td>
                  <td style={tdCell}>{r.vendorName}</td>
                  <td style={tdCell}><JobStatusBadge status={r.status} /></td>
                  <td style={tdCell}>{formatKobo(r.amountKobo)}</td>
                  <td style={{ ...tdCell, fontFamily: 'monospace', fontSize: 11, color: colors.muted }}>{r.payoutRef || '—'}</td>
                  <td style={{ ...tdCell, color: colors.muted }}>{r.completedAt ? `${ageFromNow(r.completedAt)} ago` : '—'}</td>
                  <td style={{ ...tdCell, color: colors.muted }}>{r.paidAt ? `${ageFromNow(r.paidAt)} ago` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </Page>
  );
}
