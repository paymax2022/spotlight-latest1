'use client';

import { useEffect, useState } from 'react';
import { getFeeConfig, updateFeeConfig, formatNaira } from '@/services/creatorsAdminService';
import type { CreatorFeeConfig, CreatorKycTier } from '@/types/creatorsAdmin';
import { PageHeader, CreatorsTabs, Card, DisclosureNote, StateBlock, AuditNote, btn, btnPrimary, input, label, select, bps, fmtDate } from '../_ui';
import { colors } from '@/components/ui/vuexy';

export default function CreatorFeesPage() {
  const [cfg, setCfg] = useState<CreatorFeeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // editable form mirror
  const [form, setForm] = useState<Partial<CreatorFeeConfig>>({});

  async function load() {
    setLoading(true); setError(null);
    try { const c = await getFeeConfig(); setCfg(c); setForm(c); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function save() {
    const note = window.prompt('Save fee config? This is an audited config change (NL-12). Enter a note:');
    if (note === null) return;
    setBusy(true); setMsg(null);
    try {
      const res = await updateFeeConfig({
        tip_fee_bps: Number(form.tip_fee_bps),
        subscription_fee_bps: Number(form.subscription_fee_bps),
        gated_content_fee_bps: Number(form.gated_content_fee_bps),
        min_payout_kobo: Number(form.min_payout_kobo),
        payout_kyc_min_tier: form.payout_kyc_min_tier as CreatorKycTier,
        hold_period_days: Number(form.hold_period_days),
      }, note || undefined);
      setCfg(res.config); setForm(res.config);
      setMsg(res.message + ` (audit ${res.audit_id})`);
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(false); }
  }

  const set = (k: keyof CreatorFeeConfig, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Creator fee configuration" subtitle="Platform fee schedule for tips, subscriptions and gated content, plus payout eligibility rules (minimum payout, KYC tier, earnings hold period)." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <CreatorsTabs active="fees" />
      <DisclosureNote>Fees apply to <strong>tips, subscriptions and gated content only — never a financial return or revenue share</strong> (NL-5). Payout KYC minimum tier enforces the NL-10 gate downstream. Saving writes an immutable audit entry (NL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <StateBlock loading={loading} error={error} empty={!cfg} emptyText="No fee config available.">
        {cfg && (
          <Card title="Fee schedule" right={<span style={{ fontSize: '0.75rem', color: colors.muted }}>Last updated {fmtDate(cfg.updated_at)} by {cfg.updated_by_masked}</span>}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1rem' }}>
              <div>
                <label style={label()}>Tip fee — {bps(Number(form.tip_fee_bps ?? cfg.tip_fee_bps))}</label>
                <input style={input()} type="number" min={0} max={5000} value={form.tip_fee_bps ?? ''} onChange={(e) => set('tip_fee_bps', e.target.value)} />
              </div>
              <div>
                <label style={label()}>Subscription fee — {bps(Number(form.subscription_fee_bps ?? cfg.subscription_fee_bps))}</label>
                <input style={input()} type="number" min={0} max={5000} value={form.subscription_fee_bps ?? ''} onChange={(e) => set('subscription_fee_bps', e.target.value)} />
              </div>
              <div>
                <label style={label()}>Gated-content fee — {bps(Number(form.gated_content_fee_bps ?? cfg.gated_content_fee_bps))}</label>
                <input style={input()} type="number" min={0} max={5000} value={form.gated_content_fee_bps ?? ''} onChange={(e) => set('gated_content_fee_bps', e.target.value)} />
              </div>
              <div>
                <label style={label()}>Minimum payout (kobo) — {formatNaira(Number(form.min_payout_kobo ?? cfg.min_payout_kobo))}</label>
                <input style={input()} type="number" min={0} value={form.min_payout_kobo ?? ''} onChange={(e) => set('min_payout_kobo', e.target.value)} />
              </div>
              <div>
                <label style={label()}>Payout KYC minimum tier (NL-10)</label>
                <select style={select()} value={(form.payout_kyc_min_tier as string) ?? cfg.payout_kyc_min_tier} onChange={(e) => set('payout_kyc_min_tier', e.target.value)}>
                  <option value="tier0">Tier 0</option>
                  <option value="tier1">Tier 1</option>
                  <option value="tier2">Tier 2</option>
                  <option value="tier3">Tier 3</option>
                </select>
              </div>
              <div>
                <label style={label()}>Earnings hold period (days)</label>
                <input style={input()} type="number" min={0} max={90} value={form.hold_period_days ?? ''} onChange={(e) => set('hold_period_days', e.target.value)} />
              </div>
            </div>
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
              <button style={btnPrimary()} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save config'}</button>
              <button style={btn()} disabled={busy} onClick={() => setForm(cfg)}>Reset</button>
            </div>
          </Card>
        )}
      </StateBlock>
    </div>
  );
}
