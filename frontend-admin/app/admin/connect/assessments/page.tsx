'use client';

import { useCallback, useEffect, useState } from 'react';
import { listAssessments } from '@/services/connectNetworkAdminService';
import type { SkillAssessment } from '@/types/connectNetworkAdmin';
import { PageHeader, Card, Badge, btn, th, td, timeAgo } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Question bank / assessments" subtitle="ADM-SA-01 · Versioned skill assessments (AssessmentReviewer). Pass threshold is a config value, not a trust score." action={<button onClick={() => void load()} style={btn()}>Refresh</button>} />

      <Card>
        <label style={{ fontSize: '0.8rem', color: '#374151', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          Domain
          <select value={domain} onChange={(e) => setDomain(e.target.value)} style={{ padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem' }}>
            {domains.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      </Card>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading assessments…</p> : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No assessments in this domain.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Title</th><th style={th()}>Domain</th><th style={th()}>Version</th><th style={th()}>Questions</th><th style={th()}>Pass threshold</th><th style={th()}>Status</th><th style={th()}>Updated</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td style={td()}><strong>{a.title}</strong></td>
                  <td style={td()}>{a.domain}</td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{a.version}</code></td>
                  <td style={td()}>{a.questionCount}</td>
                  <td style={td()}>{a.passThreshold}%</td>
                  <td style={td()}><Badge status={a.status === 'published' ? 'resolved' : a.status === 'archived' ? 'closed' : 'open'} label={a.status} /></td>
                  <td style={td()}>{timeAgo(a.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
