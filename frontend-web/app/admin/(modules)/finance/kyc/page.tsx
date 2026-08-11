'use client';

import { useEffect, useState, useCallback } from 'react';
import { listPendingKyc, approveKyc, rejectKyc } from '@/services/fintechService';
import type { KycProfile } from '@/types/fintech';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const TIER_LABELS: Record<number, string> = {
  1: 'Tier 1 (₦50k/day)',
  2: 'Tier 2 (₦200k/day)',
  3: 'Tier 3 (Unlimited)',
};

export default function KycQueuePage() {
  const [profiles, setProfiles] = useState<KycProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProfiles(await listPendingKyc());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleApprove(profile: KycProfile) {
    const tier = profile.requested_tier ?? 1;
    setBusy(profile.user_id);
    try {
      await approveKyc(profile.user_id, tier);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleReject(profile: KycProfile) {
    if (!confirm(`Reject KYC for ${profile.user_id}?`)) return;
    setBusy(profile.user_id);
    try {
      await rejectKyc(profile.user_id);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Page>
      <PageHeader
        title="KYC Approval Queue"
        actions={<Button variant="outline" onClick={load} disabled={loading}>{loading ? 'Loading…' : '↻ Refresh'}</Button>}
      />

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '0.5rem', padding: '0.75rem', marginBottom: '1rem', color: colors.danger }}>
          {error}
        </div>
      )}

      {!loading && profiles.length === 0 && (
        <div style={{ color: colors.muted, textAlign: 'center', padding: '3rem 0' }}>
          No pending KYC submissions.
        </div>
      )}

      {profiles.length > 0 && (
        <Card style={{ padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr>
                {['User ID', 'Status', 'Requested Tier', 'Document Type', 'Submitted At', 'Actions'].map((h) => (
                  <th key={h} style={thCell}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.user_id}>
                  <td style={{ ...tdCell, fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    {p.user_id.slice(0, 8)}…
                  </td>
                  <td style={tdCell}>
                    <Badge text={p.kyc_status} color={colors.warning} />
                  </td>
                  <td style={tdCell}>
                    {p.requested_tier ? TIER_LABELS[p.requested_tier] ?? `Tier ${p.requested_tier}` : '—'}
                  </td>
                  <td style={tdCell}>{p.document_type ?? '—'}</td>
                  <td style={tdCell}>
                    {p.kyc_submitted_at ? new Date(p.kyc_submitted_at).toLocaleString() : '—'}
                  </td>
                  <td style={{ ...tdCell, display: 'flex', gap: '0.5rem' }}>
                    <Button
                      variant="primary"
                      sm
                      onClick={() => handleApprove(p)}
                      disabled={busy === p.user_id}
                    >
                      {busy === p.user_id ? '…' : `Approve → T${p.requested_tier ?? 1}`}
                    </Button>
                    <Button
                      variant="danger"
                      sm
                      onClick={() => handleReject(p)}
                      disabled={busy === p.user_id}
                    >
                      Reject
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Page>
  );
}
