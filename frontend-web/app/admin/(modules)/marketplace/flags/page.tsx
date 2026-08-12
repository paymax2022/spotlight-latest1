'use client';

import { useCallback, useEffect, useState } from 'react';
import { listFlags, actionFlag } from '@/services/marketplaceAdminService';
import type { MktFlag, MktFlagStatus } from '@/types/marketplaceAdmin';
import {
  MarketplaceTabs, StatusBadge, DisclosureNote, StateBlock, AuditNote, FilterBar,
  PermissionBanner, label as lbl, timeAgo,
  MARKETPLACE_PERMS, useMarketplacePermission,
} from '../_ui';
import { Page, PageHeader, Card, Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUS_OPTIONS: MktFlagStatus[] = ['open', 'actioned', 'dismissed'];

export default function FlagsQueuePage() {
  const { allowed: canAction } = useMarketplacePermission(MARKETPLACE_PERMS.flagsAction);
  const [rows, setRows] = useState<MktFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<MktFlagStatus | ''>('open');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await listFlags(status || undefined)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [status]);
  useEffect(() => { void load(); }, [load]);

  async function act(f: MktFlag, action: 'actioned' | 'dismissed') {
    const reason = (reasonDraft[f.id] ?? '').trim();
    if (!reason) { setError('reason_code is required to action or dismiss a flag.'); return; }
    setBusyId(f.id); setMsg(null); setError(null);
    try {
      await actionFlag(f.id, { action, reason_code: reason });
      setMsg(`Flag ${f.id} → ${action} (${reason}). Audit entry recorded.`);
      await load();
    } catch (e) { setError(String(e)); }
    finally { setBusyId(null); }
  }

  return (
    <Page>
      <PageHeader
        title="Marketplace — Flags Queue"
        subtitle="Safety/content flags on listings, users, reviews, and chat messages. Every action requires a reason_code."
        actions={<Button variant="outline" onClick={() => void load()}>Refresh</Button>}
      />
      <MarketplaceTabs active="flags" />
      <DisclosureNote>
        Backed by <code>GET /v1/marketplace/admin/flags</code> and <code>POST /admin/flags/:id/action</code> (RBAC <code>marketplace.admin.flags.action</code>).
        reason_code is mandatory on every action.
      </DisclosureNote>

      {!canAction && <PermissionBanner permission={MARKETPLACE_PERMS.flagsAction} />}
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div>
          <label style={lbl()}>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as MktFlagStatus | '')}>
            <option value="">All</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </FilterBar>

      <Card style={{ overflow: 'auto' }}>
        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No flags match this filter.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thCell}>Target</th><th style={thCell}>Reporter</th><th style={thCell}>Reason</th>
              <th style={thCell}>Notes</th><th style={thCell}>Status</th><th style={thCell}>Raised</th><th style={thCell}>Action</th>
            </tr></thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id}>
                  <td style={tdCell}>{f.target_type}<div style={{ fontSize: '0.72rem', color: colors.muted }}><code>{f.target_id}</code></div></td>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{f.reporter_id}</code></td>
                  <td style={tdCell}>{f.reason_code.replace(/_/g, ' ')}</td>
                  <td style={tdCell}><span style={{ maxWidth: 260, display: 'inline-block' }}>{f.notes ?? '—'}</span></td>
                  <td style={tdCell}><StatusBadge status={f.status} /></td>
                  <td style={tdCell}>{timeAgo(f.created_at)}</td>
                  <td style={tdCell}>
                    {f.status === 'open' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: 220 }}>
                        <Input
                          placeholder="reason_code (mandatory)"
                          value={reasonDraft[f.id] ?? ''}
                          onChange={(e) => setReasonDraft((s) => ({ ...s, [f.id]: e.target.value }))}
                        />
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <Button
                            variant="primary"
                            sm
                            disabled={!canAction || !(reasonDraft[f.id] ?? '').trim() || busyId === f.id}
                            onClick={() => void act(f, 'actioned')}
                          >{busyId === f.id ? '…' : 'Action'}</Button>
                          <Button
                            variant="danger"
                            sm
                            disabled={!canAction || !(reasonDraft[f.id] ?? '').trim() || busyId === f.id}
                            onClick={() => void act(f, 'dismissed')}
                          >Dismiss</Button>
                        </div>
                      </div>
                    ) : (
                      <span style={{ color: colors.muted, fontSize: '0.78rem' }}>Reviewed{f.reviewed_at ? ` ${timeAgo(f.reviewed_at)}` : ''}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </Page>
  );
}
