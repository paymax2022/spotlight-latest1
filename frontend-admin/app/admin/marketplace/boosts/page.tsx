'use client';

import { useCallback, useEffect, useState } from 'react';
import { listBoosts, rejectBoost, formatKobo } from '@/services/marketplaceAdminService';
import type { MktBoost } from '@/types/marketplaceAdmin';
import {
  PageHeader, MarketplaceTabs, Card, StatusBadge, DisclosureNote, StateBlock, AuditNote,
  PermissionBanner, btn, btnDanger, btnDisabled, th, td, fmtDate,
  MARKETPLACE_PERMS, useMarketplacePermission,
} from '../_ui';

export default function BoostsAdminPage() {
  // List view is gated on the read/moderation surface, but the Reject action calls
  // POST /admin/boosts/:id/reject which the backend guards with
  // marketplace.admin.reject — gate the button on that permission so we never show
  // an action that would 403.
  const { allowed: canModerate } = useMarketplacePermission(MARKETPLACE_PERMS.moderation);
  const { allowed: canReject } = useMarketplacePermission(MARKETPLACE_PERMS.reject);
  const [rows, setRows] = useState<MktBoost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await listBoosts()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function confirmReject(b: MktBoost) {
    if (!reasonDraft.trim()) { setError('reason_code is required to reject a boost.'); return; }
    setBusyId(b.id); setMsg(null); setError(null);
    try {
      await rejectBoost(b.id, reasonDraft.trim());
      setMsg(`Boost ${b.id} rejected (${reasonDraft.trim()}) — automatic refund posted to seller wallet. Audit entry recorded.`);
      setRejectingId(null);
      await load();
    } catch (e) { setError(String(e)); }
    finally { setBusyId(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Marketplace — Boosts Admin"
        subtitle="Boost purchases (Start/VIP/VIP Gold/Diamond/Enterprise). Reject-with-reason triggers an automatic refund ledger tx."
        action={<button onClick={() => void load()} style={btn()}>Refresh</button>}
      />
      <MarketplaceTabs active="boosts" />
      <DisclosureNote>
        Backed by <code>GET /v1/marketplace/admin/boosts</code> (RBAC <code>marketplace.admin.moderation</code>) and
        <code> POST /admin/boosts/:id/reject</code> (RBAC <code>marketplace.admin.reject</code>, reason_code mandatory — triggers an
        automatic refund per the Boost FSM). Every mutation writes an immutable <code>mkt_admin_audit_log</code> row.
      </DisclosureNote>

      {!canModerate && <PermissionBanner permission={MARKETPLACE_PERMS.moderation} />}
      {canModerate && !canReject && <PermissionBanner permission={MARKETPLACE_PERMS.reject} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {msg && <AuditNote>{msg}</AuditNote>}

      <Card>
        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No boosts found.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Boost</th><th style={th()}>Listing</th><th style={th()}>Tier</th>
              <th style={th()}>Price</th><th style={th()}>Status</th><th style={th()}>Window</th><th style={th()}>Action</th>
            </tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{b.id}</code></td>
                  <td style={td()}>{b.listing_title ?? b.listing_id}</td>
                  <td style={td()}>{b.tier.replace(/_/g, ' ')}</td>
                  <td style={td()}>{formatKobo(b.price_kobo)}</td>
                  <td style={td()}><StatusBadge status={b.status} /></td>
                  <td style={td()}>{b.starts_at ? `${fmtDate(b.starts_at)} → ${fmtDate(b.ends_at)}` : '—'}</td>
                  <td style={td()}>
                    {(b.status === 'purchased' || b.status === 'active') ? (
                      rejectingId === b.id ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: 220 }}>
                          <input
                            autoFocus
                            placeholder="reason_code (mandatory)"
                            value={reasonDraft}
                            onChange={(e) => setReasonDraft(e.target.value)}
                            style={{ padding: '0.3rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.8rem' }}
                          />
                          <div style={{ display: 'flex', gap: '0.4rem' }}>
                            <button
                              style={reasonDraft.trim() && busyId !== b.id ? btnDanger() : btnDisabled()}
                              disabled={!reasonDraft.trim() || busyId === b.id || !canReject}
                              onClick={() => void confirmReject(b)}
                            >{busyId === b.id ? '…' : 'Confirm reject'}</button>
                            <button style={btn()} onClick={() => setRejectingId(null)}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button style={canReject ? btnDanger() : btnDisabled()} disabled={!canReject} onClick={() => { setRejectingId(b.id); setReasonDraft(''); }}>
                          Reject (refund)
                        </button>
                      )
                    ) : (
                      <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>{b.rejection_reason_code ?? '—'}</span>
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
