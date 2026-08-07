'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import type { Campaign } from '@/types/featuredPlacementAdmin';
import {
  getCampaign,
  approve,
  reject,
  requestInfo,
  suspend,
  naira,
  formatWindow,
} from '@/services/featuredPlacementAdminService';
import { StatusBadge } from '../statusBadge';
import { useFeaturedPermissions, FEATURED_PERMS } from '../_ui';
import { Page, Card, Button, colors } from '@/components/ui/vuexy';

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
      <td style={{ padding: '6px 8px', color: colors.muted, width: '40%' }}>{label}</td>
      <td style={{ padding: '6px 8px' }}>{value}</td>
    </tr>
  );
}

export default function FeaturedPlacementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useFeaturedPermissions();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Decision inputs — reject / request-info / suspend all require a reason.
  const [rejectReason, setRejectReason] = useState('');
  const [infoReason, setInfoReason] = useState('');
  const [suspendReason, setSuspendReason] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setCampaign(await getCampaign(id));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const runAction = async (fn: () => Promise<Campaign>, label: string) => {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const updated = await fn();
      setCampaign(updated);
      setMessage(`${label} succeeded.`);
    } catch (e) {
      setError(`${label} failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const onApprove = () => {
    if (!confirm('Approve this featured-placement campaign?')) return;
    void runAction(() => approve(id), 'Approve');
  };
  const onReject = () => {
    if (!rejectReason.trim()) {
      setError('A rejection reason is required.');
      return;
    }
    void runAction(() => reject(id, rejectReason.trim()), 'Reject');
  };
  const onRequestInfo = () => {
    if (!infoReason.trim()) {
      setError('Describe what changes are needed.');
      return;
    }
    void runAction(() => requestInfo(id, infoReason.trim()), 'Request changes');
  };
  const onSuspend = () => {
    if (!suspendReason.trim()) {
      setError('A suspension reason is required.');
      return;
    }
    void runAction(() => suspend(id, suspendReason.trim()), 'Suspend');
  };

  if (loading) return <Page><p style={{ color: colors.muted }}>Loading campaign…</p></Page>;
  if (!campaign) return <Page><p style={{ color: colors.danger }}>{error || 'Campaign not found.'}</p></Page>;

  const canApprove = can(FEATURED_PERMS.approve);
  const canReject = can(FEATURED_PERMS.reject);
  const canSuspend = can(FEATURED_PERMS.suspend);

  return (
    <Page>
      <p><Link href="/admin/featured-placement">← Back to review queue</Link></p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{campaign.creative.headline}</h1>
        <StatusBadge status={campaign.state} />
      </div>
      <p style={{ fontSize: 13, color: colors.muted }}>
        {campaign.zone_code} · {campaign.subject_type}/{campaign.subject_id} · rate {campaign.rate_version} ·{' '}
        <span style={{ fontFamily: 'monospace' }}>{campaign.id}</span>
      </p>

      {message ? <p style={{ color: colors.success }}>{message}</p> : null}
      {error ? <p style={{ color: colors.danger }}>{error}</p> : null}

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginTop: 12 }}>
        <div style={{ display: 'grid', gap: 16 }}>
          {/* Creative */}
          <Card title="Creative">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 12 }}>
              <tbody>
                <Field label="Headline" value={campaign.creative.headline} />
                <Field
                  label="Image ref"
                  value={<span style={{ fontFamily: 'monospace', fontSize: 12 }}>{campaign.creative.image_ref}</span>}
                />
                <Field label="CTA" value={campaign.creative.cta} />
                <Field
                  label="Deep link"
                  value={<span style={{ fontFamily: 'monospace', fontSize: 12 }}>{campaign.creative.deep_link}</span>}
                />
              </tbody>
            </table>
          </Card>

          {/* Placement */}
          <Card title="Placement">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 12 }}>
              <tbody>
                <Field label="Zone" value={campaign.zone_code} />
                <Field label="Subject type" value={campaign.subject_type} />
                <Field
                  label="Subject ID"
                  value={<span style={{ fontFamily: 'monospace', fontSize: 12 }}>{campaign.subject_id}</span>}
                />
                <Field label="Window" value={formatWindow(campaign.window_start, campaign.window_end)} />
                <Field label="Duration" value={`${campaign.duration_days} day(s)`} />
                <Field label="Quoted price" value={<strong>{naira(campaign.quoted_price_kobo)}</strong>} />
                <Field label="Rate version" value={campaign.rate_version} />
                <Field label="State" value={<StatusBadge status={campaign.state} />} />
                {campaign.review_reason ? <Field label="Review reason" value={campaign.review_reason} /> : null}
              </tbody>
            </table>
          </Card>
        </div>

        {/* Right column */}
        <div style={{ display: 'grid', gap: 16 }}>
          {/* Merchant standing */}
          <Card title="Merchant Standing">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 12 }}>
              <tbody>
                <Field label="Merchant" value={campaign.merchant_name ?? '—'} />
                <Field
                  label="Merchant ID"
                  value={<span style={{ fontFamily: 'monospace', fontSize: 12 }}>{campaign.merchant_id}</span>}
                />
                <Field label="Standing" value={campaign.merchant_standing ?? '—'} />
                <Field
                  label="Active campaigns"
                  value={campaign.merchant_active_campaigns ?? '—'}
                />
                <Field label="Created" value={new Date(campaign.created_at).toLocaleString()} />
                <Field label="Updated" value={new Date(campaign.updated_at).toLocaleString()} />
              </tbody>
            </table>
          </Card>

          {/* Decision actions */}
          <Card title="Decision">
            <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
              <Button variant="primary" onClick={onApprove} disabled={busy || !canApprove} title={canApprove ? '' : 'Requires placement.admin.approve'}>
                {busy ? '…' : 'Approve'}
              </Button>

              <div style={{ display: 'grid', gap: 6 }}>
                <textarea
                  value={infoReason}
                  onChange={(e) => setInfoReason(e.target.value)}
                  placeholder="Requested changes (required)"
                  rows={2}
                  style={{ width: '100%' }}
                />
                <Button variant="outline" onClick={onRequestInfo} disabled={busy || !canReject} title={canReject ? '' : 'Requires placement.admin.reject'}>
                  Request changes
                </Button>
              </div>

              <div style={{ display: 'grid', gap: 6 }}>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Rejection reason (required)"
                  rows={2}
                  style={{ width: '100%' }}
                />
                <Button variant="danger" onClick={onReject} disabled={busy || !canReject} title={canReject ? '' : 'Requires placement.admin.reject'}>
                  Reject
                </Button>
              </div>

              <div style={{ display: 'grid', gap: 6 }}>
                <textarea
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                  placeholder="Suspension reason (required)"
                  rows={2}
                  style={{ width: '100%' }}
                />
                <Button variant="danger" onClick={onSuspend} disabled={busy || !canSuspend} title={canSuspend ? '' : 'Requires placement.admin.suspend'}>
                  Suspend
                </Button>
              </div>
            </div>
            <p style={{ fontSize: 12, color: colors.muted, marginTop: 10 }}>
              Actions are role-gated (RBAC) and written to the placement audit log. Server enforces.
            </p>
          </Card>
        </div>
      </div>
    </Page>
  );
}
