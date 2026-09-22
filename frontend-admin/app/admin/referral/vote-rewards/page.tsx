'use client';

/**
 * REF-007 — Vote-Triggered Rewards (₦500 flat).
 *
 * This is System C: a third, previously-invisible referral/reward system,
 * separate from the two consoles already in this directory tree (System A —
 * this "Referral" section's other tabs — and System B at
 * /admin/referral-rewards). System C credits a flat ₦500 to the referrer
 * the moment a referred user casts their first vote
 * (frontend-web/src/server/referrals/{service,attribution}.ts, audited via
 * `referral_events`). It had no admin visibility anywhere until this page.
 *
 * Read-only by design: System C's crediting is fully automatic and already
 * idempotent (referral_events UNIQUE(referrer_id,referred_id) +
 * UNIQUE(idempotency_key)) — there is no maker-checker step to expose.
 */
import { useCallback, useEffect, useState } from 'react';
import { getVoteRewardsConsole, formatNaira, type VoteRewardsConsole } from '@/services/referralVoteRewardsAdminService';
import { ReferralTabs } from '../_ui';
import { Page, PageHeader, Card, Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';

function fmtDate(v: string | null | undefined): string {
  return v ? new Date(v).toLocaleString('en-NG') : '—';
}

function StatTile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div style={{ background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 12, color: colors.muted }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{value}</div>
      <div style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>{note}</div>
    </div>
  );
}

export default function VoteTriggeredRewardsPage() {
  const [data, setData] = useState<VoteRewardsConsole | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [referrerId, setReferrerId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getVoteRewardsConsole({
        from: from || undefined,
        to: to || undefined,
        referrerId: referrerId.trim() || undefined,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load vote-triggered referral rewards');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <Page>
      <PageHeader
        title="Vote-Triggered Rewards (₦500 flat)"
        subtitle="System C — referral reward credited automatically when a referred user casts their first vote. Read-only: crediting is fully automatic and idempotent, so there is nothing here to approve or reject."
        actions={<Button variant="outline" sm onClick={() => void load()}>Refresh</Button>}
      />
      <ReferralTabs active="vote-rewards" />

      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: 12, marginBottom: 20 }}>
          <StatTile label="Total rewards paid" value={formatNaira(data.stats.totalRewardsKobo)} note="This window (unbounded aggregate, not just the page below)" />
          <StatTile label="Distinct referrers rewarded" value={String(data.stats.distinctReferrersRewarded)} note="This window" />
          <StatTile label="Reward events" value={String(data.stats.eventCount)} note="This window" />
        </div>
      )}

      <Card title="Filters" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: 4 }}>From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: 4 }}>To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: 4 }}>Referrer user ID</label>
            <Input placeholder="uuid" style={{ width: 260 }} value={referrerId} onChange={(e) => setReferrerId(e.target.value)} />
          </div>
          <Button variant="primary" sm onClick={() => void load()}>Apply</Button>
        </div>
      </Card>

      <Card title={data ? `Reward events (${data.meta.total} total)` : 'Reward events'}>
        {loading ? (
          <p style={{ color: colors.muted, margin: 0 }}>Loading…</p>
        ) : error ? (
          <p style={{ color: colors.danger, margin: 0 }}>{error}</p>
        ) : !data || data.events.length === 0 ? (
          <p style={{ color: colors.muted, margin: 0 }}>No vote-triggered referral rewards found for this window.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>Rewarded at</th>
                  <th style={thCell}>Referrer</th>
                  <th style={thCell}>Referred user</th>
                  <th style={thCell}>Amount</th>
                  <th style={thCell}>Ledger entry</th>
                  <th style={thCell}>Idempotency key</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((e) => (
                  <tr key={e.id}>
                    <td style={tdCell}>{fmtDate(e.rewardedAt)}</td>
                    <td style={tdCell}>
                      <strong>{e.referrerName}</strong>
                      <div style={{ fontSize: 12, color: colors.muted }}>{e.referrerEmail || e.referrerId}</div>
                    </td>
                    <td style={tdCell}>
                      <strong>{e.referredName}</strong>
                      <div style={{ fontSize: 12, color: colors.muted }}>{e.referredEmail || e.referredId}</div>
                    </td>
                    <td style={tdCell}><strong>{formatNaira(e.amountKobo)}</strong></td>
                    <td style={tdCell}>{e.ledgerEntryId ? <code style={{ fontSize: '0.72rem' }}>{e.ledgerEntryId.slice(0, 8)}</code> : '—'}</td>
                    <td style={tdCell}><code style={{ fontSize: '0.72rem' }}>{e.idempotencyKey}</code></td>
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
