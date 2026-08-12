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
import { AcademyTabs, Kpi, StateBlock, AuditNote, DisclosureNote, Bar, label, select, formatNaira, fmtDate } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (['active', 'approved', 'published', 'funded', 'paid', 'completed', 'allocated', 'live', 'reconciled', 'disbursed', 'collected', 'released', 'core', 'issued', 'routed', 'ready', 'eligible', 'actioned', 'verified', 'resolved', 'plan_published', 'badge_earned', 'pool_funded', 'item_approved'].includes(s)) return colors.success;
  if (['pending', 'in_review', 'under_review', 'needs_info', 'scheduled', 'low_balance', 'review', 'in_translation', 'funding', 'fee_due', 'onboarding', 'frequent', 'packaged', 'matured', 'paused', 'processing', 'triaged', 'investigating', 'hide', 'warn', 'high', 'medium'].includes(s)) return colors.warning;
  if (['draft', 'authoring', 'open', 'upcoming', 'generated', 'partial', 'submitted', 'trial', 'requested', 'applied', 'cards_generated', 'exam_opened', 'campaign_launched'].includes(s)) return colors.info;
  if (['rejected', 'failed', 'suspended', 'blocked', 'unfunded', 'expired', 'duplicate', 'revoked', 'escalated', 'ban', 'critical', 'overdue', 'item_rejected'].includes(s)) return colors.danger;
  if (['refunded', 'reversed', 'redeemed', 'reward_redeemed'].includes(s)) return colors.primary;
  return colors.secondary;
}

