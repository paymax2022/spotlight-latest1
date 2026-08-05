'use client';

// AK13 — Audit & consent log (SCAFFOLD).
// RBAC: finance.admin.kyc (role: Compliance). Immutable trail of checks, admin
// decisions, EVIDENCE ACCESS (from AK2's logged fetches), and consent grants.
// Shell: table + empty state. Backend endpoint TBD (e.g. GET /kyc/audit-log).

import { PageHeader, Card, th, td, ScaffoldNotice } from '../_ui';
import { Page, colors } from '@/components/ui/vuexy';

export default function KycAuditLogPage() {
  return (
    <Page style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Audit & Consent Log (AK13)"
        subtitle="Immutable trail of checks, admin decisions, evidence access and consent grants. RBAC: finance.admin.kyc (Compliance)."
      />

      <ScaffoldNotice>
        Functional shell. Wire to an audit endpoint (e.g. <code>GET /kyc/audit-log</code>). Every &ldquo;View evidence (logged)&rdquo; action from a case (AK2) must appear here as an evidence-access entry.
      </ScaffoldNotice>

      <Card title="Audit trail">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th()}>When</th>
                <th style={th()}>Actor</th>
                <th style={th()}>Action</th>
                <th style={th()}>Target</th>
                <th style={th()}>Reason / detail</th>
              </tr>
            </thead>
            <tbody>
              <tr><td colSpan={5} style={{ ...td(), color: colors.muted }}>No audit entries loaded.</td></tr>
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  );
}
