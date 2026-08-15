'use client';

import { useEffect, useState } from 'react';
import { listRewardPools, createRewardPool, fundRewardPool, listRewardCatalog, getRewardLedger } from '@/services/academyAdminService';
import type { RewardPool, RewardCatalogItem, RewardLedgerEntry, RewardPoolInput } from '@/types/academyAdmin';
import { AcademyTabs, StateBlock, AuditNote, DisclosureNote, label, formatNaira, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (['active', 'approved', 'published', 'funded', 'paid', 'completed', 'allocated', 'live', 'reconciled', 'disbursed', 'collected', 'released', 'core', 'issued', 'routed', 'ready', 'eligible', 'actioned', 'verified', 'resolved', 'plan_published', 'badge_earned', 'pool_funded', 'item_approved'].includes(s)) return colors.success;
  if (['pending', 'in_review', 'under_review', 'needs_info', 'scheduled', 'low_balance', 'review', 'in_translation', 'funding', 'fee_due', 'onboarding', 'frequent', 'packaged', 'matured', 'paused', 'processing', 'triaged', 'investigating', 'hide', 'warn', 'high', 'medium'].includes(s)) return colors.warning;
  if (['draft', 'authoring', 'open', 'upcoming', 'generated', 'partial', 'submitted', 'trial', 'requested', 'applied', 'cards_generated', 'exam_opened', 'campaign_launched'].includes(s)) return colors.info;
  if (['rejected', 'failed', 'suspended', 'blocked', 'unfunded', 'expired', 'duplicate', 'revoked', 'escalated', 'ban', 'critical', 'overdue', 'item_rejected'].includes(s)) return colors.danger;
  if (['refunded', 'reversed', 'redeemed', 'reward_redeemed'].includes(s)) return colors.primary;
  return colors.secondary;
}

function StatusBadge({ status, label: lbl }: { status: string; label?: string }) {
  return <Badge text={lbl ?? status.replace(/_/g, ' ')} color={statusColor(status)} />;
}

