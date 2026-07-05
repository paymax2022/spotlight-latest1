'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { listAuditLog, type AuditLogEntry } from '@/services/associationAdminService';
import {
  PageHeader, AssociationTabs, Card, DisclosureNote, StateBlock, FilterBar,
  btn, th, td, input, label as lbl, fmtDate,
  useAssociationPermissions, ASSOCIATION_PERMS, PermissionBanner,
} from '../_ui';

export default function AssociationAuditLogPage() {
  const { can } = useAssociationPermissions();
  const canRead = can(ASSOCIATION_PERMS.auditRead);

  const [rows, setRows] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await listAuditLog(action || undefined)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [action]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Associations — admin audit log"
        subtitle="Read-only, append-only record of every admin mutation on this module (approvals, offline-payment decisions, member actions, imports)."
        action={<button onClick={() => void load()} style={btn()}>Refresh</button>}
      />
      <AssociationTabs active="audit" />
      <DisclosureNote>
        Backed by <code>GET /api/finance/associations/admin/audit-log</code>. Every admin mutation across this module
        writes here automatically — never optionally (NL-12). This view never mutates anything.
      </DisclosureNote>

      {!canRead && <PermissionBanner text="You have no access to the audit log for this module." />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <FilterBar>
        <div style={{ minWidth: 220 }}>
          <label style={lbl()}>Action</label>
          <input style={input()} placeholder="e.g. member.suspend" value={action} onChange={(e) => setAction(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void load()} />
        </div>
        <button style={btn()} onClick={() => void load()}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No audit entries match this filter.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>When</th><th style={th()}>Actor</th><th style={th()}>Action</th>
              <th style={th()}>Subject</th><th style={th()}></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr>
                    <td style={td()}>{fmtDate(r.createdAt)}</td>
                    <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.actorId}</code></td>
                    <td style={td()}>{r.action}</td>
                    <td style={td()}>{r.subjectType}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}><code>{r.subjectId}</code></div></td>
                    <td style={td()}>
                      <button style={btn()} onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                        {expanded === r.id ? 'Hide' : 'Metadata'}
                      </button>
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr>
                      <td style={td()} colSpan={5}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#6b7280', marginBottom: '0.25rem' }}>METADATA</div>
                        <pre style={{ fontSize: '0.75rem', background: '#f9fafb', padding: '0.5rem', borderRadius: 4, overflowX: 'auto' }}>{JSON.stringify(r.metadata ?? {}, null, 2)}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
