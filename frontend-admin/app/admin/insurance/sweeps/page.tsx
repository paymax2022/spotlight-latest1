'use client';

import { PageHeader, InsuranceTabs, UnbuiltSurface } from '../_ui';
import { probe } from '@/services/insuranceAdminService';

/**
 * Lapse & renewal sweeps — no backend endpoint exists for this surface yet.
 *
 * See UnbuiltSurface in _ui.tsx for why the page probes live instead of
 * rendering fixtures.
 */
export default function InsuranceSweepsPage() {
  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Lapse & renewal sweeps" subtitle="The scheduled jobs that expire and renew cover." />
      <InsuranceTabs active="ops" />
      <UnbuiltSurface
        endpoint="/api/insurance/admin/sweeps"
        purpose="Cover ends on a date. Something has to notice that date and act — lapse the policy, notify the customer, or take the renewal premium. This screen monitors those runs. A silent sweep failure is the kind of fault that surfaces as a customer discovering at claim time that their cover quietly ended."
        requires={[
          'Recent run history per sweep kind, with scanned, affected, notified and error counts.',
          'The next scheduled run, so a stalled scheduler is visible as a stale timestamp.',
          'Policies currently inside the renewal window and those already past expiry without being lapsed.',
        ]}
        probeFn={() => probe('/sweeps')}
      />
    </div>
  );
}
