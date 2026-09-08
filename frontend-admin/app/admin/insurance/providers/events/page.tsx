'use client';

import { PageHeader, InsuranceTabs, UnbuiltSurface } from '../../_ui';
import { probe } from '@/services/insuranceAdminService';

/**
 * Provider events — no backend endpoint exists for this surface yet.
 *
 * See UnbuiltSurface in _ui.tsx for why the page probes live instead of
 * rendering fixtures.
 */
export default function InsuranceProvidersEventsPage() {
  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Provider events" subtitle="Inbound events from the aggregator and how each was processed." />
      <InsuranceTabs active="providers" />
      <UnbuiltSurface
        endpoint="/api/insurance/admin/provider-events"
        purpose="Policy activations, claim decisions and cancellations arrive from the provider as events. This screen is the record of what arrived, whether its signature verified, whether it was processed, and whether it was a duplicate dropped on the unique provider-event constraint. Reprocessing an event that was already applied is how a single payout gets made twice."
        requires={[
          'Received events with the provider event id, type, receipt time and processing outcome.',
          'The signature verification result per event — an unverified event must be visibly unverified.',
          'Duplicate detection state, so a dropped replay reads as intended behaviour rather than a lost event.',
        ]}
        probeFn={() => probe('/provider-events')}
      />
    </div>
  );
}