function StatusBadge({ status, label: lbl }: { status: string; label?: string }) {
  return <Badge text={lbl ?? status.replace(/_/g, ' ')} color={statusColor(status)} />;
}

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
    <Page>
      <PageHeader title="School & institution management" subtitle="B2B2C institutions, seat-based licences, class groups, seat-capped bulk enrolment, white-label config, and usage billing." actions={<Button onClick={load} variant="outline" sm>Refresh</Button>} />
      <AcademyTabs active="schools" />
      <DisclosureNote>Requires <code>academy.schools</code>. Licences are seat-metered: bulk enrolment <strong>fails closed at the seat cap</strong>. Invoices are generated then charged via the finance rail; every change is audit-logged. Money in ₦ (kobo internally).</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={false}>
        {overview && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="Institutions active" value={overview.institutions_active.toString()} sub={`${overview.institutions_total} total`} accent={colors.primary} />
            <Kpi label="Seats used" value={overview.seats_used.toLocaleString('en-NG')} sub={`${overview.seats_sold.toLocaleString('en-NG')} sold`} />
            <Kpi label="Learners (B2B2C)" value={overview.learners_total.toLocaleString('en-NG')} />
            <Kpi label="Licence MRR" value={formatNaira(overview.mrr_kobo)} accent={colors.success} />
            <Kpi label="Outstanding" value={formatNaira(overview.outstanding_kobo)} accent={overview.outstanding_kobo > 0 ? colors.warning : undefined} />
          </div>
        )}

        <Card title="Institutions">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Institution</th><th style={thCell}>Type</th><th style={thCell}>State</th><th style={thCell}>Contact</th><th style={thCell}>Learners</th><th style={thCell}>Groups</th><th style={thCell}>Status</th></tr></thead>
            <tbody>
              {institutions.map((i) => (
                <tr key={i.id}>
                  <td style={tdCell}><strong>{i.name}</strong></td>
                  <td style={tdCell}><StatusBadge status={i.type} /></td>
                  <td style={tdCell}>{i.state}</td>
                  <td style={tdCell}>{i.contact_name}<br /><span style={{ color: colors.muted, fontSize: '0.75rem' }}>{i.contact_email}</span></td>
                  <td style={tdCell}>{i.learners.toLocaleString('en-NG')}</td>
                  <td style={tdCell}>{i.class_groups}</td>
                  <td style={tdCell}><StatusBadge status={i.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem', alignItems: 'end', marginTop: '0.75rem', borderTop: `1px solid ${colors.border}`, paddingTop: '0.75rem' }}>
            <div><label style={label()}>Name</label><Input value={instForm.name} onChange={(e) => setInstForm({ ...instForm, name: e.target.value })} /></div>
            <div><label style={label()}>Type</label><select style={select()} value={instForm.type} onChange={(e) => setInstForm({ ...instForm, type: e.target.value })}><option value="school">School</option><option value="college">College</option><option value="ngo">NGO</option><option value="corporate">Corporate</option></select></div>
            <div><label style={label()}>State</label><Input value={instForm.state} onChange={(e) => setInstForm({ ...instForm, state: e.target.value })} /></div>
            <div><label style={label()}>Contact name</label><Input value={instForm.contact_name} onChange={(e) => setInstForm({ ...instForm, contact_name: e.target.value })} /></div>
            <div><label style={label()}>Contact email</label><Input value={instForm.contact_email} onChange={(e) => setInstForm({ ...instForm, contact_email: e.target.value })} /></div>
            <div><Button onClick={addInstitution} disabled={busy === 'inst'} variant="primary" sm>Onboard institution</Button></div>
          </div>
        </Card>

        <Card title="Licences (seats used / total)">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Institution</th><th style={thCell}>Plan</th><th style={thCell}>Seats</th><th style={thCell}>₦/seat</th><th style={thCell}>Expires</th><th style={thCell}>Status</th><th style={thCell}>Actions</th></tr></thead>
            <tbody>
              {licences.map((l) => {
                const full = l.seats_used >= l.seats_total;
                return (
                  <tr key={l.id}>
                    <td style={tdCell}>{instName(l.institution_id)}</td>
                    <td style={tdCell}>{l.plan_name}</td>
                    <td style={tdCell}><div style={{ minWidth: 180 }}><Bar value={l.seats_used} max={l.seats_total} color={full ? colors.danger : colors.primary} labelRight={`${l.seats_used.toLocaleString('en-NG')} / ${l.seats_total.toLocaleString('en-NG')}`} /></div></td>
                    <td style={tdCell}>{formatNaira(l.price_per_seat_kobo)}</td>
                    <td style={tdCell}>{fmtDate(l.expires_on)}</td>
                    <td style={tdCell}><StatusBadge status={l.status} /></td>
                    <td style={tdCell}>
                      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                        {l.status === 'suspended'
                          ? <Button onClick={() => changeLicence(l, 'reactivate')} disabled={busy === l.id} variant="primary" sm>Reactivate</Button>
                          : <Button onClick={() => changeLicence(l, 'suspend')} disabled={busy === l.id} variant="danger" sm>Suspend</Button>}
                        <Button onClick={() => changeLicence(l, 'set_seats')} disabled={busy === l.id} variant="outline" sm>Set seats</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.6rem', alignItems: 'end', marginTop: '0.75rem', borderTop: `1px solid ${colors.border}`, paddingTop: '0.75rem' }}>
            <div><label style={label()}>Institution</label><select style={select()} value={licForm.institution_id} onChange={(e) => setLicForm({ ...licForm, institution_id: e.target.value })}>{institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
            <div><label style={label()}>Plan</label><select style={select()} value={licForm.plan_id} onChange={(e) => setLicForm({ ...licForm, plan_id: e.target.value })}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div><label style={label()}>Seats</label><Input type="number" value={licForm.seats_total} onChange={(e) => setLicForm({ ...licForm, seats_total: e.target.value })} /></div>
            <div><label style={label()}>₦/seat</label><Input type="number" value={licForm.price} onChange={(e) => setLicForm({ ...licForm, price: e.target.value })} /></div>
            <div><label style={label()}>Expires</label><Input type="date" value={licForm.expires_on} onChange={(e) => setLicForm({ ...licForm, expires_on: e.target.value })} /></div>
            <div><Button onClick={addLicence} disabled={busy === 'lic'} variant="primary" sm>Issue licence</Button></div>
          </div>
        </Card>

        <Card title="Class groups">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Group</th><th style={thCell}>Institution</th><th style={thCell}>Teacher</th><th style={thCell}>Exam focus</th><th style={thCell}>Learners</th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id}><td style={tdCell}><strong>{g.name}</strong></td><td style={tdCell}>{instName(g.institution_id)}</td><td style={tdCell}>{g.teacher}</td><td style={tdCell}><StatusBadge status={g.exam_focus} /></td><td style={tdCell}>{g.learners}</td></tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem', alignItems: 'end', marginTop: '0.75rem', borderTop: `1px solid ${colors.border}`, paddingTop: '0.75rem' }}>
            <div><label style={label()}>Institution</label><select style={select()} value={groupForm.institution_id} onChange={(e) => setGroupForm({ ...groupForm, institution_id: e.target.value })}>{institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
            <div><label style={label()}>Group name</label><Input value={groupForm.name} onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} placeholder="SS 3 — Gold" /></div>
            <div><label style={label()}>Teacher</label><Input value={groupForm.teacher} onChange={(e) => setGroupForm({ ...groupForm, teacher: e.target.value })} /></div>
            <div><label style={label()}>Exam focus</label><Input value={groupForm.exam_focus} onChange={(e) => setGroupForm({ ...groupForm, exam_focus: e.target.value })} /></div>
            <div><Button onClick={addGroup} disabled={busy === 'group'} variant="primary" sm>Create group</Button></div>
          </div>
        </Card>

        <Card title="Bulk enrolment (seat-capped)">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.6rem', alignItems: 'end', marginBottom: '0.75rem' }}>
            <div><label style={label()}>Institution</label><select style={select()} value={enrolInst} onChange={(e) => { setEnrolInst(e.target.value); setEnrolLic(''); }}>{institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
            <div><label style={label()}>Licence</label><select style={select()} value={enrolLic} onChange={(e) => setEnrolLic(e.target.value)}><option value="">Select licence…</option>{licsFor(enrolInst).map((l) => <option key={l.id} value={l.id}>{l.plan_name} ({l.seats_total - l.seats_used} free)</option>)}</select></div>
          </div>
          <label style={label()}>Learner IDs (paste/upload — comma, space or newline separated)</label>
          <textarea style={{ minHeight: 90, fontFamily: 'monospace', fontSize: '0.78rem' }} value={enrolText} onChange={(e) => setEnrolText(e.target.value)} placeholder={'usr_aa01\nusr_bb02\nusr_cc03'} />
          <div style={{ marginTop: '0.6rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <Button onClick={runBulkEnrol} disabled={busy === 'enrol'} variant="primary" sm>Enrol learners</Button>
            <input type="file" accept=".csv,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then(setEnrolText); }} style={{ fontSize: '0.8rem' }} />
          </div>
          {enrolResult && (
            <div style={{ marginTop: '0.75rem', border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                <span><strong>Requested:</strong> {enrolResult.requested}</span>
                <span style={{ color: colors.success }}><strong>Enrolled:</strong> {enrolResult.enrolled}</span>
                <span style={{ color: enrolResult.rejected ? colors.danger : colors.muted }}><strong>Rejected:</strong> {enrolResult.rejected}</span>
                <span><strong>Seats remaining:</strong> {enrolResult.seats_remaining}</span>
              </div>
              {enrolResult.reason && <p style={{ color: colors.danger, fontSize: '0.8rem', margin: '0.5rem 0 0' }}>{enrolResult.reason}</p>}
              {enrolResult.rejected_ids.length > 0 && <p style={{ fontSize: '0.78rem', color: colors.muted, margin: '0.4rem 0 0' }}>Rejected IDs: <code>{enrolResult.rejected_ids.join(', ')}</code></p>}
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
                <div><label style={label()}>Brand name</label><Input value={wl.brand_name} onChange={(e) => setWl({ ...wl, brand_name: e.target.value })} /></div>
                <div><label style={label()}>Subdomain</label><Input value={wl.subdomain} onChange={(e) => setWl({ ...wl, subdomain: e.target.value })} placeholder="school.spotlight.academy" /></div>
                <div><label style={label()}>Custom domain</label><Input value={wl.custom_domain ?? ''} onChange={(e) => setWl({ ...wl, custom_domain: e.target.value || null })} placeholder="learn.school.ng" /></div>
                <div><label style={label()}>Primary color</label><Input value={wl.primary_color} onChange={(e) => setWl({ ...wl, primary_color: e.target.value })} placeholder="#340075" /></div>
                <div><label style={label()}>Logo URL</label><Input value={wl.logo_url} onChange={(e) => setWl({ ...wl, logo_url: e.target.value })} /></div>
                <div><label style={label()}>Support email</label><Input value={wl.support_email} onChange={(e) => setWl({ ...wl, support_email: e.target.value })} /></div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', marginTop: '0.6rem' }}>
                <input type="checkbox" checked={wl.hide_spotlight_branding} onChange={(e) => setWl({ ...wl, hide_spotlight_branding: e.target.checked })} />
                Hide Spotlight branding
              </label>
              <div style={{ marginTop: '0.6rem' }}><Button onClick={saveWl} disabled={busy === 'wl'} variant="primary" sm>Save white-label config</Button></div>
            </>
          )}
        </Card>

        <Card title="Usage & billing">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Invoice</th><th style={thCell}>Institution</th><th style={thCell}>Period</th><th style={thCell}>Seats</th><th style={thCell}>Amount</th><th style={thCell}>Due</th><th style={thCell}>Status</th><th style={thCell}>Action</th></tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{i.id}</code></td>
                  <td style={tdCell}>{instName(i.institution_id)}</td>
                  <td style={tdCell}>{i.period}</td>
                  <td style={tdCell}>{i.seats_billed.toLocaleString('en-NG')}</td>
                  <td style={tdCell}>{formatNaira(i.amount_kobo)}</td>
                  <td style={tdCell}>{fmtDate(i.due_on)}</td>
                  <td style={tdCell}><StatusBadge status={i.status} /></td>
                  <td style={tdCell}>{i.status === 'paid' || i.status === 'void' ? <span style={{ color: colors.muted, fontSize: '0.8rem' }}>done</span> : <Button onClick={() => charge(i)} disabled={busy === i.id} variant="primary" sm>Charge</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem', alignItems: 'end', marginTop: '0.75rem', borderTop: `1px solid ${colors.border}`, paddingTop: '0.75rem' }}>
            <div><label style={label()}>Institution</label><select style={select()} value={invForm.institution_id} onChange={(e) => setInvForm({ ...invForm, institution_id: e.target.value, licence_id: '' })}>{institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
            <div><label style={label()}>Licence</label><select style={select()} value={invForm.licence_id} onChange={(e) => setInvForm({ ...invForm, licence_id: e.target.value })}><option value="">Select licence…</option>{licsFor(invForm.institution_id).map((l) => <option key={l.id} value={l.id}>{l.plan_name}</option>)}</select></div>
            <div><label style={label()}>Period</label><Input value={invForm.period} onChange={(e) => setInvForm({ ...invForm, period: e.target.value })} placeholder="June 2026" /></div>
            <div><Button onClick={genInvoice} disabled={busy === 'inv'} variant="primary" sm>Generate invoice</Button></div>
          </div>
          {notice && <p style={{ fontSize: '0.8rem', color: colors.text, marginTop: '0.6rem' }}>{notice}</p>}
          <AuditNote>Institution onboarding, licence changes, bulk enrolment, white-label edits and invoice generation/charges are recorded to the immutable audit log; charges post to the finance ledger.</AuditNote>
        </Card>
      </StateBlock>
    </Page>
  );
}
