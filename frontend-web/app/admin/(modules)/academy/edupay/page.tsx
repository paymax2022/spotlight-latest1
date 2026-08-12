'use client';

import { useEffect, useState } from 'react';
import {
  listSchools, createSchool, listFeeSchedules, createFeeSchedule,
  listDisbursements, reconcileDisbursement, listSchoolPots,
  listScholarships, createScholarship, awardScholarship, DISBURSEMENT_FLOW,
} from '@/services/academyAdminService';
import type {
  School, FeeSchedule, Disbursement, SchoolPot, Scholarship, DisbursementStatus,
} from '@/types/academyAdmin';
import { PageHeader, AcademyTabs, Card, Badge, Kpi, StateBlock, AuditNote, DisclosureNote, Bar, btn, btnPrimary, th, td, input, label, select, formatNaira, fmtDate } from '../_ui';
import { colors } from '@/components/ui/vuexy';

export default function EduPayPage() {
  const [schools, setSchools] = useState<School[]>([]);
  const [fees, setFees] = useState<FeeSchedule[]>([]);
  const [disb, setDisb] = useState<Disbursement[]>([]);
  const [pots, setPots] = useState<SchoolPot[]>([]);
  const [scholarships, setScholarships] = useState<Scholarship[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [schoolForm, setSchoolForm] = useState({ name: '', state: '', bank_account: '' });
  const [feeForm, setFeeForm] = useState({ school_id: '', term: '', amount: '', due_date: '' });
  const [shpForm, setShpForm] = useState({ name: '', sponsor: '', pool: '', slots: '' });
  const [awardForm, setAwardForm] = useState<Record<string, { learner: string; amount: string }>>({});

  async function load() {
    setLoading(true); setError(null);
    try {
      const [s, f, d, p, sh] = await Promise.all([listSchools(), listFeeSchedules(), listDisbursements(), listSchoolPots(), listScholarships()]);
      setSchools(s); setFees(f); setDisb(d); setPots(p); setScholarships(sh);
      if (s[0] && !feeForm.school_id) setFeeForm((x) => ({ ...x, school_id: s[0].id }));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function schoolName(id: string) { return schools.find((s) => s.id === id)?.name ?? id; }

  async function addSchool() {
    if (!schoolForm.name || !schoolForm.state || !schoolForm.bank_account) { setNotice('Name, state and bank account are required.'); return; }
    setBusy('school'); setNotice(null);
    try { const s = await createSchool(schoolForm); setNotice(`Onboarded "${s.name}".`); setSchoolForm({ name: '', state: '', bank_account: '' }); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }
  async function addFee() {
    const amt = Number(feeForm.amount);
    if (!feeForm.school_id || !feeForm.term || !amt || !feeForm.due_date) { setNotice('School, term, amount (₦) and due date are required.'); return; }
    setBusy('fee'); setNotice(null);
    try { const f = await createFeeSchedule({ school_id: feeForm.school_id, term: feeForm.term, amount_kobo: amt * 100, due_date: feeForm.due_date }); setNotice(`Created fee schedule "${f.term}".`); setFeeForm({ ...feeForm, term: '', amount: '', due_date: '' }); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }
  async function reconcile(d: Disbursement) {
    const ref = typeof window !== 'undefined' ? (window.prompt('Bank reference for reconciliation?', d.reference) || d.reference) : d.reference;
    setBusy(d.id); setNotice(null);
    try { const u = await reconcileDisbursement({ id: d.id, bank_reference: ref }); setNotice(`Disbursement ${u.reference} → ${u.status}.`); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }
  async function addScholarship() {
    const pool = Number(shpForm.pool); const slots = Number(shpForm.slots);
    if (!shpForm.name || !shpForm.sponsor || !pool || !slots) { setNotice('Name, sponsor, pool (₦) and slots are required.'); return; }
    setBusy('shp'); setNotice(null);
    try { const s = await createScholarship({ name: shpForm.name, sponsor: shpForm.sponsor, pool_kobo: pool * 100, slots }); setNotice(`Created scholarship "${s.name}".`); setShpForm({ name: '', sponsor: '', pool: '', slots: '' }); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }
  async function award(s: Scholarship) {
    const f = awardForm[s.id];
    const amt = Number(f?.amount ?? '');
    if (!f?.learner || !amt) { setNotice('Learner ID and amount (₦) are required to award.'); return; }
    setBusy(s.id); setNotice(null);
    try { const u = await awardScholarship({ scholarship_id: s.id, learner_id: f.learner, amount_kobo: amt * 100 }); setNotice(`Awarded ${formatNaira(amt * 100)} from "${u.name}" (${u.awarded_slots}/${u.slots} slots).`); setAwardForm({ ...awardForm, [s.id]: { learner: '', amount: '' } }); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }

  const totalDisbursed = disb.filter((d) => d.status === 'disbursed' || d.status === 'reconciled').reduce((s, d) => s + d.amount_kobo, 0);
  const pendingRecon = disb.filter((d) => d.status === 'disbursed').length;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="EduPay — school fees & scholarships" subtitle="School onboarding, fee schedules, disbursement runs with reconciliation, save-for-school pots, and sponsor-funded scholarships." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <AcademyTabs active="edupay" />
      <DisclosureNote>Requires <code>academy.edupay</code>. Disbursement state machine: <strong>fee_due → funding → collected → disbursed → reconciled</strong>. All money in ₦ (kobo internally); every movement posts to the finance ledger.</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={false}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <Kpi label="Schools active" value={schools.filter((s) => s.status === 'active').length.toString()} sub={`${schools.length} total`} accent="#340075" />
          <Kpi label="Disbursed (lifetime)" value={formatNaira(totalDisbursed)} accent="#15803d" />
          <Kpi label="Pending reconciliation" value={pendingRecon.toString()} accent={pendingRecon > 0 ? '#9a3412' : undefined} />
          <Kpi label="Save-for-school pots" value={pots.length.toString()} sub={formatNaira(pots.reduce((s, p) => s + p.balance_kobo, 0))} />
        </div>

        {/* Disbursement state machine legend */}
        <Card title="Disbursement lifecycle">
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {DISBURSEMENT_FLOW.map((st, i) => (
              <span key={st} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                <Badge status={st} label={st.replace(/_/g, ' ')} />
                {i < DISBURSEMENT_FLOW.length - 1 ? <span style={{ color: colors.muted }}>→</span> : null}
              </span>
            ))}
          </div>
        </Card>

        <Card title="Schools">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>School</th><th style={th()}>State</th><th style={th()}>Students</th><th style={th()}>Bank account</th><th style={th()}>Status</th></tr></thead>
            <tbody>
              {schools.map((s) => (
                <tr key={s.id}><td style={td()}><strong>{s.name}</strong></td><td style={td()}>{s.state}</td><td style={td()}>{s.students.toLocaleString('en-NG')}</td><td style={td()}><code style={{ fontSize: '0.78rem' }}>{s.bank_account}</code></td><td style={td()}><Badge status={s.status} /></td></tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.6rem', alignItems: 'end', marginTop: '0.75rem', borderTop: '1px solid #f3f4f6', paddingTop: '0.75rem' }}>
            <div><label style={label()}>Name</label><input style={input()} value={schoolForm.name} onChange={(e) => setSchoolForm({ ...schoolForm, name: e.target.value })} /></div>
            <div><label style={label()}>State</label><input style={input()} value={schoolForm.state} onChange={(e) => setSchoolForm({ ...schoolForm, state: e.target.value })} /></div>
            <div><label style={label()}>Bank account</label><input style={input()} value={schoolForm.bank_account} onChange={(e) => setSchoolForm({ ...schoolForm, bank_account: e.target.value })} placeholder="****1234 · Bank" /></div>
            <div><button onClick={addSchool} disabled={busy === 'school'} style={btnPrimary()}>Onboard school</button></div>
          </div>
        </Card>

        <Card title="Fee schedules">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>School</th><th style={th()}>Term</th><th style={th()}>Amount</th><th style={th()}>Collected</th><th style={th()}>Due</th><th style={th()}>Status</th></tr></thead>
            <tbody>
              {fees.map((f) => (
                <tr key={f.id}><td style={td()}>{schoolName(f.school_id)}</td><td style={td()}>{f.term}</td><td style={td()}>{formatNaira(f.amount_kobo)}</td><td style={td()}>{formatNaira(f.collected_kobo)}</td><td style={td()}>{fmtDate(f.due_date)}</td><td style={td()}><Badge status={f.status} /></td></tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem', alignItems: 'end', marginTop: '0.75rem', borderTop: '1px solid #f3f4f6', paddingTop: '0.75rem' }}>
            <div><label style={label()}>School</label><select style={select()} value={feeForm.school_id} onChange={(e) => setFeeForm({ ...feeForm, school_id: e.target.value })}>{schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div><label style={label()}>Term</label><input style={input()} value={feeForm.term} onChange={(e) => setFeeForm({ ...feeForm, term: e.target.value })} placeholder="First Term 2025/26" /></div>
            <div><label style={label()}>Amount (₦)</label><input type="number" style={input()} value={feeForm.amount} onChange={(e) => setFeeForm({ ...feeForm, amount: e.target.value })} /></div>
            <div><label style={label()}>Due date</label><input type="date" style={input()} value={feeForm.due_date} onChange={(e) => setFeeForm({ ...feeForm, due_date: e.target.value })} /></div>
            <div><button onClick={addFee} disabled={busy === 'fee'} style={btnPrimary()}>Create schedule</button></div>
          </div>
        </Card>

        <Card title="Disbursements">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Reference</th><th style={th()}>School</th><th style={th()}>Amount</th><th style={th()}>Status</th><th style={th()}>Initiated</th><th style={th()}>Reconciled</th><th style={th()}>Action</th></tr></thead>
            <tbody>
              {disb.map((d) => {
                const advanceable = d.status !== 'reconciled';
                const nextLabel: Record<DisbursementStatus, string> = { fee_due: 'Mark funding', funding: 'Mark collected', collected: 'Mark disbursed', disbursed: 'Reconcile', reconciled: '—' };
                return (
                  <tr key={d.id}>
                    <td style={td()}><code style={{ fontSize: '0.78rem' }}>{d.reference}</code></td>
                    <td style={td()}>{schoolName(d.school_id)}</td>
                    <td style={td()}>{formatNaira(d.amount_kobo)}</td>
                    <td style={td()}><Badge status={d.status} label={d.status.replace(/_/g, ' ')} /></td>
                    <td style={td()}>{fmtDate(d.initiated_at)}</td>
                    <td style={td()}>{d.reconciled_at ? fmtDate(d.reconciled_at) : '—'}</td>
                    <td style={td()}>{advanceable ? <button onClick={() => reconcile(d)} disabled={busy === d.id} style={btnPrimary()}>{nextLabel[d.status]}</button> : <span style={{ color: colors.muted, fontSize: '0.8rem' }}>done</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card title="Save-for-school pots">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Guardian</th><th style={th()}>School</th><th style={th()}>Progress</th><th style={th()}>Status</th></tr></thead>
            <tbody>
              {pots.map((p) => (
                <tr key={p.id}>
                  <td style={td()}>{p.guardian}</td>
                  <td style={td()}>{schoolName(p.school_id)}</td>
                  <td style={td()}><div style={{ minWidth: 180 }}><Bar value={p.balance_kobo} max={p.target_kobo} color="#15803d" labelRight={`${formatNaira(p.balance_kobo)} / ${formatNaira(p.target_kobo)}`} /></div></td>
                  <td style={td()}><Badge status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Scholarships & disbursements">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Program</th><th style={th()}>Sponsor</th><th style={th()}>Pool</th><th style={th()}>Awarded</th><th style={th()}>Slots</th><th style={th()}>Status</th><th style={th()}>Award</th></tr></thead>
            <tbody>
              {scholarships.map((s) => (
                <tr key={s.id}>
                  <td style={td()}><strong>{s.name}</strong></td>
                  <td style={td()}>{s.sponsor}</td>
                  <td style={td()}>{formatNaira(s.pool_kobo)}</td>
                  <td style={td()}>{formatNaira(s.awarded_kobo)}</td>
                  <td style={td()}>{s.awarded_slots}/{s.slots}</td>
                  <td style={td()}><Badge status={s.status} /></td>
                  <td style={td()}>
                    {s.status === 'closed' ? <span style={{ color: colors.muted, fontSize: '0.8rem' }}>full</span> : (
                      <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                        <input style={{ ...input(), width: 100 }} placeholder="Learner ID" value={awardForm[s.id]?.learner ?? ''} onChange={(e) => setAwardForm({ ...awardForm, [s.id]: { ...(awardForm[s.id] ?? { learner: '', amount: '' }), learner: e.target.value } })} />
                        <input style={{ ...input(), width: 80 }} placeholder="₦" value={awardForm[s.id]?.amount ?? ''} onChange={(e) => setAwardForm({ ...awardForm, [s.id]: { ...(awardForm[s.id] ?? { learner: '', amount: '' }), amount: e.target.value } })} />
                        <button onClick={() => award(s)} disabled={busy === s.id} style={btnPrimary()}>Award</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem', alignItems: 'end', marginTop: '0.75rem', borderTop: '1px solid #f3f4f6', paddingTop: '0.75rem' }}>
            <div><label style={label()}>Program name</label><input style={input()} value={shpForm.name} onChange={(e) => setShpForm({ ...shpForm, name: e.target.value })} /></div>
            <div><label style={label()}>Sponsor</label><input style={input()} value={shpForm.sponsor} onChange={(e) => setShpForm({ ...shpForm, sponsor: e.target.value })} /></div>
            <div><label style={label()}>Pool (₦)</label><input type="number" style={input()} value={shpForm.pool} onChange={(e) => setShpForm({ ...shpForm, pool: e.target.value })} /></div>
            <div><label style={label()}>Slots</label><input type="number" style={input()} value={shpForm.slots} onChange={(e) => setShpForm({ ...shpForm, slots: e.target.value })} /></div>
            <div><button onClick={addScholarship} disabled={busy === 'shp'} style={btnPrimary()}>Create program</button></div>
          </div>
          {notice && <p style={{ fontSize: '0.8rem', color: colors.muted, marginTop: '0.6rem' }}>{notice}</p>}
          <AuditNote>School onboarding, fee schedules, disbursement transitions and scholarship awards are recorded to the immutable audit log and finance ledger.</AuditNote>
        </Card>
      </StateBlock>
    </div>
  );
}
