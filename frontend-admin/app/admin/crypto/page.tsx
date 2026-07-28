'use client';

import { useEffect, useState } from 'react';
import {
  adminListAssets, adminListOrders, adminListWithdrawals, adminGetReconciliation, formatKobo,
} from '@/services/cryptoAdminService';
import { PageHeader, CryptoTabs, Card, Kpi, DisclosureNote } from './_ui';

export default function CryptoOverviewPage() {
  const [assetsTotal, setAssetsTotal] = useState<number | null>(null);
  const [assetsActive, setAssetsActive] = useState<number | null>(null);
  const [ordersTotal, setOrdersTotal] = useState<number | null>(null);
  const [pendingOrders, setPendingOrders] = useState<number | null>(null);
  const [failedOrders, setFailedOrders] = useState<number | null>(null);
  const [volumeKobo, setVolumeKobo] = useState<number>(0);
  const [pendingWithdrawals, setPendingWithdrawals] = useState<number | null>(null);
  const [reconBreaks, setReconBreaks] = useState<number | null>(null);

  useEffect(() => {
    void adminListAssets().then((r) => {
      setAssetsTotal(r.length);
      setAssetsActive(r.filter((a) => a.is_active).length);
    }).catch(() => { setAssetsTotal(null); setAssetsActive(null); });

    void adminListOrders(200, 0).then((r) => {
      setOrdersTotal(r.length);
      setPendingOrders(r.filter((o) => o.status === 'pending').length);
      setFailedOrders(r.filter((o) => o.status === 'failed').length);
      setVolumeKobo(r.filter((o) => o.status === 'filled').reduce((sum, o) => sum + o.cash_kobo, 0));
    }).catch(() => { setOrdersTotal(null); setPendingOrders(null); setFailedOrders(null); });

    void adminListWithdrawals('requested').then((r) => setPendingWithdrawals(r.length)).catch(() => setPendingWithdrawals(null));
    void adminGetReconciliation().then((s) => setReconBreaks(s.breaks)).catch(() => setReconBreaks(null));
  }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Paymax Crypto — Ops Console"
        subtitle="Order oversight and admin-curated asset catalogue for the crypto buy/sell module. Money path reuses the shared finance ledger (idempotent, double-entry, audited)."
      />
      <CryptoTabs active="overview" />
      <DisclosureNote>
        Backed by <code>GET/POST /api/v1/admin/crypto/*</code> (RBAC <code>crypto.admin</code>). Every fill on the
        member side requires an <code>Idempotency-Key</code>, posts a balanced double-entry pair against the shared
        escrow standing account, and snapshots the quote. Holdings are integer asset minor units; cash is NGN kobo —
        no float math anywhere on this path.
      </DisclosureNote>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Assets in catalogue" value={assetsTotal != null ? String(assetsTotal) : '—'} sub={assetsActive != null ? `${assetsActive} active/tradable` : undefined} />
        <Kpi label="Orders (recent page)" value={ordersTotal != null ? String(ordersTotal) : '—'} />
        <Kpi label="Pending orders" value={pendingOrders != null ? String(pendingOrders) : '—'} accent={pendingOrders && pendingOrders > 0 ? '#9a3412' : undefined} />
        <Kpi label="Failed orders" value={failedOrders != null ? String(failedOrders) : '—'} accent={failedOrders && failedOrders > 0 ? '#b91c1c' : undefined} />
        <Kpi label="Withdrawals awaiting AML" value={pendingWithdrawals != null ? String(pendingWithdrawals) : '—'} accent={pendingWithdrawals && pendingWithdrawals > 0 ? '#9a3412' : undefined} />
        <Kpi label="Reconciliation breaks" value={reconBreaks != null ? String(reconBreaks) : '—'} accent={reconBreaks && reconBreaks > 0 ? '#b91c1c' : '#15803d'} />
        <Kpi label="Filled volume (cash)" value={formatKobo(volumeKobo)} accent="#340075" />
      </div>

      <Card title="Modules">
        <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.88rem', color: '#374151', lineHeight: 1.9 }}>
          <li><strong>Orders</strong> — all-user buy/sell fill history, read-only oversight, filterable by status.</li>
          <li><strong>Withdrawals / AML</strong> — approval queue for outbound crypto withdrawals with AML risk scoring and flags; approve/reject with a mandatory audited note.</li>
          <li><strong>Swaps</strong> — asset→asset swap monitoring: realised rates, spread revenue, volume and anomaly detection.</li>
          <li><strong>Address review</strong> — allow-list review of withdrawal destinations with screening verdicts; approve/reject with a mandatory audited note.</li>
          <li><strong>Reconciliation</strong> — per-asset on-chain vs ledger drift, breaks surfaced (FX SF-8 pattern).</li>
          <li><strong>Assets</strong> — admin-curated tradable catalogue: create, activate/deactivate, and configure minor-unit scale.</li>
        </ul>
      </Card>
    </div>
  );
}
