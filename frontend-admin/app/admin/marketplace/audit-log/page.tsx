'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { listAuditLog } from '@/services/marketplaceAdminService';
import type { MktAdminAuditLogEntry } from '@/types/marketplaceAdmin';
import {
  MarketplaceTabs, DisclosureNote, StateBlock, FilterBar, PermissionBanner,
  label as lbl, fmtDate, MARKETPLACE_PERMS, useMarketplacePermission,
} from '../_ui';
import { Page, PageHeader, Card, Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function AuditLogPage() {
  const { allowed: canRead } = useMarketplacePermission(MARKETPLACE_PERMS.auditRead);
  const [rows, setRows] = useState<MktAdminAuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [targetType, setTargetType] = useState('');
  const [targetId, setTargetId] = useState('');
  const [adminId, setAdminId] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setRows(await listAuditLog({
        target_type: targetType || undefined,
        target_id: targetId || undefined,
        admin_id: adminId || undefined,
      }));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [targetType, targetId, adminId]);
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Page>
      <PageHeader
        title="Marketplace — Admin Audit Log"
        subtitle="Read-only, append-only record of every admin mutation (actor, target, reason_code, before/after state)."
        actions={<Button variant="outline" onClick={() => void load()}>Refresh</Button>}
      />
      <MarketplaceTabs active="audit-log" />
      <DisclosureNote>
        Backed by <code>GET /v1/marketplace/admin/audit-log</code> (RBAC <code>marketplace.admin.audit.read</code>). Every admin mutation across the
        Marketplace module writes here automatically via middleware — never optionally. This view never mutates anything.
      </DisclosureNote>

      {!canRead && <PermissionBanner permission={MARKETPLACE_PERMS.auditRead} />}
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <FilterBar>
        <div style={{ minWidth: 160 }}>
          <label style={lbl()}>Target type</label>
          <Input placeholder="Listing, flag, boost…" value={targetType} onChange={(e) => setTargetType(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div style={{ minWidth: 200 }}>
          <label style={lbl()}>Target id</label>
          <Input placeholder="UUID" value={targetId} onChange={(e) => setTargetId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div style={{ minWidth: 200 }}>
          <label style={lbl()}>Admin id</label>
          <Input placeholder="UUID" value={adminId} onChange={(e) => setAdminId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <Button variant="outline" onClick={() => void load()}>Apply</Button>
      </FilterBar>

      <Card style={{ overflow: 'auto' }}>
        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No audit entries match this filter.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thCell}>When</th><th style={thCell}>Admin</th><th style={thCell}>Action</th>
              <th style={thCell}>Target</th><th style={thCell}>reason_code</th><th style={thCell}></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr>
                    <td style={tdCell}>{fmtDate(r.created_at)}</td>
                    <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{r.admin_id}</code>{r.admin_role && <div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.admin_role}</div>}</td>
                    <td style={tdCell}>{r.action}</td>
                    <td style={tdCell}>{r.target_type}<div style={{ fontSize: '0.72rem', color: colors.muted }}><code>{r.target_id}</code></div></td>
                    <td style={tdCell}>{r.reason_code ? <code>{r.reason_code}</code> : <span style={{ color: colors.muted }}>—</span>}</td>
                    <td style={tdCell}>
                      <Button variant="outline" sm onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                        {expanded === r.id ? 'Hide' : 'Before/after'}
                      </Button>
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr>
                      <td style={tdCell} colSpan={6}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                          <div>
                            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: colors.muted, marginBottom: '0.25rem' }}>BEFORE</div>
                            <pre style={{ fontSize: '0.75rem', background: colors.headBg, padding: '0.5rem', borderRadius: 4, overflowX: 'auto' }}>{JSON.stringify(r.before_state ?? {}, null, 2)}</pre>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: colors.muted, marginBottom: '0.25rem' }}>AFTER</div>
                            <pre style={{ fontSize: '0.75rem', background: colors.headBg, padding: '0.5rem', borderRadius: 4, overflowX: 'auto' }}>{JSON.stringify(r.after_state ?? {}, null, 2)}</pre>
                          </div>
                        </div>
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
