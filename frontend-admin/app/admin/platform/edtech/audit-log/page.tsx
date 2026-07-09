'use client';

// SU-11 — Platform Audit Log Viewer. Search the immutable audit trail (SF-11)
// across every entity in the EdTech module. RBAC: platform_edtech_admin.
// The log is append-only — this view is read + search only, never edit/delete.

import { useEffect, useState } from 'react';
import { searchAuditLog } from '@/services/platformEdtechAdminService';
import type { AuditLogEntry } from '@/types/platformEdtechAdmin';
import {
  PlatformGuard, PlatformTabs, timeAgo, fmtDate,
  PageHeader, Card, Badge, Kpi, StateBlock, DisclosureNote, btn, btnPrimary, th, td, input, select, label,
} from '../_ui';

export default function AuditLogViewerPage() {
  const [rows, setRows] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState<{ module: string; entity: string; school_id: string }>({ module: '', entity: '', school_id: '' });

  async function run() {
    setLoading(true); setError(null);
    try { setRows(await searchAuditLog({ module: q.module || undefined, entity: q.entity || undefined, school_id: q.school_id || undefined })); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <PlatformGuard>
      <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
        <PageHeader title="Platform Audit Log Viewer" subtitle="Search the immutable audit trail across every entity in the EdTech module (SF-11). Append-only — entries can never be edited or deleted; each carries an integrity hash." />
        <PlatformTabs active="audit-log" />
        <DisclosureNote>Requires <code>platform_edtech_admin</code>. This is the platform-wide view; it surfaces events written by school-level actors (bursar, head_teacher, guardian) as well as platform operators — but only a platform operator can read it here.</DisclosureNote>

        <Card title="Search">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '0.6rem', alignItems: 'end' }}>
            <div><span style={label()}>Module</span><input style={input()} value={q.module} onChange={(e) => setQ({ ...q, module: e.target.value })} placeholder="academy.fees" /></div>
            <div><span style={label()}>Entity</span>
              <select style={select()} value={q.entity} onChange={(e) => setQ({ ...q, entity: e.target.value })}>
                <option value="">Any</option><option value="invoice">invoice</option><option value="promotion">promotion</option><option value="vault">vault</option><option value="payment">payment</option><option value="school">school</option>
              </select>
            </div>
            <div><span style={label()}>School ID</span><input style={input()} value={q.school_id} onChange={(e) => setQ({ ...q, school_id: e.target.value })} placeholder="sch_001" /></div>
            <button onClick={run} style={btnPrimary()}>Search</button>
          </div>
        </Card>

        <StateBlock loading={loading} error={error} empty={false}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="Entries" value={rows.length.toString()} accent="#340075" />
          </div>
          <Card title="Audit entries (immutable)">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th()}>When</th><th style={th()}>Module</th><th style={th()}>Entity</th><th style={th()}>Action</th><th style={th()}>Actor</th><th style={th()}>Role</th><th style={th()}>School</th><th style={th()}>Hash</th></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td style={td()}>{timeAgo(e.at)}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{fmtDate(e.at)}</div></td>
                    <td style={td()}><code style={{ fontSize: '0.76rem' }}>{e.module}</code></td>
                    <td style={td()}>{e.entity}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{e.entity_id}</div></td>
                    <td style={td()}><Badge status={e.action} label={e.action.replace(/_/g, ' ')} /></td>
                    <td style={td()}>{e.actor}</td>
                    <td style={td()}><Badge status="verified" label={e.actor_role} /></td>
                    <td style={td()}>{e.school_id ?? '—'}</td>
                    <td style={td()}><code style={{ fontSize: '0.72rem' }}>{e.immutable_hash}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 ? <p style={{ color: '#6b7280', marginTop: '0.75rem' }}>No audit entries match the search.</p> : null}
          </Card>
        </StateBlock>
      </div>
    </PlatformGuard>
  );
}
