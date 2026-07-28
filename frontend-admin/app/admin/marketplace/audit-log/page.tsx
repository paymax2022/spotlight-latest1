'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { listAuditLog } from '@/services/marketplaceAdminService';
import type { MktAdminAuditLogEntry } from '@/types/marketplaceAdmin';
import {
  PageHeader, MarketplaceTabs, Card, DisclosureNote, StateBlock, FilterBar, PermissionBanner,
  btn, th, td, input, label as lbl, fmtDate, MARKETPLACE_PERMS, useMarketplacePermission,
} from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Marketplace — Admin Audit Log"
        subtitle="Read-only, append-only record of every admin mutation (actor, target, reason_code, before/after state)."
        action={<button onClick={() => void load()} style={btn()}>Refresh</button>}
      />
      <MarketplaceTabs active="audit-log" />
      <DisclosureNote>
        Backed by <code>GET /v1/marketplace/admin/audit-log</code> (RBAC <code>marketplace.admin.audit.read</code>). Every admin mutation across the
        Marketplace module writes here automatically via middleware — never optionally. This view never mutates anything.
      </DisclosureNote>

      {!canRead && <PermissionBanner permission={MARKETPLACE_PERMS.auditRead} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <FilterBar>
        <div style={{ minWidth: 160 }}>
          <label style={lbl()}>Target type</label>
          <input style={input()} placeholder="listing, dispute, flag…" value={targetType} onChange={(e) => setTargetType(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div style={{ minWidth: 200 }}>
          <label style={lbl()}>Target id</label>
          <input style={input()} placeholder="uuid" value={targetId} onChange={(e) => setTargetId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div style={{ minWidth: 200 }}>
          <label style={lbl()}>Admin id</label>
          <input style={input()} placeholder="uuid" value={adminId} onChange={(e) => setAdminId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <button style={btn()} onClick={() => void load()}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No audit entries match this filter.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>When</th><th style={th()}>Admin</th><th style={th()}>Action</th>
              <th style={th()}>Target</th><th style={th()}>reason_code</th><th style={th()}></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr>
                    <td style={td()}>{fmtDate(r.created_at)}</td>
                    <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.admin_id}</code>{r.admin_role && <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.admin_role}</div>}</td>
                    <td style={td()}>{r.action}</td>
                    <td style={td()}>{r.target_type}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}><code>{r.target_id}</code></div></td>
                    <td style={td()}>{r.reason_code ? <code>{r.reason_code}</code> : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                    <td style={td()}>
                      <button style={btn()} onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                        {expanded === r.id ? 'Hide' : 'Before/after'}
                      </button>
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr>
                      <td style={td()} colSpan={6}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                          <div>
                            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#6b7280', marginBottom: '0.25rem' }}>BEFORE</div>
                            <pre style={{ fontSize: '0.75rem', background: '#f9fafb', padding: '0.5rem', borderRadius: 4, overflowX: 'auto' }}>{JSON.stringify(r.before_state ?? {}, null, 2)}</pre>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#6b7280', marginBottom: '0.25rem' }}>AFTER</div>
                            <pre style={{ fontSize: '0.75rem', background: '#f9fafb', padding: '0.5rem', borderRadius: 4, overflowX: 'auto' }}>{JSON.stringify(r.after_state ?? {}, null, 2)}</pre>
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
    </div>
  );
}
