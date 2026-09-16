'use client';

import { PageHeader, InsuranceTabs, UnbuiltSurface } from '../_ui';
import { probe } from '@/services/insuranceAdminService';

/**
 * Consent & data-sharing audit — no backend endpoint exists for this surface yet.
 *
 * See UnbuiltSurface in _ui.tsx for why the page probes live instead of
 * rendering fixtures.
 */
export default function InsuranceConsentAuditPage() {
  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Consent & data-sharing audit" subtitle="What personal data went to the provider, for whom, and under which consent." />
      <InsuranceTabs active="ops" />
      <UnbuiltSurface
        endpoint="/api/insurance/admin/consent-audit"
        purpose="Buying cover means sending a customer's personal data — name, NIN, address, sometimes a photograph — to a third party. NDPA obligations require us to be able to show, per customer, exactly what was shared, when, under which consent version, and to honour a withdrawal or erasure request. That record has to be an append-only audit log, not a state column that the current value overwrites."
        requires={[
          'An append-only log of grant, withdrawal, data-share and erasure events, with actor and timestamp.',
          'The consent version in force at the moment of each share, not merely the latest version.',
          'The specific fields transmitted on each share, so a subject-access request can be answered precisely.',
        ]}
        probeFn={() => probe('/consent-audit')}
      />
    </div>
  );
}
