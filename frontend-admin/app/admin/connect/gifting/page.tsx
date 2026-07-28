'use client';

import { useEffect, useMemo, useState } from 'react';
import { listGifts, formatNaira } from '@/services/connectAdminService';
import type { GiftTransaction } from '@/types/connectAdmin';
import { PageHeader, ConnectTabs, Card, Badge, btn, th, td, timeAgo } from '../_ui';

const STATUSES = ['all', 'successful', 'pending', 'reversed', 'failed'];
const LIMITS = ['all', 'within', 'near_limit', 'blocked'];

export default function ConnectGiftingPage() {
  const [rows, setRows] = useState<GiftTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');
  const [limit, setLimit] = useState('all');

  const opts = useMemo(() => ({
    status: status === 'all' ? undefined : status,
    limit_state: limit === 'all' ? undefined : limit,
  }), [status, limit]);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listGifts(opts)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [opts]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Gift transactions" subtitle="Gifts are real wallet-to-wallet transfers (§11.5). Tier & limit context shown; amounts in kobo → Naira." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ConnectTabs active="overview" />

      <Card>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <Select label="Status" value={status} options={STATUSES} onChange={setStatus} />
          <Select label="Limit state" value={limit} options={LIMITS} onChange={setLimit} />
        </div>
      </Card>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading gifts…</p> : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No gift transactions match these filters.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Reference</th><th style={th()}>Gift</th><th style={th()}>Sender → Recipient</th><th style={th()}>Amount</th><th style={th()}>Fee</th><th style={th()}>Tier</th><th style={th()}>Limit</th><th style={th()}>Status</th><th style={th()}>When</th></tr></thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id}>
                  <td style={td()}><strong>{g.reference}</strong></td>
                  <td style={td()}>{g.gift_label}</td>
                  <td style={td()}>{g.sender_id} → {g.recipient_id}</td>
                  <td style={td()}>{formatNaira(g.amount_kobo)}</td>
                  <td style={td()}>{formatNaira(g.fee_kobo)}</td>
                  <td style={td()}>T{g.tier_at_send}</td>
                  <td style={td()}><Badge status={g.limit_state === 'within' ? 'resolved' : g.limit_state === 'blocked' ? 'critical' : 'high'} label={g.limit_state.replace(/_/g, ' ')} /></td>
                  <td style={td()}><Badge status={g.status === 'successful' ? 'resolved' : g.status === 'failed' ? 'critical' : g.status === 'reversed' ? 'closed' : 'open'} label={g.status} /></td>
                  <td style={td()}>{timeAgo(g.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label style={{ fontSize: '0.8rem', color: '#374151', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', textTransform: 'capitalize' }}>
        {options.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
      </select>
    </label>
  );
}
