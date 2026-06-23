'use client';

import { useEffect, useState, useCallback } from 'react';
import { listPendingKyc, approveKyc, rejectKyc } from '@/services/fintechService';
import type { KycProfile } from '@/types/fintech';

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
    <div style={{ padding: '2rem', fontFamily: 'inherit' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>KYC Approval Queue</h1>
        <button
          onClick={load}
          disabled={loading}
          style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', border: '1px solid #d1d5db', cursor: 'pointer' }}
        >
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '0.5rem', padding: '0.75rem', marginBottom: '1rem', color: '#dc2626' }}>
          {error}
        </div>
      )}

      {!loading && profiles.length === 0 && (
        <div style={{ color: '#6b7280', textAlign: 'center', padding: '3rem 0' }}>
          No pending KYC submissions.
        </div>
      )}

      {profiles.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
              {['User ID', 'Status', 'Requested Tier', 'Document Type', 'Submitted At', 'Actions'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '0.75rem 0.5rem', fontWeight: 600, color: '#374151' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.user_id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                  {p.user_id.slice(0, 8)}…
                </td>
                <td style={{ padding: '0.75rem 0.5rem' }}>
                  <span style={{
                    background: '#fef3c7', color: '#92400e',
                    padding: '0.125rem 0.5rem', borderRadius: '9999px', fontSize: '0.75rem',
                  }}>
                    {p.kyc_status}
                  </span>
                </td>
                <td style={{ padding: '0.75rem 0.5rem' }}>
                  {p.requested_tier ? TIER_LABELS[p.requested_tier] ?? `Tier ${p.requested_tier}` : '—'}
                </td>
                <td style={{ padding: '0.75rem 0.5rem' }}>{p.document_type ?? '—'}</td>
                <td style={{ padding: '0.75rem 0.5rem' }}>
                  {p.kyc_submitted_at ? new Date(p.kyc_submitted_at).toLocaleString() : '—'}
                </td>
                <td style={{ padding: '0.75rem 0.5rem', display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => handleApprove(p)}
                    disabled={busy === p.user_id}
                    style={{
                      padding: '0.375rem 0.75rem', borderRadius: '0.375rem', border: 'none',
                      background: '#10b981', color: '#fff', cursor: 'pointer', fontSize: '0.8rem',
                    }}
                  >
                    {busy === p.user_id ? '…' : `Approve → T${p.requested_tier ?? 1}`}
                  </button>
                  <button
                    onClick={() => handleReject(p)}
                    disabled={busy === p.user_id}
                    style={{
                      padding: '0.375rem 0.75rem', borderRadius: '0.375rem', border: 'none',
                      background: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: '0.8rem',
                    }}
                  >
                    Reject
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
