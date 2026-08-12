'use client';

import { useEffect, useState } from 'react';
import { getFees, updateFees } from '@/services/investAdminService';
import { InvestTabs, naira } from '../_ui';
import { Page, PageHeader, Card, Button, Input, colors } from '@/components/ui/vuexy';

export default function InvestFeesPage() {
  const [bps, setBps] = useState(150);
  const [minFee, setMinFee] = useState(10000);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { const f = await getFees(); setBps(f.commission_bps); setMinFee(f.min_fee_kobo); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function save() {
    setSaving(true); setMsg(null); setError(null);
    try {
      await updateFees({ commission_bps: bps, min_fee_kobo: minFee, reason });
      setMsg('Fee schedule updated and audited.');
      setReason('');
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  const exampleNotional = 1_000_000; // ₦10,000 trade
  const exampleFee = Math.max(Math.round((exampleNotional * bps) / 10000), minFee);

  return (
    <Page>
      <PageHeader
        title="Fees & limits"
        subtitle="Server-side fee schedule. Fees are always shown to users before they confirm an order."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <InvestTabs />

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {msg && <p style={{ color: colors.success }}>{msg}</p>}

      {loading ? (
        <p style={{ color: colors.muted }}>Loading…</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', maxWidth: 760 }}>
          <Card title="Commission schedule">
            <label style={lbl}>Commission (basis points)</label>
            <Input type="number" value={bps} onChange={(e) => setBps(parseInt(e.target.value || '0', 10))} style={{ width: '100%' }} min={0} max={1000} />
            <p style={hint}>{(bps / 100).toFixed(2)}% per trade (1 bp = 0.01%).</p>

            <label style={lbl}>Minimum fee (kobo)</label>
            <Input type="number" value={minFee} onChange={(e) => setMinFee(parseInt(e.target.value || '0', 10))} style={{ width: '100%' }} min={0} />
            <p style={hint}>Floor of {naira(minFee)} per trade.</p>

            <label style={lbl}>Reason (audited)</label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Q3 pricing review" style={{ width: '100%' }} />

            <Button variant="primary" onClick={save} disabled={saving} style={{ marginTop: '0.75rem' }}>
              {saving ? 'Saving…' : 'Save fee schedule'}
            </Button>
          </Card>

          <Card title="Preview">
            <p style={{ fontSize: '0.85rem', color: colors.text }}>
              On a {naira(exampleNotional)} order, the fee would be:
            </p>
            <div style={{ fontSize: '1.6rem', fontWeight: 700, color: colors.primary, marginTop: 6 }}>{naira(exampleFee)}</div>
            <p style={hint}>Total debit: {naira(exampleNotional + exampleFee)}</p>
            <p style={{ ...hint, marginTop: '1rem' }}>
              Changes apply to new orders immediately and are written to the invest admin audit log.
            </p>
          </Card>
        </div>
      )}
    </Page>
  );
}

const lbl: React.CSSProperties = { display: 'block', fontSize: '0.78rem', color: colors.muted, marginTop: '0.6rem', marginBottom: 2 };
const hint: React.CSSProperties = { fontSize: '0.72rem', color: colors.muted, marginTop: 2 };