export default function RewardsPage() {
  const [pools, setPools] = useState<RewardPool[]>([]);
  const [catalog, setCatalog] = useState<RewardCatalogItem[]>([]);
  const [ledger, setLedger] = useState<RewardLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [poolForm, setPoolForm] = useState<{ name: string; cap_naira: string; sponsor: string }>({ name: '', cap_naira: '', sponsor: '' });
  const [fundAmount, setFundAmount] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [p, c, l] = await Promise.all([listRewardPools(), listRewardCatalog(), getRewardLedger()]);
      setPools(p); setCatalog(c); setLedger(l);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function createPool() {
    if (!poolForm.name || !poolForm.cap_naira) { setNotice('Pool name and per-user cap are required.'); return; }
    setBusy(true); setNotice(null);
    try {
      const input: RewardPoolInput = { name: poolForm.name, per_user_cap_kobo: Math.round(Number(poolForm.cap_naira) * 100), sponsor: poolForm.sponsor || null };
      await createRewardPool(input);
      setNotice('Pool created — UNFUNDED. Fund it before any reward can be redeemed.');
      setPoolForm({ name: '', cap_naira: '', sponsor: '' });
      await load();
    } catch (e) { setNotice(String(e)); }
    finally { setBusy(false); }
  }

  async function fund(poolId: string) {
    const amt = Number(fundAmount[poolId] ?? '');
    if (!amt || amt <= 0) { setNotice('Enter a positive funding amount (₦).'); return; }
    setBusy(true); setNotice(null);
    try {
      await fundRewardPool({ pool_id: poolId, amount_kobo: Math.round(amt * 100) });
      setNotice(`Funded pool with ${formatNaira(Math.round(amt * 100))}.`);
      setFundAmount({ ...fundAmount, [poolId]: '' });
      await load();
    } catch (e) { setNotice(String(e)); }
    finally { setBusy(false); }
  }

  function poolName(id: string) { return pools.find((p) => p.id === id)?.name ?? id; }
  function poolFunded(id: string) { const p = pools.find((x) => x.id === id); return p ? p.status === 'funded' || p.status === 'low_balance' : false; }

  return (
    <Page>
      <PageHeader title="Rewards & wallet ops" subtitle="Funded reward pools; point→value conversion; redemption catalog; per-user caps; ledger reconciliation & reporting." actions={<Button onClick={load} variant="outline" sm>Refresh</Button>} />
      <AcademyTabs active="rewards" />
      <DisclosureNote>
        Requires <code>academy.rewards</code>. <strong>No reward may be issued without a funded pool.</strong> A
        catalog item maps to a pool; redemptions debit that pool&apos;s balance against the per-user cap, and every
        movement (fund / redeem / reversal) posts to the reward ledger.
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={pools.length === 0}>
        <Card title="Reward pools">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Pool</th><th style={thCell}>Sponsor</th><th style={thCell}>Status</th><th style={thCell}>Funded</th><th style={thCell}>Balance</th><th style={thCell}>Spent</th><th style={thCell}>Per-user cap</th><th style={thCell}>Fund</th></tr></thead>
            <tbody>
              {pools.map((p) => (
                <tr key={p.id}>
                  <td style={tdCell}>{p.name}</td>
                  <td style={tdCell}>{p.sponsor ?? '—'}</td>
                  <td style={tdCell}><StatusBadge status={p.status} /></td>
                  <td style={tdCell}>{formatNaira(p.funded_kobo)}</td>
                  <td style={{ ...tdCell, fontWeight: 600, color: p.balance_kobo <= 0 ? colors.danger : colors.success }}>{formatNaira(p.balance_kobo)}</td>
                  <td style={tdCell}>{formatNaira(p.spent_kobo)}</td>
                  <td style={tdCell}>{formatNaira(p.per_user_cap_kobo)}</td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                      <Input style={{ width: 90 }} placeholder="₦" value={fundAmount[p.id] ?? ''} onChange={(e) => setFundAmount({ ...fundAmount, [p.id]: e.target.value })} />
                      <Button onClick={() => fund(p.id)} disabled={busy} variant="primary" sm>Fund</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Create reward pool">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.6rem', alignItems: 'end' }}>
            <div><label style={label()}>Name</label><Input value={poolForm.name} onChange={(e) => setPoolForm({ ...poolForm, name: e.target.value })} placeholder="e.g. Q4 Engagement Drive" /></div>
            <div><label style={label()}>Per-user cap (₦)</label><Input type="number" value={poolForm.cap_naira} onChange={(e) => setPoolForm({ ...poolForm, cap_naira: e.target.value })} /></div>
            <div><label style={label()}>Sponsor (optional)</label><Input value={poolForm.sponsor} onChange={(e) => setPoolForm({ ...poolForm, sponsor: e.target.value })} /></div>
            <div><Button onClick={createPool} disabled={busy} variant="primary" sm>Create pool</Button></div>
          </div>
          {notice && <p style={{ fontSize: '0.8rem', color: colors.text, marginTop: '0.6rem' }}>{notice}</p>}
          <AuditNote>Pool creation, funding and redemptions are recorded to the immutable audit log and the reward ledger.</AuditNote>
        </Card>

        <Card title="Redemption catalog">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Item</th><th style={thCell}>Category</th><th style={thCell}>Point cost</th><th style={thCell}>Value</th><th style={thCell}>Pool</th><th style={thCell}>Funded?</th><th style={thCell}>Stock</th><th style={thCell}>Status</th></tr></thead>
            <tbody>
              {catalog.map((c) => (
                <tr key={c.id}>
                  <td style={tdCell}>{c.name}</td>
                  <td style={tdCell}>{c.category}</td>
                  <td style={tdCell}>{c.point_cost.toLocaleString('en-NG')}</td>
                  <td style={tdCell}>{formatNaira(c.value_kobo)}</td>
                  <td style={tdCell}>{poolName(c.pool_id)}</td>
                  <td style={tdCell}>{poolFunded(c.pool_id) ? <StatusBadge status="funded" /> : <StatusBadge status="unfunded" label="unfunded — blocked" />}</td>
                  <td style={tdCell}>{c.stock === null ? '∞' : c.stock.toLocaleString('en-NG')}</td>
                  <td style={tdCell}><StatusBadge status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Reward ledger (reconciliation report)">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Type</th><th style={thCell}>Pool</th><th style={thCell}>Amount</th><th style={thCell}>User</th><th style={thCell}>Ref</th><th style={thCell}>When</th></tr></thead>
            <tbody>
              {ledger.map((l) => (
                <tr key={l.id}>
                  <td style={tdCell}><StatusBadge status={l.type === 'fund' ? 'funded' : l.type === 'redeem' ? 'redeemed' : 'reversed'} label={l.type} /></td>
                  <td style={tdCell}>{poolName(l.pool_id)}</td>
                  <td style={{ ...tdCell, fontWeight: 600, color: l.type === 'fund' ? colors.success : l.type === 'reversal' ? colors.primary : colors.danger }}>{l.type === 'fund' ? '+' : '−'}{formatNaira(l.amount_kobo)}</td>
                  <td style={tdCell}>{l.user_id ?? '—'}</td>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{l.ref}</code></td>
                  <td style={tdCell}>{timeAgo(l.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </StateBlock>
    </Page>
  );
}
