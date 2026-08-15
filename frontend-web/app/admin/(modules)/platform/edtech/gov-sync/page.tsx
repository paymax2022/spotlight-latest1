'use client';

// SU-05 — Gov/Regulator Sync Oversight. Which schools opted in, per data category,
// plus the immutable ComplianceExport log (SF-11). RBAC: platform_edtech_admin.

import { useEffect, useState } from 'react';
import { listGovSync, listComplianceExports } from '@/services/platformEdtechAdminService';
import type { GovSyncRow, ComplianceExportLog } from '@/types/platformEdtechAdmin';
import {
  PlatformGuard, PlatformTabs, fmtDate,
  PageHeader, Card, Badge, Kpi, StateBlock, DisclosureNote, th, td,
} from '../_ui';
import { colors } from '@/components/ui/vuexy';

export default function GovSyncPage() {
  const [rows, setRows] = useState<GovSyncRow[]>([]);
  const [exports, setExports] = useState<ComplianceExportLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { const [r, e] = await Promise.all([listGovSync(), listComplianceExports()]); setRows(r); setExports(e); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const optedIn = rows.filter((r) => r.opted_in).length;

  return (
    <PlatformGuard>
      <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
        <PageHeader title="Gov / Regulator Sync Oversight" subtitle="Which schools have opted into government/regulator reporting, per data category, and the full immutable ComplianceExport audit log (SF-11)." action={<button onClick={load} style={{ padding: '0.35rem 0.8rem' }}>Refresh</button>} />
        <PlatformTabs active="gov-sync" />
        <DisclosureNote>Requires <code>platform_edtech_admin</code>. SF-11: gov sync is <strong>opt-in per school, per data category</strong>; every export is logged immutably and can never be edited or deleted — corrections are new append-only entries.</DisclosureNote>

        <StateBlock loading={loading} error={error} empty={false}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="Schools opted in" value={optedIn.toString()} sub={`of ${rows.length}`} accent={colors.primary} />
            <Kpi label="Exports logged" value={exports.length.toString()} accent={colors.success} />
          </div>

          <Card title="Opt-in status by school">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th()}>School</th><th style={th()}>Regulator</th><th style={th()}>Opt-in</th><th style={th()}>Data categories</th><th style={th()}>Exports</th><th style={th()}>Last export</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.school_id}>
                    <td style={td()}><strong>{r.school_name}</strong></td>
                    <td style={td()}>{r.regulator}</td>
                    <td style={td()}>{r.opted_in ? <Badge status="active" label="opted in" /> : <Badge status="none" label="off" />}</td>
                    <td style={td()}>{r.data_categories.length ? r.data_categories.map((c) => <Badge key={c} status="verified" label={c} />) : <span style={{ color: colors.muted }}>—</span>}</td>
                    <td style={td()}>{r.export_count}</td>
                    <td style={td()}>{fmtDate(r.last_export_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="ComplianceExport log (SF-11 — immutable, append-only)">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th()}>School</th><th style={th()}>Report</th><th style={th()}>Period</th><th style={th()}>Categories</th><th style={th()}>Regulator</th><th style={th()}>Generated</th><th style={th()}>By</th><th style={th()}>Hash</th></tr></thead>
              <tbody>
                {exports.map((e) => (
                  <tr key={e.id}>
                    <td style={td()}>{e.school_name}</td>
                    <td style={td()}>{e.report_type}</td>
                    <td style={td()}>{e.period}</td>
                    <td style={td()}>{e.data_categories.map((c) => <Badge key={c} status="verified" label={c} />)}</td>
                    <td style={td()}>{e.regulator}</td>
                    <td style={td()}>{fmtDate(e.generated_at)}</td>
                    <td style={td()}>{e.generated_by}</td>
                    <td style={td()}><code style={{ fontSize: '0.72rem' }}>{e.immutable_hash}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </StateBlock>
      </div>
    </PlatformGuard>
  );
}
