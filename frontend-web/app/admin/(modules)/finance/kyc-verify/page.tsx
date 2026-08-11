'use client';

// AK1 — KYC Verification review queue.
// RBAC: finance.admin.kyc (role: KYC Ops). Lists sessions/checks in NEEDS_REVIEW,
// prioritized (lowest confidence first), each row → case detail (AK2).

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { listReviewQueue } from '@/services/kycAdminService';
import type { KycReviewItem } from '@/types/kycAdmin';
import { CHECK_TYPE_LABELS, TIER_LABELS } from '@/types/kycAdmin';
import { PageHeader, Card, btn, th, td, timeAgo, ConfidencePill, useKycPermissions } from './_ui';
import { Page, colors } from '@/components/ui/vuexy';

export default function KycReviewQueuePage() {
  const { canManage } = useKycPermissions();
  const [rows, setRows] = useState<KycReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await listReviewQueue()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <Page style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="KYC Verification — Review Queue"
        subtitle="Sessions in NEEDS_REVIEW (facial below threshold, document flagged, AML hit). Prioritized by confidence. RBAC: finance.admin.kyc (KYC Ops)."
        action={<button onClick={() => void load()} style={btn()}>Refresh</button>}
      />

      {!canManage && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: colors.danger, marginBottom: '1.25rem' }}>
          You lack <code>finance.admin.kyc</code>. You can view the queue but case decisions are disabled. Backend RBAC is authoritative.
        </div>
      )}

      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <Card>
        {loading ? (
          <p style={{ color: colors.muted }}>Loading review queue…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: colors.muted }}>No cases awaiting review. </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>Priority</th>
                  <th style={th()}>User</th>
                  <th style={th()}>Target Tier</th>
                  <th style={th()}>Failing Check</th>
                  <th style={th()}>Provider</th>
                  <th style={th()}>Confidence</th>
                  <th style={th()}>Submitted</th>
                  <th style={th()}>Case</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.session.id}>
                    <td style={td()}>
                      <span style={{ fontWeight: 700, color: (r.priority ?? 0) >= 40 ? colors.danger : colors.warning }}>
                        {r.priority ?? '—'}
                      </span>
                    </td>
                    <td style={{ ...td(), fontFamily: 'monospace', fontSize: '0.8rem' }}>{r.session.user_id}</td>
                    <td style={td()}>{TIER_LABELS[r.session.target_tier] ?? `Tier ${r.session.target_tier}`}</td>
                    <td style={td()}>{r.failing_check_type ? CHECK_TYPE_LABELS[r.failing_check_type] : '—'}</td>
                    <td style={{ ...td(), textTransform: 'capitalize' }}>{r.provider ?? '—'}</td>
                    <td style={td()}><ConfidencePill value={r.confidence} /></td>
                    <td style={td()}>{timeAgo(r.submitted_at)}</td>
                    <td style={td()}>
                      <Link href={`/admin/finance/kyc-verify/cases/${r.session.id}`} style={{ color: colors.primary, textDecoration: 'none', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                        {r.session.id} →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
