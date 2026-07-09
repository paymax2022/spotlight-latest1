'use client';

// SC-29 · Setup Wizard — create school → session → class → fee schedule.
// FeeSchedule builder with fee_items + installment_policy. Discloses SF-1:
// once a schedule is ISSUED (an Invoice can reference it) it becomes immutable.

import { useEffect, useState } from 'react';
import {
  listFeesSchools, createFeesSchool, listFeesSessions, createFeesSession,
  listFeesClasses, createFeesClass, listFeeSchedules, createFeeSchedule, issueFeeSchedule,
} from '@/services/academyFeesService';
import type {
  FeesSchool, FeesSession, FeesClass, FeeSchedule, FeeItemInput, InstallmentPolicy,
} from '@/types/academyFees';
import {
  PageHeader, Card, Badge, StateBlock, DisclosureNote, AuditNote,
  btn, btnPrimary, th, td, input, label, select, formatNaira, fmtDate,
} from '../../_ui';
import { FeesTabs } from '../_ui';

export default function FeesSetupWizardPage() {
  const [schools, setSchools] = useState<FeesSchool[]>([]);
  const [sessions, setSessions] = useState<FeesSession[]>([]);
  const [classes, setClasses] = useState<FeesClass[]>([]);
  const [schedules, setSchedules] = useState<FeeSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [schoolForm, setSchoolForm] = useState({ name: '', state: '', owner_email: '' });
  const [sessionForm, setSessionForm] = useState({ school_id: '', name: '', starts_on: '', ends_on: '' });
  const [classForm, setClassForm] = useState({ school_id: '', session_id: '', name: '', curriculum_class: 'JSS1' });

  // Fee-schedule builder state.
  const [schedForm, setSchedForm] = useState({ school_id: '', session_id: '', class_id: '', term: '', due_date: '' });
  const [feeItems, setFeeItems] = useState<FeeItemInput[]>([{ name: 'Tuition', amount_kobo: 0, mandatory: true }]);
  const [policy, setPolicy] = useState<InstallmentPolicy>({ enabled: false, count: 1, cadence_days: 30, first_due_date: '' });

  async function load() {
    setLoading(true); setError(null);
    try {
      const [sc, se, cl, fs] = await Promise.all([listFeesSchools(), listFeesSessions(), listFeesClasses(), listFeeSchedules()]);
      setSchools(sc); setSessions(se); setClasses(cl); setSchedules(fs);
      if (sc[0]) {
        setSessionForm((x) => ({ ...x, school_id: x.school_id || sc[0].id }));
        setClassForm((x) => ({ ...x, school_id: x.school_id || sc[0].id }));
        setSchedForm((x) => ({ ...x, school_id: x.school_id || sc[0].id }));
      }
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function nameOf<T extends { id: string; name: string }>(rows: T[], id: string) { return rows.find((r) => r.id === id)?.name ?? id; }

  async function addSchool() {
    if (!schoolForm.name || !schoolForm.state || !schoolForm.owner_email) { setNotice('Name, state and owner email are required.'); return; }
    setBusy('school'); setNotice(null);
    try { const s = await createFeesSchool(schoolForm); setNotice(`Created school "${s.name}" (verification: ${s.verification_tier}).`); setSchoolForm({ name: '', state: '', owner_email: '' }); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }
  async function addSession() {
    if (!sessionForm.school_id || !sessionForm.name || !sessionForm.starts_on || !sessionForm.ends_on) { setNotice('School, name, start and end dates are required.'); return; }
    setBusy('session'); setNotice(null);
    try { const s = await createFeesSession(sessionForm); setNotice(`Created session "${s.name}".`); setSessionForm({ ...sessionForm, name: '', starts_on: '', ends_on: '' }); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }
  async function addClass() {
    if (!classForm.school_id || !classForm.session_id || !classForm.name) { setNotice('School, session and class name are required.'); return; }
    setBusy('class'); setNotice(null);
    try { const c = await createFeesClass(classForm); setNotice(`Created class "${c.name}".`); setClassForm({ ...classForm, name: '' }); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }

  function setItem(i: number, patch: Partial<FeeItemInput>) { setFeeItems(feeItems.map((it, n) => (n === i ? { ...it, ...patch } : it))); }
  function addItem() { setFeeItems([...feeItems, { name: '', amount_kobo: 0, mandatory: true }]); }
  function removeItem(i: number) { setFeeItems(feeItems.filter((_, n) => n !== i)); }
  const scheduleTotal = feeItems.reduce((s, it) => s + it.amount_kobo, 0);

  async function addSchedule() {
    if (!schedForm.school_id || !schedForm.session_id || !schedForm.class_id || !schedForm.term || !schedForm.due_date) { setNotice('School, session, class, term and due date are required.'); return; }
    if (feeItems.some((it) => !it.name || it.amount_kobo <= 0)) { setNotice('Every fee item needs a name and a positive amount.'); return; }
    setBusy('sched'); setNotice(null);
    try {
      const f = await createFeeSchedule({ ...schedForm, fee_items: feeItems, installment_policy: { ...policy, first_due_date: policy.first_due_date || schedForm.due_date } });
      setNotice(`Created DRAFT schedule "${f.term}". It can still be edited until issued.`);
      setFeeItems([{ name: 'Tuition', amount_kobo: 0, mandatory: true }]);
      setSchedForm({ ...schedForm, term: '', due_date: '' });
      await load();
    } catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }
  async function issue(f: FeeSchedule) {
    const ok = typeof window === 'undefined' ? true : window.confirm(`Issue "${f.term}"? SF-1: once issued, this schedule is IMMUTABLE — installment terms lock and it can no longer be edited.`);
    if (!ok) return;
    setBusy(f.id); setNotice(null);
    try { const r = await issueFeeSchedule(f.id); setNotice(`Issued schedule ${r.id}. It is now immutable (SF-1).`); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }

  const sessionsFor = (schoolId: string) => sessions.filter((s) => s.school_id === schoolId);
  const classesFor = (sessionId: string) => classes.filter((c) => c.session_id === sessionId);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Setup Wizard" subtitle="Stand up a school fees programme end-to-end: school → academic session → classes → fee schedules. Build fee items and an optional installment plan, then issue." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FeesTabs active="setup-wizard" />
      <DisclosureNote>Requires <code>academy.fees.setup</code>. <strong>SF-1:</strong> a FeeSchedule becomes <strong>immutable</strong> the moment it is <strong>issued</strong> (once an invoice can reference it). Fee items and installment terms lock at issuance — plan carefully. All money in ₦ (kobo internally).</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={false}>
        {/* STEP 1 — School */}
        <Card title="Step 1 · School">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>School</th><th style={th()}>State</th><th style={th()}>Verification</th><th style={th()}>Status</th></tr></thead>
            <tbody>{schools.map((s) => <tr key={s.id}><td style={td()}><strong>{s.name}</strong></td><td style={td()}>{s.state}</td><td style={td()}><Badge status={s.verification_tier} /></td><td style={td()}><Badge status={s.status} /></td></tr>)}</tbody>
          </table>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.6rem', alignItems: 'end', marginTop: '0.75rem', borderTop: '1px solid #f3f4f6', paddingTop: '0.75rem' }}>
            <div><label style={label()}>Name</label><input style={input()} value={schoolForm.name} onChange={(e) => setSchoolForm({ ...schoolForm, name: e.target.value })} /></div>
            <div><label style={label()}>State</label><input style={input()} value={schoolForm.state} onChange={(e) => setSchoolForm({ ...schoolForm, state: e.target.value })} /></div>
            <div><label style={label()}>Owner email</label><input style={input()} value={schoolForm.owner_email} onChange={(e) => setSchoolForm({ ...schoolForm, owner_email: e.target.value })} /></div>
            <div><button onClick={addSchool} disabled={busy === 'school'} style={btnPrimary()}>Create school</button></div>
          </div>
        </Card>

        {/* STEP 2 — Session */}
        <Card title="Step 2 · Academic session">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>School</th><th style={th()}>Session</th><th style={th()}>Starts</th><th style={th()}>Ends</th><th style={th()}>Status</th></tr></thead>
            <tbody>{sessions.map((s) => <tr key={s.id}><td style={td()}>{nameOf(schools, s.school_id)}</td><td style={td()}>{s.name}</td><td style={td()}>{fmtDate(s.starts_on)}</td><td style={td()}>{fmtDate(s.ends_on)}</td><td style={td()}><Badge status={s.status} /></td></tr>)}</tbody>
          </table>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem', alignItems: 'end', marginTop: '0.75rem', borderTop: '1px solid #f3f4f6', paddingTop: '0.75rem' }}>
            <div><label style={label()}>School</label><select style={select()} value={sessionForm.school_id} onChange={(e) => setSessionForm({ ...sessionForm, school_id: e.target.value })}>{schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div><label style={label()}>Session name</label><input style={input()} value={sessionForm.name} onChange={(e) => setSessionForm({ ...sessionForm, name: e.target.value })} placeholder="2025/2026" /></div>
            <div><label style={label()}>Starts</label><input type="date" style={input()} value={sessionForm.starts_on} onChange={(e) => setSessionForm({ ...sessionForm, starts_on: e.target.value })} /></div>
            <div><label style={label()}>Ends</label><input type="date" style={input()} value={sessionForm.ends_on} onChange={(e) => setSessionForm({ ...sessionForm, ends_on: e.target.value })} /></div>
            <div><button onClick={addSession} disabled={busy === 'session'} style={btnPrimary()}>Create session</button></div>
          </div>
        </Card>

        {/* STEP 3 — Class */}
        <Card title="Step 3 · Classes">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Class</th><th style={th()}>Session</th><th style={th()}>Curriculum</th><th style={th()}>Students</th></tr></thead>
            <tbody>{classes.map((c) => <tr key={c.id}><td style={td()}><strong>{c.name}</strong></td><td style={td()}>{nameOf(sessions, c.session_id)}</td><td style={td()}><Badge status="core" label={c.curriculum_class} /></td><td style={td()}>{c.students}</td></tr>)}</tbody>
          </table>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem', alignItems: 'end', marginTop: '0.75rem', borderTop: '1px solid #f3f4f6', paddingTop: '0.75rem' }}>
            <div><label style={label()}>School</label><select style={select()} value={classForm.school_id} onChange={(e) => setClassForm({ ...classForm, school_id: e.target.value, session_id: '' })}>{schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div><label style={label()}>Session</label><select style={select()} value={classForm.session_id} onChange={(e) => setClassForm({ ...classForm, session_id: e.target.value })}><option value="">Select…</option>{sessionsFor(classForm.school_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div><label style={label()}>Class name</label><input style={input()} value={classForm.name} onChange={(e) => setClassForm({ ...classForm, name: e.target.value })} placeholder="JSS 1A" /></div>
            <div><label style={label()}>Curriculum</label><select style={select()} value={classForm.curriculum_class} onChange={(e) => setClassForm({ ...classForm, curriculum_class: e.target.value })}>{['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3'].map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
            <div><button onClick={addClass} disabled={busy === 'class'} style={btnPrimary()}>Create class</button></div>
          </div>
        </Card>

        {/* STEP 4 — Fee schedule builder */}
        <Card title="Step 4 · Fee schedule builder">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Class</th><th style={th()}>Term</th><th style={th()}>Total</th><th style={th()}>Items</th><th style={th()}>Installments</th><th style={th()}>Due</th><th style={th()}>Status</th><th style={th()}>Action</th></tr></thead>
            <tbody>
              {schedules.map((f) => {
                const total = f.fee_items.reduce((s, it) => s + it.amount_kobo, 0);
                return (
                  <tr key={f.id}>
                    <td style={td()}>{nameOf(classes, f.class_id)}</td>
                    <td style={td()}>{f.term}</td>
                    <td style={td()}>{formatNaira(total)}</td>
                    <td style={td()}>{f.fee_items.map((it) => `${it.name}${it.mandatory ? '' : ' (opt)'}`).join(', ')}</td>
                    <td style={td()}>{f.installment_policy.enabled ? `${f.installment_policy.count}× / ${f.installment_policy.cadence_days}d` : 'Full payment'}</td>
                    <td style={td()}>{fmtDate(f.due_date)}</td>
                    <td style={td()}><Badge status={f.status} label={f.status === 'issued' ? 'issued · locked' : 'draft'} /></td>
                    <td style={td()}>{f.status === 'draft' ? <button onClick={() => issue(f)} disabled={busy === f.id} style={btnPrimary()}>Issue (lock)</button> : <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>immutable</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: '0.75rem', marginTop: '0.75rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem', alignItems: 'end' }}>
              <div><label style={label()}>School</label><select style={select()} value={schedForm.school_id} onChange={(e) => setSchedForm({ ...schedForm, school_id: e.target.value, session_id: '', class_id: '' })}>{schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><label style={label()}>Session</label><select style={select()} value={schedForm.session_id} onChange={(e) => setSchedForm({ ...schedForm, session_id: e.target.value, class_id: '' })}><option value="">Select…</option>{sessionsFor(schedForm.school_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><label style={label()}>Class</label><select style={select()} value={schedForm.class_id} onChange={(e) => setSchedForm({ ...schedForm, class_id: e.target.value })}><option value="">Select…</option>{classesFor(schedForm.session_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label style={label()}>Term</label><input style={input()} value={schedForm.term} onChange={(e) => setSchedForm({ ...schedForm, term: e.target.value })} placeholder="First Term 2025/26" /></div>
              <div><label style={label()}>Due date</label><input type="date" style={input()} value={schedForm.due_date} onChange={(e) => setSchedForm({ ...schedForm, due_date: e.target.value })} /></div>
            </div>

            <div style={{ marginTop: '0.85rem' }}>
              <label style={label()}>Fee items</label>
              {feeItems.map((it, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto auto', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <input style={input()} value={it.name} placeholder="Item name" onChange={(e) => setItem(i, { name: e.target.value })} />
                  <input type="number" style={input()} value={it.amount_kobo ? it.amount_kobo / 100 : ''} placeholder="₦ amount" onChange={(e) => setItem(i, { amount_kobo: Number(e.target.value) * 100 })} />
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', color: '#374151', whiteSpace: 'nowrap' }}><input type="checkbox" checked={it.mandatory} onChange={(e) => setItem(i, { mandatory: e.target.checked })} /> mandatory</label>
                  <button onClick={() => removeItem(i)} disabled={feeItems.length === 1} style={btn()}>Remove</button>
                </div>
              ))}
              <button onClick={addItem} style={btn()}>+ Add item</button>
              <span style={{ marginLeft: '1rem', fontSize: '0.85rem', color: '#374151' }}>Schedule total: <strong>{formatNaira(scheduleTotal)}</strong></span>
            </div>

            <div style={{ marginTop: '0.85rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.6rem', alignItems: 'end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: '#374151' }}><input type="checkbox" checked={policy.enabled} onChange={(e) => setPolicy({ ...policy, enabled: e.target.checked })} /> Allow installments</label>
              <div><label style={label()}>Installments</label><input type="number" disabled={!policy.enabled} style={input()} value={policy.count} onChange={(e) => setPolicy({ ...policy, count: Number(e.target.value) })} /></div>
              <div><label style={label()}>Cadence (days)</label><input type="number" disabled={!policy.enabled} style={input()} value={policy.cadence_days} onChange={(e) => setPolicy({ ...policy, cadence_days: Number(e.target.value) })} /></div>
              <div><button onClick={addSchedule} disabled={busy === 'sched'} style={btnPrimary()}>Create draft schedule</button></div>
            </div>
            <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.5rem' }}>Installments are <strong>guardian-pays-school-over-time only</strong> — Paymax never fronts fees (Model A). Terms lock at issuance (SF-1 / SF-6).</p>
          </div>
          {notice && <p style={{ fontSize: '0.8rem', color: '#374151', marginTop: '0.6rem' }}>{notice}</p>}
          <AuditNote>School / session / class creation, schedule drafts and issuance are recorded to the immutable audit log (module <code>academy.fees</code>).</AuditNote>
        </Card>
      </StateBlock>
    </div>
  );
}
