'use client';

import { useEffect, useState } from 'react';
import { listRewardPools, createRewardPool, fundRewardPool, listRewardCatalog, getRewardLedger } from '@/services/academyAdminService';
import type { RewardPool, RewardCatalogItem, RewardLedgerEntry, RewardPoolInput } from '@/types/academyAdmin';
import { PageHeader, AcademyTabs, Card, Badge, StateBlock, AuditNote, DisclosureNote, btn, btnPrimary, th, td, input, label, formatNaira, timeAgo } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Rewards & wallet ops" subtitle="Funded reward pools; point→value conversion; redemption catalog; per-user caps; ledger reconciliation & reporting." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <AcademyTabs active="rewards" />
      <DisclosureNote>
        Requires <code>academy.rewards</code>. <strong>No reward may be issued without a funded pool.</strong> A
        catalog item maps to a pool; redemptions debit that pool&apos;s balance against the per-user cap, and every
        movement (fund / redeem / reversal) posts to the reward ledger.
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={pools.length === 0}>
        <Card title="Reward pools">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Pool</th><th style={th()}>Sponsor</th><th style={th()}>Status</th><th style={th()}>Funded</th><th style={th()}>Balance</th><th style={th()}>Spent</th><th style={th()}>Per-user cap</th><th style={th()}>Fund</th></tr></thead>
            <tbody>
              {pools.map((p) => (
                <tr key={p.id}>
                  <td style={td()}>{p.name}</td>
                  <td style={td()}>{p.sponsor ?? '—'}</td>
                  <td style={td()}><Badge status={p.status} /></td>
                  <td style={td()}>{formatNaira(p.funded_kobo)}</td>
                  <td style={{ ...td(), fontWeight: 600, color: p.balance_kobo <= 0 ? '#b91c1c' : '#15803d' }}>{formatNaira(p.balance_kobo)}</td>
                  <td style={td()}>{formatNaira(p.spent_kobo)}</td>
                  <td style={td()}>{formatNaira(p.per_user_cap_kobo)}</td>
                  <td style={td()}>
                    <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                      <input style={{ ...input(), width: 90 }} placeholder="₦" value={fundAmount[p.id] ?? ''} onChange={(e) => setFundAmount({ ...fundAmount, [p.id]: e.target.value })} />
                      <button onClick={() => fund(p.id)} disabled={busy} style={btnPrimary()}>Fund</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Create reward pool">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.6rem', alignItems: 'end' }}>
            <div><label style={label()}>Name</label><input style={input()} value={poolForm.name} onChange={(e) => setPoolForm({ ...poolForm, name: e.target.value })} placeholder="e.g. Q4 Engagement Drive" /></div>
            <div><label style={label()}>Per-user cap (₦)</label><input type="number" style={input()} value={poolForm.cap_naira} onChange={(e) => setPoolForm({ ...poolForm, cap_naira: e.target.value })} /></div>
            <div><label style={label()}>Sponsor (optional)</label><input style={input()} value={poolForm.sponsor} onChange={(e) => setPoolForm({ ...poolForm, sponsor: e.target.value })} /></div>
            <div><button onClick={createPool} disabled={busy} style={btnPrimary()}>Create pool</button></div>
          </div>
          {notice && <p style={{ fontSize: '0.8rem', color: '#374151', marginTop: '0.6rem' }}>{notice}</p>}
          <AuditNote>Pool creation, funding and redemptions are recorded to the immutable audit log and the reward ledger.</AuditNote>
        </Card>

        <Card title="Redemption catalog">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Item</th><th style={th()}>Category</th><th style={th()}>Point cost</th><th style={th()}>Value</th><th style={th()}>Pool</th><th style={th()}>Funded?</th><th style={th()}>Stock</th><th style={th()}>Status</th></tr></thead>
            <tbody>
              {catalog.map((c) => (
                <tr key={c.id}>
                  <td style={td()}>{c.name}</td>
                  <td style={td()}>{c.category}</td>
                  <td style={td()}>{c.point_cost.toLocaleString('en-NG')}</td>
                  <td style={td()}>{formatNaira(c.value_kobo)}</td>
                  <td style={td()}>{poolName(c.pool_id)}</td>
                  <td style={td()}>{poolFunded(c.pool_id) ? <Badge status="funded" /> : <Badge status="unfunded" label="unfunded — blocked" />}</td>
                  <td style={td()}>{c.stock === null ? '∞' : c.stock.toLocaleString('en-NG')}</td>
                  <td style={td()}><Badge status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Reward ledger (reconciliation report)">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Type</th><th style={th()}>Pool</th><th style={th()}>Amount</th><th style={th()}>User</th><th style={th()}>Ref</th><th style={th()}>When</th></tr></thead>
            <tbody>
              {ledger.map((l) => (
                <tr key={l.id}>
                  <td style={td()}><Badge status={l.type === 'fund' ? 'funded' : l.type === 'redeem' ? 'redeemed' : 'reversed'} label={l.type} /></td>
                  <td style={td()}>{poolName(l.pool_id)}</td>
                  <td style={{ ...td(), fontWeight: 600, color: l.type === 'fund' ? '#15803d' : l.type === 'reversal' ? '#7c3aed' : '#b91c1c' }}>{l.type === 'fund' ? '+' : '−'}{formatNaira(l.amount_kobo)}</td>
                  <td style={td()}>{l.user_id ?? '—'}</td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{l.ref}</code></td>
                  <td style={td()}>{timeAgo(l.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </StateBlock>
    </div>
  );
}
