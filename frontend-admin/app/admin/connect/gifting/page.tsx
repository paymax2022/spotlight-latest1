'use client';

import { useEffect, useMemo, useState } from 'react';
import { listGifts, formatNaira } from '@/services/connectAdminService';
import type { GiftTransaction } from '@/types/connectAdmin';
import { ConnectTabs, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader title="Gift transactions" subtitle="Gifts are real wallet-to-wallet transfers (§11.5). Tier & limit context shown; amounts in kobo → Naira." actions={<Button variant="outline" sm onClick={load}>Refresh</Button>} />
      <ConnectTabs active="overview" />

      <Card>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <Select label="Status" value={status} options={STATUSES} onChange={setStatus} />
          <Select label="Limit state" value={limit} options={LIMITS} onChange={setLimit} />
        </div>
      </Card>

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      <Card>
        {loading ? <p style={{ color: colors.muted }}>Loading gifts…</p> : rows.length === 0 ? (
          <p style={{ color: colors.muted }}>No gift transactions match these filters.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Reference</th><th style={thCell}>Gift</th><th style={thCell}>Sender → Recipient</th><th style={thCell}>Amount</th><th style={thCell}>Fee</th><th style={thCell}>Tier</th><th style={thCell}>Limit</th><th style={thCell}>Status</th><th style={thCell}>When</th></tr></thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id}>
                  <td style={tdCell}><strong>{g.reference}</strong></td>
                  <td style={tdCell}>{g.gift_label}</td>
                  <td style={tdCell}>{g.sender_id} → {g.recipient_id}</td>
                  <td style={tdCell}>{formatNaira(g.amount_kobo)}</td>
                  <td style={tdCell}>{formatNaira(g.fee_kobo)}</td>
                  <td style={tdCell}>T{g.tier_at_send}</td>
                  <td style={tdCell}><Badge text={g.limit_state.replace(/_/g, ' ')} color={g.limit_state === 'within' ? colors.success : g.limit_state === 'blocked' ? colors.danger : colors.warning} /></td>
                  <td style={tdCell}><Badge text={g.status} color={g.status === 'successful' ? colors.success : g.status === 'failed' ? colors.danger : g.status === 'reversed' ? colors.secondary : colors.warning} /></td>
                  <td style={tdCell}>{timeAgo(g.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label style={{ fontSize: '0.8rem', color: colors.text, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ textTransform: 'capitalize' }}>
        {options.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
      </select>
    </label>
  );
}
