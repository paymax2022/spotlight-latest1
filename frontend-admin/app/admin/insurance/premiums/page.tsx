'use client';

import { PageHeader, InsuranceTabs, UnbuiltSurface } from '../_ui';
import { probe } from '@/services/insuranceAdminService';

/**
 * Premium transactions — no backend endpoint exists for this surface yet.
 *
 * See UnbuiltSurface in _ui.tsx for why the page probes live instead of
 * rendering fixtures.
 */
export default function InsurancePremiumsPage() {
  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Premium transactions" subtitle="Every premium movement behind a policy, tied to its ledger entry." />
      <InsuranceTabs active="finance" />
      <UnbuiltSurface
        endpoint="/api/insurance/admin/premiums"
        purpose="Premium is not our money. Each bind should debit the customer and credit a provider-clearing account, and this screen is where an operator proves that happened: one row per movement, each carrying the idempotency key that made it replay-safe and the ledger reference that makes it auditable. Without it, a failed bind that never reversed its premium is invisible until the customer complains."
        requires={[
          'One row per premium movement: policy id, direction, amount in kobo, status.',
          'The idempotency key the movement was posted under, so a duplicate can be recognised as a duplicate rather than a second charge.',
          'The ledger entry reference for both legs, so the double-entry can be followed.',
          'Whether the provider has acknowledged remittance, and under which reference.',
        ]}
        probeFn={() => probe('/premiums')}
      />
    </div>
  );
}
