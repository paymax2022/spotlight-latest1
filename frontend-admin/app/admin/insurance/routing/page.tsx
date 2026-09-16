'use client';

import { PageHeader, InsuranceTabs, UnbuiltSurface } from '../_ui';
import { probe } from '@/services/insuranceAdminService';

/**
 * Product routing — no backend endpoint exists for this surface yet.
 *
 * See UnbuiltSurface in _ui.tsx for why the page probes live instead of
 * rendering fixtures.
 */
export default function InsuranceRoutingPage() {
  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Product routing" subtitle="Which aggregator and underwriter each product resolves to." />
      <InsuranceTabs active="providers" />
      <UnbuiltSurface
        endpoint="/api/insurance/admin/routing"
        purpose="Routing decides who carries the risk when a customer buys. Today MyCover is the only live rail, and each product already names its own underwriter, so this screen is a read of that mapping rather than a choice we make per sale. It becomes a control surface the moment a second aggregator can serve the same product line."
        requires={[
          'Current product to aggregator to underwriter mapping, as stored.',
          'For MyCover, the bespoke purchase path per product — it is not derivable from the product name and must be stored, not computed.',
          'Whether a routing change is permitted while policies are in force under the old route.',
        ]}
        probeFn={() => probe('/routing')}
      />
    </div>
  );
}
