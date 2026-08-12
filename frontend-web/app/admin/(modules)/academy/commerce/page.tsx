'use client';

import { useEffect, useState } from 'react';
import { listPlans, listExamBundles, listAccessCardBatches, getPaymentsOverview, generateAccessCards, allocateAccessCards } from '@/services/academyAdminService';
import type { Plan, ExamBundle, AccessCardBatch, PaymentsOverview } from '@/types/academyAdmin';
import { PageHeader, AcademyTabs, Card, Badge, Kpi, StateBlock, AuditNote, DisclosureNote, btn, btnPrimary, th, td, input, label, select, formatNaira } from '../_ui';
import { colors } from '@/components/ui/vuexy';

export default function CommercePage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [bundles, setBundles] = useState<ExamBundle[]>([]);
  const [batches, setBatches] = useState<AccessCardBatch[]>([]);
  const [payments, setPayments] = useState<PaymentsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [genForm, setGenForm] = useState<{ plan_id: string; quantity: string; label: string }>({ plan_id: '', quantity: '', label: '' });
  const [allocForm, setAllocForm] = useState<Record<string, { agent: string; quantity: string }>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [p, b, c, pay] = await Promise.all([listPlans(), listExamBundles(), listAccessCardBatches(), getPaymentsOverview()]);
      setPlans(p); setBundles(b); setBatches(c); setPayments(pay);
      if (p[0] && !genForm.plan_id) setGenForm((f) => ({ ...f, plan_id: p[0].id }));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function generate() {
    const qty = Number(genForm.quantity);
    if (!genForm.plan_id || !qty || !genForm.label) { setNotice('Plan, quantity and label are required.'); return; }
    setBusy(true); setNotice(null);
    try {
      await generateAccessCards({ plan_id: genForm.plan_id, quantity: qty, label: genForm.label });
      setNotice(`Generated ${qty} access cards.`);
      setGenForm({ plan_id: genForm.plan_id, quantity: '', label: '' });
      await load();
    } catch (e) { setNotice(String(e)); }
    finally { setBusy(false); }
  }

  async function allocate(batchId: string) {
    const f = allocForm[batchId];
    const qty = Number(f?.quantity ?? '');
    if (!f?.agent || !qty) { setNotice('Agent and quantity are required to allocate.'); return; }
    setBusy(true); setNotice(null);
    try {
      await allocateAccessCards({ batch_id: batchId, agent: f.agent, quantity: qty });
      setNotice(`Allocated ${qty} cards to ${f.agent}.`);
      setAllocForm({ ...allocForm, [batchId]: { agent: '', quantity: '' } });
      await load();
    } catch (e) { setNotice(String(e)); }
    finally { setBusy(false); }
  }

  function planName(id: string) { return plans.find((p) => p.id === id)?.name ?? id; }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Commerce & finance" subtitle="Plans & billing, exam-bundle store, prepaid access-card batches (generate/allocate to agents), and payments overview." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <AcademyTabs active="commerce" />
      <DisclosureNote>Requires <code>academy.commerce</code>. Access cards map to a plan entitlement; agent allocation is tracked per batch. All money in ₦ (kobo internally); refunds/settlements post to the finance ledger.</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!payments}>
        {payments && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="Gross (30d)" value={formatNaira(payments.gross_30d_kobo)} accent="#340075" />
            <Kpi label="Net revenue (30d)" value={formatNaira(payments.net_30d_kobo)} accent="#15803d" />
            <Kpi label="Refunds (30d)" value={formatNaira(payments.refunds_30d_kobo)} accent="#7c3aed" />
            <Kpi label="Successful txns (30d)" value={payments.successful_txns_30d.toLocaleString('en-NG')} />
            <Kpi label="Failed txns (30d)" value={payments.failed_txns_30d.toLocaleString('en-NG')} accent={payments.failed_txns_30d > 0 ? '#9a3412' : undefined} />
          </div>
        )}

        <Card title="Plans & billing">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Plan</th><th style={th()}>Cadence</th><th style={th()}>Price</th><th style={th()}>Status</th><th style={th()}>Active subs</th></tr></thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id}><td style={td()}>{p.name}</td><td style={td()}>{p.cadence}</td><td style={td()}>{formatNaira(p.price_kobo)}</td><td style={td()}><Badge status={p.status} /></td><td style={td()}>{p.active_subscribers.toLocaleString('en-NG')}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Exam bundles & store">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Bundle</th><th style={th()}>Exam</th><th style={th()}>Price</th><th style={th()}>Status</th><th style={th()}>Sold</th></tr></thead>
            <tbody>
              {bundles.map((b) => (
                <tr key={b.id}><td style={td()}>{b.name}</td><td style={td()}><Badge status={b.exam_code} /></td><td style={td()}>{formatNaira(b.price_kobo)}</td><td style={td()}><Badge status={b.status} /></td><td style={td()}>{b.sold.toLocaleString('en-NG')}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Access-card batches">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Batch</th><th style={th()}>Plan</th><th style={th()}>Generated</th><th style={th()}>Allocated</th><th style={th()}>Status</th><th style={th()}>Agent</th><th style={th()}>Allocate</th></tr></thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td style={td()}>{b.label}</td>
                  <td style={td()}>{planName(b.plan_id)}</td>
                  <td style={td()}>{b.generated.toLocaleString('en-NG')} / {b.quantity.toLocaleString('en-NG')}</td>
                  <td style={td()}>{b.allocated.toLocaleString('en-NG')}</td>
                  <td style={td()}><Badge status={b.status} /></td>
                  <td style={td()}>{b.agent ?? '—'}</td>
                  <td style={td()}>
                    {b.status === 'allocated' ? <span style={{ color: colors.muted, fontSize: '0.8rem' }}>full</span> : (
                      <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                        <input style={{ ...input(), width: 90 }} placeholder="Agent" value={allocForm[b.id]?.agent ?? ''} onChange={(e) => setAllocForm({ ...allocForm, [b.id]: { ...(allocForm[b.id] ?? { agent: '', quantity: '' }), agent: e.target.value } })} />
                        <input style={{ ...input(), width: 70 }} placeholder="Qty" value={allocForm[b.id]?.quantity ?? ''} onChange={(e) => setAllocForm({ ...allocForm, [b.id]: { ...(allocForm[b.id] ?? { agent: '', quantity: '' }), quantity: e.target.value } })} />
                        <button onClick={() => allocate(b.id)} disabled={busy} style={btnPrimary()}>Allocate</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Generate access-card batch">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.6rem', alignItems: 'end' }}>
            <div><label style={label()}>Plan</label>
              <select style={select()} value={genForm.plan_id} onChange={(e) => setGenForm({ ...genForm, plan_id: e.target.value })}>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div><label style={label()}>Quantity</label><input type="number" style={input()} value={genForm.quantity} onChange={(e) => setGenForm({ ...genForm, quantity: e.target.value })} /></div>
            <div><label style={label()}>Batch label</label><input style={input()} value={genForm.label} onChange={(e) => setGenForm({ ...genForm, label: e.target.value })} placeholder="e.g. Lagos Agents Batch 08" /></div>
            <div><button onClick={generate} disabled={busy} style={btnPrimary()}>Generate</button></div>
          </div>
          {notice && <p style={{ fontSize: '0.8rem', color: colors.muted, marginTop: '0.6rem' }}>{notice}</p>}
          <AuditNote>Card generation, allocation and refunds are recorded to the immutable audit log and finance ledger.</AuditNote>
        </Card>
      </StateBlock>
    </div>
  );
}
