'use client';

// SU-12 — Compliance & Licensing Dashboard. Tracks the platform's Model-A-only
// posture (§4) and flags any drift toward receivables-factoring-like installment
// structures BEFORE they ship. RBAC: platform_edtech_admin.

import { useEffect, useState } from 'react';
import { getCompliancePosture } from '@/services/platformEdtechAdminService';
import type { CompliancePosture } from '@/types/platformEdtechAdmin';
import {
  PlatformGuard, PlatformTabs, fmtDate, timeAgo,
  PageHeader, Card, Badge, Kpi, StateBlock, DisclosureNote,
} from '../_ui';
import { colors, tint } from '@/components/ui/vuexy';

export default function CompliancePage() {
  const [posture, setPosture] = useState<CompliancePosture | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setPosture(await getCompliancePosture()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const critical = posture?.drift_signals.filter((d) => d.severity === 'critical').length ?? 0;

  return (
    <PlatformGuard>
      <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
        <PageHeader title="Compliance & Licensing" subtitle="Continuous check that the platform stays Model-A-only (§4): Paymax collects fees for schools and never fronts them. Any structure that looks like receivables factoring is flagged before launch." action={<button onClick={load} style={{ padding: '0.35rem 0.8rem' }}>Refresh</button>} />
        <PlatformTabs active="compliance" />
        <DisclosureNote>Requires <code>platform_edtech_admin</code>. <strong>Model A only:</strong> installments = guardian paying the school down over time. Repurposing the BNPL rail to advance fees to a school is out of scope (a different licensing category) and is a release blocker.</DisclosureNote>

        <StateBlock loading={loading} error={error} empty={!posture}>
          {posture ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <Kpi label="Model-A-only posture" value={posture.model_a_only ? 'Holding' : 'BREACHED'} accent={posture.model_a_only ? colors.success : colors.danger} />
                <Kpi label="BNPL rail repurposed?" value={posture.bnpl_rail_repurposed ? 'YES — factoring risk' : 'No'} accent={posture.bnpl_rail_repurposed ? colors.danger : colors.success} />
                <Kpi label="Drift signals" value={posture.drift_signals.length.toString()} accent={critical ? colors.danger : posture.drift_signals.length ? colors.warning : colors.success} sub={`${critical} critical`} />
                <Kpi label="Last reviewed" value={fmtDate(posture.last_reviewed_at)} />
              </div>

              <Card title="Licensing posture">
                <div style={{ fontSize: '0.9rem', color: colors.text }}>
                  <p style={{ margin: '0 0 0.5rem' }}><strong>Category:</strong> {posture.license_category}</p>
                  <p style={{ margin: 0 }}>
                    {posture.model_a_only && !posture.bnpl_rail_repurposed
                      ? <span style={{ color: colors.success }}>✔ Posture compliant — collections-only, no fee-fronting detected.</span>
                      : <span style={{ color: colors.danger }}>✖ Posture at risk — review the drift signals below before any further installment rollout.</span>}
                  </p>
                </div>
              </Card>

              <Card title="Factoring-drift signals">
                {posture.drift_signals.length === 0 ? (
                  <p style={{ color: colors.success }}>No drift detected. All installment structures are guardian-pays-school-over-time.</p>
                ) : (
                  <div style={{ display: 'grid', gap: '0.6rem' }}>
                    {posture.drift_signals.map((d) => (
                      <div key={d.id} style={{ border: `1px solid ${d.severity === 'critical' ? tint(colors.danger, 0.3) : tint(colors.warning, 0.3)}`, background: d.severity === 'critical' ? tint(colors.danger, 0.08) : tint(colors.warning, 0.08), borderRadius: '0.5rem', padding: '0.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <strong>{d.school_name}</strong>
                          <span style={{ display: 'flex', gap: '0.4rem' }}><Badge status={d.severity} /><span style={{ fontSize: '0.74rem', color: colors.muted }}>{timeAgo(d.detected_at)}</span></span>
                        </div>
                        <p style={{ margin: '0.4rem 0 0', fontSize: '0.86rem', color: colors.text }}>{d.signal}</p>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </>
          ) : null}
        </StateBlock>
      </div>
    </PlatformGuard>
  );
}
