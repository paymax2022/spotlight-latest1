'use client';

// A-EST-11 — Vendors / artisans directory + approval state.

import { useEffect, useState } from 'react';
import { listVendors, verifyVendor } from '@/services/estateAdminService';
import type { AdminVendor } from '@/types/estateAdmin';
import { PageHeader, EstateTabs, Card, Badge, btn, btnPrimary, th, td } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Vendors & artisans" subtitle="Approved trades directory. Verify pending applications before they take estate jobs." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <EstateTabs active="vendors" />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <Card title="Vendor directory">
        {loading ? <p style={{ color: '#6b7280' }}>Loading vendors…</p> : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No vendors registered.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Vendor</th><th style={th()}>Trade</th><th style={th()}>Phone</th><th style={th()}>Rating</th><th style={th()}>Jobs</th><th style={th()}>Status</th><th style={th()}>Actions</th></tr></thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td style={td()}><strong>{v.name}</strong></td>
                  <td style={td()}>{v.trade}</td>
                  <td style={td()}>{v.phone}</td>
                  <td style={td()}>{v.rating > 0 ? `${v.rating.toFixed(1)} ★` : '—'}</td>
                  <td style={td()}>{v.jobsCompleted}</td>
                  <td style={td()}><Badge status={v.status} /></td>
                  <td style={td()}>
                    {v.status === 'pending'
                      ? <button disabled={busy === v.id} onClick={() => verify(v.id)} style={btnPrimary('#16a34a')}>Verify</button>
                      : <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
