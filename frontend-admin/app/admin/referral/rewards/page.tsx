'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { listRewardLedger, manualGrant, formatNaira } from '@/services/referralAdminService';
import type { RewardLedgerEntry, RewardKind } from '@/types/referralAdmin';
import { PageHeader, ReferralTabs, Card, Badge, btn, btnPrimary, input, label, th, td, timeAgo, StateBlock } from '../_ui';

const STATES = ['all', 'earned', 'pending', 'vesting', 'eligible', 'paid', 'clawed_back'];
const KINDS = ['all', 'referrer', 'referee', 'override', 'mission', 'manual'];

export default function RewardLedgerPage() {
  const [rows, setRows] = useState<RewardLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState('all');
  const [kind, setKind] = useState('all');
  const [showGrant, setShowGrant] = useState(false);

  const filters = useMemo(() => ({ state, kind }), [state, kind]);
  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listRewardLedger(filters)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filters]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Reward ledger"
        subtitle="Every reward across all states: earned → pending → vesting → eligible → paid → clawed-back (A-RWD-01). Manual grants & clawbacks are audited."
        action={<button onClick={() => setShowGrant((s) => !s)} style={btnPrimary()}>{showGrant ? 'Close' : '+ Manual grant'}</button>}
      />
      <ReferralTabs active="rewards" />

      {showGrant && <ManualGrantForm onDone={() => { setShowGrant(false); load(); }} />}

      <Card>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ fontSize: '0.8rem', color: '#374151', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            State
            <select value={state} onChange={(e) => setState(e.target.value)} style={{ padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem' }}>
              {STATES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
          <label style={{ fontSize: '0.8rem', color: '#374151', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem' }}>
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <span style={{ marginLeft: 'auto' }}><button onClick={load} style={btn()}>Refresh</button></span>
        </div>
      </Card>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No rewards match these filters.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>ID</th><th style={th()}>Beneficiary</th><th style={th()}>Kind</th><th style={th()}>Amount</th><th style={th()}>State</th><th style={th()}>Flags</th><th style={th()}>Updated</th><th style={th()}></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><code style={{ fontSize: '0.76rem' }}>{r.id}</code></td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.beneficiary_id}</code>{r.is_house && <> <Badge status="house" label="house" /></>}</td>
                  <td style={td()}><Badge status="normal" label={r.kind} /></td>
                  <td style={td()}>{formatNaira(r.amount_kobo)}</td>
                  <td style={td()}><Badge status={r.state} /></td>
                  <td style={td()}>
                    {r.excluded_from_kfactor && <Badge status="vesting" label="excl. K-factor" />}{' '}
                    {r.excluded_from_override && <Badge status="vesting" label="excl. override" />}
                  </td>
                  <td style={td()}>{timeAgo(r.updated_at)}</td>
                  <td style={{ ...td(), textAlign: 'right' }}><Link href={`/admin/referral/rewards/${r.id}`} style={{ color: '#1d4ed8', textDecoration: 'none', fontWeight: 600 }}>Open →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}

function ManualGrantForm({ onDone }: { onDone: () => void }) {
  const [beneficiary, setBeneficiary] = useState('');
  const [naira, setNaira] = useState('');
  const [kind, setKind] = useState<RewardKind>('manual');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!beneficiary.trim() || !reason.trim() || !naira) { setError('Beneficiary, amount and reason are required.'); return; }
    setBusy(true); setError(null);
    try {
      await manualGrant({ beneficiary_id: beneficiary.trim(), amount_kobo: Math.round(Number(naira) * 100), kind, reason: reason.trim() });
      onDone();
    } catch (err) { setError(String(err)); setBusy(false); }
  }

  return (
    <Card title="Manual grant / adjustment (A-RWD-04, audited)">
      <form onSubmit={submit}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <div><label style={label()}>Beneficiary user ID</label><input value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} style={input()} placeholder="usr_..." /></div>
          <div><label style={label()}>Amount (₦)</label><input type="number" min={0} value={naira} onChange={(e) => setNaira(e.target.value)} style={input()} /></div>
          <div><label style={label()}>Kind</label>
            <select value={kind} onChange={(e) => setKind(e.target.value as RewardKind)} style={input()}>
              {['manual', 'referrer', 'referee', 'override', 'mission'].map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}><label style={label()}>Reason (required, audited)</label><input value={reason} onChange={(e) => setReason(e.target.value)} style={input()} placeholder="e.g. Goodwill — disputed claim resolved in user's favour" /></div>
        </div>
        {error && <p style={{ color: '#dc2626' }}>{error}</p>}
        <p style={{ fontSize: '0.72rem', color: '#6b7280' }}>A manual grant posts a balanced double-entry ledger record with an Idempotency-Key and emits an audit event (money iron rules).</p>
        <button type="submit" disabled={busy} style={{ ...btnPrimary(), opacity: busy ? 0.6 : 1 }}>{busy ? 'Granting…' : 'Post grant'}</button>
      </form>
    </Card>
  );
}
