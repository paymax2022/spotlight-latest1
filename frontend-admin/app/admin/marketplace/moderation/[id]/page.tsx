'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getModerationListing, approveListing, rejectListing, formatKobo } from '@/services/marketplaceAdminService';
import type { MktListing } from '@/types/marketplaceAdmin';
import {
  PageHeader, Card, Kpi, StatusBadge, DisclosureNote, StateBlock, AuditNote, PermissionBanner,
  btn, btnPrimary, btnDanger, btnDisabled, textarea, label as lbl, fmtDate,
  MARKETPLACE_PERMS, useMarketplacePermission,
} from '../../_ui';

export default function ModerationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';

  const { allowed: canApprove } = useMarketplacePermission(MARKETPLACE_PERMS.approve);
  const { allowed: canReject } = useMarketplacePermission(MARKETPLACE_PERMS.reject);

  const [listing, setListing] = useState<MktListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [reasonCode, setReasonCode] = useState('');
  const [activeMedia, setActiveMedia] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setListing(await getModerationListing(id)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { if (id) void load(); }, [id, load]);

  async function approve() {
    if (!listing) return;
    setBusy(true); setMsg(null); setError(null);
    try {
      await approveListing(listing.id, reasonCode.trim() || undefined);
      setMsg(`Listing approved → active. Audit entry recorded.`);
      await load();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  async function reject() {
    if (!listing) return;
    if (!reasonCode.trim()) { setError('reason_code is required to reject — the seller sees this verbatim.'); return; }
    setBusy(true); setMsg(null); setError(null);
    try {
      await rejectListing(listing.id, reasonCode.trim());
      setMsg(`Listing rejected (${reasonCode.trim()}) → removed_policy. Seller notified verbatim. Audit entry recorded.`);
      await load();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  const isPending = listing?.status === 'pending_review';

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Listing review"
        subtitle={`Listing ${id}`}
        action={<div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link href="/admin/marketplace/moderation" style={btn()}>Back to queue</Link>
          <button onClick={() => void load()} style={btn()}>Refresh</button>
        </div>}
      />
      <DisclosureNote>
        Approve: <code>POST /admin/listings/:id/approve</code> (reason_code optional). Reject: <code>POST /admin/listings/:id/reject</code>
        (reason_code MANDATORY — the seller receives this text verbatim). Both write an immutable <code>mkt_admin_audit_log</code> row.
      </DisclosureNote>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {msg && <AuditNote>{msg}</AuditNote>}

      <StateBlock loading={loading} error={null} empty={!listing} emptyText="Listing not found.">
        {listing && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Price" value={formatKobo(listing.price_kobo)} accent="#340075" />
              <Kpi
                label="Fair price band (p50)"
                value={listing.fair_price_band ? formatKobo(listing.fair_price_band.p50_kobo) : '—'}
                sub={listing.fair_price_band ? `p25 ${formatKobo(listing.fair_price_band.p25_kobo)} · p75 ${formatKobo(listing.fair_price_band.p75_kobo)}` : 'no band computed'}
              />
              <Kpi label="Quality score" value={listing.quality_score != null ? listing.quality_score.toFixed(2) : '—'} accent={listing.quality_score != null && listing.quality_score < 0.4 ? '#b91c1c' : undefined} />
              <Kpi label="Seller trust score" value={listing.seller ? listing.seller.trust_score.toFixed(2) : '—'} accent={listing.seller && listing.seller.trust_score < 0.4 ? '#b91c1c' : undefined} />
              <Kpi label="Escrow" value={listing.escrow_eligible ? 'Eligible' : 'Not eligible'} />
              <Kpi label="Status" value={listing.status.replace(/_/g, ' ')} />
            </div>

            <Card title="Media">
              {listing.media && listing.media.length > 0 ? (
                <div>
                  <img src={listing.media[activeMedia]?.url_full ?? listing.media[activeMedia]?.url_card} alt="" style={{ width: '100%', maxWidth: 480, borderRadius: 8, objectFit: 'cover' }} />
                  <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                    {listing.media.map((m, i) => (
                      <img
                        key={m.id}
                        src={m.url_thumb}
                        alt=""
                        onClick={() => setActiveMedia(i)}
                        style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 4, cursor: 'pointer', border: i === activeMedia ? '2px solid #340075' : '1px solid #e5e7eb' }}
                      />
                    ))}
                  </div>
                </div>
              ) : <p style={{ color: '#9ca3af' }}>No media attached.</p>}
            </Card>

            <Card title="Listing detail">
              <p style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: '0.25rem' }}>{listing.title}</p>
              <p style={{ color: '#374151', fontSize: '0.88rem', whiteSpace: 'pre-wrap' }}>{listing.description}</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.75rem', fontSize: '0.82rem', color: '#6b7280' }}>
                <div>Category: <strong style={{ color: '#374151' }}>{listing.category_name ?? listing.category_id}</strong></div>
                <div>Condition: <strong style={{ color: '#374151' }}>{listing.condition}</strong></div>
                <div>Location: <strong style={{ color: '#374151' }}>{listing.state}{listing.lga ? `, ${listing.lga}` : ''}</strong></div>
                <div>Submitted: <strong style={{ color: '#374151' }}>{fmtDate(listing.created_at)}</strong></div>
                <div>Views / Saves: <strong style={{ color: '#374151' }}>{listing.view_count ?? 0} / {listing.save_count ?? 0}</strong></div>
                <div>Status: <StatusBadge status={listing.status} /></div>
              </div>
            </Card>

            <Card title="Seller">
              {listing.seller ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.5rem', fontSize: '0.82rem', color: '#6b7280' }}>
                  <div>Tenure: <strong style={{ color: '#374151' }}>{listing.seller.tenure_label}</strong></div>
                  <div>Trust score: <strong style={{ color: '#374151' }}>{listing.seller.trust_score.toFixed(2)}</strong></div>
                  <div>ID verified: <strong style={{ color: '#374151' }}>{listing.seller.verified_id_badge ? 'Yes' : 'No'}</strong></div>
                  <div>Business verified: <strong style={{ color: '#374151' }}>{listing.seller.verified_business_badge ? 'Yes' : 'No'}</strong></div>
                  <div>Response time: <strong style={{ color: '#374151' }}>{listing.seller.response_time_minutes != null ? `${listing.seller.response_time_minutes}m` : '—'}</strong></div>
                </div>
              ) : <p style={{ color: '#9ca3af' }}>No seller summary available.</p>}
            </Card>

            <Card title="Decision">
              {!isPending && (
                <p style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                  This listing is <strong>{listing.status.replace(/_/g, ' ')}</strong> — no further moderation action is available.
                  {listing.moderation_reason_code && <> Last reason_code: <code>{listing.moderation_reason_code}</code></>}
                </p>
              )}
              {(!canApprove && !canReject) && <PermissionBanner permission={`${MARKETPLACE_PERMS.approve} / ${MARKETPLACE_PERMS.reject}`} />}
              <label style={lbl()}>reason_code (optional for approve, MANDATORY for reject — seller sees this verbatim)</label>
              <textarea
                style={textarea()}
                placeholder="e.g. PROHIBITED_ITEM, DUPLICATE_PHOTO_DETECTED, MISLEADING_PRICE…"
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                disabled={!isPending}
              />
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                <button style={canApprove && isPending && !busy ? btnPrimary() : btnDisabled()} disabled={!canApprove || !isPending || busy} onClick={() => void approve()}>
                  {busy ? '…' : 'Approve listing'}
                </button>
                <button
                  style={canReject && isPending && reasonCode.trim() && !busy ? btnDanger() : btnDisabled()}
                  disabled={!canReject || !isPending || !reasonCode.trim() || busy}
                  onClick={() => void reject()}
                >
                  Reject listing
                </button>
                <button style={btn()} onClick={() => router.push('/admin/marketplace/moderation')}>Back to queue</button>
              </div>
              {isPending && !reasonCode.trim() && <p style={{ color: '#9ca3af', fontSize: '0.75rem', marginTop: '0.4rem' }}>Reject is disabled until a reason_code is entered.</p>}
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
