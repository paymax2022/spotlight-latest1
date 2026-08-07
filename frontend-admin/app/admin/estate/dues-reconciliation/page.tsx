'use client';

// A-EST-OV-03 — Platform dues reconciliation (estate.admin.dues).
// Billed vs collected vs outstanding per estate; payments; restrictions.

import { useCallback, useEffect, useState } from 'react';
import {
  getDuesReconciliation, listOversightPayments, listOversightRestrictions,
} from '@/services/estateAdminService';
import type { DuesReconciliationRow, OversightPayment, OversightRestriction } from '@/types/estateAdmin';
import { EstateOversightTabs, Restricted, useEstatePermissions, ESTATE_ADMIN_PERMS, naira, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const cap = (s: string) => s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());

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
    <Page>
      <PageHeader title="Dues reconciliation" subtitle="Billed vs collected vs outstanding per estate. Variance surfaces ledger/projection drift." actions={<Button variant="outline" sm onClick={() => void load()}>Refresh</Button>} />
      <EstateOversightTabs active="dues-reconciliation" />
      {!canView ? <Restricted perm="estate.admin.dues" /> : (
        <>
          {error && <p style={{ color: colors.danger }}>{error}</p>}
          {loading ? <p style={{ color: colors.muted }}>Loading reconciliation…</p> : (
            <>
              <Card title="Collections vs ledger" style={{ marginBottom: '1.25rem' }}>
                {recon.length === 0 ? <p style={{ color: colors.muted }}>No dues data.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={thCell}>Estate</th><th style={thCell}>Billed</th><th style={thCell}>Collected</th><th style={thCell}>Paid invoices</th><th style={thCell}>Outstanding</th><th style={thCell}>Overdue</th><th style={thCell}>Variance</th></tr></thead>
                    <tbody>
                      {recon.map((r) => (
                        <tr key={r.estateId}>
                          <td style={tdCell}><strong>{r.estateId}</strong></td>
                          <td style={tdCell}>{naira(r.billedKobo)}</td>
                          <td style={tdCell}>{naira(r.collectedKobo)}</td>
                          <td style={tdCell}>{naira(r.paidInvoiceKobo)}</td>
                          <td style={tdCell}>{naira(r.outstandingKobo)}</td>
                          <td style={tdCell}>{r.overdueCount}</td>
                          <td style={tdCell}>{r.varianceKobo === 0 ? <Badge text="Balanced" color={colors.success} /> : <Badge text={naira(r.varianceKobo)} color={colors.danger} />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <Card title="Recent payments" style={{ marginBottom: '1.25rem' }}>
                {payments.length === 0 ? <p style={{ color: colors.muted }}>No payments.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={thCell}>Estate</th><th style={thCell}>Payer</th><th style={thCell}>Amount</th><th style={thCell}>Method</th><th style={thCell}>Status</th><th style={thCell}>Reference</th><th style={thCell}>When</th></tr></thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.id}>
                          <td style={tdCell}>{p.estateId}</td>
                          <td style={tdCell}>{p.payerId}</td>
                          <td style={tdCell}>{naira(p.amountKobo)}</td>
                          <td style={tdCell}>{p.method}</td>
                          <td style={tdCell}><Badge text={cap(p.status)} color={p.status === 'successful' ? colors.success : p.status === 'refunded' ? colors.danger : colors.warning} /></td>
                          <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{p.reference ?? '—'}</code></td>
                          <td style={tdCell}>{timeAgo(p.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <Card title="Access restrictions">
                {restrictions.length === 0 ? <p style={{ color: colors.muted }}>No restrictions.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={thCell}>Estate</th><th style={thCell}>Resident</th><th style={thCell}>Level</th><th style={thCell}>Reason</th><th style={thCell}>Active</th><th style={thCell}>Applied</th></tr></thead>
                    <tbody>
                      {restrictions.map((x) => (
                        <tr key={x.id}>
                          <td style={tdCell}>{x.estateId}</td>
                          <td style={tdCell}>{x.residentId}</td>
                          <td style={tdCell}><Badge text={cap(x.level)} color={x.level === 'hard' ? colors.danger : colors.warning} /></td>
                          <td style={tdCell}>{x.reason ?? '—'}</td>
                          <td style={tdCell}><Badge text={x.active ? 'Active' : 'Lifted'} color={x.active ? colors.danger : colors.success} /></td>
                          <td style={tdCell}>{timeAgo(x.createdAt)}</td>
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
    </Page>
  );
}
