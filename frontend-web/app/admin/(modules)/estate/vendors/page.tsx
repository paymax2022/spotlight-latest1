'use client';

// A-EST-11 — Vendors / artisans directory + approval state.

import { useEffect, useState } from 'react';
import { listVendors, verifyVendor } from '@/services/estateAdminService';
import type { AdminVendor } from '@/types/estateAdmin';
import { EstateTabs } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const cap = (s: string) => s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
function statusColor(status: string): string {
  if (status === 'verified') return colors.success;
  if (status === 'pending') return colors.warning;
  if (status === 'rejected' || status === 'suspended') return colors.danger;
  return colors.secondary;
}

export default function VendorsPage() {
  const [rows, setRows] = useState<AdminVendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listVendors()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function verify(id: string) {
    setBusy(id);
    const prev = rows;
    setRows((r) => r.map((x) => (x.id === id ? { ...x, status: 'verified' } : x))); // optimistic
    try { await verifyVendor(id); }
    catch (e) { setError(String(e)); setRows(prev); }
    finally { setBusy(null); }
  }

  return (
    <Page>
      <PageHeader title="Vendors & artisans" subtitle="Approved trades directory. Verify pending applications before they take estate jobs." actions={<Button variant="outline" sm onClick={load}>Refresh</Button>} />
      <EstateTabs active="vendors" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <Card title="Vendor directory">
        {loading ? <p style={{ color: colors.muted }}>Loading vendors…</p> : rows.length === 0 ? (
          <p style={{ color: colors.muted }}>No vendors registered.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Vendor</th><th style={thCell}>Trade</th><th style={thCell}>Phone</th><th style={thCell}>Rating</th><th style={thCell}>Jobs</th><th style={thCell}>Status</th><th style={thCell}>Actions</th></tr></thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td style={tdCell}><strong>{v.name}</strong></td>
                  <td style={tdCell}>{v.trade}</td>
                  <td style={tdCell}>{v.phone}</td>
                  <td style={tdCell}>{v.rating > 0 ? `${v.rating.toFixed(1)} ★` : '—'}</td>
                  <td style={tdCell}>{v.jobsCompleted}</td>
                  <td style={tdCell}><Badge text={cap(v.status)} color={statusColor(v.status)} /></td>
                  <td style={tdCell}>
                    {v.status === 'pending'
                      ? <Button variant="primary" sm disabled={busy === v.id} onClick={() => verify(v.id)}>Verify</Button>
                      : <span style={{ color: colors.muted, fontSize: '0.8rem' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
