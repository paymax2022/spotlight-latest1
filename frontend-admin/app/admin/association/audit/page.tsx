'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { listAuditLog, type AuditLogEntry } from '@/services/associationAdminService';
import {
  AssociationTabs, DisclosureNote, StateBlock, FilterBar, fmtDate, OrgPicker, useSelectedOrg,
  useAssociationPermissions, ASSOCIATION_PERMS, PermissionBanner,
} from '../_ui';
import { Page, PageHeader, Card, Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function AssociationAuditLogPage() {
  const { can } = useAssociationPermissions();
  const canRead = can(ASSOCIATION_PERMS.auditRead);
  const orgId = useSelectedOrg();

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

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [load, orgId]);

  return (
    <Page>
      <PageHeader
        title="Associations — admin audit log"
        subtitle="Read-only, append-only record of every admin mutation on this module (approvals, offline-payment decisions, member actions, imports)."
        actions={<Button variant="outline" onClick={() => void load()}>Refresh</Button>}
      />
      <AssociationTabs active="audit" />
      <OrgPicker />
      <DisclosureNote>
        Backed by <code>GET /api/finance/associations/admin/audit-log</code>. Every admin mutation across this module
        writes here automatically — never optionally (NL-12). This view never mutates anything.
      </DisclosureNote>

      {!canRead && <PermissionBanner text="You have no access to the audit log for this module." />}
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <FilterBar>
        <div style={{ minWidth: 220 }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Action</label>
          <Input placeholder="e.g. member.suspend" value={action} onChange={(e) => setAction(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void load()} />
        </div>
        <Button variant="outline" onClick={() => void load()}>Apply</Button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No audit entries match this filter.">
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
            <thead><tr>
              <th style={thCell}>When</th><th style={thCell}>Actor</th><th style={thCell}>Action</th>
              <th style={thCell}>Subject</th><th style={thCell}></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr>
                    <td style={tdCell}>{fmtDate(r.createdAt)}</td>
                    <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{r.actorId}</code></td>
                    <td style={tdCell}>{r.action}</td>
                    <td style={tdCell}>{r.subjectType}<div style={{ fontSize: '0.72rem', color: colors.muted }}><code>{r.subjectId}</code></div></td>
                    <td style={tdCell}>
                      <Button variant="outline" sm onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                        {expanded === r.id ? 'Hide' : 'Metadata'}
                      </Button>
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr>
                      <td style={tdCell} colSpan={5}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: colors.muted, marginBottom: '0.25rem' }}>METADATA</div>
                        <pre style={{ fontSize: '0.75rem', background: colors.headBg, padding: '0.5rem', borderRadius: 4, overflowX: 'auto' }}>{JSON.stringify(r.metadata ?? {}, null, 2)}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </Page>
  );
}
