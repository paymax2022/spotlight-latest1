'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { listModerationQueue, approveListing, rejectListing, formatKobo } from '@/services/marketplaceAdminService';
import type { MktListing } from '@/types/marketplaceAdmin';
import {
  MarketplaceTabs, StatusBadge, DisclosureNote, StateBlock, AuditNote,
  PermissionBanner, timeAgo,
  MARKETPLACE_PERMS, useMarketplacePermission,
} from '../_ui';
import { Page, PageHeader, Card, Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function ModerationQueuePage() {
  const { allowed: canModerate } = useMarketplacePermission(MARKETPLACE_PERMS.moderation);
  const { allowed: canApprove } = useMarketplacePermission(MARKETPLACE_PERMS.approve);
  const { allowed: canReject } = useMarketplacePermission(MARKETPLACE_PERMS.reject);

  const [rows, setRows] = useState<MktListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await listModerationQueue()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function approve(l: MktListing) {
    setBusyId(l.id); setMsg(null); setError(null);
    try {
      await approveListing(l.id);
      setMsg(`Listing ${l.id} approved → active. Audit entry recorded.`);
      await load();
    } catch (e) { setError(String(e)); }
    finally { setBusyId(null); }
  }

  function startReject(l: MktListing) {
    setRejectingId(l.id);
    setReasonDraft('');
    setError(null);
  }

  async function confirmReject(l: MktListing) {
    // Block submit if reason_code is empty — the seller sees this verbatim.
    if (!reasonDraft.trim()) { setError('reason_code is required to reject a listing (the seller sees this verbatim).'); return; }
    setBusyId(l.id); setMsg(null); setError(null);
    try {
      await rejectListing(l.id, reasonDraft.trim());
      setMsg(`Listing ${l.id} rejected (${reasonDraft.trim()}) → removed_policy. Seller notified. Audit entry recorded.`);
      setRejectingId(null);
      await load();
    } catch (e) { setError(String(e)); }
    finally { setBusyId(null); }
  }

  return (
    <Page>
      <PageHeader
        title="Marketplace — Moderation Queue (M1)"
        subtitle="Pending-review listings. Approve or reject with a mandatory reason_code — the seller sees the rejection reason verbatim."
        actions={<Button variant="outline" onClick={() => void load()}>Refresh</Button>}
      />
      <MarketplaceTabs active="moderation" />
      <DisclosureNote>
        Backed by <code>GET /v1/marketplace/admin/moderation/queue</code> (RBAC <code>marketplace.admin.moderation</code>).
        Approve calls <code>POST /admin/listings/:id/approve</code> (reason_code optional) — RBAC <code>marketplace.admin.approve</code>.
        Reject calls <code>POST /admin/listings/:id/reject</code> (reason_code MANDATORY) — RBAC <code>marketplace.admin.reject</code>.
        Every mutation writes an immutable <code>mkt_admin_audit_log</code> row.
      </DisclosureNote>

      {!canModerate && <PermissionBanner permission={MARKETPLACE_PERMS.moderation} />}
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {msg && <AuditNote>{msg}</AuditNote>}

      <Card style={{ overflow: 'auto' }}>
        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No listings pending review.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thCell}>Listing</th><th style={thCell}>Seller</th><th style={thCell}>Price</th>
              <th style={thCell}>Price band (p25/p50/p75)</th><th style={thCell}>Quality</th><th style={thCell}>Escrow</th>
              <th style={thCell}>Submitted</th><th style={thCell}>Action</th>
            </tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td style={tdCell}>
                    <Link href={`/admin/marketplace/moderation/${l.id}`} style={{ color: colors.primary, textDecoration: 'none', fontWeight: 600 }}>{l.title}</Link>
                    <div style={{ fontSize: '0.72rem', color: colors.muted }}>{l.id} · {l.category_name ?? l.category_id}</div>
                    {l.media?.[0] && (
                      <img src={l.media[0].url_thumb} alt="" width={56} height={56} style={{ objectFit: 'cover', borderRadius: 4, marginTop: 4 }} />
                    )}
                  </td>
                  <td style={tdCell}>
                    {l.seller?.tenure_label ?? '—'}
                    <div style={{ fontSize: '0.72rem', color: colors.muted }}>trust {l.seller ? l.seller.trust_score.toFixed(2) : '—'} · {l.seller?.verified_id_badge ? 'ID verified' : 'unverified'}</div>
                  </td>
                  <td style={tdCell}>{formatKobo(l.price_kobo)}</td>
                  <td style={tdCell}>
                    {l.fair_price_band ? (
                      <span style={{ fontSize: '0.78rem' }}>{formatKobo(l.fair_price_band.p25_kobo)} / {formatKobo(l.fair_price_band.p50_kobo)} / {formatKobo(l.fair_price_band.p75_kobo)}</span>
                    ) : <span style={{ color: colors.muted }}>no band</span>}
                  </td>
                  <td style={tdCell}>{l.quality_score != null ? l.quality_score.toFixed(2) : '—'}</td>
                  <td style={tdCell}><StatusBadgeInline value={l.escrow_eligible} /></td>
                  <td style={tdCell}>{timeAgo(l.created_at)}</td>
                  <td style={tdCell}>
                    {rejectingId === l.id ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: 220 }}>
                        <Input
                          autoFocus
                          placeholder="reason_code (mandatory, seller sees this)"
                          value={reasonDraft}
                          onChange={(e) => setReasonDraft(e.target.value)}
                        />
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <Button
                            variant="danger"
                            sm
                            disabled={!reasonDraft.trim() || busyId === l.id || !canReject}
                            onClick={() => void confirmReject(l)}
                          >{busyId === l.id ? '…' : 'Confirm reject'}</Button>
                          <Button variant="outline" sm onClick={() => setRejectingId(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <Button variant="primary" sm disabled={!canApprove || busyId === l.id} onClick={() => void approve(l)}>
                          {busyId === l.id ? '…' : 'Approve'}
                        </Button>
                        <Button variant="danger" sm disabled={!canReject || busyId === l.id} onClick={() => startReject(l)}>Reject</Button>
                      </div>
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

function StatusBadgeInline({ value }: { value: boolean }) {
  return <span style={{ fontSize: '0.78rem', color: value ? colors.success : colors.muted }}>{value ? 'Eligible' : 'Not eligible'}</span>;
}
