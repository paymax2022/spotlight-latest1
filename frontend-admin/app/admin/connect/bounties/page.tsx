'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listBountyPayouts, reviewBounty, formatNaira } from '@/services/connectNetworkAdminService';
import type { BountyPayout, ReviewAction } from '@/types/connectNetworkAdmin';
import { PageHeader, Card, Badge, btn, th, td, timeAgo } from '../_ui';

const STATES = ['all', 'bounty_payable', 'approved', 'released', 'held', 'rejected'];

export default function ConnectBountyPayoutsPage() {
  const [rows, setRows] = useState<BountyPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState('bounty_payable');
  const [busy, setBusy] = useState<string | null>(null);

  const q = useMemo(() => (state === 'all' ? undefined : state), [state]);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await listBountyPayouts(q)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [q]);
  useEffect(() => { void load(); }, [load]);

  async function act(id: string, action: ReviewAction) {
    setBusy(id);
    try { await reviewBounty(id, action); await load(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Referral bounty payout queue" subtitle="ADM-JB-02 · Review single-level referral bounties before ledger release. Amounts in kobo → Naira." action={<button onClick={() => void load()} style={btn()}>Refresh</button>} />

      <Card>
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '0.5rem', padding: '0.6rem 0.9rem', color: '#1e40af', fontSize: '0.82rem' }}>
          <strong>Ledger-safe.</strong> Approving here authorizes release only. The actual double-entry ledger posting happens downstream with an Idempotency-Key — this console never mutates balances directly.
        </div>
      </Card>

      <Card>
        <label style={{ fontSize: '0.8rem', color: '#374151', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          State
          <select value={state} onChange={(e) => setState(e.target.value)} style={{ padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', textTransform: 'capitalize' }}>
            {STATES.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
      </Card>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading bounties…</p> : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No bounties in this state.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Reference</th><th style={th()}>Referrer → Referred</th><th style={th()}>Job</th><th style={th()}>Amount</th><th style={th()}>Risk</th><th style={th()}>State</th><th style={th()}>Created</th><th style={th()}>Review</th></tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td style={td()}><strong>{b.reference}</strong></td>
                  <td style={td()}>{b.referrerId} → {b.referredId}</td>
                  <td style={td()}>{b.jobTitle}</td>
                  <td style={td()}>{formatNaira(b.amountKobo)}</td>
                  <td style={td()}>{b.riskFlags.length ? <span style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>{b.riskFlags.map((f) => <Badge key={f} status="high" label={f} />)}</span> : <span style={{ color: '#9ca3af' }}>clean</span>}</td>
                  <td style={td()}><Badge status={b.state === 'released' ? 'resolved' : b.state === 'rejected' ? 'critical' : b.state === 'held' ? 'high' : b.state === 'approved' ? 'investigating' : 'open'} label={b.state.replace(/_/g, ' ')} /></td>
                  <td style={td()}>{timeAgo(b.createdAt)}</td>
                  <td style={td()}>{b.state === 'bounty_payable' || b.state === 'held' ? (
                    <span style={{ display: 'flex', gap: '0.35rem' }}>
                      <button disabled={busy === b.id} onClick={() => act(b.id, 'approve')} style={{ ...btn(), color: '#15803d', borderColor: '#bbf7d0' }}>Release</button>
                      <button disabled={busy === b.id} onClick={() => act(b.id, 'flag')} style={{ ...btn(), color: '#9a3412', borderColor: '#fed7aa' }}>Hold</button>
                      <button disabled={busy === b.id} onClick={() => act(b.id, 'reject')} style={{ ...btn(), color: '#b91c1c', borderColor: '#fecaca' }}>Reject</button>
                    </span>
                  ) : <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
