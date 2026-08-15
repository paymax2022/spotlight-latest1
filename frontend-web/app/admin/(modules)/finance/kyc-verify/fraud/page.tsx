'use client';

// AK5 — Fraud / duplicate-identity queue (SCAFFOLD).
// RBAC: finance.admin.kyc (role: Compliance). IDs flagged as previously
// registered (e.g. Smile `UserIDsOfPreviousRegistrants`); investigate links.
// Shell: table + empty state. Backend endpoint TBD (e.g. GET /kyc/duplicate-hits).

import { PageHeader, Card, th, ScaffoldNotice } from '../_ui';
import { Page, colors } from '@/components/ui/vuexy';

export default function KycFraudQueuePage() {
  return (
    <Page style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Fraud / Duplicate-Identity Queue (AK5)"
        subtitle="IDs flagged as previously registered; investigate linked accounts. RBAC: finance.admin.kyc (Compliance)."
      />

      <ScaffoldNotice>
        Functional shell. Wire to a duplicate-identity endpoint (e.g. <code>GET /kyc/duplicate-hits</code>) surfacing previous-registrant links for investigation.
      </ScaffoldNotice>

      <Card title="Flagged duplicate identities">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th()}>User</th>
                <th style={th()}>ID type</th>
                <th style={th()}>Previously registered as</th>
                <th style={th()}>Linked accounts</th>
                <th style={th()}>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr><td colSpan={5} style={{ padding: '0.75rem 0.5rem', color: colors.muted, fontSize: '0.85rem' }}>No duplicate-identity flags.</td></tr>
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  );
}
