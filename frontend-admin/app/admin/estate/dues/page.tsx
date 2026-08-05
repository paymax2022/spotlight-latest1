'use client';

// A-EST-05 — Dues & collections. Invoices paid vs pending, arrears, restrictions.

import { useEffect, useMemo, useState } from 'react';
import { listDuesInvoices } from '@/services/estateAdminService';
import type { AdminDuesInvoice } from '@/types/estateAdmin';
import { EstateTabs, Kpi, naira } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  if (status === 'paid') return colors.success;
  if (status === 'overdue' || status === 'restricted') return colors.danger;
  if (status === 'pending') return colors.warning;
  return colors.secondary;
}
const cap = (s: string) => s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());

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
    <Page>
      <PageHeader title="Dues & collections" subtitle="Service charges and levies — paid vs pending, arrears and access restrictions." actions={<Button variant="outline" sm onClick={load}>Refresh</Button>} />
      <EstateTabs active="dues" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      {loading ? <p style={{ color: colors.muted }}>Loading invoices…</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <Kpi label="Total billed" value={naira(totals.billed)} accent={colors.info} />
            <Kpi label="Collected" value={naira(totals.paid)} accent={colors.success} />
            <Kpi label="Arrears outstanding" value={naira(totals.arrears)} accent={totals.arrears ? colors.warning : colors.success} />
            <Kpi label="Restricted units" value={String(totals.restricted.length)} accent={totals.restricted.length ? colors.danger : colors.success} />
          </div>

          <Card title="Invoices" style={{ marginBottom: '1.25rem' }}>
            {rows.length === 0 ? <p style={{ color: colors.muted }}>No invoices.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={thCell}>Reference</th><th style={thCell}>Unit / Resident</th><th style={thCell}>Description</th><th style={thCell}>Billed</th><th style={thCell}>Paid</th><th style={thCell}>Outstanding</th><th style={thCell}>Status</th></tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const out = Math.max(0, r.amountKobo - r.paidKobo);
                    return (
                      <tr key={r.id}>
                        <td style={tdCell}>{r.reference}</td>
                        <td style={tdCell}><strong>{r.unit}</strong><div style={{ color: colors.muted, fontSize: '0.75rem' }}>{r.residentName}</div></td>
                        <td style={tdCell}>{r.description}</td>
                        <td style={tdCell}>{naira(r.amountKobo)}</td>
                        <td style={tdCell}>{naira(r.paidKobo)}</td>
                        <td style={tdCell}>{out > 0 ? <span style={{ color: colors.warning }}>{naira(out)}</span> : <span style={{ color: colors.success }}>—</span>}</td>
                        <td style={tdCell}><Badge text={cap(r.status)} color={statusColor(r.status)} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Access restrictions">
            {totals.restricted.length === 0 ? <p style={{ color: colors.muted }}>No units currently restricted for non-payment.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={thCell}>Unit</th><th style={thCell}>Resident</th><th style={thCell}>Reason</th><th style={thCell}>Outstanding</th></tr></thead>
                <tbody>
                  {totals.restricted.map((r) => (
                    <tr key={r.id}>
                      <td style={tdCell}>{r.unit}</td>
                      <td style={tdCell}>{r.residentName}</td>
                      <td style={tdCell}>{r.description}</td>
                      <td style={tdCell}><span style={{ color: colors.danger }}>{naira(Math.max(0, r.amountKobo - r.paidKobo))}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}
