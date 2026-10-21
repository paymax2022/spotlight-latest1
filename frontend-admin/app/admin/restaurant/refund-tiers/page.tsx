'use client';

import { useCallback, useEffect, useState } from 'react';
import { listRefundTiers, setRefundTier, CONFIG_PERMS, type RefundTier } from '@/services/restaurantConfigAdminService';
import { naira, useRestaurantPermissions, AccessNotice } from '../_ui';
import { Page, PageHeader, Card, Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function RefundTiersPage() {
  const { can } = useRestaurantPermissions();
  const [tiers, setTiers] = useState<RefundTier[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [value, setValue] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const r = await listRefundTiers(); setTiers(r.tiers); setCurrent(r.current_threshold_kobo); setErr(null); } catch (e) { setErr(String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    const kobo = Math.round(Number(value) * 100);
    if (!Number.isFinite(kobo) || kobo < 0) { setErr('Enter a non-negative naira amount.'); return; }
    try { await setRefundTier(kobo); setValue(''); await load(); } catch (e) { setErr(String(e)); }
  }

  if (!can(CONFIG_PERMS.refundTiers)) return <Page><AccessNotice perm={CONFIG_PERMS.refundTiers[0]} /></Page>;
  return (
    <Page>
      <PageHeader title="Refund approval tiers" subtitle="Dispute refunds above the threshold need the restaurant.admin.refund_large permission." />
      {err && <div style={{ color: colors.danger, marginBottom: 8 }}>{err}</div>}
      <Card title={`Current threshold: ${current === null ? '…' : naira(current)}`}>
        {can(CONFIG_PERMS.refundTierWrite) ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <Input placeholder="New threshold (₦)" value={value} onChange={(e) => setValue(e.target.value)} />
            <Button variant="primary" onClick={save}>Set threshold</Button>
          </div>
        ) : <span style={{ color: colors.muted }}>Changing the threshold requires restaurant.admin.refund_large.</span>}
      </Card>
      <Card title="History">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Threshold', 'Effective from', 'Set by'].map((h) => <th key={h} style={thCell}>{h}</th>)}</tr></thead>
          <tbody>{tiers.map((t) => (
            <tr key={t.id}><td style={tdCell}>{naira(t.threshold_kobo)}</td><td style={tdCell}>{new Date(t.effective_from).toLocaleString()}</td><td style={tdCell}>{t.created_by ?? 'system'}</td></tr>
          ))}</tbody>
        </table>
      </Card>
    </Page>
  );
}
