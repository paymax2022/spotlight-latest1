'use client';

import { useEffect, useState } from 'react';
import { getFees, updateFees } from '@/services/investAdminService';
import { PageHeader, InvestTabs, Card, btn, btnPrimary, naira } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Fees & limits"
        subtitle="Server-side fee schedule. Fees are always shown to users before they confirm an order."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <InvestTabs />

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {msg && <p style={{ color: '#16a34a' }}>{msg}</p>}

      {loading ? (
        <p style={{ color: '#6b7280' }}>Loading…</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', maxWidth: 760 }}>
          <Card title="Commission schedule">
            <label style={lbl}>Commission (basis points)</label>
            <input type="number" value={bps} onChange={(e) => setBps(parseInt(e.target.value || '0', 10))} style={inp} min={0} max={1000} />
            <p style={hint}>{(bps / 100).toFixed(2)}% per trade (1 bp = 0.01%).</p>

            <label style={lbl}>Minimum fee (kobo)</label>
            <input type="number" value={minFee} onChange={(e) => setMinFee(parseInt(e.target.value || '0', 10))} style={inp} min={0} />
            <p style={hint}>Floor of {naira(minFee)} per trade.</p>

            <label style={lbl}>Reason (audited)</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Q3 pricing review" style={inp} />

            <button onClick={save} disabled={saving} style={{ ...btnPrimary(), marginTop: '0.75rem' }}>
              {saving ? 'Saving…' : 'Save fee schedule'}
            </button>
          </Card>

          <Card title="Preview">
            <p style={{ fontSize: '0.85rem', color: '#374151' }}>
              On a {naira(exampleNotional)} order, the fee would be:
            </p>
            <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#340075', marginTop: 6 }}>{naira(exampleFee)}</div>
            <p style={hint}>Total debit: {naira(exampleNotional + exampleFee)}</p>
            <p style={{ ...hint, marginTop: '1rem' }}>
              Changes apply to new orders immediately and are written to the invest admin audit log.
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}

const lbl: React.CSSProperties = { display: 'block', fontSize: '0.78rem', color: '#6b7280', marginTop: '0.6rem', marginBottom: 2 };
const inp: React.CSSProperties = { width: '100%', padding: '0.45rem 0.6rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.9rem' };
const hint: React.CSSProperties = { fontSize: '0.72rem', color: '#9ca3af', marginTop: 2 };
