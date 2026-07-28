'use client';

import { useCallback, useEffect, useState } from 'react';
import { listFlags, actionFlag } from '@/services/marketplaceAdminService';
import type { MktFlag, MktFlagStatus } from '@/types/marketplaceAdmin';
import {
  PageHeader, MarketplaceTabs, Card, StatusBadge, DisclosureNote, StateBlock, AuditNote, FilterBar,
  PermissionBanner, btn, btnPrimary, btnDanger, btnDisabled, th, td, select, label as lbl, timeAgo,
  MARKETPLACE_PERMS, useMarketplacePermission,
} from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Marketplace — Flags Queue"
        subtitle="Safety/content flags on listings, users, reviews, and chat messages. Every action requires a reason_code."
        action={<button onClick={() => void load()} style={btn()}>Refresh</button>}
      />
      <MarketplaceTabs active="flags" />
      <DisclosureNote>
        Backed by <code>GET /v1/marketplace/admin/flags</code> and <code>POST /admin/flags/:id/action</code> (RBAC <code>marketplace.admin.flags.action</code>).
        reason_code is mandatory on every action.
      </DisclosureNote>

      {!canAction && <PermissionBanner permission={MARKETPLACE_PERMS.flagsAction} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div>
          <label style={lbl()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value as MktFlagStatus | '')}>
            <option value="">All</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No flags match this filter.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Target</th><th style={th()}>Reporter</th><th style={th()}>Reason</th>
              <th style={th()}>Notes</th><th style={th()}>Status</th><th style={th()}>Raised</th><th style={th()}>Action</th>
            </tr></thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id}>
                  <td style={td()}>{f.target_type}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}><code>{f.target_id}</code></div></td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{f.reporter_id}</code></td>
                  <td style={td()}>{f.reason_code.replace(/_/g, ' ')}</td>
                  <td style={td()}><span style={{ maxWidth: 260, display: 'inline-block' }}>{f.notes ?? '—'}</span></td>
                  <td style={td()}><StatusBadge status={f.status} /></td>
                  <td style={td()}>{timeAgo(f.created_at)}</td>
                  <td style={td()}>
                    {f.status === 'open' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: 220 }}>
                        <input
                          placeholder="reason_code (mandatory)"
                          value={reasonDraft[f.id] ?? ''}
                          onChange={(e) => setReasonDraft((s) => ({ ...s, [f.id]: e.target.value }))}
                          style={{ padding: '0.3rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.8rem' }}
                        />
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <button
                            style={canAction && (reasonDraft[f.id] ?? '').trim() && busyId !== f.id ? btnPrimary() : btnDisabled()}
                            disabled={!canAction || !(reasonDraft[f.id] ?? '').trim() || busyId === f.id}
                            onClick={() => void act(f, 'actioned')}
                          >{busyId === f.id ? '…' : 'Action'}</button>
                          <button
                            style={canAction && (reasonDraft[f.id] ?? '').trim() && busyId !== f.id ? btnDanger() : btnDisabled()}
                            disabled={!canAction || !(reasonDraft[f.id] ?? '').trim() || busyId === f.id}
                            onClick={() => void act(f, 'dismissed')}
                          >Dismiss</button>
                        </div>
                      </div>
                    ) : (
                      <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>Reviewed{f.reviewed_at ? ` ${timeAgo(f.reviewed_at)}` : ''}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
