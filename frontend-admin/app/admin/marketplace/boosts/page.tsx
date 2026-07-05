'use client';

import { useCallback, useEffect, useState } from 'react';
import { listBoosts, rejectBoost, formatKobo } from '@/services/marketplaceAdminService';
import type { MktBoost } from '@/types/marketplaceAdmin';
import {
  PageHeader, MarketplaceTabs, Card, StatusBadge, ScaffoldNotice, StateBlock, AuditNote,
  PermissionBanner, btn, btnDanger, btnDisabled, th, td, timeAgo, fmtDate,
  MARKETPLACE_PERMS, useMarketplacePermission,
} from '../_ui';

export default function BoostsAdminPage() {
  // Boost moderation reuses the same "moderate" surface as listings/flags per §2.4
  // of the build contract (admin/system detects policy violation → reason_code
  // mandatory → automatic refund). No dedicated marketplace.admin.boosts.* slug is
  // seeded yet — gate on the moderation permission until Agent C adds one.
  const { allowed: canModerate } = useMarketplacePermission(MARKETPLACE_PERMS.moderation);
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
      <ScaffoldNotice>
        Listing + rejection are wired to <code>GET /admin/boosts</code> (not yet in the frozen route list — scaffolded pending Agent A) and
        <code> POST /admin/boosts/:id/reject</code> (frozen, reason_code mandatory, per §2.4 Boost FSM). Full campaign analytics /
        placement-weight tooling is out of scope for this pass.
      </ScaffoldNotice>

      {!canModerate && <PermissionBanner permission={MARKETPLACE_PERMS.moderation} />}
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
                              disabled={!reasonDraft.trim() || busyId === b.id || !canModerate}
                              onClick={() => void confirmReject(b)}
                            >{busyId === b.id ? '…' : 'Confirm reject'}</button>
                            <button style={btn()} onClick={() => setRejectingId(null)}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button style={canModerate ? btnDanger() : btnDisabled()} disabled={!canModerate} onClick={() => { setRejectingId(b.id); setReasonDraft(''); }}>
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
