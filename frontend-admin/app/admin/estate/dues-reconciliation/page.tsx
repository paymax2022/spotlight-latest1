'use client';

// A-EST-OV-03 — Platform dues reconciliation (estate.admin.dues).
// Billed vs collected vs outstanding per estate; payments; restrictions.

import { useCallback, useEffect, useState } from 'react';
import {
  getDuesReconciliation, listOversightPayments, listOversightRestrictions,
} from '@/services/estateAdminService';
import type { DuesReconciliationRow, OversightPayment, OversightRestriction } from '@/types/estateAdmin';
import {
  PageHeader, EstateOversightTabs, Card, Badge, btn, th, td, naira, timeAgo,
  useEstatePermissions, ESTATE_ADMIN_PERMS, Restricted,
} from '../_ui';

export default function DuesReconciliationPage() {
  const { can } = useEstatePermissions();
  const canView = can(ESTATE_ADMIN_PERMS.dues);

  const [recon, setRecon] = useState<DuesReconciliationRow[]>([]);
  const [payments, setPayments] = useState<OversightPayment[]>([]);
  const [restrictions, setRestrictions] = useState<OversightRestriction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true); setError(null);
    try {
      const [r, p, x] = await Promise.all([
        getDuesReconciliation(), listOversightPayments(), listOversightRestrictions(),
      ]);
      setRecon(r); setPayments(p); setRestrictions(x);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [canView]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Dues reconciliation" subtitle="Billed vs collected vs outstanding per estate. Variance surfaces ledger/projection drift." action={<button onClick={() => void load()} style={btn()}>Refresh</button>} />
      <EstateOversightTabs active="dues-reconciliation" />
      {!canView ? <Restricted perm="estate.admin.dues" /> : (
        <>
          {error && <p style={{ color: '#dc2626' }}>{error}</p>}
          {loading ? <p style={{ color: '#6b7280' }}>Loading reconciliation…</p> : (
            <>
              <Card title="Collections vs ledger">
                {recon.length === 0 ? <p style={{ color: '#6b7280' }}>No dues data.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={th()}>Estate</th><th style={th()}>Billed</th><th style={th()}>Collected</th><th style={th()}>Paid invoices</th><th style={th()}>Outstanding</th><th style={th()}>Overdue</th><th style={th()}>Variance</th></tr></thead>
                    <tbody>
                      {recon.map((r) => (
                        <tr key={r.estateId}>
                          <td style={td()}><strong>{r.estateId}</strong></td>
                          <td style={td()}>{naira(r.billedKobo)}</td>
                          <td style={td()}>{naira(r.collectedKobo)}</td>
                          <td style={td()}>{naira(r.paidInvoiceKobo)}</td>
                          <td style={td()}>{naira(r.outstandingKobo)}</td>
                          <td style={td()}>{r.overdueCount}</td>
                          <td style={td()}>{r.varianceKobo === 0 ? <Badge status="paid" label="Balanced" /> : <Badge status="overdue" label={naira(r.varianceKobo)} />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <Card title="Recent payments">
                {payments.length === 0 ? <p style={{ color: '#6b7280' }}>No payments.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={th()}>Estate</th><th style={th()}>Payer</th><th style={th()}>Amount</th><th style={th()}>Method</th><th style={th()}>Status</th><th style={th()}>Reference</th><th style={th()}>When</th></tr></thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.id}>
                          <td style={td()}>{p.estateId}</td>
                          <td style={td()}>{p.payerId}</td>
                          <td style={td()}>{naira(p.amountKobo)}</td>
                          <td style={td()}>{p.method}</td>
                          <td style={td()}><Badge status={p.status === 'successful' ? 'paid' : p.status === 'refunded' ? 'restricted' : 'pending'} label={p.status} /></td>
                          <td style={td()}><code style={{ fontSize: '0.78rem' }}>{p.reference ?? '—'}</code></td>
                          <td style={td()}>{timeAgo(p.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <Card title="Access restrictions">
                {restrictions.length === 0 ? <p style={{ color: '#6b7280' }}>No restrictions.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={th()}>Estate</th><th style={th()}>Resident</th><th style={th()}>Level</th><th style={th()}>Reason</th><th style={th()}>Active</th><th style={th()}>Applied</th></tr></thead>
                    <tbody>
                      {restrictions.map((x) => (
                        <tr key={x.id}>
                          <td style={td()}>{x.estateId}</td>
                          <td style={td()}>{x.residentId}</td>
                          <td style={td()}><Badge status={x.level === 'hard' ? 'overdue' : 'pending'} label={x.level} /></td>
                          <td style={td()}>{x.reason ?? '—'}</td>
                          <td style={td()}><Badge status={x.active ? 'restricted' : 'resolved'} label={x.active ? 'Active' : 'Lifted'} /></td>
                          <td style={td()}>{timeAgo(x.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
