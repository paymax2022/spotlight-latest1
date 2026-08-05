'use client';

// 9.O.1 — Immutable, filterable audit log: who / what / when / before-after.

import { Fragment, useEffect, useState } from 'react';
import { getAudit } from '@/services/fractionalreAdminService';
import type { AuditEntry } from '@/types/fractionalreAdmin';
import { FractionalReTabs } from '../_ui';
import { Page, PageHeader, Card, Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setEntries(await getAudit({ action: action || undefined, entityType: entityType || undefined })); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function exportCsv() {
    const rows = [['When', 'Actor', 'Action', 'Entity', 'Entity ID', 'Reason']];
    entries.forEach((e) => rows.push([e.at, e.actorName, e.action, e.entityType, e.entityId, e.reason ?? '']));
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'fractionalre-audit.csv'; a.click();
  }

  return (
    <Page>
      <PageHeader title="Audit log" subtitle="Immutable record of every sensitive action." actions={<Button onClick={exportCsv}>Export CSV</Button>} />
      <FractionalReTabs active="audit" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <Input placeholder="Filter action (e.g. distribution)" value={action} onChange={(e) => setAction(e.target.value)} style={{ width: 240 }} />
        <select value={entityType} onChange={(e) => setEntityType(e.target.value)} className="vx-input" style={{ width: 200 }}>
          <option value="">All entity types</option>{['asset', 'round', 'distribution', 'investor', 'cap_table', 'sponsor'].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <Button onClick={load}>Apply filters</Button>
      </div>

      <Card style={{ padding: 0, overflow: 'auto' }}>
        {loading ? <p style={{ color: colors.muted, padding: 14 }}>Loading audit…</p> : entries.length === 0 ? <p style={{ color: colors.muted, padding: 14 }}>No audit entries.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>When</th><th style={thCell}>Actor</th><th style={thCell}>Action</th><th style={thCell}>Entity</th><th style={thCell}>Reason</th><th style={thCell} /></tr></thead>
            <tbody>{entries.map((e) => (
              <Fragment key={e.id}>
                <tr>
                  <td style={tdCell}>{new Date(e.at).toLocaleString('en-NG')}</td>
                  <td style={tdCell}>{e.actorName}</td>
                  <td style={tdCell}>{e.action}</td>
                  <td style={tdCell}>{e.entityType} · {e.entityId}</td>
                  <td style={tdCell}>{e.reason ?? '—'}</td>
                  <td style={tdCell}><Button sm onClick={() => setExpanded(expanded === e.id ? null : e.id)}>{expanded === e.id ? 'Hide' : 'Before/after'}</Button></td>
                </tr>
                {expanded === e.id && (
                  <tr>
                    <td style={tdCell} colSpan={6}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.78rem' }}>
                        <div><strong>Before</strong><pre style={{ background: colors.headBg, padding: '0.5rem', borderRadius: 6, overflow: 'auto' }}>{JSON.stringify(e.before ?? {}, null, 2)}</pre></div>
                        <div><strong>After</strong><pre style={{ background: colors.headBg, padding: '0.5rem', borderRadius: 6, overflow: 'auto' }}>{JSON.stringify(e.after ?? {}, null, 2)}</pre></div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}</tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
