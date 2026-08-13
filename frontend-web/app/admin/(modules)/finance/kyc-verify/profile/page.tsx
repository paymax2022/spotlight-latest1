'use client';

// AK3 — User KYC profile (SCAFFOLD).
// RBAC: finance.admin.kyc (KYC Ops / Compliance). Tier, status, full
// verification history, consent records, linked checks for a single user.
// Shell: search + empty state. Backend endpoint TBD (e.g. GET /kyc/users/{id}).

import { useState } from 'react';
import { PageHeader, Card, btn, inputStyle, th, ScaffoldNotice } from '../_ui';
import { Page, colors } from '@/components/ui/vuexy';

type KycProfile = {
  userId: string;
  tier: string;
  status: string;
  history: Array<{ date: string; action: string }>;
  consents: Array<{ version: string; grantedAt: string; scope: string }>;
};

export default function KycUserProfilePage() {
  const [userId, setUserId] = useState('');
  const [profile, setProfile] = useState<KycProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLoadProfile = async () => {
    if (!userId.trim()) return;
    setLoading(true);
    setError('');
    try {
      // TODO: Replace with actual API call to GET /kyc/users/{id}
      // const res = await fetch(`/api/v1/finance/kyc/users/${userId}`);
      // const data = await res.json();
      // For now, mock data
      await new Promise(resolve => setTimeout(resolve, 500));
      setProfile({
        userId: userId.trim(),
        tier: 'Tier 2',
        status: 'Verified',
        history: [
          { date: '2024-08-05', action: 'Email verified' },
          { date: '2024-08-04', action: 'Phone verified' },
          { date: '2024-08-03', action: 'Identity document submitted' },
        ],
        consents: [
          { version: 'v2.1', grantedAt: '2024-08-05T10:30:00Z', scope: 'KYC Basic' },
          { version: 'v2.0', grantedAt: '2024-08-03T14:20:00Z', scope: 'KYC Full' },
        ],
      });
    } catch (err) {
      setError('Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

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
          <button disabled={!userId.trim() || loading} onClick={handleLoadProfile} style={btn()}>
            {loading ? 'Loading...' : 'Load profile'}
          </button>
        </div>
        {error && <p style={{ color: colors.danger, fontSize: '0.85rem', margin: '0.5rem 0 0' }}>{error}</p>}
      </Card>

      {profile && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
          <div style={{ margin: 0 }}>
            <Card title="Tier & Status">
              <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.85rem' }}>
                <div><span style={{ color: colors.muted }}>User ID:</span> <strong>{profile.userId}</strong></div>
                <div><span style={{ color: colors.muted }}>Tier:</span> <strong>{profile.tier}</strong></div>
                <div><span style={{ color: colors.muted }}>Status:</span> <strong style={{ color: colors.success }}>{profile.status}</strong></div>
              </div>
            </Card>
          </div>
        </div>
      )}

      <Card title="Verification history">
        {profile ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr><th style={th()}>Date</th><th style={th()}>Action</th></tr>
            </thead>
            <tbody>
              {profile.history.map((entry, i) => (
                <tr key={i}><td style={{ padding: '0.5rem', borderBottom: `1px solid ${colors.border}` }}>{entry.date}</td><td style={{ padding: '0.5rem', borderBottom: `1px solid ${colors.border}` }}>{entry.action}</td></tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ color: colors.muted, margin: 0 }}>Enter a user ID to view their tier, KYC status and check history.</p>
        )}
      </Card>

      <Card title="Consent records">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr><th style={th()}>Template version</th><th style={th()}>Granted at</th><th style={th()}>Scope</th></tr>
          </thead>
          <tbody>
            {profile && profile.consents.length > 0 ? (
              profile.consents.map((consent, i) => (
                <tr key={i}>
                  <td style={{ padding: '0.75rem 0.5rem', color: colors.text, fontSize: '0.85rem', borderBottom: `1px solid ${colors.border}` }}>{consent.version}</td>
                  <td style={{ padding: '0.75rem 0.5rem', color: colors.text, fontSize: '0.85rem', borderBottom: `1px solid ${colors.border}` }}>{consent.grantedAt}</td>
                  <td style={{ padding: '0.75rem 0.5rem', color: colors.text, fontSize: '0.85rem', borderBottom: `1px solid ${colors.border}` }}>{consent.scope}</td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={3} style={{ padding: '0.75rem 0.5rem', color: colors.muted, fontSize: '0.85rem' }}>No consent records loaded.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}
