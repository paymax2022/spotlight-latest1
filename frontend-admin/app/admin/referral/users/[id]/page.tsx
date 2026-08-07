'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getReferralUser360, interveneUser, formatNaira } from '@/services/referralAdminOpsService';
import type { ReferralUser360, InterventionAction } from '@/types/referralAdminOps';
import { timeAgo } from '../../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const ACTIONS: { value: InterventionAction; label: string }[] = [
  { value: 'adjust', label: 'Adjust balance' },
  { value: 'suspend', label: 'Suspend account' },
  { value: 'reverse', label: 'Reverse reward' },
  { value: 're_verify', label: 'Re-verify KYC' },
];

function statusBadgeColor(status: string): string {
  if (status === 'active') return colors.success;
  if (status === 'suspended') return colors.danger;
  return colors.warning;
}

function rewardStateBadgeColor(state: string): string {
  if (state === 'eligible' || state === 'paid') return colors.success;
  if (state === 'clawed_back') return colors.danger;
  if (state === 'earned') return colors.info;
  if (state === 'vesting') return colors.primary;
  return colors.warning;
}

export default function ReferralUser360Page() {
  const params = useParams();
  const id = String(params?.id ?? '');
  const [data, setData] = useState<ReferralUser360 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<InterventionAction>('adjust');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getReferralUser360(id)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (id) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function intervene() {
    if (!data) return;
    if (!reason.trim()) { setMsg('A reason is required for any intervention (audited).'); return; }
    const needsAmount = action === 'adjust' || action === 'reverse';
    const amountKobo = needsAmount ? Math.round(parseFloat(amount || '0') * 100) : undefined;
    if (needsAmount && (!amountKobo || amountKobo <= 0)) { setMsg('Enter a valid amount (₦).'); return; }
    setBusy(true); setMsg(null);
    try {
      await interveneUser({ user_id: data.id, action, amount_kobo: amountKobo, reason: reason.trim() });
      setMsg(`Intervention "${action}" recorded — audit event emitted.`);
      setReason(''); setAmount('');
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  const needsAmount = action === 'adjust' || action === 'reverse';

  return (
    <Page>
      <PageHeader
        title={data ? data.name : 'User 360'}
        subtitle="Referral User 360: roles, earnings, referrals & risk score (A-USR-01) with manual intervention & support tools (A-USR-03/04)."
        actions={<Link href="/admin/referral/users" className="vx-btn vx-btn--outline" style={{ textDecoration: 'none' }}>← Users</Link>}
      />

      {loading ? <p style={{ color: colors.muted }}>Loading…</p>
        : error ? <p style={{ color: colors.danger }}>{error}</p>
        : !data ? <p style={{ color: colors.muted }}>User not found.</p>
        : (
          <>
            <Card style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Profile</h2>
                <Badge text={data.status} color={statusBadgeColor(data.status)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px,1fr))', gap: 10 }}>
                <Kpi label="User ID" value={data.id} sub={data.email} />
                <Kpi label="Roles" value={data.roles.join(', ')} />
                <Kpi label="KYC tier" value={data.kyc_tier} />
                <Kpi label="Risk score" value={`${data.risk_score}/100`} accent={data.risk_score >= 70 ? colors.danger : data.risk_score >= 40 ? colors.warning : colors.success} />
                <Kpi label="Total earned" value={formatNaira(data.total_earned_kobo)} />
                <Kpi label="Pending" value={formatNaira(data.pending_kobo)} accent={colors.warning} />
                <Kpi label="Clawed back" value={formatNaira(data.clawed_back_kobo)} accent={data.clawed_back_kobo > 0 ? colors.danger : undefined} />
                <Kpi label="Referrals" value={`${data.active_referrals}/${data.referrals_count}`} sub="active / total" />
              </div>
            </Card>

            <Card title="Manual intervention (A-USR-03)" style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 12, color: colors.muted, marginTop: 14 }}>Adjust, suspend, reverse or re-verify. All actions are audited; money-affecting actions post reversing/adjusting ledger entries with an Idempotency-Key.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: 12, alignItems: 'end' }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Action</label>
                  <select value={action} onChange={(e) => setAction(e.target.value as InterventionAction)} style={{ width: '100%' }}>
                    {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                </div>
                {needsAmount && (
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Amount (₦)</label>
                    <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2000.00" inputMode="decimal" />
                  </div>
                )}
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Reason</label>
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Goodwill / fraud correction / dispute" />
                </div>
                <Button variant={action === 'suspend' || action === 'reverse' ? 'danger' : 'primary'} disabled={busy} onClick={intervene}>{busy ? '…' : 'Apply'}</Button>
              </div>
              {msg && <p style={{ color: msg.startsWith('Intervention') ? colors.success : colors.danger, fontSize: 13, marginTop: 8 }}>{msg}</p>}
            </Card>

            <Card title="Referrals" style={{ marginBottom: 16 }}>
              {data.referrals.length === 0 ? <p style={{ color: colors.muted }}>No referrals.</p> : (
                <div style={{ overflowX: 'auto', marginTop: 14 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={thCell}>Referred user</th><th style={thCell}>State</th><th style={thCell}>Reward</th><th style={thCell}>When</th></tr></thead>
                    <tbody>
                      {data.referrals.map((r) => (
                        <tr key={r.id}><td style={tdCell}>{r.user_id}</td><td style={tdCell}>{r.state}</td><td style={tdCell}>{formatNaira(r.reward_kobo)}</td><td style={tdCell}>{timeAgo(r.created_at)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="Earnings" style={{ marginBottom: 16 }}>
              {data.earnings.length === 0 ? <p style={{ color: colors.muted }}>No earnings.</p> : (
                <div style={{ overflowX: 'auto', marginTop: 14 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={thCell}>Reward</th><th style={thCell}>Kind</th><th style={thCell}>State</th><th style={thCell}>Amount</th><th style={thCell}>When</th></tr></thead>
                    <tbody>
                      {data.earnings.map((e) => (
                        <tr key={e.id}>
                          <td style={tdCell}><code style={{ fontSize: 13 }}>{e.id}</code></td>
                          <td style={tdCell}>{e.kind}</td>
                          <td style={tdCell}><Badge text={e.state} color={rewardStateBadgeColor(e.state)} /></td>
                          <td style={tdCell}>{formatNaira(e.amount_kobo)}</td>
                          <td style={tdCell}>{timeAgo(e.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="Audit trail">
              <div style={{ overflowX: 'auto', marginTop: 14 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thCell}>When</th><th style={thCell}>Actor</th><th style={thCell}>Action</th></tr></thead>
                  <tbody>
                    {data.audit.map((a, i) => (
                      <tr key={i}><td style={tdCell}>{timeAgo(a.ts)}</td><td style={tdCell}>{a.actor}</td><td style={tdCell}>{a.action}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
    </Page>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: '13px 15px', background: colors.card }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 700, marginTop: 4, color: accent ?? colors.text }}>{value}</div>
      {sub ? <div style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}
