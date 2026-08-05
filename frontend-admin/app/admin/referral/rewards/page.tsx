'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { listRewardLedger, manualGrant, formatNaira } from '@/services/referralAdminService';
import type { RewardLedgerEntry, RewardKind } from '@/types/referralAdmin';
import { ReferralTabs, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATES = ['all', 'earned', 'pending', 'vesting', 'eligible', 'paid', 'clawed_back'];
const KINDS = ['all', 'referrer', 'referee', 'override', 'mission', 'manual'];

function badgeColor(status: string): string {
  switch (status) {
    case 'eligible': case 'paid':
      return colors.success;
    case 'clawed_back':
      return colors.danger;
    case 'earned': case 'normal':
      return colors.info;
    case 'vesting': case 'house':
      return colors.primary;
    default:
      return colors.warning;
  }
}

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
    <Page>
      <PageHeader
        title="Reward ledger"
        subtitle="Every reward across all states: earned → pending → vesting → eligible → paid → clawed-back (A-RWD-01). Manual grants & clawbacks are audited."
        actions={<Button variant="primary" onClick={() => setShowGrant((s) => !s)}>{showGrant ? 'Close' : '+ Manual grant'}</Button>}
      />
      <ReferralTabs active="rewards" />

      {showGrant && <ManualGrantForm onDone={() => { setShowGrant(false); load(); }} />}

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ fontSize: 13, color: colors.text, display: 'flex', alignItems: 'center', gap: 6 }}>
            State
            <select value={state} onChange={(e) => setState(e.target.value)}>
              {STATES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 13, color: colors.text, display: 'flex', alignItems: 'center', gap: 6 }}>
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <span style={{ marginLeft: 'auto' }}><Button variant="outline" onClick={load}>Refresh</Button></span>
        </div>
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: 14 }}>
          {loading ? <p style={{ color: colors.muted }}>Loading…</p>
            : error ? <p style={{ color: colors.danger }}>{error}</p>
            : rows.length === 0 ? <p style={{ color: colors.muted }}>No rewards match these filters.</p>
            : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thCell}>ID</th><th style={thCell}>Beneficiary</th><th style={thCell}>Kind</th><th style={thCell}>Amount</th><th style={thCell}>State</th><th style={thCell}>Flags</th><th style={thCell}>Updated</th><th style={thCell}></th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td style={tdCell}><code style={{ fontSize: 12 }}>{r.id}</code></td>
                        <td style={tdCell}><code style={{ fontSize: 13 }}>{r.beneficiary_id}</code>{r.is_house && <> <Badge text="house" color={badgeColor('house')} /></>}</td>
                        <td style={tdCell}><Badge text={r.kind} color={badgeColor('normal')} /></td>
                        <td style={tdCell}>{formatNaira(r.amount_kobo)}</td>
                        <td style={tdCell}><Badge text={r.state.replace(/_/g, ' ')} color={badgeColor(r.state)} /></td>
                        <td style={tdCell}>
                          {r.excluded_from_kfactor && <Badge text="excl. K-factor" color={badgeColor('vesting')} />}{' '}
                          {r.excluded_from_override && <Badge text="excl. override" color={badgeColor('vesting')} />}
                        </td>
                        <td style={tdCell}>{timeAgo(r.updated_at)}</td>
                        <td style={{ ...tdCell, textAlign: 'right' }}><Link href={`/admin/referral/rewards/${r.id}`} style={{ fontWeight: 600 }}>Open →</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </Card>
    </Page>
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
    <Card title="Manual grant / adjustment (A-RWD-04, audited)" style={{ marginBottom: 16 }}>
      <form onSubmit={submit} style={{ marginTop: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: 12, marginBottom: 12 }}>
          <div><label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Beneficiary user ID</label><Input value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} placeholder="usr_..." /></div>
          <div><label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Amount (₦)</label><Input type="number" min={0} value={naira} onChange={(e) => setNaira(e.target.value)} /></div>
          <div><label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Kind</label>
            <select value={kind} onChange={(e) => setKind(e.target.value as RewardKind)} style={{ width: '100%' }}>
              {['manual', 'referrer', 'referee', 'override', 'mission'].map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}><label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Reason (required, audited)</label><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Goodwill — disputed claim resolved in user's favour" /></div>
        </div>
        {error && <p style={{ color: colors.danger }}>{error}</p>}
        <p style={{ fontSize: 12, color: colors.muted }}>A manual grant posts a balanced double-entry ledger record with an Idempotency-Key and emits an audit event (money iron rules).</p>
        <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Granting…' : 'Post grant'}</Button>
      </form>
    </Card>
  );
}
