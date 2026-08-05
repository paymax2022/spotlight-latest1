'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listBountyPayouts, reviewBounty, formatNaira } from '@/services/connectNetworkAdminService';
import type { BountyPayout, ReviewAction } from '@/types/connectNetworkAdmin';
import { timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

const STATES = ['all', 'bounty_payable', 'approved', 'released', 'held', 'rejected'];

function stateColor(state: string): string {
  if (state === 'released') return colors.success;
  if (state === 'rejected') return colors.danger;
  if (state === 'held') return colors.warning;
  if (state === 'approved') return colors.info;
  return colors.secondary;
}

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
    <Page>
      <PageHeader title="Referral bounty payout queue" subtitle="ADM-JB-02 · Review single-level referral bounties before ledger release. Amounts in kobo → Naira." actions={<Button variant="outline" sm onClick={() => void load()}>Refresh</Button>} />

      <Card style={{ marginBottom: 16 }}>
        <div style={{ background: tint(colors.info, 0.12), border: `1px solid ${tint(colors.info, 0.35)}`, borderRadius: '0.5rem', padding: '0.6rem 0.9rem', color: colors.info, fontSize: '0.82rem' }}>
          <strong>Ledger-safe.</strong> Approving here authorizes release only. The actual double-entry ledger posting happens downstream with an Idempotency-Key — this console never mutates balances directly.
        </div>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <label style={{ fontSize: '0.8rem', color: colors.text, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          State
          <select value={state} onChange={(e) => setState(e.target.value)} style={{ padding: '0.35rem 0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.85rem', textTransform: 'capitalize' }}>
            {STATES.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
      </Card>

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      <Card style={{ padding: 0, overflow: 'auto' }}>
        {loading ? <p style={{ color: colors.muted, padding: 14 }}>Loading bounties…</p> : rows.length === 0 ? (
          <p style={{ color: colors.muted, padding: 14 }}>No bounties in this state.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Reference</th><th style={thCell}>Referrer → Referred</th><th style={thCell}>Job</th><th style={thCell}>Amount</th><th style={thCell}>Risk</th><th style={thCell}>State</th><th style={thCell}>Created</th><th style={thCell}>Review</th></tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td style={tdCell}><strong>{b.reference}</strong></td>
                  <td style={tdCell}>{b.referrerId} → {b.referredId}</td>
                  <td style={tdCell}>{b.jobTitle}</td>
                  <td style={tdCell}>{formatNaira(b.amountKobo)}</td>
                  <td style={tdCell}>{b.riskFlags.length ? <span style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>{b.riskFlags.map((f) => <Badge key={f} text={f} color={colors.warning} />)}</span> : <span style={{ color: colors.muted }}>clean</span>}</td>
                  <td style={tdCell}><Badge text={b.state.replace(/_/g, ' ')} color={stateColor(b.state)} /></td>
                  <td style={tdCell}>{timeAgo(b.createdAt)}</td>
                  <td style={tdCell}>{b.state === 'bounty_payable' || b.state === 'held' ? (
                    <span style={{ display: 'flex', gap: '0.35rem' }}>
                      <Button variant="outline" sm disabled={busy === b.id} onClick={() => act(b.id, 'approve')} style={{ color: colors.success, borderColor: colors.success }}>Release</Button>
                      <Button variant="outline" sm disabled={busy === b.id} onClick={() => act(b.id, 'flag')} style={{ color: colors.warning, borderColor: colors.warning }}>Hold</Button>
                      <Button variant="danger" sm disabled={busy === b.id} onClick={() => act(b.id, 'reject')}>Reject</Button>
                    </span>
                  ) : <span style={{ color: colors.muted, fontSize: '0.8rem' }}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
