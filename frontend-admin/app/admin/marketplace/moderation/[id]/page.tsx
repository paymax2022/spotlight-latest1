'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getModerationListing, approveListing, rejectListing, listModerationCategories, recategorizeListing, formatKobo } from '@/services/marketplaceAdminService';
import type { MktListing, MktModerationCategory } from '@/types/marketplaceAdmin';
import {
  Kpi, StatusBadge, DisclosureNote, StateBlock, AuditNote, PermissionBanner,
  label as lbl, select as selectStyle, fmtDate,
  MARKETPLACE_PERMS, useMarketplacePermission,
} from '../../_ui';
import { Page, PageHeader, Card, Button, colors } from '@/components/ui/vuexy';

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
  const [categories, setCategories] = useState<MktModerationCategory[]>([]);
  const [catsError, setCatsError] = useState<string | null>(null);
  const [mainId, setMainId] = useState('');
  const [subId, setSubId] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setListing(await getModerationListing(id)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { if (id) void load(); }, [id, load]);

  useEffect(() => {
    listModerationCategories()
      .then(setCategories)
      .catch((e) => setCatsError(String(e)));
  }, []);

  const mains = categories.filter((c) => !c.parent_id);
  const subsOf = (parentId: string) => categories.filter((c) => c.parent_id === parentId);
  const current = listing ? categories.find((c) => c.id === listing.category_id) : undefined;
  const currentMain = current ? (current.parent_id ? categories.find((c) => c.id === current.parent_id) : current) : undefined;
  const currentSub = current?.parent_id ? current : undefined;
  const currentPath = current
    ? [currentMain?.name, currentSub?.name].filter(Boolean).join(' › ')
    : (listing?.category_name ?? listing?.category_id ?? '');

  // Start the pickers on the listing's saved category whenever it (re)loads.
  useEffect(() => {
    if (!listing || categories.length === 0) return;
    setMainId(currentMain?.id ?? '');
    setSubId(currentSub?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing?.category_id, categories.length]);

  // The category the pickers point at. A main that has sub-categories is not a valid
  // final choice: buyers browse by sub-category, so the reviewer must pick one.
  const mainSubs = mainId ? subsOf(mainId) : [];
  const needsSub = mainSubs.length > 0 && !subId;
  const targetId = subId || mainId;
  const categoryChanged = !!listing && !!targetId && targetId !== listing.category_id;

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

  async function saveCategory() {
    if (!listing || !targetId) return;
    setBusy(true); setMsg(null); setError(null);
    try {
      const updated = await recategorizeListing(listing.id, targetId);
      const moved = categories.find((c) => c.id === updated.category_id);
      const parent = moved?.parent_id ? categories.find((c) => c.id === moved.parent_id) : undefined;
      const path = [parent?.name, moved?.name].filter(Boolean).join(' › ');
      setConfirmed(false);
      setMsg(`Listing moved to ${path || 'the selected category'}. The seller was told. Audit entry recorded — confirm the new category before approving.`);
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
    <Page>
      <PageHeader
        title="Listing review"
        subtitle={`Listing ${id}`}
        actions={<div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link href="/admin/marketplace/moderation" className="vx-btn vx-btn--outline">Back to queue</Link>
          <Button variant="outline" onClick={() => void load()}>Refresh</Button>
        </div>}
      />
      <DisclosureNote>
        Approve: <code>POST /admin/listings/:id/approve</code> (reason_code optional). Reject: <code>POST /admin/listings/:id/reject</code>
        (reason_code MANDATORY — the seller receives this text verbatim). Both write an immutable <code>mkt_admin_audit_log</code> row.
      </DisclosureNote>

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {msg && <AuditNote>{msg}</AuditNote>}

      <StateBlock loading={loading} error={null} empty={!listing} emptyText="Listing not found.">
        {listing && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Price" value={formatKobo(listing.price_kobo)} accent={colors.primary} />
              <Kpi
                label="Fair price band (p50)"
                value={listing.fair_price_band ? formatKobo(listing.fair_price_band.p50_kobo) : '—'}
                sub={listing.fair_price_band ? `p25 ${formatKobo(listing.fair_price_band.p25_kobo)} · p75 ${formatKobo(listing.fair_price_band.p75_kobo)}` : 'no band computed'}
              />
              <Kpi label="Quality score" value={listing.quality_score != null ? listing.quality_score.toFixed(2) : '—'} accent={listing.quality_score != null && listing.quality_score < 0.4 ? colors.danger : undefined} />
              <Kpi label="Seller trust score" value={listing.seller ? listing.seller.trust_score.toFixed(2) : '—'} accent={listing.seller && listing.seller.trust_score < 0.4 ? colors.danger : undefined} />
              <Kpi label="Escrow" value={listing.escrow_eligible ? 'Eligible' : 'Not eligible'} />
              <Kpi label="Status" value={listing.status.replace(/_/g, ' ')} />
            </div>

            <Card title="Media" style={{ marginBottom: '1.25rem' }}>
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
                        style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 4, cursor: 'pointer', border: i === activeMedia ? `2px solid ${colors.primary}` : `1px solid ${colors.border}` }}
                      />
                    ))}
                  </div>
                </div>
              ) : <p style={{ color: colors.muted }}>No media attached.</p>}
            </Card>

            <Card title="Listing detail" style={{ marginBottom: '1.25rem' }}>
              <p style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: '0.25rem' }}>{listing.title}</p>
              <p style={{ color: colors.muted, fontSize: '0.88rem', whiteSpace: 'pre-wrap' }}>{listing.description}</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.75rem', fontSize: '0.82rem', color: colors.muted }}>
                <div>Category: <strong style={{ color: colors.text }}>{currentPath}</strong></div>
                <div>Condition: <strong style={{ color: colors.text }}>{listing.condition}</strong></div>
                <div>Location: <strong style={{ color: colors.text }}>{listing.state}{listing.lga ? `, ${listing.lga}` : ''}</strong></div>
                <div>Submitted: <strong style={{ color: colors.text }}>{fmtDate(listing.created_at)}</strong></div>
                <div>Views / Saves: <strong style={{ color: colors.text }}>{listing.view_count ?? 0} / {listing.save_count ?? 0}</strong></div>
                <div>Status: <StatusBadge status={listing.status} /></div>
              </div>
            </Card>

            <Card title="Category check" style={{ marginBottom: '1.25rem' }}>
              <p style={{ color: colors.muted, fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                Sellers choose their own category. Check the item really belongs under{' '}
                <strong style={{ color: colors.text }}>{currentPath || 'its current category'}</strong>; if not, move it to the right
                category and sub-category before approving.
              </p>
              {catsError && <p style={{ color: colors.danger, fontSize: '0.82rem' }}>Couldn&apos;t load the category list: {catsError}</p>}
              {!current && categories.length > 0 && (
                <p style={{ color: colors.danger, fontSize: '0.82rem', marginBottom: '0.5rem' }}>
                  This listing&apos;s category isn&apos;t in the active category list — please pick the right one.
                </p>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={lbl()}>Category</label>
                  <select
                    style={selectStyle()}
                    value={mainId}
                    disabled={!isPending || categories.length === 0 || busy}
                    onChange={(e) => { setMainId(e.target.value); setSubId(''); setConfirmed(false); }}
                  >
                    <option value="">— choose a category —</option>
                    {mains.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl()}>Sub-category</label>
                  <select
                    style={selectStyle()}
                    value={subId}
                    disabled={!isPending || !mainId || mainSubs.length === 0 || busy}
                    onChange={(e) => { setSubId(e.target.value); setConfirmed(false); }}
                  >
                    <option value="">{mainId && mainSubs.length === 0 ? '— none for this category —' : '— choose a sub-category —'}</option>
                    {mainSubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <Button
                  variant="primary"
                  disabled={!canApprove || !isPending || busy || !categoryChanged || needsSub}
                  onClick={() => void saveCategory()}
                >
                  {busy ? '…' : 'Save category change'}
                </Button>
                {needsSub && <span style={{ color: colors.muted, fontSize: '0.75rem' }}>Pick a sub-category to save.</span>}
                {categoryChanged && !needsSub && <span style={{ color: colors.muted, fontSize: '0.75rem' }}>Unsaved change — save it before approving.</span>}
              </div>
            </Card>

            <Card title="Seller" style={{ marginBottom: '1.25rem' }}>
              {listing.seller ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.5rem', fontSize: '0.82rem', color: colors.muted }}>
                  <div>Tenure: <strong style={{ color: colors.text }}>{listing.seller.tenure_label}</strong></div>
                  <div>Trust score: <strong style={{ color: colors.text }}>{listing.seller.trust_score.toFixed(2)}</strong></div>
                  <div>ID verified: <strong style={{ color: colors.text }}>{listing.seller.verified_id_badge ? 'Yes' : 'No'}</strong></div>
                  <div>Business verified: <strong style={{ color: colors.text }}>{listing.seller.verified_business_badge ? 'Yes' : 'No'}</strong></div>
                  <div>Response time: <strong style={{ color: colors.text }}>{listing.seller.response_time_minutes != null ? `${listing.seller.response_time_minutes}m` : '—'}</strong></div>
                </div>
              ) : <p style={{ color: colors.muted }}>No seller summary available.</p>}
            </Card>

            <Card title="Decision">
              {!isPending && (
                <p style={{ color: colors.muted, fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                  This listing is <strong>{listing.status.replace(/_/g, ' ')}</strong> — no further moderation action is available.
                  {listing.moderation_reason_code && <> Last reason_code: <code>{listing.moderation_reason_code}</code></>}
                </p>
              )}
              {(!canApprove && !canReject) && <PermissionBanner permission={`${MARKETPLACE_PERMS.approve} / ${MARKETPLACE_PERMS.reject}`} />}
              <label style={lbl()}>reason_code (optional for approve, MANDATORY for reject — seller sees this verbatim)</label>
              <textarea
                placeholder="e.g. PROHIBITED_ITEM, DUPLICATE_PHOTO_DETECTED, MISLEADING_PRICE…"
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                disabled={!isPending}
                style={{ width: '100%', minHeight: '4.5rem', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
              />
              <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginTop: '0.75rem', fontSize: '0.85rem' }}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={!isPending || busy}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  style={{ marginTop: '0.2rem' }}
                />
                <span>I&apos;ve checked this item is in the right category and sub-category{currentPath ? <> (<strong>{currentPath}</strong>)</> : null}.</span>
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                <Button variant="primary" disabled={!canApprove || !isPending || busy || !confirmed || categoryChanged} onClick={() => void approve()}>
                  {busy ? '…' : 'Approve listing'}
                </Button>
                <Button
                  variant="danger"
                  disabled={!canReject || !isPending || !reasonCode.trim() || busy}
                  onClick={() => void reject()}
                >
                  Reject listing
                </Button>
                <Button variant="outline" onClick={() => router.push('/admin/marketplace/moderation')}>Back to queue</Button>
              </div>
              {isPending && !reasonCode.trim() && <p style={{ color: colors.muted, fontSize: '0.75rem', marginTop: '0.4rem' }}>Reject is disabled until a reason_code is entered.</p>}
              {isPending && !confirmed && <p style={{ color: colors.muted, fontSize: '0.75rem', marginTop: '0.4rem' }}>Approve is disabled until you confirm the category{categoryChanged ? ' and save your category change' : ''}.</p>}
              {isPending && confirmed && categoryChanged && <p style={{ color: colors.muted, fontSize: '0.75rem', marginTop: '0.4rem' }}>Save the category change before approving.</p>}
            </Card>
          </>
        )}
      </StateBlock>
    </Page>
  );
}
