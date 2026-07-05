'use client';

import { useEffect, useState } from 'react';
import {
  listDividends, createDividend, listCorporateActions, createCorporateAction,
} from '@/services/investAdminService';
import type { Dividend, CorporateAction } from '@/types/investAdmin';
import { PageHeader, InvestTabs, Card, Badge, btn, btnPrimary, th, td, naira } from '../_ui';

const inp: React.CSSProperties = { padding: '0.4rem 0.55rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem' };

export default function CorporateActionsPage() {
  const [divs, setDivs] = useState<Dividend[]>([]);
  const [cas, setCas] = useState<CorporateAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // dividend form
  const [dSymbol, setDSymbol] = useState('');
  const [dAmount, setDAmount] = useState('');
  const [dPay, setDPay] = useState('');
  // corporate action form
  const [cSymbol, setCSymbol] = useState('');
  const [cType, setCType] = useState('bonus');
  const [cTitle, setCTitle] = useState('');
  const [cDate, setCDate] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { const [d, c] = await Promise.all([listDividends(), listCorporateActions()]); setDivs(d); setCas(c); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function addDividend() {
    if (!dSymbol || !dAmount) return;
    setSaving(true);
    try {
      await createDividend({ symbol: dSymbol.toUpperCase(), amount_per_share_kobo: Math.round(parseFloat(dAmount) * 100), payment_date: dPay || undefined, source: 'admin' });
      setDSymbol(''); setDAmount(''); setDPay(''); await load();
    } catch (e) { alert(String(e)); } finally { setSaving(false); }
  }

  async function addCA() {
    if (!cSymbol || !cTitle) return;
    setSaving(true);
    try {
      await createCorporateAction({ symbol: cSymbol.toUpperCase(), type: cType, title: cTitle, effective_date: cDate || undefined, source: 'admin' });
      setCSymbol(''); setCTitle(''); setCDate(''); await load();
    } catch (e) { alert(String(e)); } finally { setSaving(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Corporate actions & dividends" subtitle="Ingest dividends and corporate actions. Every record is traceable to a source." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <InvestTabs />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', alignItems: 'start' }}>
        <Card title="Dividends">
          <div style={{ display: 'flex', gap: 6, marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <input placeholder="Symbol" value={dSymbol} onChange={(e) => setDSymbol(e.target.value)} style={{ ...inp, width: 90 }} />
            <input placeholder="₦/share" value={dAmount} onChange={(e) => setDAmount(e.target.value)} style={{ ...inp, width: 90 }} />
            <input placeholder="Pay date" type="date" value={dPay} onChange={(e) => setDPay(e.target.value)} style={inp} />
            <button onClick={addDividend} disabled={saving} style={btnPrimary()}>Add</button>
          </div>
          {loading ? <p style={{ color: '#6b7280' }}>Loading…</p> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead><tr><th style={th()}>Symbol</th><th style={th()}>Per share</th><th style={th()}>Pay date</th><th style={th()}>Status</th></tr></thead>
              <tbody>
                {divs.map((d) => (
                  <tr key={d.id}><td style={td()}><strong>{d.symbol}</strong></td><td style={td()}>{naira(d.amount_per_share_kobo)}</td><td style={td()}>{d.payment_date || '—'}</td><td style={td()}><Badge status={d.status} /></td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Corporate actions">
          <div style={{ display: 'flex', gap: 6, marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <input placeholder="Symbol" value={cSymbol} onChange={(e) => setCSymbol(e.target.value)} style={{ ...inp, width: 90 }} />
            <select value={cType} onChange={(e) => setCType(e.target.value)} style={inp}>
              {['bonus', 'split', 'reverse_split', 'merger', 'delisting', 'suspension', 'name_change', 'tender'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input placeholder="Title" value={cTitle} onChange={(e) => setCTitle(e.target.value)} style={{ ...inp, width: 140 }} />
            <input type="date" value={cDate} onChange={(e) => setCDate(e.target.value)} style={inp} />
            <button onClick={addCA} disabled={saving} style={btnPrimary()}>Add</button>
          </div>
          {loading ? <p style={{ color: '#6b7280' }}>Loading…</p> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead><tr><th style={th()}>Symbol</th><th style={th()}>Type</th><th style={th()}>Title</th><th style={th()}>Effective</th></tr></thead>
              <tbody>
                {cas.map((c) => (
                  <tr key={c.id}><td style={td()}><strong>{c.symbol}</strong></td><td style={td()}>{c.type}</td><td style={td()}>{c.title}</td><td style={td()}>{c.effective_date || '—'}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
