'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { VendorPayoutFilters, VendorPayoutRow } from '@/types/vendorsAdmin';
import { listVendorPayouts, formatKobo, ageFromNow } from '@/services/vendorsAdminService';
import { JobStatusBadge } from '../statusBadge';
import { useVendorPermissions, VENDOR_PERMS } from '../_ui';

const card = { border: '1px solid #2a2a2a', padding: 12, borderRadius: 6 } as const;
const th = { padding: '8px 6px', fontWeight: 600, opacity: 0.8 } as const;
const td = { padding: '8px 6px' } as const;
const input = { background: '#111', color: '#eee', border: '1px solid #2a2a2a', padding: '4px 6px', borderRadius: 4 } as const;

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
    <div>
      <p><Link href="/admin/vendors">← Back to Vendor Directory</Link></p>
      <h1>Vendor Payouts &amp; Disputes</h1>
      <p style={{ fontSize: 13, opacity: 0.7 }}>
        Read-only oversight of the estate vendor payout lifecycle
        (available → accepted → … → completed → paid). Payouts are idempotent, kobo-denominated,
        and posted server-side as a balanced double-entry (DEBIT estate settlement → CREDIT vendor
        wallet). This surface does not trigger money movement.
      </p>
      <p style={{ fontSize: 12, color: '#fde68a', ...card, background: '#1a1400', borderColor: '#78350f' }}>
        ⚠ Read-only. The backend exposes vendor jobs + RequestVendorPayout (vendor-initiated) but has
        NO admin payout-run or vendor-dispute route. Disputed jobs are flagged here by convention only.
      </p>

      {error ? <p style={{ color: 'salmon' }}>{error}</p> : null}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
        <div style={card}><div style={{ fontSize: 11, opacity: 0.6 }}>Paid (visible)</div><strong>{formatKobo(paidTotal)}</strong></div>
        <div style={card}><div style={{ fontSize: 11, opacity: 0.6 }}>Awaiting payout</div><strong>{awaiting.length}</strong></div>
        <div style={card}><div style={{ fontSize: 11, opacity: 0.6 }}>Disputed</div><strong style={{ color: disputed.length ? '#fca5a5' : undefined }}>{disputed.length}</strong></div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
        <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} style={input}>
          {STATUS_OPTIONS.map((v) => <option key={v} value={v}>{v ? v.replace(/_/g, ' ') : 'All statuses'}</option>)}
        </select>
        <button onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Apply'}</button>
        <button onClick={() => setFilters(defaultFilters)} disabled={loading}>Reset</button>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{rows.length} job(s)</span>
      </div>

      {!loading && rows.length === 0 ? (
        <p style={{ opacity: 0.6, marginTop: 24 }}>No vendor jobs match the current filters.</p>
      ) : null}

      {rows.length > 0 && canView ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 16 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2a2a', textAlign: 'left' }}>
              {['Job', 'Estate', 'Vendor', 'Status', 'Amount', 'Payout ref', 'Completed', 'Paid'].map((h) => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #1c1c1c' }}>
                <td style={td}>
                  {r.title}
                  {isDisputed(r) ? <span style={{ color: '#fca5a5', marginLeft: 6, fontSize: 11 }}>● disputed</span> : null}
                  <div style={{ fontSize: 11, opacity: 0.5, fontFamily: 'monospace' }}>{r.id}</div>
                </td>
                <td style={td}>{r.estateName}</td>
                <td style={td}>{r.vendorName}</td>
                <td style={td}><JobStatusBadge status={r.status} /></td>
                <td style={td}>{formatKobo(r.amountKobo)}</td>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: 11, opacity: 0.7 }}>{r.payoutRef || '—'}</td>
                <td style={{ ...td, opacity: 0.6 }}>{r.completedAt ? `${ageFromNow(r.completedAt)} ago` : '—'}</td>
                <td style={{ ...td, opacity: 0.6 }}>{r.paidAt ? `${ageFromNow(r.paidAt)} ago` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
