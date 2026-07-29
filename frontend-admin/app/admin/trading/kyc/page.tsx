'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { listReviewQueue } from '@/services/tradingAdminService';
import type { TradingKycRecord } from '@/types/tradingAdmin';
import {
  PageHeader, TradingTabs, Card, StatusBadge, DisclosureNote, StateBlock, PermissionBanner,
  btn, th, td, timeAgo, TRADING_PERMS, useTradingPermission,
} from '../_ui';

// Module-KYC review queue (§16B.2). SUBMITTED + UNDER_REVIEW cases, oldest first,
// with risk flags. Decoupled from the super-app Tier 0-3.
export default function TradingKycQueuePage() {
  const { allowed: canReview } = useTradingPermission(TRADING_PERMS.review, TRADING_PERMS.bypassApprove);
  const [rows, setRows] = useState<TradingKycRecord[]>([]);
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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Trading — Module KYC"
        subtitle="Trading Access Verification, independent of the app's identity Tier 0–3. Approve/Reject grants or blocks trading access; Bypass is a controlled two-person exception."
        action={<button onClick={() => void load()} style={btn()}>Refresh</button>}
      />
      <TradingTabs active="kyc" />
      <DisclosureNote>
        This verification is <strong>decoupled</strong> from the super-app Tier 0–3 (§16B.1): a user can be Tier 3 and still
        Not-Verified for trading. The trading module grants access <strong>iff</strong> this record is <code>APPROVED</code> or an
        unexpired <code>BYPASSED</code>. Every decision requires a reason and is audited.
      </DisclosureNote>

      {!canReview && <PermissionBanner permission={TRADING_PERMS.review} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <Card>
        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No cases awaiting review.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Applicant</th><th style={th()}>Status</th><th style={th()}>Risk</th>
              <th style={th()}>Source of funds</th><th style={th()}>Submitted</th><th style={th()}></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id}>
                  <td style={td()}>
                    <div style={{ fontWeight: 600 }}>{r.display_name}</div>
                    <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.email_masked} · <code>{r.user_id}</code></div>
                  </td>
                  <td style={td()}><StatusBadge status={r.status} /></td>
                  <td style={td()}>
                    {r.sanctions_hit ? <span style={{ color: '#b91c1c', fontWeight: 600 }}>sanctions </span> : null}
                    {r.pep_hit ? <span style={{ color: '#9a3412', fontWeight: 600 }}>PEP </span> : null}
                    {!r.sanctions_hit && !r.pep_hit ? <span style={{ color: '#15803d' }}>clear</span> : null}
                  </td>
                  <td style={td()}>{r.source_of_funds ?? '—'}</td>
                  <td style={td()}>{timeAgo(r.submitted_at)}</td>
                  <td style={td()}><Link href={`/admin/trading/kyc/${r.user_id}`} style={{ ...btn(), textDecoration: 'none' }}>Review</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
