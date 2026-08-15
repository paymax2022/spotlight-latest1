'use client';

import { useCallback, useEffect, useState } from 'react';
import { listAssessments } from '@/services/connectNetworkAdminService';
import type { SkillAssessment } from '@/types/connectNetworkAdmin';
import { timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function ConnectAssessmentsPage() {
  const [rows, setRows] = useState<SkillAssessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [domain, setDomain] = useState('all');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await listAssessments(domain === 'all' ? undefined : domain)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [domain]);
  useEffect(() => { void load(); }, [load]);

  const domains = ['all', ...Array.from(new Set(rows.map((r) => r.domain)))];

  return (
    <Page>
      <PageHeader title="Question bank / assessments" subtitle="ADM-SA-01 · Versioned skill assessments (AssessmentReviewer). Pass threshold is a config value, not a trust score." actions={<Button variant="outline" sm onClick={() => void load()}>Refresh</Button>} />

      <Card style={{ marginBottom: 16 }}>
        <label style={{ fontSize: '0.8rem', color: colors.text, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          Domain
          <select value={domain} onChange={(e) => setDomain(e.target.value)} style={{ padding: '0.35rem 0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.85rem' }}>
            {domains.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      </Card>

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      <Card style={{ padding: 0, overflow: 'auto' }}>
        {loading ? <p style={{ color: colors.muted, padding: 14 }}>Loading assessments…</p> : rows.length === 0 ? (
          <p style={{ color: colors.muted, padding: 14 }}>No assessments in this domain.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Title</th><th style={thCell}>Domain</th><th style={thCell}>Version</th><th style={thCell}>Questions</th><th style={thCell}>Pass threshold</th><th style={thCell}>Status</th><th style={thCell}>Updated</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td style={tdCell}><strong>{a.title}</strong></td>
                  <td style={tdCell}>{a.domain}</td>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{a.version}</code></td>
                  <td style={tdCell}>{a.questionCount}</td>
                  <td style={tdCell}>{a.passThreshold}%</td>
                  <td style={tdCell}><Badge text={a.status} color={a.status === 'published' ? colors.success : a.status === 'archived' ? colors.secondary : colors.info} /></td>
                  <td style={tdCell}>{timeAgo(a.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
