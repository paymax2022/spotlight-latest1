'use client';

import { useEffect, useState } from 'react';
import { getBankSettings, updateBankSettings } from '@/services/staysExtranetService';
import type { BankSettings } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, PropertyScopeNote, Badge, StateBlock, btn, btnPrimary, input, label, select, fmtDate } from '../_ui';

export default function BankPage() {
  const [data, setData] = useState<BankSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getBankSettings()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function save() {
    if (!data) return;
    setSaving(true);
    try { setData(await updateBankSettings(data)); setSavedAt(new Date().toLocaleTimeString('en-NG')); }
    catch (e) { setError(String(e)); } finally { setSaving(false); }
  }
  const set = (k: keyof BankSettings, v: string) => setData((x) => (x ? { ...x, [k]: v } : x));

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Bank / payout settings" subtitle="Your Naira settlement account and payout schedule. Account changes are re-verified before the next payout." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ExtranetTabs active="finance" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <StateBlock loading={loading} error={error} empty={!data}>
        {data && (
          <Card title="Payout account" right={data.verified ? <Badge status="verified" /> : <Badge status="pending" />}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.85rem' }}>
              <div><label style={label()}>Bank name</label><input style={input()} value={data.bank_name} onChange={(e) => set('bank_name', e.target.value)} /></div>
              <div><label style={label()}>Account name</label><input style={input()} value={data.account_name} onChange={(e) => set('account_name', e.target.value)} /></div>
              <div><label style={label()}>Account number</label><input style={input()} value={data.account_number} onChange={(e) => set('account_number', e.target.value)} /></div>
              <div><label style={label()}>Settlement currency</label><select style={select()} value={data.currency} onChange={(e) => set('currency', e.target.value)}><option value="NGN">NGN (₦)</option></select></div>
              <div><label style={label()}>Payout schedule</label>
                <select style={select()} value={data.payout_schedule} onChange={(e) => set('payout_schedule', e.target.value)}>
                  {['daily', 'weekly', 'biweekly', 'monthly'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <p style={{ fontSize: '0.82rem', color: '#6b7280', marginTop: '0.75rem' }}>Next payout: <strong>{fmtDate(data.next_payout_date)}</strong></p>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem' }}>
              <button style={btnPrimary()} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save bank settings'}</button>
              {savedAt ? <span style={{ color: '#15803d', fontSize: '0.82rem' }}>Saved at {savedAt}. Account will be re-verified.</span> : null}
            </div>
          </Card>
        )}
      </StateBlock>
    </div>
  );
}
