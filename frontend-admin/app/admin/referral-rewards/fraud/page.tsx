'use client';

// A3 — Fraud & Anti-Abuse Review Queue. Human-in-the-loop review of flagged
// referrer/referred pairs. Actions: clear / void / suspend — each requires a note.
// Backend may return an empty queue initially; the empty state is a first-class UI.
// RBAC: referral.admin.fraud (Trust & Safety / Fraud).

import { useEffect, useState } from 'react';
import { getFraudQueue, actionFraudFlag } from '@/services/referralRewardsAdminService';
import type { FraudFlag, FraudAction } from '@/types/referralRewardsAdmin';
import { PageHeader, RewardsTabs, Card, Badge, StateBlock, btn, btnPrimary, btnDanger, th, td, input, label, timeAgo } from '../_ui';

const STATUS_FILTERS = ['OPEN', 'CLEARED', 'VOIDED', 'SUSPENDED', 'all'];

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Fraud & Anti-Abuse Review Queue"
        subtitle="Flagged referrer/referred pairs (self-referral via device/KYC dedup, circular-funding patterns). Review the evidence, then clear, void the reward, or suspend the referrer — every action requires a note and is logged. (A3)"
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <RewardsTabs active="fraud" />

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'center' }}>
        <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>Status:</span>
        {STATUS_FILTERS.map((s) => (
          <button key={s} onClick={() => setStatus(s)} style={{ ...btn(), background: status === s ? '#eef2ff' : '#fff', borderColor: status === s ? '#340075' : '#d1d5db', fontWeight: status === s ? 700 : 400 }}>{s === 'all' ? 'All' : s}</button>
        ))}
      </div>

      {msg && <div style={{ border: '1px solid #93c5fd', background: '#eff6ff', color: '#1e40af', borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.85rem', marginBottom: '1rem' }}>{msg}</div>}

      <StateBlock loading={loading} error={error} empty={flags.length === 0} emptyText="No flagged pairs in this view. The anti-abuse engine surfaces suspicious device/KYC/funding patterns here as they are detected.">
        {flags.map((f) => (
          <Card key={f.flag_id} title={`Flag ${f.flag_id}`} right={<Badge status={f.status} />}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <Field label="Referrer" value={<code>{f.referrer_id}</code>} />
              <Field label="Referred user" value={<code>{f.referred_user_id}</code>} />
              <Field label="Reason" value={f.reason.replace(/_/g, ' ')} />
              <Field label="Flagged" value={timeAgo(f.flagged_at)} />
            </div>
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: '#6b7280', fontWeight: 600, marginBottom: '0.3rem' }}>Evidence</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {Object.entries(f.evidence).map(([k, v]) => (
                    <tr key={k}><td style={{ ...td(), width: 220, color: '#6b7280' }}>{k}</td><td style={td()}><code style={{ fontSize: '0.78rem' }}>{String(v)}</code></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <label style={label()}>Reviewer note (required)</label>
              <input style={input()} value={note[f.flag_id] ?? ''} onChange={(e) => setNote((m) => ({ ...m, [f.flag_id]: e.target.value }))} placeholder="Reason for this decision — logged with your reviewer ID" />
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
                <button disabled={acting === f.flag_id} onClick={() => act(f, 'CLEARED')} style={btn()}>Clear (false positive)</button>
                <button disabled={acting === f.flag_id} onClick={() => act(f, 'VOIDED')} style={btnDanger()}>Void reward</button>
                <button disabled={acting === f.flag_id} onClick={() => act(f, 'SUSPENDED')} style={{ ...btnPrimary(), background: '#b91c1c', border: '1px solid #b91c1c' }}>Suspend referrer</button>
              </div>
            </div>
          </Card>
        ))}
      </StateBlock>
    </div>
  );
}

function Field({ label: lbl, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: '#6b7280', fontWeight: 600 }}>{lbl}</div>
      <div style={{ fontSize: '0.9rem', marginTop: '0.2rem', color: '#111827' }}>{value}</div>
    </div>
  );
}
