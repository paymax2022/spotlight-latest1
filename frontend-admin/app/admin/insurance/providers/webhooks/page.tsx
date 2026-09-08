'use client';

import { PageHeader, InsuranceTabs, UnbuiltSurface, WarningNote } from '../../_ui';
import { probe } from '@/services/insuranceAdminService';

/**
 * Webhook deliveries — no backend endpoint exists for this surface yet.
 *
 * See UnbuiltSurface in _ui.tsx for why the page probes live instead of
 * rendering fixtures.
 */
export default function InsuranceProvidersWebhooksPage() {
  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Webhook deliveries" subtitle="Delivery attempts, failures, and replay." />
      <InsuranceTabs active="providers" />
      <UnbuiltSurface
        endpoint="/api/insurance/admin/webhooks"
        purpose="The delivery-level view of the same pipeline as provider events: what the provider attempted to send us, what we returned, and what needs replaying. Replay is a real mutation and is not offered here until it can call a real endpoint, because a replay button that resolves locally would let an operator believe a missed policy activation had been recovered."
        requires={[
          'Delivery attempts with status, attempt count, last attempt time and the response we returned.',
          'A replay endpoint that re-enqueues by provider event id and is idempotent on that id.',
          'Whether the signing secret was configured at the time of each delivery, so historical unverifiable deliveries stay identifiable after a secret is finally set.',
        ]}
        note={
          <WarningNote title="Signature verification cannot pass today">
            INSURANCE_MYCOVER_WEBHOOK_SECRET is unset in this environment, so there is no shared secret to
            check an inbound signature against. Every delivery that arrives is therefore either rejected or
            accepted unverified. Nothing on this screen should be read as evidence that provider webhooks
            are authenticated.
          </WarningNote>
        }
        probeFn={() => probe('/webhooks')}
      />
    </div>
  );
}
