'use client';

import { useEffect, useState } from 'react';
import { getReports } from '@/services/insuranceAdminService';
import type { ReportDefinition } from '@/types/insuranceAdmin';
import { InsuranceTabs, DisclosureNote, StateBlock, fmtDate } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const CATEGORIES: ReportDefinition['category'][] = ['finance', 'compliance', 'operations'];
const CATEGORY_LABEL: Record<ReportDefinition['category'], string> = {
  finance: 'Finance',
  compliance: 'Compliance',
  operations: 'Operations',
};

export default function ReportsPage() {
  const [data, setData] = useState<ReportDefinition[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getReports()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function onGenerate(name: string, fmt: string) {
    // Generation is server-side; stub confirms intent without fabricating a file.
    alert(`Generating ${name} (.${fmt})…`);
  }

  return (
    <Page>
      <PageHeader
        title="Reporting & exports"
        subtitle="Finance, compliance and operations report definitions. Generation runs server-side and is delivered out-of-band."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <InsuranceTabs active="ops" />

      <DisclosureNote>The NAICOM regulator pack is an immutable audit export — state changes and disclosures are captured append-only.</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data || data.length === 0} emptyText="No reports defined.">
        {data && CATEGORIES.map((cat) => {
          const rows = data.filter((r) => r.category === cat);
          if (rows.length === 0) return null;
          return (
            <Card key={cat} title={CATEGORY_LABEL[cat]} style={{ marginBottom: 16 }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thCell}>Name</th>
                      <th style={thCell}>Description</th>
                      <th style={thCell}>Category</th>
                      <th style={thCell}>Formats</th>
                      <th style={thCell}>Last generated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td style={{ ...tdCell, fontWeight: 600 }}>{r.name}</td>
                        <td style={{ ...tdCell, color: colors.muted, maxWidth: 360 }}>{r.description}</td>
                        <td style={tdCell}><Badge text={r.category} color={colors.info} /></td>
                        <td style={tdCell}>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {r.formats.map((f) => (
                              <Button key={f} variant="outline" sm onClick={() => onGenerate(r.name, f)}>Download .{f}</Button>
                            ))}
                          </div>
                        </td>
                        <td style={tdCell}>{r.last_generated_at ? fmtDate(r.last_generated_at) : 'Never'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
      </StateBlock>
    </Page>
  );
}
