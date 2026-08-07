'use client';

import { useEffect, useMemo, useState } from 'react';
import { listOfflineBundles, buildOfflineBundle, listContent, listPlans } from '@/services/academyAdminService';
import type { OfflineBundle, ContentItem, Plan } from '@/types/academyAdmin';
import { PageHeader, AcademyTabs, Card, Badge, StateBlock, AuditNote, DisclosureNote, Bar, btn, btnPrimary, th, td, input, label, select, fmtDate } from '../_ui';
import { colors } from '@/components/ui/vuexy';

export default function BundlesPage() {
  const [bundles, setBundles] = useState<OfflineBundle[]>([]);
  const [lessons, setLessons] = useState<ContentItem[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [examCode, setExamCode] = useState('UTME');
  const [budget, setBudget] = useState('256');
  const [planId, setPlanId] = useState('');
  const [picked, setPicked] = useState<string[]>([]);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [b, c, p] = await Promise.all([listOfflineBundles(), listContent(), listPlans()]);
      setBundles(b); setLessons(c.filter((x) => x.kind !== 'bundle')); setPlans(p);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  // Estimated bundle size = sum of picked lessons' standard-quality variants.
  const estSize = useMemo(() => picked.reduce((sum, id) => {
    const c = lessons.find((x) => x.id === id);
    return sum + (c?.variants.find((v) => v.quality === 'standard')?.size_mb ?? 0);
  }, 0), [picked, lessons]);
  const budgetNum = Number(budget) || 0;
  const overBudget = estSize > budgetNum;

  function togglePick(id: string) {
    setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  }

  async function build() {
    if (!name || picked.length === 0) { setNotice('Name and at least one lesson are required.'); return; }
    if (overBudget) { setNotice('Selected lessons exceed the size budget.'); return; }
    setBusy(true); setNotice(null);
    try {
      const b = await buildOfflineBundle({ name, exam_code: examCode, lesson_ids: picked, size_budget_mb: budgetNum, access_card_plan_id: planId || null });
      setNotice(`Built "${b.name}" (${b.size_mb} MB of ${b.size_budget_mb} MB).`);
      setName(''); setPicked([]);
      await load();
    } catch (e) { setNotice(String(e)); }
    finally { setBusy(false); }
  }

  function planName(id: string | null) { return id ? plans.find((p) => p.id === id)?.name ?? id : '—'; }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Offline bundle builder" subtitle="Compose agent-distributable offline packages from lessons, budget the total download size, and map each bundle to an access-card plan entitlement." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <AcademyTabs active="bundles" />
      <DisclosureNote>Requires <code>academy.content</code>. Bundles cannot exceed their size budget. Access-card mapping ties the offline package to a plan entitlement for agent distribution.</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={false}>
        <Card title="Existing offline bundles">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Bundle</th><th style={th()}>Exam</th><th style={th()}>Lessons</th><th style={th()}>Size / Budget</th><th style={th()}>Access card</th><th style={th()}>Status</th><th style={th()}>Updated</th></tr></thead>
            <tbody>
              {bundles.map((b) => (
                <tr key={b.id}>
                  <td style={td()}><strong>{b.name}</strong></td>
                  <td style={td()}><Badge status={b.exam_code} /></td>
                  <td style={td()}>{b.lesson_ids.length}</td>
                  <td style={td()}>
                    <div style={{ minWidth: 140 }}>
                      <Bar value={b.size_mb} max={b.size_budget_mb} color={b.size_mb > b.size_budget_mb ? '#b91c1c' : '#340075'} labelRight={`${b.size_mb} / ${b.size_budget_mb} MB`} />
                    </div>
                  </td>
                  <td style={td()}>{planName(b.access_card_plan_id)}</td>
                  <td style={td()}><Badge status={b.status} /></td>
                  <td style={td()}>{fmtDate(b.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Compose new bundle">
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: '1rem', alignItems: 'start' }}>
            <div>
              <label style={label()}>Pick lessons</label>
              <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', maxHeight: 280, overflowY: 'auto' }}>
                {lessons.map((c) => {
                  const std = c.variants.find((v) => v.quality === 'standard')?.size_mb ?? 0;
                  const on = picked.includes(c.id);
                  return (
                    <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.45rem 0.6rem', borderBottom: '1px solid #f3f4f6', cursor: 'pointer', background: on ? '#f5f3ff' : '#fff' }}>
                      <input type="checkbox" checked={on} onChange={() => togglePick(c.id)} />
                      <span style={{ flex: 1, fontSize: '0.82rem' }}>{c.title} <span style={{ color: colors.muted }}>· {c.subject}</span></span>
                      <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>{std} MB</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'grid', gap: '0.6rem', alignContent: 'start' }}>
              <div><label style={label()}>Bundle name</label><input style={input()} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. UTME Physics Offline Pack" /></div>
              <div><label style={label()}>Exam code</label>
                <select style={select()} value={examCode} onChange={(e) => setExamCode(e.target.value)}>
                  {['CCE', 'BECE', 'WASSCE', 'NECO', 'UTME', 'NABTEB'].map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </div>
              <div><label style={label()}>Size budget (MB)</label><input type="number" style={input()} value={budget} onChange={(e) => setBudget(e.target.value)} /></div>
              <div><label style={label()}>Access-card plan (optional)</label>
                <select style={select()} value={planId} onChange={(e) => setPlanId(e.target.value)}>
                  <option value="">— none —</option>
                  {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label style={label()}>Size budget</label>
                <Bar value={estSize} max={budgetNum} color={overBudget ? '#b91c1c' : '#15803d'} labelRight={`${estSize} / ${budgetNum} MB`} />
                {overBudget ? <p style={{ color: '#b91c1c', fontSize: '0.75rem', margin: '0.3rem 0 0' }}>Over budget — remove lessons or raise the budget.</p> : null}
              </div>
              <button onClick={build} disabled={busy} style={btnPrimary()}>{busy ? 'Building…' : 'Build bundle'}</button>
            </div>
          </div>
          {notice && <p style={{ fontSize: '0.8rem', color: colors.muted, marginTop: '0.6rem' }}>{notice}</p>}
          <AuditNote>Bundle composition and access-card mapping are recorded to the immutable audit log.</AuditNote>
        </Card>
      </StateBlock>
    </div>
  );
}
