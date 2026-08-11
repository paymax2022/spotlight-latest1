'use client';

// A3 — Fraud & Anti-Abuse Review Queue. Human-in-the-loop review of flagged
// referrer/referred pairs. Actions: clear / void / suspend — each requires a note.
// Backend may return an empty queue initially; the empty state is a first-class UI.
// RBAC: referral.admin.fraud (Trust & Safety / Fraud).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getFraudQueue, actionFraudFlag } from '@/services/referralRewardsAdminService';
import type { FraudFlag, FraudAction } from '@/types/referralRewardsAdmin';
import { Page, PageHeader, Card, Button, Input, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';
import { timeAgo } from '../_ui';

const STATUS_FILTERS = ['OPEN', 'CLEARED', 'VOIDED', 'SUSPENDED', 'all'];

const REWARDS_TABS = [
  { href: '/admin/referral-rewards/config', label: 'A1 · Config', key: 'config' },
  { href: '/admin/referral-rewards/analytics', label: 'A2 · Analytics', key: 'analytics' },
  { href: '/admin/referral-rewards/fraud', label: 'A3 · Fraud queue', key: 'fraud' },
  { href: '/admin/referral-rewards/ledger', label: 'A4 · Ledger', key: 'ledger' },
  { href: '/admin/referral-rewards/case', label: 'A5 · Case view', key: 'case' },
  { href: '/admin/referral-rewards/milestones', label: 'A6 · Milestones', key: 'milestones' },
  { href: '/admin/referral-rewards/module-status', label: 'A7 · Module status', key: 'module-status' },
];

function RewardsTabs({ active }: { active: string }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20, borderBottom: `1px solid ${colors.border}`, paddingBottom: 8 }}>
      {REWARDS_TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          style={{
            textDecoration: 'none', padding: '6px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600,
            color: active === t.key ? '#fff' : colors.text,
            background: active === t.key ? colors.primary : tint(colors.primary, 0.06),
          }}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

const STATUS_BADGE: Record<string, string> = {
  open: colors.warning,
  cleared: colors.secondary,
  voided: colors.danger,
  suspended: colors.danger,
};
function statusColor(status: string): string {
  return STATUS_BADGE[status.toLowerCase()] ?? colors.secondary;
}
function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').toLowerCase();
}

export default function ReferralRewardsFraudPage() {
  const [flags, setFlags] = useState<FraudFlag[]>([]);
  const [status, setStatus] = useState('OPEN');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null); setMsg(null);
    try { setFlags(await getFraudQueue(status)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function act(flag: FraudFlag, action: FraudAction) {
    const n = (note[flag.flag_id] ?? '').trim();
    if (!n) { setMsg('A note is required for every fraud action.'); return; }
    setActing(flag.flag_id); setMsg(null); setError(null);
    try {
      await actionFraudFlag({ flag_id: flag.flag_id, action, note: n });
      setMsg(`Flag ${flag.flag_id} actioned: ${action}.`);
      await load();
    } catch (e) { setError(String(e)); }
    finally { setActing(null); }
  }

  return (
    <Page>
      <PageHeader
        title="Fraud & Anti-Abuse Review Queue"
        subtitle="Flagged referrer/referred pairs (self-referral via device/KYC dedup, circular-funding patterns). Review the evidence, then clear, void the reward, or suspend the referrer — every action requires a note and is logged. (A3)"
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <RewardsTabs active="fraud" />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: colors.muted }}>Status:</span>
        {STATUS_FILTERS.map((s) => (
          <Button key={s} variant={status === s ? 'primary' : 'outline'} sm onClick={() => setStatus(s)}>{s === 'all' ? 'All' : s}</Button>
        ))}
      </div>

      {msg && <div style={{ border: `1px solid ${colors.info}`, background: tint(colors.info, 0.1), color: colors.info, borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>{msg}</div>}

      {loading ? (
        <p style={{ color: colors.muted }}>Loading…</p>
      ) : error ? (
        <p style={{ color: colors.danger }}>{error}</p>
      ) : flags.length === 0 ? (
        <p style={{ color: colors.muted }}>No flagged pairs in this view. The anti-abuse engine surfaces suspicious device/KYC/funding patterns here as they are detected.</p>
      ) : (
        flags.map((f) => (
          <Card key={f.flag_id} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Flag {f.flag_id}</h2>
              <Badge text={statusLabel(f.status)} color={statusColor(f.status)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: 12, marginBottom: 12 }}>
              <Field label="Referrer" value={<code>{f.referrer_id}</code>} />
              <Field label="Referred user" value={<code>{f.referred_user_id}</code>} />
              <Field label="Reason" value={f.reason.replace(/_/g, ' ')} />
              <Field label="Flagged" value={timeAgo(f.flagged_at)} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 600, marginBottom: 5 }}>Evidence</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {Object.entries(f.evidence).map(([k, v]) => (
                    <tr key={k}><td style={{ ...tdCell, width: 220, color: colors.muted }}>{k}</td><td style={tdCell}><code style={{ fontSize: 12 }}>{String(v)}</code></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Reviewer note (required)</label>
              <Input value={note[f.flag_id] ?? ''} onChange={(e) => setNote((m) => ({ ...m, [f.flag_id]: e.target.value }))} placeholder="Reason for this decision — logged with your reviewer ID" />
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <Button variant="outline" disabled={acting === f.flag_id} onClick={() => act(f, 'CLEARED')}>Clear (false positive)</Button>
                <Button variant="danger" disabled={acting === f.flag_id} onClick={() => act(f, 'VOIDED')}>Void reward</Button>
                <Button variant="danger" disabled={acting === f.flag_id} onClick={() => act(f, 'SUSPENDED')}>Suspend referrer</Button>
              </div>
            </div>
          </Card>
        ))
      )}
    </Page>
  );
}

function Field({ label: lbl, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 600 }}>{lbl}</div>
      <div style={{ fontSize: 14, marginTop: 2, color: colors.text }}>{value}</div>
    </div>
  );
}
