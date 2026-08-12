'use client';

import { useEffect, useState } from 'react';
import {
  listDividends, createDividend, listCorporateActions, createCorporateAction,
} from '@/services/investAdminService';
import type { Dividend, CorporateAction } from '@/types/investAdmin';
import { InvestTabs, naira } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function dividendStatusColor(status: string): string {
  if (status === 'active' || status === 'Settled') return colors.success;
  if (status === 'suspended') return colors.warning;
  if (status === 'delisted') return colors.danger;
  return colors.secondary;
}

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
    <Page>
      <PageHeader title="Corporate actions & dividends" subtitle="Ingest dividends and corporate actions. Every record is traceable to a source." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <InvestTabs />
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', alignItems: 'start' }}>
        <Card title="Dividends">
          <div style={{ display: 'flex', gap: 6, margin: '0.75rem 0', flexWrap: 'wrap' }}>
            <Input placeholder="Symbol" value={dSymbol} onChange={(e) => setDSymbol(e.target.value)} style={{ width: 90 }} />
            <Input placeholder="₦/share" value={dAmount} onChange={(e) => setDAmount(e.target.value)} style={{ width: 90 }} />
            <Input placeholder="Pay date" type="date" value={dPay} onChange={(e) => setDPay(e.target.value)} />
            <Button variant="primary" onClick={addDividend} disabled={saving}>Add</Button>
          </div>
          {loading ? <p style={{ color: colors.muted }}>Loading…</p> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr><th style={thCell}>Symbol</th><th style={thCell}>Per share</th><th style={thCell}>Pay date</th><th style={thCell}>Status</th></tr></thead>
              <tbody>
                {divs.map((d) => (
                  <tr key={d.id}><td style={tdCell}><strong>{d.symbol}</strong></td><td style={tdCell}>{naira(d.amount_per_share_kobo)}</td><td style={tdCell}>{d.payment_date || '—'}</td><td style={tdCell}><Badge text={d.status} color={dividendStatusColor(d.status)} /></td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Corporate actions">
          <div style={{ display: 'flex', gap: 6, margin: '0.75rem 0', flexWrap: 'wrap' }}>
            <Input placeholder="Symbol" value={cSymbol} onChange={(e) => setCSymbol(e.target.value)} style={{ width: 90 }} />
            <select value={cType} onChange={(e) => setCType(e.target.value)}>
              {['bonus', 'split', 'reverse_split', 'merger', 'delisting', 'suspension', 'name_change', 'tender'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <Input placeholder="Title" value={cTitle} onChange={(e) => setCTitle(e.target.value)} style={{ width: 140 }} />
            <Input type="date" value={cDate} onChange={(e) => setCDate(e.target.value)} />
            <Button variant="primary" onClick={addCA} disabled={saving}>Add</Button>
          </div>
          {loading ? <p style={{ color: colors.muted }}>Loading…</p> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr><th style={thCell}>Symbol</th><th style={thCell}>Type</th><th style={thCell}>Title</th><th style={thCell}>Effective</th></tr></thead>
              <tbody>
                {cas.map((c) => (
                  <tr key={c.id}><td style={tdCell}><strong>{c.symbol}</strong></td><td style={tdCell}>{c.type}</td><td style={tdCell}>{c.title}</td><td style={tdCell}>{c.effective_date || '—'}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </Page>
  );
}
