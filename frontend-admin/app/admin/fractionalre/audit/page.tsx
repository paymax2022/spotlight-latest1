'use client';

// 9.O.1 — Immutable, filterable audit log: who / what / when / before-after.

import { Fragment, useEffect, useState } from 'react';
import { getAudit } from '@/services/fractionalreAdminService';
import type { AuditEntry } from '@/types/fractionalreAdmin';
import { PageHeader, FractionalReTabs, Card, btn, th, td, input } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Audit log" subtitle="Immutable record of every sensitive action." action={<button onClick={exportCsv} style={btn()}>Export CSV</button>} />
      <FractionalReTabs active="audit" />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <input placeholder="Filter action (e.g. distribution)" value={action} onChange={(e) => setAction(e.target.value)} style={{ ...input(), width: 240 }} />
        <select value={entityType} onChange={(e) => setEntityType(e.target.value)} style={{ ...input(), width: 200 }}>
          <option value="">All entity types</option>{['asset', 'round', 'distribution', 'investor', 'cap_table', 'sponsor'].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={load} style={btn()}>Apply filters</button>
      </div>

      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading audit…</p> : entries.length === 0 ? <p style={{ color: '#6b7280' }}>No audit entries.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>When</th><th style={th()}>Actor</th><th style={th()}>Action</th><th style={th()}>Entity</th><th style={th()}>Reason</th><th style={th()} /></tr></thead>
            <tbody>{entries.map((e) => (
              <Fragment key={e.id}>
                <tr>
                  <td style={td()}>{new Date(e.at).toLocaleString('en-NG')}</td>
                  <td style={td()}>{e.actorName}</td>
                  <td style={td()}>{e.action}</td>
                  <td style={td()}>{e.entityType} · {e.entityId}</td>
                  <td style={td()}>{e.reason ?? '—'}</td>
                  <td style={td()}><button onClick={() => setExpanded(expanded === e.id ? null : e.id)} style={btn()}>{expanded === e.id ? 'Hide' : 'Before/after'}</button></td>
                </tr>
                {expanded === e.id && (
                  <tr>
                    <td style={td()} colSpan={6}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.78rem' }}>
                        <div><strong>Before</strong><pre style={{ background: '#f9fafb', padding: '0.5rem', borderRadius: 6, overflow: 'auto' }}>{JSON.stringify(e.before ?? {}, null, 2)}</pre></div>
                        <div><strong>After</strong><pre style={{ background: '#f9fafb', padding: '0.5rem', borderRadius: 6, overflow: 'auto' }}>{JSON.stringify(e.after ?? {}, null, 2)}</pre></div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
