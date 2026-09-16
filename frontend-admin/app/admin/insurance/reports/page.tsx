'use client';

import { PageHeader, InsuranceTabs, UnbuiltSurface } from '../_ui';
import { probe } from '@/services/insuranceAdminService';

/**
 * Reports — no backend endpoint exists for this surface yet.
 *
 * See UnbuiltSurface in _ui.tsx for why the page probes live instead of
 * rendering fixtures.
 */
export default function InsuranceReportsPage() {
  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Reports" subtitle="Finance, compliance and operational extracts." />
      <InsuranceTabs active="ops" />
      <UnbuiltSurface
        endpoint="/api/insurance/admin/reports"
        purpose="Regulatory and finance reporting on distributed insurance: what was written, what commission was recognised, what was claimed and what remains outstanding. These extracts must be generated from the ledger rather than assembled in the browser, so that a figure in an exported report and a figure on a screen can never disagree."
        requires={[
          'The available report definitions and the formats each supports.',
          'A generation endpoint that produces the file server-side from ledger data.',
          'When each report was last generated and over what period, so a stale export is not mistaken for a current one.',
        ]}
        probeFn={() => probe('/reports')}
      />
    </div>
  );
}
