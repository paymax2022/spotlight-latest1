'use client';

// SU-08 — Sponsor & Scholarship Oversight. Full fund-flow audit for
// Sponsor-a-Student pledges. RBAC: platform_edtech_admin.
// Minor-safe: student is referenced by ref, never PII (SF-7). Read-only audit view.

import { useEffect, useMemo, useState } from 'react';
import { listScholarshipPledges } from '@/services/platformEdtechAdminService';
import type { ScholarshipPledge } from '@/types/platformEdtechAdmin';
import {
  PlatformGuard, PlatformTabs, formatNaira, fmtDate,
  PageHeader, Card, Badge, Kpi, StateBlock, DisclosureNote, th, td, select,
} from '../_ui';
import { colors } from '@/components/ui/vuexy';

export default function ScholarshipOversightPage() {
  const [pledges, setPledges] = useState<ScholarshipPledge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setPledges(await listScholarshipPledges()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const rows = useMemo(() => pledges.filter((p) => !status || p.status === status), [pledges, status]);
  const disbursed = pledges.filter((p) => p.status === 'disbursed').reduce((s, p) => s + p.amount_kobo, 0);
  const inFlight = pledges.filter((p) => p.status === 'pledged' || p.status === 'funded').reduce((s, p) => s + p.amount_kobo, 0);

  return (
    <PlatformGuard>
      <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
        <PageHeader title="Sponsor & Scholarship Oversight" subtitle="End-to-end fund-flow audit for Sponsor-a-Student pledges. Every leg posts to the finance ledger; students are referenced by minor-safe ref (SF-7)." action={<button onClick={load} style={{ padding: '0.35rem 0.8rem' }}>Refresh</button>} />
        <PlatformTabs active="scholarships" />
        <DisclosureNote>Requires <code>platform_edtech_admin</code>. Scholarship money moves through the existing ledger (edupay scholarships) — this console audits the flow; it never mutates balances directly.</DisclosureNote>

        <StateBlock loading={loading} error={error} empty={false}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="Pledges" value={pledges.length.toString()} accent={colors.primary} />
            <Kpi label="Disbursed (lifetime)" value={formatNaira(disbursed)} accent={colors.success} />
            <Kpi label="In flight" value={formatNaira(inFlight)} accent={colors.warning} sub="pledged + funded" />
          </div>

          <Card title="Pledge fund-flow" right={
            <select style={{ ...select(), maxWidth: 160 }} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option><option value="pledged">Pledged</option><option value="funded">Funded</option><option value="disbursed">Disbursed</option><option value="refunded">Refunded</option><option value="cancelled">Cancelled</option>
            </select>}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th()}>Sponsor</th><th style={th()}>School</th><th style={th()}>Student ref</th><th style={th()}>Amount</th><th style={th()}>Status</th><th style={th()}>Ledger ref</th><th style={th()}>Created</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td style={td()}><strong>{p.sponsor}</strong><div style={{ fontSize: '0.72rem', color: colors.muted }}>{p.sponsor_identity_id}</div></td>
                    <td style={td()}>{p.school_name}</td>
                    <td style={td()}><code style={{ fontSize: '0.78rem' }}>{p.target_student_ref}</code></td>
                    <td style={td()}>{formatNaira(p.amount_kobo)}</td>
                    <td style={td()}><Badge status={p.status} /></td>
                    <td style={td()}><code style={{ fontSize: '0.78rem' }}>{p.ledger_ref}</code></td>
                    <td style={td()}>{fmtDate(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 ? <p style={{ color: colors.muted, marginTop: '0.75rem' }}>No pledges match the filter.</p> : null}
          </Card>
        </StateBlock>
      </div>
    </PlatformGuard>
  );
}
