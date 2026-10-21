'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  getRiderDriverRecord,
  setRiderVerification,
  type RiderDriverRecord,
  type RiderVerificationAction,
} from '@/services/restaurantAdminService';
import { RESTAURANT_PERMS, useRestaurantPermissions, AccessNotice } from '../../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors } from '@/components/ui/vuexy';

// Admin rider detail with Suspend / Pause / Resume (FOOD-UAT-G-010).
// Suspending releases the rider's in-flight orders back to dispatch (server side).

const STATUS_LABEL: Record<string, string> = {
  approved: 'Active',
  under_review: 'Paused',
  suspended: 'Suspended',
  rejected: 'Rejected',
  submitted: 'Submitted',
  draft: 'Draft',
};
const STATUS_COLOR: Record<string, string> = {
  approved: colors.success,
  under_review: colors.warning,
  suspended: colors.danger,
  rejected: colors.danger,
};

export default function RiderDetailPage() {
  const params = useParams<{ id: string }>();
  const riderId = decodeURIComponent(String(params?.id ?? ''));
  const { can } = useRestaurantPermissions();
  const canView = can(RESTAURANT_PERMS.manage) || can(RESTAURANT_PERMS.dispatch);
  const canAct = can(RESTAURANT_PERMS.dispatch);

  const [rec, setRec] = useState<RiderDriverRecord | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRec(await getRiderDriverRecord(riderId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rider');
    }
  }, [riderId]);

  useEffect(() => { if (canView) void load(); }, [canView, load]);

  async function act(action: RiderVerificationAction) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await setRiderVerification(riderId, action, reason);
      setNotice(`Rider is now ${STATUS_LABEL[res.verification_status] ?? res.verification_status}.`);
      setReason('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  if (!canView) return <AccessNotice perm="restaurant.manage / restaurant.admin.dispatch" />;

  const status = rec?.verification_status ?? '';
  return (
    <Page>
      <PageHeader title={rec?.name ?? 'Rider'} subtitle={`Rider ${riderId}`} />
      {error ? <p role="alert" style={{ color: colors.danger }}>{error}</p> : null}
      {notice ? <p role="status" style={{ color: colors.success }}>{notice}</p> : null}
      <Card title="Account status">
        {rec ? (
          <>
            <p>
              <Badge text={STATUS_LABEL[status] ?? status} color={STATUS_COLOR[status] ?? colors.secondary} />
              {rec.vehicle_type ? <span style={{ marginLeft: 8, color: colors.muted }}>{rec.vehicle_type}</span> : null}
            </p>
            {canAct ? (
              <>
                <label style={{ display: 'block', fontSize: 13, color: colors.muted, marginBottom: 4 }} htmlFor="rider-reason">
                  Reason (required to suspend or pause)
                </label>
                <Input id="rider-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer complaint under review" />
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <Button variant="danger" disabled={busy || status === 'suspended' || !reason.trim()} onClick={() => act('suspend')}>Suspend</Button>
                  <Button variant="outline" disabled={busy || status === 'under_review' || !reason.trim()} onClick={() => act('pause')}>Pause</Button>
                  <Button disabled={busy || status === 'approved'} onClick={() => act('resume')}>Resume</Button>
                </div>
              </>
            ) : (
              <p style={{ color: colors.muted }}>You can view riders but not change their status.</p>
            )}
          </>
        ) : !error ? <p style={{ color: colors.muted }}>Loading…</p> : null}
      </Card>
    </Page>
  );
}
