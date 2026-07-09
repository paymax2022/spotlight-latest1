'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { VendorFilters, VendorRow, VendorStatus } from '@/types/vendorsAdmin';
import { listVendors, setVendorStatus, formatKobo, ageFromNow } from '@/services/vendorsAdminService';
import { VendorStatusBadge } from './statusBadge';
import { useVendorPermissions, VENDOR_PERMS } from './_ui';

const card = { border: '1px solid #2a2a2a', padding: 12, borderRadius: 6 } as const;
const th = { padding: '8px 6px', fontWeight: 600, opacity: 0.8 } as const;
const td = { padding: '8px 6px' } as const;
const input = { background: '#111', color: '#eee', border: '1px solid #2a2a2a', padding: '4px 6px', borderRadius: 4 } as const;

const STATUS_OPTIONS = ['', 'pending', 'verified', 'suspended'];
const CATEGORY_OPTIONS = ['', 'plumbing', 'electrical', 'cleaning', 'security', 'landscaping', 'general'];

const defaultFilters: VendorFilters = { status: '', category: '', estateId: '', q: '' };

export default function VendorsDirectoryPage() {
  const { can } = useVendorPermissions();
  const canManage = can(VENDOR_PERMS.manage);

  const [filters, setFilters] = useState<VendorFilters>(defaultFilters);
  const [rows, setRows] = useState<VendorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await listVendors(filters));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSetStatus = async (v: VendorRow, status: VendorStatus, label: string) => {
    if (!confirm(`${label} vendor "${v.businessName}" in ${v.estateName}?`)) return;
    setBusyId(v.id);
    setError('');
    setMessage('');
    try {
      await setVendorStatus(v.estateId, v.id, status);
      setMessage(`${label} succeeded for ${v.businessName}.`);
      await load();
    } catch (e) {
      setError(`${label} failed: ${String(e)}`);
    } finally {
      setBusyId('');
    }
  };

  const verifiedCount = rows.filter((r) => r.status === 'verified').length;

  return (
    <div>
      <h1>Vendor Directory</h1>
      <p style={{ fontSize: 13, opacity: 0.7 }}>
        Cross-estate marketplace vendor oversight — the estate/marketplace side of the mobile
        vendor-portal. Verify or suspend vendors; verify/suspend is role-gated (estate.manage)
        and audited server-side.
      </p>
      <p style={{ display: 'flex', gap: 12, fontSize: 13 }}>
        <Link href="/admin/vendors/onboarding">Onboarding / Approval Queue →</Link>
        <Link href="/admin/vendors/payouts">Payouts &amp; Disputes →</Link>
      </p>
      <p style={{ fontSize: 12, color: '#fde68a', ...card, background: '#1a1400', borderColor: '#78350f' }}>
        ⚠ Estate vendor endpoints are estate-object-scoped (no cross-estate admin aggregate route).
        This directory aggregates per-estate GET /estate/:id/vendors; mock by default until an admin
        aggregate lands.
      </p>

      {message ? <p style={{ color: 'lightgreen' }}>{message}</p> : null}
      {error ? <p style={{ color: 'salmon' }}>{error}</p> : null}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
        <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} style={input}>
          {STATUS_OPTIONS.map((v) => <option key={v} value={v}>{v ? v : 'All statuses'}</option>)}
        </select>
        <select value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))} style={input}>
          {CATEGORY_OPTIONS.map((v) => <option key={v} value={v}>{v ? v : 'All categories'}</option>)}
        </select>
        <input placeholder="Search name / business / estate…" value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} style={input} />
        <button onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Apply'}</button>
        <button onClick={() => setFilters(defaultFilters)} disabled={loading}>Reset</button>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{rows.length} vendor(s) · {verifiedCount} verified</span>
      </div>

      {!loading && rows.length === 0 ? (
        <p style={{ opacity: 0.6, marginTop: 24 }}>No vendors match the current filters.</p>
      ) : null}

      {rows.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 16 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2a2a', textAlign: 'left' }}>
              {['Vendor', 'Estate', 'Category', 'Status', 'Rating', 'Jobs (paid/open)', 'Earned', 'Actions'].map((h) => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id} style={{ borderBottom: '1px solid #1c1c1c' }}>
                <td style={td}>
                  <strong>{v.businessName}</strong>
                  <div style={{ fontSize: 11, opacity: 0.6 }}>{v.name} · {v.phone}</div>
                  <div style={{ fontSize: 11, opacity: 0.5 }}>{v.specialties.join(', ') || '—'}</div>
                </td>
                <td style={td}>{v.estateName}</td>
                <td style={{ ...td, textTransform: 'capitalize' }}>{v.category}</td>
                <td style={td}><VendorStatusBadge status={v.status} /></td>
                <td style={td}>{v.rating ? v.rating.toFixed(1) : '—'}</td>
                <td style={td}>{v.paidJobs} / {v.openJobs}</td>
                <td style={td}>{formatKobo(v.totalEarnedKobo)}</td>
                <td style={td}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {v.status !== 'verified' ? (
                      <button onClick={() => onSetStatus(v, 'verified', 'Verify')} disabled={busyId === v.id || !canManage} title={!canManage ? 'Requires estate.manage' : ''}>
                        {busyId === v.id ? '…' : 'Verify'}
                      </button>
                    ) : null}
                    {v.status !== 'suspended' ? (
                      <button onClick={() => onSetStatus(v, 'suspended', 'Suspend')} disabled={busyId === v.id || !canManage} title={!canManage ? 'Requires estate.manage' : ''}>
                        Suspend
                      </button>
                    ) : (
                      <button onClick={() => onSetStatus(v, 'verified', 'Reinstate')} disabled={busyId === v.id || !canManage}>Reinstate</button>
                    )}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}>added {ageFromNow(v.createdAt)} ago</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
