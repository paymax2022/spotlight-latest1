'use client';

import { PageHeader, InsuranceTabs, UnbuiltSurface } from '../_ui';
import { probe } from '@/services/insuranceAdminService';

/**
 * Refunds — no backend endpoint exists for this surface yet.
 *
 * See UnbuiltSurface in _ui.tsx for why the page probes live instead of
 * rendering fixtures.
 */
export default function InsuranceRefundsPage() {
  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Refunds" subtitle="Cooling-off cancellations, failed binds, and duplicate charges." />
      <InsuranceTabs active="finance" />
      <UnbuiltSurface
        endpoint="/api/insurance/admin/refunds"
        purpose="A refund is a money mutation like any other: it needs an idempotency key, a balanced reversing pair, an audit event, and a cap so it can never exceed what was actually collected on that policy. This screen is where those requests are reviewed. It is deliberately inert until a real endpoint exists, because an approve button that resolves an in-memory object would tell an operator a customer was refunded when no money moved."
        requires={[
          'Pending refund requests with the policy, the reason, and the amount in kobo.',
          'The premium actually collected on that policy, so the console can show the cap rather than trust the requested amount.',
          'A decision endpoint that posts reversing ledger entries under an idempotency key — never a status-column update.',
          'The resulting ledger reference on each decided refund.',
        ]}
        probeFn={() => probe('/refunds')}
      />
    </div>
  );
}
