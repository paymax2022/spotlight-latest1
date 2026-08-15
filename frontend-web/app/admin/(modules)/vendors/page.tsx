'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { VendorFilters, VendorRow, VendorStatus } from '@/types/vendorsAdmin';
import { listVendors, setVendorStatus, formatKobo, ageFromNow } from '@/services/vendorsAdminService';
import { VendorStatusBadge } from './statusBadge';
import { useVendorPermissions, VENDOR_PERMS } from './_ui';
import { Page, PageHeader, Card, Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader
        title="Vendor Directory"
        subtitle="Cross-estate marketplace vendor oversight — the estate/marketplace side of the mobile vendor-portal. Verify or suspend vendors; verify/suspend is role-gated (estate.manage) and audited server-side."
      />

      <p style={{ display: 'flex', gap: 12, fontSize: 13 }}>
        <Link href="/admin/vendors/onboarding" style={{ color: colors.primary }}>Onboarding / Approval Queue →</Link>
        <Link href="/admin/vendors/payouts" style={{ color: colors.primary }}>Payouts &amp; Disputes →</Link>
      </p>

      <Card style={{ background: colors.card, borderColor: colors.warning, marginBottom: 16 }}>
        <p style={{ margin: 0, fontSize: 12, color: colors.warning }}>
          ⚠ Estate vendor endpoints are estate-object-scoped (no cross-estate admin aggregate route).
          This directory aggregates per-estate GET /estate/:id/vendors; mock by default until an admin
          aggregate lands.
        </p>
      </Card>

      {message ? <p style={{ color: colors.success }}>{message}</p> : null}
      {error ? <p style={{ color: colors.danger }}>{error}</p> : null}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
        <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
          {STATUS_OPTIONS.map((v) => <option key={v} value={v}>{v ? v : 'All statuses'}</option>)}
        </select>
        <select value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}>
          {CATEGORY_OPTIONS.map((v) => <option key={v} value={v}>{v ? v : 'All categories'}</option>)}
        </select>
        <Input placeholder="Search name / business / estate…" value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
        <Button variant="outline" onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Apply'}</Button>
        <Button variant="secondary" onClick={() => setFilters(defaultFilters)} disabled={loading}>Reset</Button>
        <span style={{ fontSize: 12, color: colors.muted }}>{rows.length} vendor(s) · {verifiedCount} verified</span>
      </div>

      {!loading && rows.length === 0 ? (
        <p style={{ color: colors.muted, marginTop: 24 }}>No vendors match the current filters.</p>
      ) : null}

      {rows.length > 0 ? (
        <Card style={{ padding: 0, overflow: 'auto', marginTop: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Vendor', 'Estate', 'Category', 'Status', 'Rating', 'Jobs (paid/open)', 'Earned', 'Actions'].map((h) => (
                  <th key={h} style={thCell}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td style={tdCell}>
                    <strong>{v.businessName}</strong>
                    <div style={{ fontSize: 11, color: colors.muted }}>{v.name} · {v.phone}</div>
                    <div style={{ fontSize: 11, color: colors.muted }}>{v.specialties.join(', ') || '—'}</div>
                  </td>
                  <td style={tdCell}>{v.estateName}</td>
                  <td style={{ ...tdCell, textTransform: 'capitalize' }}>{v.category}</td>
                  <td style={tdCell}><VendorStatusBadge status={v.status} /></td>
                  <td style={tdCell}>{v.rating ? v.rating.toFixed(1) : '—'}</td>
                  <td style={tdCell}>{v.paidJobs} / {v.openJobs}</td>
                  <td style={tdCell}>{formatKobo(v.totalEarnedKobo)}</td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {v.status !== 'verified' ? (
                        <Button variant="primary" sm onClick={() => onSetStatus(v, 'verified', 'Verify')} disabled={busyId === v.id || !canManage} title={!canManage ? 'Requires estate.manage' : ''}>
                          {busyId === v.id ? '…' : 'Verify'}
                        </Button>
                      ) : null}
                      {v.status !== 'suspended' ? (
                        <Button variant="danger" sm onClick={() => onSetStatus(v, 'suspended', 'Suspend')} disabled={busyId === v.id || !canManage} title={!canManage ? 'Requires estate.manage' : ''}>
                          Suspend
                        </Button>
                      ) : (
                        <Button variant="outline" sm onClick={() => onSetStatus(v, 'verified', 'Reinstate')} disabled={busyId === v.id || !canManage}>Reinstate</Button>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>added {ageFromNow(v.createdAt)} ago</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </Page>
  );
}
