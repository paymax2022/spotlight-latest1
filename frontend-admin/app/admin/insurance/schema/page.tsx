'use client';

import { PageHeader, InsuranceTabs, UnbuiltSurface } from '../_ui';
import { probe } from '@/services/insuranceAdminService';

/**
 * Field schemas — no backend endpoint exists for this surface yet.
 *
 * See UnbuiltSurface in _ui.tsx for why the page probes live instead of
 * rendering fixtures.
 */
export default function InsuranceSchemaPage() {
  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Field schemas" subtitle="The per-product fields a purchase requires." />
      <InsuranceTabs active="ops" />
      <UnbuiltSurface
        endpoint="/api/insurance/admin/schema"
        purpose="MyCover exposes one bespoke purchase endpoint per product, each with its own required fields, lengths and enums — two products from the same underwriter can demand entirely different information. There is no single application form. This screen is where those per-product schemas are inspected, both to review what personal data each product forces us to collect and to check the mobile app is rendering the right form."
        requires={[
          'The stored field schema per product: name, type, required, bounds, enum options and any conditional display rule.',
          'Which fields are personal data, so data-minimisation can be reviewed per product rather than in aggregate.',
          'When each schema was last refreshed from the provider, since a stale schema produces purchases the provider rejects.',
        ]}
        probeFn={() => probe('/schema')}
      />
    </div>
  );
}
