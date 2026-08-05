'use client';

// AK3 — User KYC profile (SCAFFOLD).
// RBAC: finance.admin.kyc (KYC Ops / Compliance). Tier, status, full
// verification history, consent records, linked checks for a single user.
// Shell: search + empty state. Backend endpoint TBD (e.g. GET /kyc/users/{id}).

import { useState } from 'react';
import { PageHeader, Card, btn, inputStyle, th, ScaffoldNotice } from '../_ui';
import { Page, colors } from '@/components/ui/vuexy';

export default function KycUserProfilePage() {
  const [userId, setUserId] = useState('');

  return (
    <Page style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="User KYC Profile (AK3)"
        subtitle="Tier, status, verification history, consent records and linked checks for a user. RBAC: finance.admin.kyc (KYC Ops / Compliance)."
      />

      <ScaffoldNotice>
        Functional shell. Wire to a per-user KYC endpoint (e.g. <code>GET /kyc/users/&#123;id&#125;</code>) to populate tier, history and consent records.
      </ScaffoldNotice>

      <Card title="Look up user">
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="User ID" style={{ ...inputStyle(), width: '18rem' }} />
          <button disabled={!userId.trim()} style={btn()}>Load profile</button>
        </div>
      </Card>

      <Card title="Verification history">
        <p style={{ color: colors.muted, margin: 0 }}>
          {userId.trim() ? 'No data — endpoint not yet wired.' : 'Enter a user ID to view their tier, KYC status and check history.'}
        </p>
      </Card>

      <Card title="Consent records">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr><th style={th()}>Template version</th><th style={th()}>Granted at</th><th style={th()}>Scope</th></tr>
          </thead>
          <tbody>
            <tr><td colSpan={3} style={{ padding: '0.75rem 0.5rem', color: colors.muted, fontSize: '0.85rem' }}>No consent records loaded.</td></tr>
          </tbody>
        </table>
      </Card>
    </Page>
  );
}
