'use client';

// A-EST-05 — Dues & collections. Invoices paid vs pending, arrears, restrictions.

import { useEffect, useMemo, useState } from 'react';
import { listDuesInvoices } from '@/services/estateAdminService';
import type { AdminDuesInvoice } from '@/types/estateAdmin';
import { PageHeader, EstateTabs, Card, Kpi, Badge, btn, th, td, naira } from '../_ui';

export default function DuesPage() {
  const [rows, setRows] = useState<AdminDuesInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listDuesInvoices()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const totals = useMemo(() => {
    const billed = rows.reduce((s, r) => s + r.amountKobo, 0);
    const paid = rows.reduce((s, r) => s + r.paidKobo, 0);
    const arrears = rows.reduce((s, r) => s + Math.max(0, r.amountKobo - r.paidKobo), 0);
    const restricted = rows.filter((r) => r.restricted);
    return { billed, paid, arrears, restricted };
  }, [rows]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Dues & collections" subtitle="Service charges and levies — paid vs pending, arrears and access restrictions." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <EstateTabs active="dues" />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      {loading ? <p style={{ color: '#6b7280' }}>Loading invoices…</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <Kpi label="Total billed" value={naira(totals.billed)} accent="#1d4ed8" />
            <Kpi label="Collected" value={naira(totals.paid)} accent="#16a34a" />
            <Kpi label="Arrears outstanding" value={naira(totals.arrears)} accent={totals.arrears ? '#d97706' : '#16a34a'} />
            <Kpi label="Restricted units" value={String(totals.restricted.length)} accent={totals.restricted.length ? '#dc2626' : '#16a34a'} />
          </div>

          <Card title="Invoices">
            {rows.length === 0 ? <p style={{ color: '#6b7280' }}>No invoices.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Reference</th><th style={th()}>Unit / Resident</th><th style={th()}>Description</th><th style={th()}>Billed</th><th style={th()}>Paid</th><th style={th()}>Outstanding</th><th style={th()}>Status</th></tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const out = Math.max(0, r.amountKobo - r.paidKobo);
                    return (
                      <tr key={r.id}>
                        <td style={td()}>{r.reference}</td>
                        <td style={td()}><strong>{r.unit}</strong><div style={{ color: '#6b7280', fontSize: '0.75rem' }}>{r.residentName}</div></td>
                        <td style={td()}>{r.description}</td>
                        <td style={td()}>{naira(r.amountKobo)}</td>
                        <td style={td()}>{naira(r.paidKobo)}</td>
                        <td style={td()}>{out > 0 ? <span style={{ color: '#d97706' }}>{naira(out)}</span> : <span style={{ color: '#16a34a' }}>—</span>}</td>
                        <td style={td()}><Badge status={r.status} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Access restrictions">
            {totals.restricted.length === 0 ? <p style={{ color: '#6b7280' }}>No units currently restricted for non-payment.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Unit</th><th style={th()}>Resident</th><th style={th()}>Reason</th><th style={th()}>Outstanding</th></tr></thead>
                <tbody>
                  {totals.restricted.map((r) => (
                    <tr key={r.id}>
                      <td style={td()}>{r.unit}</td>
                      <td style={td()}>{r.residentName}</td>
                      <td style={td()}>{r.description}</td>
                      <td style={td()}><span style={{ color: '#dc2626' }}>{naira(Math.max(0, r.amountKobo - r.paidKobo))}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
