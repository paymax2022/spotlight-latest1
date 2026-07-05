'use client';

import { useEffect, useState } from 'react';
import { getReports } from '@/services/insuranceAdminService';
import type { ReportDefinition } from '@/types/insuranceAdmin';
import { PageHeader, InsuranceTabs, Card, Badge, btn, th, td, StateBlock, DisclosureNote, fmtDate } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Reporting & exports"
        subtitle="Finance, compliance and operations report definitions. Generation runs server-side and is delivered out-of-band."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <InsuranceTabs active="ops" />

      <DisclosureNote>The NAICOM regulator pack is an immutable audit export — state changes and disclosures are captured append-only.</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data || data.length === 0} emptyText="No reports defined.">
        {data && CATEGORIES.map((cat) => {
          const rows = data.filter((r) => r.category === cat);
          if (rows.length === 0) return null;
          return (
            <Card key={cat} title={CATEGORY_LABEL[cat]}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th()}>Name</th>
                      <th style={th()}>Description</th>
                      <th style={th()}>Category</th>
                      <th style={th()}>Formats</th>
                      <th style={th()}>Last generated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td style={{ ...td(), fontWeight: 600 }}>{r.name}</td>
                        <td style={{ ...td(), color: '#6b7280', maxWidth: 360 }}>{r.description}</td>
                        <td style={td()}><Badge status="normal" label={r.category} /></td>
                        <td style={td()}>
                          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                            {r.formats.map((f) => (
                              <button key={f} onClick={() => onGenerate(r.name, f)} style={btn()}>Download .{f}</button>
                            ))}
                          </div>
                        </td>
                        <td style={td()}>{r.last_generated_at ? fmtDate(r.last_generated_at) : 'Never'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
      </StateBlock>
    </div>
  );
}
