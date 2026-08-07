'use client';

// AK4 — AML / PEP hits queue (SCAFFOLD).
// RBAC: finance.admin.kyc (role: Compliance). Screening hits with match detail;
// disposition (clear / escalate). Shell: table + empty state. Backend endpoint
// TBD (e.g. GET /kyc/aml-hits).

import { PageHeader, Card, th, ScaffoldNotice } from '../_ui';
import { Page, colors } from '@/components/ui/vuexy';

export default function KycAmlQueuePage() {
  return (
    <Page style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="AML / PEP Hits Queue (AK4)"
        subtitle="Screening hits with match detail; disposition (clear / escalate). RBAC: finance.admin.kyc (Compliance)."
      />

      <ScaffoldNotice>
        Functional shell. Wire to an AML-hits endpoint (e.g. <code>GET /kyc/aml-hits</code>) and add clear/escalate disposition actions (audited).
      </ScaffoldNotice>

      <Card title="Open AML / PEP hits">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th()}>User</th>
                <th style={th()}>List</th>
                <th style={th()}>Match name</th>
                <th style={th()}>Score</th>
                <th style={th()}>Provider</th>
                <th style={th()}>Disposition</th>
              </tr>
            </thead>
            <tbody>
              <tr><td colSpan={6} style={{ padding: '0.75rem 0.5rem', color: colors.muted, fontSize: '0.85rem' }}>No open AML / PEP hits.</td></tr>
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  );
}
