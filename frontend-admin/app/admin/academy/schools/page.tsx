'use client';

import { useEffect, useState } from 'react';
import {
  getSchoolsOverview, listInstitutions, createInstitution,
  listLicences, issueLicence, manageLicence,
  listClassGroups, createClassGroup, bulkEnrol,
  getWhiteLabelConfig, saveWhiteLabelConfig,
  listInvoices, generateInvoice, chargeInvoice, listPlans,
} from '@/services/academyAdminService';
import type {
  Institution, Licence, ClassGroup, BulkEnrolResult, WhiteLabelConfig,
  Invoice, SchoolsOverview, Plan,
} from '@/types/academyAdmin';
import { PageHeader, AcademyTabs, Card, Badge, Kpi, StateBlock, AuditNote, DisclosureNote, Bar, btn, btnPrimary, btnDanger, th, td, input, label, select, formatNaira, fmtDate } from '../_ui';

export default function SchoolsPage() {
  const [overview, setOverview] = useState<SchoolsOverview | null>(null);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [licences, setLicences] = useState<Licence[]>([]);
  const [groups, setGroups] = useState<ClassGroup[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [instForm, setInstForm] = useState({ name: '', type: 'school', state: '', contact_name: '', contact_email: '' });
  const [licForm, setLicForm] = useState({ institution_id: '', plan_id: '', seats_total: '', price: '', expires_on: '' });
  const [groupForm, setGroupForm] = useState({ institution_id: '', name: '', teacher: '', exam_focus: 'WASSCE' });
  const [invForm, setInvForm] = useState({ institution_id: '', licence_id: '', period: '' });

  const [enrolInst, setEnrolInst] = useState('');
  const [enrolLic, setEnrolLic] = useState('');
  const [enrolText, setEnrolText] = useState('');
  const [enrolResult, setEnrolResult] = useState<BulkEnrolResult | null>(null);

  const [wlInst, setWlInst] = useState('');
  const [wl, setWl] = useState<WhiteLabelConfig | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [o, i, l, g, inv, p] = await Promise.all([
        getSchoolsOverview(), listInstitutions(), listLicences(), listClassGroups(), listInvoices(), listPlans(),
      ]);
      setOverview(o); setInstitutions(i); setLicences(l); setGroups(g); setInvoices(inv); setPlans(p);
      if (i[0]) {
        if (!licForm.institution_id) setLicForm((x) => ({ ...x, institution_id: i[0].id }));
        if (!groupForm.institution_id) setGroupForm((x) => ({ ...x, institution_id: i[0].id }));
        if (!enrolInst) setEnrolInst(i[0].id);
        if (!invForm.institution_id) setInvForm((x) => ({ ...x, institution_id: i[0].id }));
        if (!wlInst) setWlInst(i[0].id);
      }
      if (p[0] && !licForm.plan_id) setLicForm((x) => ({ ...x, plan_id: p[0].id }));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  useEffect(() => { if (wlInst) getWhiteLabelConfig(wlInst).then(setWl).catch(() => setWl(null)); }, [wlInst]);

  function instName(id: string) { return institutions.find((i) => i.id === id)?.name ?? id; }
  function licsFor(instId: string) { return licences.filter((l) => l.institution_id === instId); }

  async function addInstitution() {
    if (!instForm.name || !instForm.state || !instForm.contact_email) { setNotice('Name, state and contact email are required.'); return; }
    setBusy('inst'); setNotice(null);
    try { const i = await createInstitution({ name: instForm.name, type: instForm.type as Institution['type'], state: instForm.state, contact_name: instForm.contact_name, contact_email: instForm.contact_email }); setNotice(`Onboarded "${i.name}".`); setInstForm({ name: '', type: 'school', state: '', contact_name: '', contact_email: '' }); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }
  async function addLicence() {
    const seats = Number(licForm.seats_total); const price = Number(licForm.price);
    if (!licForm.institution_id || !licForm.plan_id || !seats || !price || !licForm.expires_on) { setNotice('Institution, plan, seats, price/seat (₦) and expiry are required.'); return; }
    setBusy('lic'); setNotice(null);
    try { const l = await issueLicence({ institution_id: licForm.institution_id, plan_id: licForm.plan_id, seats_total: seats, price_per_seat_kobo: price * 100, expires_on: licForm.expires_on }); setNotice(`Issued ${l.plan_name} licence (${l.seats_total} seats).`); setLicForm({ ...licForm, seats_total: '', price: '', expires_on: '' }); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }
  async function changeLicence(l: Licence, action: 'suspend' | 'reactivate' | 'set_seats') {
    let seats: number | undefined;
    if (action === 'set_seats') {
      const v = typeof window !== 'undefined' ? window.prompt(`New seat total for ${instName(l.institution_id)} (currently ${l.seats_total}, ${l.seats_used} used)?`, String(l.seats_total)) : null;
      if (!v) return;
      seats = Number(v);
      if (!seats) { setNotice('Seat total must be a number.'); return; }
    }
    setBusy(l.id); setNotice(null);
    try { const u = await manageLicence({ id: l.id, action, seats_total: seats }); setNotice(`Licence ${u.id} → ${u.status} · ${u.seats_total} seats.`); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }
  async function addGroup() {
    if (!groupForm.institution_id || !groupForm.name || !groupForm.teacher) { setNotice('Institution, group name and teacher are required.'); return; }
    setBusy('group'); setNotice(null);
    try { const g = await createClassGroup(groupForm); setNotice(`Created class group "${g.name}".`); setGroupForm({ ...groupForm, name: '', teacher: '' }); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }
  async function runBulkEnrol() {
    const ids = enrolText.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (!enrolInst || !enrolLic || !ids.length) { setNotice('Pick an institution + licence and paste at least one learner ID.'); return; }
    setBusy('enrol'); setNotice(null); setEnrolResult(null);
    try { const r = await bulkEnrol({ institution_id: enrolInst, licence_id: enrolLic, learner_ids: ids }); setEnrolResult(r); setNotice(`Enrolled ${r.enrolled}/${r.requested}; ${r.rejected} rejected.`); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }
  async function saveWl() {
    if (!wl) return;
    setBusy('wl'); setNotice(null);
    try { const u = await saveWhiteLabelConfig(wl); setWl(u); setNotice(`Saved white-label config for ${instName(u.institution_id)}.`); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }
  async function genInvoice() {
    if (!invForm.institution_id || !invForm.licence_id || !invForm.period) { setNotice('Institution, licence and period are required to generate an invoice.'); return; }
    setBusy('inv'); setNotice(null);
    try { const i = await generateInvoice(invForm); setNotice(`Generated invoice ${i.id} (${formatNaira(i.amount_kobo)}).`); setInvForm({ ...invForm, period: '' }); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }
  async function charge(i: Invoice) {
    setBusy(i.id); setNotice(null);
    try { const u = await chargeInvoice({ id: i.id }); setNotice(`Charged invoice ${u.id} → ${u.status}.`); await load(); }
    catch (e) { setNotice(String(e)); } finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="School & institution management" subtitle="B2B2C institutions, seat-based licences, class groups, seat-capped bulk enrolment, white-label config, and usage billing." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <AcademyTabs active="schools" />
      <DisclosureNote>Requires <code>academy.schools</code>. Licences are seat-metered: bulk enrolment <strong>fails closed at the seat cap</strong>. Invoices are generated then charged via the finance rail; every change is audit-logged. Money in ₦ (kobo internally).</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={false}>
        {overview && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="Institutions active" value={overview.institutions_active.toString()} sub={`${overview.institutions_total} total`} accent="#340075" />
            <Kpi label="Seats used" value={overview.seats_used.toLocaleString('en-NG')} sub={`${overview.seats_sold.toLocaleString('en-NG')} sold`} />
            <Kpi label="Learners (B2B2C)" value={overview.learners_total.toLocaleString('en-NG')} />
            <Kpi label="Licence MRR" value={formatNaira(overview.mrr_kobo)} accent="#15803d" />
            <Kpi label="Outstanding" value={formatNaira(overview.outstanding_kobo)} accent={overview.outstanding_kobo > 0 ? '#9a3412' : undefined} />
          </div>
        )}

        <Card title="Institutions">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Institution</th><th style={th()}>Type</th><th style={th()}>State</th><th style={th()}>Contact</th><th style={th()}>Learners</th><th style={th()}>Groups</th><th style={th()}>Status</th></tr></thead>
            <tbody>
              {institutions.map((i) => (
                <tr key={i.id}>
                  <td style={td()}><strong>{i.name}</strong></td>
                  <td style={td()}><Badge status={i.type} /></td>
                  <td style={td()}>{i.state}</td>
                  <td style={td()}>{i.contact_name}<br /><span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>{i.contact_email}</span></td>
                  <td style={td()}>{i.learners.toLocaleString('en-NG')}</td>
                  <td style={td()}>{i.class_groups}</td>
                  <td style={td()}><Badge status={i.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem', alignItems: 'end', marginTop: '0.75rem', borderTop: '1px solid #f3f4f6', paddingTop: '0.75rem' }}>
            <div><label style={label()}>Name</label><input style={input()} value={instForm.name} onChange={(e) => setInstForm({ ...instForm, name: e.target.value })} /></div>
            <div><label style={label()}>Type</label><select style={select()} value={instForm.type} onChange={(e) => setInstForm({ ...instForm, type: e.target.value })}><option value="school">School</option><option value="college">College</option><option value="ngo">NGO</option><option value="corporate">Corporate</option></select></div>
            <div><label style={label()}>State</label><input style={input()} value={instForm.state} onChange={(e) => setInstForm({ ...instForm, state: e.target.value })} /></div>
            <div><label style={label()}>Contact name</label><input style={input()} value={instForm.contact_name} onChange={(e) => setInstForm({ ...instForm, contact_name: e.target.value })} /></div>
            <div><label style={label()}>Contact email</label><input style={input()} value={instForm.contact_email} onChange={(e) => setInstForm({ ...instForm, contact_email: e.target.value })} /></div>
            <div><button onClick={addInstitution} disabled={busy === 'inst'} style={btnPrimary()}>Onboard institution</button></div>
          </div>
        </Card>

        <Card title="Licences (seats used / total)">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Institution</th><th style={th()}>Plan</th><th style={th()}>Seats</th><th style={th()}>₦/seat</th><th style={th()}>Expires</th><th style={th()}>Status</th><th style={th()}>Actions</th></tr></thead>
            <tbody>
              {licences.map((l) => {
                const full = l.seats_used >= l.seats_total;
                return (
                  <tr key={l.id}>
                    <td style={td()}>{instName(l.institution_id)}</td>
                    <td style={td()}>{l.plan_name}</td>
                    <td style={td()}><div style={{ minWidth: 180 }}><Bar value={l.seats_used} max={l.seats_total} color={full ? '#b91c1c' : '#340075'} labelRight={`${l.seats_used.toLocaleString('en-NG')} / ${l.seats_total.toLocaleString('en-NG')}`} /></div></td>
                    <td style={td()}>{formatNaira(l.price_per_seat_kobo)}</td>
                    <td style={td()}>{fmtDate(l.expires_on)}</td>
                    <td style={td()}><Badge status={l.status} /></td>
                    <td style={td()}>
                      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                        {l.status === 'suspended'
                          ? <button onClick={() => changeLicence(l, 'reactivate')} disabled={busy === l.id} style={btnPrimary()}>Reactivate</button>
                          : <button onClick={() => changeLicence(l, 'suspend')} disabled={busy === l.id} style={btnDanger()}>Suspend</button>}
                        <button onClick={() => changeLicence(l, 'set_seats')} disabled={busy === l.id} style={btn()}>Set seats</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.6rem', alignItems: 'end', marginTop: '0.75rem', borderTop: '1px solid #f3f4f6', paddingTop: '0.75rem' }}>
            <div><label style={label()}>Institution</label><select style={select()} value={licForm.institution_id} onChange={(e) => setLicForm({ ...licForm, institution_id: e.target.value })}>{institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
            <div><label style={label()}>Plan</label><select style={select()} value={licForm.plan_id} onChange={(e) => setLicForm({ ...licForm, plan_id: e.target.value })}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div><label style={label()}>Seats</label><input type="number" style={input()} value={licForm.seats_total} onChange={(e) => setLicForm({ ...licForm, seats_total: e.target.value })} /></div>
            <div><label style={label()}>₦/seat</label><input type="number" style={input()} value={licForm.price} onChange={(e) => setLicForm({ ...licForm, price: e.target.value })} /></div>
            <div><label style={label()}>Expires</label><input type="date" style={input()} value={licForm.expires_on} onChange={(e) => setLicForm({ ...licForm, expires_on: e.target.value })} /></div>
            <div><button onClick={addLicence} disabled={busy === 'lic'} style={btnPrimary()}>Issue licence</button></div>
          </div>
        </Card>

        <Card title="Class groups">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Group</th><th style={th()}>Institution</th><th style={th()}>Teacher</th><th style={th()}>Exam focus</th><th style={th()}>Learners</th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id}><td style={td()}><strong>{g.name}</strong></td><td style={td()}>{instName(g.institution_id)}</td><td style={td()}>{g.teacher}</td><td style={td()}><Badge status={g.exam_focus} /></td><td style={td()}>{g.learners}</td></tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem', alignItems: 'end', marginTop: '0.75rem', borderTop: '1px solid #f3f4f6', paddingTop: '0.75rem' }}>
            <div><label style={label()}>Institution</label><select style={select()} value={groupForm.institution_id} onChange={(e) => setGroupForm({ ...groupForm, institution_id: e.target.value })}>{institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
            <div><label style={label()}>Group name</label><input style={input()} value={groupForm.name} onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} placeholder="SS 3 — Gold" /></div>
            <div><label style={label()}>Teacher</label><input style={input()} value={groupForm.teacher} onChange={(e) => setGroupForm({ ...groupForm, teacher: e.target.value })} /></div>
            <div><label style={label()}>Exam focus</label><input style={input()} value={groupForm.exam_focus} onChange={(e) => setGroupForm({ ...groupForm, exam_focus: e.target.value })} /></div>
            <div><button onClick={addGroup} disabled={busy === 'group'} style={btnPrimary()}>Create group</button></div>
          </div>
        </Card>

        <Card title="Bulk enrolment (seat-capped)">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.6rem', alignItems: 'end', marginBottom: '0.75rem' }}>
            <div><label style={label()}>Institution</label><select style={select()} value={enrolInst} onChange={(e) => { setEnrolInst(e.target.value); setEnrolLic(''); }}>{institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
            <div><label style={label()}>Licence</label><select style={select()} value={enrolLic} onChange={(e) => setEnrolLic(e.target.value)}><option value="">Select licence…</option>{licsFor(enrolInst).map((l) => <option key={l.id} value={l.id}>{l.plan_name} ({l.seats_total - l.seats_used} free)</option>)}</select></div>
          </div>
          <label style={label()}>Learner IDs (paste/upload — comma, space or newline separated)</label>
          <textarea style={{ ...input(), minHeight: 90, fontFamily: 'monospace', fontSize: '0.78rem' }} value={enrolText} onChange={(e) => setEnrolText(e.target.value)} placeholder={'usr_aa01\nusr_bb02\nusr_cc03'} />
          <div style={{ marginTop: '0.6rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={runBulkEnrol} disabled={busy === 'enrol'} style={btnPrimary()}>Enrol learners</button>
            <input type="file" accept=".csv,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then(setEnrolText); }} style={{ fontSize: '0.8rem' }} />
          </div>
          {enrolResult && (
            <div style={{ marginTop: '0.75rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                <span><strong>Requested:</strong> {enrolResult.requested}</span>
                <span style={{ color: '#15803d' }}><strong>Enrolled:</strong> {enrolResult.enrolled}</span>
                <span style={{ color: enrolResult.rejected ? '#b91c1c' : '#6b7280' }}><strong>Rejected:</strong> {enrolResult.rejected}</span>
                <span><strong>Seats remaining:</strong> {enrolResult.seats_remaining}</span>
              </div>
              {enrolResult.reason && <p style={{ color: '#b91c1c', fontSize: '0.8rem', margin: '0.5rem 0 0' }}>{enrolResult.reason}</p>}
              {enrolResult.rejected_ids.length > 0 && <p style={{ fontSize: '0.78rem', color: '#6b7280', margin: '0.4rem 0 0' }}>Rejected IDs: <code>{enrolResult.rejected_ids.join(', ')}</code></p>}
            </div>
          )}
        </Card>

        <Card title="White-label config">
          <div style={{ marginBottom: '0.75rem', maxWidth: 320 }}>
            <label style={label()}>Institution</label>
            <select style={select()} value={wlInst} onChange={(e) => setWlInst(e.target.value)}>{institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
          </div>
          {wl && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.6rem', alignItems: 'end' }}>
                <div><label style={label()}>Brand name</label><input style={input()} value={wl.brand_name} onChange={(e) => setWl({ ...wl, brand_name: e.target.value })} /></div>
                <div><label style={label()}>Subdomain</label><input style={input()} value={wl.subdomain} onChange={(e) => setWl({ ...wl, subdomain: e.target.value })} placeholder="school.spotlight.academy" /></div>
                <div><label style={label()}>Custom domain</label><input style={input()} value={wl.custom_domain ?? ''} onChange={(e) => setWl({ ...wl, custom_domain: e.target.value || null })} placeholder="learn.school.ng" /></div>
                <div><label style={label()}>Primary color</label><input style={input()} value={wl.primary_color} onChange={(e) => setWl({ ...wl, primary_color: e.target.value })} placeholder="#340075" /></div>
                <div><label style={label()}>Logo URL</label><input style={input()} value={wl.logo_url} onChange={(e) => setWl({ ...wl, logo_url: e.target.value })} /></div>
                <div><label style={label()}>Support email</label><input style={input()} value={wl.support_email} onChange={(e) => setWl({ ...wl, support_email: e.target.value })} /></div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', marginTop: '0.6rem' }}>
                <input type="checkbox" checked={wl.hide_spotlight_branding} onChange={(e) => setWl({ ...wl, hide_spotlight_branding: e.target.checked })} />
                Hide Spotlight branding
              </label>
              <div style={{ marginTop: '0.6rem' }}><button onClick={saveWl} disabled={busy === 'wl'} style={btnPrimary()}>Save white-label config</button></div>
            </>
          )}
        </Card>

        <Card title="Usage & billing">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Invoice</th><th style={th()}>Institution</th><th style={th()}>Period</th><th style={th()}>Seats</th><th style={th()}>Amount</th><th style={th()}>Due</th><th style={th()}>Status</th><th style={th()}>Action</th></tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{i.id}</code></td>
                  <td style={td()}>{instName(i.institution_id)}</td>
                  <td style={td()}>{i.period}</td>
                  <td style={td()}>{i.seats_billed.toLocaleString('en-NG')}</td>
                  <td style={td()}>{formatNaira(i.amount_kobo)}</td>
                  <td style={td()}>{fmtDate(i.due_on)}</td>
                  <td style={td()}><Badge status={i.status} /></td>
                  <td style={td()}>{i.status === 'paid' || i.status === 'void' ? <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>done</span> : <button onClick={() => charge(i)} disabled={busy === i.id} style={btnPrimary()}>Charge</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem', alignItems: 'end', marginTop: '0.75rem', borderTop: '1px solid #f3f4f6', paddingTop: '0.75rem' }}>
            <div><label style={label()}>Institution</label><select style={select()} value={invForm.institution_id} onChange={(e) => setInvForm({ ...invForm, institution_id: e.target.value, licence_id: '' })}>{institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
            <div><label style={label()}>Licence</label><select style={select()} value={invForm.licence_id} onChange={(e) => setInvForm({ ...invForm, licence_id: e.target.value })}><option value="">Select licence…</option>{licsFor(invForm.institution_id).map((l) => <option key={l.id} value={l.id}>{l.plan_name}</option>)}</select></div>
            <div><label style={label()}>Period</label><input style={input()} value={invForm.period} onChange={(e) => setInvForm({ ...invForm, period: e.target.value })} placeholder="June 2026" /></div>
            <div><button onClick={genInvoice} disabled={busy === 'inv'} style={btnPrimary()}>Generate invoice</button></div>
          </div>
          {notice && <p style={{ fontSize: '0.8rem', color: '#374151', marginTop: '0.6rem' }}>{notice}</p>}
          <AuditNote>Institution onboarding, licence changes, bulk enrolment, white-label edits and invoice generation/charges are recorded to the immutable audit log; charges post to the finance ledger.</AuditNote>
        </Card>
      </StateBlock>
    </div>
  );
}
