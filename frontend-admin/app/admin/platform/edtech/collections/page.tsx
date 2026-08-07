'use client';

// SU-03 — Platform-Wide Collections Dashboard. Aggregate GMV, collection trend,
// and reconciliation health (SF-8 nightly recon) across every school.

import { useEffect, useState } from 'react';
import { getCollectionsOverview } from '@/services/platformEdtechAdminService';
import type { CollectionsOverview } from '@/types/platformEdtechAdmin';
import {
  PlatformGuard, PlatformTabs, formatNaira, fmtDate, timeAgo,
  PageHeader, Card, Kpi, StateBlock, DisclosureNote, Bar, th, td,
} from '../_ui';
import { colors } from '@/components/ui/vuexy';

export default function CollectionsPage() {
  const [ov, setOv] = useState<CollectionsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setOv(await getCollectionsOverview()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const maxTrend = ov ? Math.max(1, ...ov.gmv_trend.map((p) => p.value_kobo)) : 1;
  const maxTop = ov ? Math.max(1, ...ov.top_schools.map((s) => s.gmv_kobo)) : 1;

  return (
    <PlatformGuard>
      <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
        <PageHeader title="Platform-Wide Collections" subtitle="Aggregate GMV, collection rate and reconciliation health across the whole EdTech platform. Balances are ledger projections — never mutated directly." action={<button onClick={load} style={{ padding: '0.35rem 0.8rem' }}>Refresh</button>} />
        <PlatformTabs active="collections" />
        <DisclosureNote>Requires <code>platform_edtech_admin</code>. All amounts in ₦ (kobo internally). Reconciliation drift feeds the nightly SF-8 job; flagged items should be worked in the Fraud &amp; Risk queue (SU-04).</DisclosureNote>

        <StateBlock loading={loading} error={error} empty={!ov}>
          {ov ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <Kpi label="GMV (lifetime)" value={formatNaira(ov.gmv_kobo)} accent={colors.success} />
                <Kpi label="GMV today" value={formatNaira(ov.gmv_today_kobo)} />
                <Kpi label="Collection rate" value={`${(ov.collection_rate * 100).toFixed(1)}%`} sub={`${ov.invoices_paid.toLocaleString('en-NG')} / ${ov.invoices_issued.toLocaleString('en-NG')} invoices`} accent={colors.primary} />
                <Kpi label="Recon drift flagged" value={ov.reconciliation.drift_flagged.toString()} accent={ov.reconciliation.drift_flagged > 0 ? colors.danger : colors.success} sub={`last run ${timeAgo(ov.reconciliation.last_run_at)}`} />
              </div>

              <Card title="GMV — last 14 days">
                <div style={{ display: 'grid', gap: '0.35rem' }}>
                  {ov.gmv_trend.map((p) => <Bar key={p.date} value={p.value_kobo} max={maxTrend} labelLeft={p.date.slice(5)} labelRight={formatNaira(p.value_kobo)} />)}
                </div>
              </Card>

              <Card title="Reconciliation health (SF-8)">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem' }}>
                  <Kpi label="Matched" value={ov.reconciliation.matched.toLocaleString('en-NG')} accent={colors.success} />
                  <Kpi label="Pending" value={ov.reconciliation.pending.toLocaleString('en-NG')} accent={colors.warning} />
                  <Kpi label="Drift flagged" value={ov.reconciliation.drift_flagged.toLocaleString('en-NG')} accent={colors.danger} />
                  <Kpi label="Last run" value={fmtDate(ov.reconciliation.last_run_at)} />
                </div>
              </Card>

              <Card title="Top schools by GMV">
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th()}>School</th><th style={th()}>GMV</th></tr></thead>
                  <tbody>
                    {ov.top_schools.map((s) => (
                      <tr key={s.school_id}><td style={td()}><strong>{s.name}</strong></td><td style={td()}><div style={{ minWidth: 200 }}><Bar value={s.gmv_kobo} max={maxTop} labelRight={formatNaira(s.gmv_kobo)} /></div></td></tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </>
          ) : null}
        </StateBlock>
      </div>
    </PlatformGuard>
  );
}
