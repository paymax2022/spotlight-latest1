'use client';

// The working console for the Spotlight Film Academy, replacing the BRIDGE that
// used to sit here.
// The bridge shipped four links to /admin/film-academy on the web app. Those
// pages were removed when the admin portal was consolidated into this console,
// so every link went to a login redirect and then nowhere — the section looked
// present and did nothing. The API behind them was never removed, so the screens
// belong here now, against that same API.
// EVERY tab below drives the exact data plane the mobile app reads at
// http://localhost:8083/film-academy:
//   Batches / Areas / Settings  → mobile GET /api/academy/apply       (hub, apply)
//   Applications (decide)       → mobile GET /api/academy/application (status)
//   Tuition plans               → mobile GET /api/academy/installments(tuition)
//   Curriculum                  → mobile GET /api/academy/learning    (learn)
//   Submissions (grade)         → mobile GET /api/academy/assignments (assignments)
// convention). So `formatNaira` from ../_ui is deliberately NOT used here — it
// divides by 100 and would render ₦150,000 as ₦1,500. `naira()` below formats
// the values as stored.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Page, colors } from '@/components/ui/vuexy';
import {
  AcademyTabs, Card, PageHeader, Badge, StateBlock, FilterBar, DisclosureNote, AuditNote,
  Kpi, Bar, btn, btnPrimary, btnDanger, th, td, input, label, select, card, fmtDate,
} from '../_ui';
import * as svc from '@/services/filmAcademyAdminService';

type TabKey = 'batches' | 'applications' | 'tuition' | 'curriculum' | 'progress' | 'submissions' | 'assessment' | 'bank' | 'exams' | 'settings';

const TABS: Array<{ key: TabKey; label: string; hint: string }> = [
  { key: 'batches',     label: 'Batches',      hint: 'Cohorts the app offers on /film-academy' },
  { key: 'applications',label: 'Applications', hint: 'Decisions drive /film-academy/status' },
  { key: 'tuition',     label: 'Tuition',      hint: 'Plans shown on /film-academy/tuition' },
  { key: 'curriculum',  label: 'Curriculum',   hint: 'Modules, lessons and the week 1-4 assignment timeline' },
  { key: 'progress',    label: 'Progress',     hint: 'Who has sent which part, and who is behind' },
  { key: 'submissions', label: 'Submissions',  hint: 'Grades appear on /film-academy/assignments' },
  { key: 'assessment',  label: 'Import',       hint: 'Stage the 256 MCQ bank (preview → commit as drafts)' },
  { key: 'bank',        label: 'Question Bank',hint: 'SME review queue — approve to make a question exam-eligible' },
  { key: 'exams',       label: 'Exams',        hint: 'Author exams and publish them once the approved pool covers the draw' },
  { key: 'settings',    label: 'Settings',     hint: 'Fees and areas used by the apply form' },
];

/** Academy money is stored in whole NAIRA. Never divide by 100 here. */
function naira(v: number | string | null | undefined): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '—';
  return `₦${n.toLocaleString('en-NG', { maximumFractionDigits: 0 })}`;
}

/** A hook per tab would refetch on every keystroke; one generic loader instead. */
function useAsync<T>(fn: () => Promise<T>, deps: unknown[], enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async () => {
    if (!enabled) return;
    setLoading(true); setError(null);
    try { setData(await fn()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
  useEffect(() => { void run(); }, [run]);
  return { data, loading, error, reload: run };
}

export default function FilmAcademyAdminPage() {
  const [tab, setTab] = useState<TabKey>('batches');
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <Page>
      <PageHeader
        title="Film Academy"
        subtitle="Cohorts, applications, tuition, curriculum and grading for the Spotlight Film Academy."
      />
      <AcademyTabs active="film" />

      <DisclosureNote>
        Everything here is the live data plane the mobile app reads at
        {' '}<code>/film-academy</code>. Approving an application creates its instalment plan and,
        once tuition is settled (or where none is due), unlocks Learn and Assignments on the phone.
        Amounts are whole <strong>naira</strong>, not kobo.
      </DisclosureNote>

      {notice ? (
        <div style={{ ...card(), borderColor: colors.success, color: colors.success, marginBottom: '1rem', fontSize: '0.85rem' }}>
          {notice}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setNotice(null); }}
            title={t.hint}
            style={tab === t.key ? btnPrimary() : btn()}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'batches'      ? <BatchesTab onNotice={setNotice} /> : null}
      {tab === 'applications' ? <ApplicationsTab onNotice={setNotice} /> : null}
      {tab === 'tuition'      ? <TuitionTab onNotice={setNotice} /> : null}
      {tab === 'curriculum'   ? <CurriculumTab onNotice={setNotice} /> : null}
      {tab === 'progress'     ? <ProgressTab onNotice={setNotice} /> : null}
      {tab === 'submissions'  ? <SubmissionsTab onNotice={setNotice} /> : null}
      {tab === 'assessment'   ? <ImportTab onNotice={setNotice} /> : null}
      {tab === 'bank'         ? <QuestionBankTab onNotice={setNotice} /> : null}
      {tab === 'exams'        ? <ExamsTab onNotice={setNotice} /> : null}
      {tab === 'settings'     ? <SettingsTab onNotice={setNotice} /> : null}
    </Page>
  );
}

type NoticeProp = { onNotice: (s: string | null) => void };

const EMPTY_BATCH: svc.BatchInput = {
  batch_name: '', status: 'draft', start_date: '', end_date: '', application_deadline: '',
  capacity: 0, training_fee_ngn: 0, installments_count: 1, fee_frequency: 'monthly',
  one_off_discount_pct: 0, fee_start_offset_days: 0, interest_area_slugs: [],
};

function BatchesTab({ onNotice }: NoticeProp) {
  const batches = useAsync(() => svc.listBatches(), []);
  const areas = useAsync(() => svc.listInterestAreas(), []);
  const [editing, setEditing] = useState<svc.BatchInput | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const openNew = () => { setEditingId(null); setEditing({ ...EMPTY_BATCH }); setFormError(null); };

  const openEdit = async (id: string) => {
    setFormError(null);
    try {
      // Fetch the single batch: the list projection omits interest_area_slugs, and
      // saving from the list shape would silently clear a batch's areas.
      const b = await svc.getBatch(id);
      if (!b) { setFormError('Batch not found.'); return; }
      setEditingId(id);
      setEditing({
        batch_name: b.batch_name ?? '', status: b.status ?? 'draft',
        start_date: b.start_date ?? '', end_date: b.end_date ?? '',
        application_deadline: b.application_deadline ?? '',
        capacity: b.capacity ?? 0, training_fee_ngn: b.training_fee_ngn ?? 0,
        installments_count: b.installments_count ?? 1, fee_frequency: b.fee_frequency ?? 'monthly',
        one_off_discount_pct: b.one_off_discount_pct ?? 0,
        fee_start_offset_days: b.fee_start_offset_days ?? 0,
        interest_area_slugs: b.interest_area_slugs ?? [],
      });
    } catch (e) { setFormError(e instanceof Error ? e.message : String(e)); }
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.batch_name.trim()) { setFormError('A batch name is required.'); return; }
    setSaving(true); setFormError(null);
    try {
      // Dates are optional; send null rather than '' so Postgres stores a real NULL.
      const payload: svc.BatchInput = {
        ...editing,
        start_date: editing.start_date || null,
        end_date: editing.end_date || null,
        application_deadline: editing.application_deadline || null,
      };
      if (editingId) await svc.updateBatch(editingId, payload);
      else await svc.createBatch(payload);
      setEditing(null); setEditingId(null);
      await batches.reload();
      onNotice(`Batch saved. It is now what /film-academy offers on the phone.`);
    } catch (e) { setFormError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Delete the batch "${name}"? Applications attached to it may be affected.`)) return;
    try {
      await svc.deleteBatch(id);
      await batches.reload();
      onNotice('Batch deleted.');
    } catch (e) { onNotice(null); alert(e instanceof Error ? e.message : String(e)); }
  };

  const list = batches.data ?? [];

  return (
    <>
      <Card
        title="Cohorts"
        right={<button style={btnPrimary()} onClick={openNew}>New batch</button>}
      >
        <StateBlock loading={batches.loading} error={batches.error} empty={list.length === 0}
          emptyText="No cohorts yet. Create one — until then the app's Film Academy hub has nothing to offer.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
              <thead><tr>
                <th style={th()}>Batch</th><th style={th()}>Status</th><th style={th()}>Starts</th>
                <th style={th()}>Deadline</th><th style={th()}>Capacity</th>
                <th style={th()}>Instalments</th>
                <th style={th()}>Applications</th><th style={th()} />
              </tr></thead>
              <tbody>
                {list.map((b) => (
                  <tr key={b.id}>
                    <td style={td()}>{b.batch_name}</td>
                    <td style={td()}><Badge status={b.status ?? 'draft'} /></td>
                    <td style={td()}>{fmtDate(b.start_date)}</td>
                    <td style={td()}>{fmtDate(b.application_deadline)}</td>
                    <td style={td()}>{b.capacity ?? '—'}</td>
                    <td style={td()}>{b.installments_count ?? 1} × {b.fee_frequency ?? 'monthly'}</td>
                    <td style={td()}>{b.academy_applications?.[0]?.count ?? 0}</td>
                    <td style={{ ...td(), whiteSpace: 'nowrap' }}>
                      <button style={btn()} onClick={() => void openEdit(b.id)}>Edit</button>{' '}
                      <button style={btnDanger()} onClick={() => void remove(b.id, b.batch_name)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StateBlock>
      </Card>

      {editing ? (
        <Card title={editingId ? 'Edit batch' : 'New batch'}>
          {formError ? <p style={{ color: colors.danger, fontSize: '0.85rem' }}>{formError}</p> : null}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '0.8rem' }}>
            <Field label="Batch name">
              <input style={input()} value={editing.batch_name}
                onChange={(e) => setEditing({ ...editing, batch_name: e.target.value })} />
            </Field>
            <Field label="Status">
              <select style={select()} value={editing.status ?? 'draft'}
                onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                {['draft', 'open', 'closed', 'active', 'completed'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Starts"><input type="date" style={input()} value={editing.start_date ?? ''}
              onChange={(e) => setEditing({ ...editing, start_date: e.target.value })} /></Field>
            <Field label="Ends"><input type="date" style={input()} value={editing.end_date ?? ''}
              onChange={(e) => setEditing({ ...editing, end_date: e.target.value })} /></Field>
            <Field label="Application deadline"><input type="date" style={input()} value={editing.application_deadline ?? ''}
              onChange={(e) => setEditing({ ...editing, application_deadline: e.target.value })} /></Field>
            <Field label="Capacity"><input type="number" min={0} style={input()} value={editing.capacity ?? 0}
              onChange={(e) => setEditing({ ...editing, capacity: Number(e.target.value) })} /></Field>
            <Field label="Instalments"><input type="number" min={1} style={input()} value={editing.installments_count ?? 1}
              onChange={(e) => setEditing({ ...editing, installments_count: Number(e.target.value) })} /></Field>
            <Field label="Frequency">
              <select style={select()} value={editing.fee_frequency ?? 'monthly'}
                onChange={(e) => setEditing({ ...editing, fee_frequency: e.target.value })}>
                {['weekly', 'biweekly', 'monthly', 'termly'].map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </Field>
            <Field label="One-off discount (%)"><input type="number" min={0} max={100} style={input()} value={editing.one_off_discount_pct ?? 0}
              onChange={(e) => setEditing({ ...editing, one_off_discount_pct: Number(e.target.value) })} /></Field>
            <Field label="First instalment offset (days)"><input type="number" min={0} style={input()} value={editing.fee_start_offset_days ?? 0}
              onChange={(e) => setEditing({ ...editing, fee_start_offset_days: Number(e.target.value) })} /></Field>
          </div>

          <div style={{ marginTop: '0.9rem' }}>
            <span style={label()}>Areas of interest offered by this batch</span>
            <p style={{ fontSize: '0.75rem', color: colors.muted, marginTop: 0 }}>
              Leave every box clear to offer <strong>all</strong> active areas — empty means unrestricted, not
              &ldquo;offers nothing&rdquo;. These are the choices the apply form shows on the phone.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {(areas.data ?? []).filter((a) => a.is_active !== false).map((a) => {
                const on = (editing.interest_area_slugs ?? []).includes(a.slug);
                return (
                  <label key={a.id} style={{ ...btn(), display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer', borderColor: on ? colors.primary : undefined }}>
                    <input type="checkbox" checked={on} onChange={(e) => {
                      const cur = new Set(editing.interest_area_slugs ?? []);
                      if (e.target.checked) cur.add(a.slug); else cur.delete(a.slug);
                      setEditing({ ...editing, interest_area_slugs: [...cur] });
                    }} />
                    {a.label}
                  </label>
                );
              })}
              {(areas.data ?? []).length === 0 ? (
                <span style={{ fontSize: '0.8rem', color: colors.muted }}>No areas defined — add them under Settings.</span>
              ) : null}
            </div>
          </div>

          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
            <button style={btnPrimary()} disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save batch'}
            </button>
            <button style={btn()} onClick={() => { setEditing(null); setEditingId(null); }}>Cancel</button>
          </div>
          <AuditNote>Batch changes take effect immediately on the mobile Film Academy hub.</AuditNote>
        </Card>
      ) : null}
    </>
  );
}

function Field({ label: l, children }: { label: string; children: React.ReactNode }) {
  return <div><span style={label()}>{l}</span>{children}</div>;
}

const APP_STATUSES = ['submitted', 'under_review', 'approved', 'rejected', 'waitlisted'];

function ApplicationsTab({ onNotice }: NoticeProp) {
  const batches = useAsync(() => svc.listBatches(), []);
  const [batchId, setBatchId] = useState('');
  const [status, setStatus] = useState('');
  const apps = useAsync(() => svc.listApplications({ batchId: batchId || undefined, status: status || undefined }), [batchId, status]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const decide = async (id: string, next: string) => {
    const verb = next === 'approved' ? 'Approve' : next === 'rejected' ? 'Reject' : 'Update';
    if (!window.confirm(
      next === 'approved'
        ? 'Approve this application? This creates the instalment plan and starts the enrolment — the applicant sees it immediately on their phone.'
        : `${verb} this application?`,
    )) return;
    setBusy(id);
    try {
      await svc.decideApplication(id, { status: next, review_notes: notes[id] || undefined });
      await apps.reload();
      onNotice(next === 'approved'
        ? 'Approved. The instalment plan is created and /film-academy/status now shows the decision.'
        : 'Application updated — the applicant sees the new status on their phone.');
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const list = apps.data ?? [];

  return (
    <Card title="Applications">
      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <span style={label()}>Batch</span>
          <select style={select()} value={batchId} onChange={(e) => setBatchId(e.target.value)}>
            <option value="">All batches</option>
            {(batches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.batch_name}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 180 }}>
          <span style={label()}>Status</span>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {APP_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button style={btn()} onClick={() => void apps.reload()}>Refresh</button>
      </FilterBar>

      <StateBlock loading={apps.loading} error={apps.error} empty={list.length === 0}
        emptyText="No applications match this filter.">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead><tr>
              <th style={th()}>Applicant</th><th style={th()}>Batch</th><th style={th()}>Areas</th>
              <th style={th()}>Status</th><th style={th()}>App. fee paid</th>
              <th style={th()}>Applied</th><th style={th()}>Decision</th>
            </tr></thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id}>
                  <td style={td()}>
                    <div style={{ fontWeight: 600 }}>{a.full_name || '—'}</div>
                    <div style={{ fontSize: '0.75rem', color: colors.muted }}>{a.email}</div>
                    {a.phone ? <div style={{ fontSize: '0.75rem', color: colors.muted }}>{a.phone}</div> : null}
                  </td>
                  <td style={td()}>{a.academy_batches?.batch_name || '—'}</td>
                  <td style={td()}>{(a.areas_of_interest ?? []).join(', ') || '—'}</td>
                  <td style={td()}><Badge status={a.status ?? 'submitted'} /></td>
                  {/* application_fee_paid is NUMERIC (the amount), not a boolean. */}
                  <td style={td()}>{naira(a.application_fee_paid)}</td>
                  <td style={td()}>{fmtDate(a.created_at)}</td>
                  <td style={{ ...td(), minWidth: 260 }}>
                    <input
                      style={{ ...input(), marginBottom: 6 }}
                      placeholder="Review note (optional)"
                      value={notes[a.id] ?? ''}
                      onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })}
                    />
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button style={btnPrimary()} disabled={busy === a.id || a.status === 'approved'}
                        onClick={() => void decide(a.id, 'approved')}>
                        {busy === a.id ? '…' : 'Approve'}
                      </button>
                      <button style={btnDanger()} disabled={busy === a.id || a.status === 'rejected'}
                        onClick={() => void decide(a.id, 'rejected')}>Reject</button>
                      <button style={btn()} disabled={busy === a.id}
                        onClick={() => void decide(a.id, 'under_review')}>Review</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </StateBlock>
      <AuditNote>
        Approving creates the instalment plan and calls enrolment. Where tuition is due, the enrolment
        completes on the FIRST instalment — not the full amount.
      </AuditNote>
    </Card>
  );
}

function TuitionTab({ onNotice }: NoticeProp) {
  const batches = useAsync(() => svc.listBatches(), []);
  const [batchId, setBatchId] = useState('');
  const plans = useAsync(() => svc.listInstallmentPlans({ batchId: batchId || undefined }), [batchId]);
  const [busy, setBusy] = useState<string | null>(null);

  const remind = async (planId: string) => {
    setBusy(planId);
    try {
      await svc.remindInstallmentPlan(planId);
      onNotice('Reminder sent for that plan.');
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const list = plans.data ?? [];

  return (
    <Card title="Tuition plans">
      <FilterBar>
        <div style={{ minWidth: 220 }}>
          <span style={label()}>Batch</span>
          <select style={select()} value={batchId} onChange={(e) => setBatchId(e.target.value)}>
            <option value="">All batches</option>
            {(batches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.batch_name}</option>)}
          </select>
        </div>
        <button style={btn()} onClick={() => void plans.reload()}>Refresh</button>
      </FilterBar>

      <StateBlock loading={plans.loading} error={plans.error} empty={list.length === 0}
        emptyText="No instalment plans yet. A plan is created when an application is approved.">
        <div style={{ display: 'grid', gap: '0.8rem' }}>
          {list.map((p) => {
            const payments = [...(p.academy_installment_payments ?? [])]
              .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
            const paid = payments.filter((x) => x.status === 'paid').length;
            return (
              <div key={p.id} style={card()}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{p.academy_applications?.full_name || 'Applicant'}</div>
                    <div style={{ fontSize: '0.75rem', color: colors.muted }}>{p.academy_applications?.email}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 600 }}>{naira(p.total_amount_ngn)}</div>
                    <div style={{ fontSize: '0.75rem', color: colors.muted }}>
                      {paid}/{payments.length || p.installments_count || 0} paid
                    </div>
                  </div>
                  <div><Badge status={p.status ?? 'pending'} /></div>
                  <button style={btn()} disabled={busy === p.id} onClick={() => void remind(p.id)}>
                    {busy === p.id ? 'Sending…' : 'Send reminder'}
                  </button>
                </div>
                {payments.length > 0 ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.6rem' }}>
                    <thead><tr>
                      <th style={th()}>#</th><th style={th()}>Amount</th>
                      <th style={th()}>Due</th><th style={th()}>Status</th><th style={th()}>Paid</th>
                    </tr></thead>
                    <tbody>
                      {payments.map((pay, i) => (
                        <tr key={pay.id}>
                          <td style={td()}>{pay.sequence ?? i + 1}</td>
                          <td style={td()}>{naira(pay.amount_ngn)}</td>
                          <td style={td()}>{fmtDate(pay.due_date)}</td>
                          <td style={td()}><Badge status={pay.status ?? 'pending'} /></td>
                          <td style={td()}>{fmtDate(pay.paid_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </div>
            );
          })}
        </div>
      </StateBlock>
    </Card>
  );
}

function CurriculumTab({ onNotice }: NoticeProp) {
  const cur = useAsync(() => svc.getCurriculum(), []);
  const [seedBatch, setSeedBatch] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ kind: 'program' | 'module' | 'lesson' | 'assignment' } & Record<string, string>>({ kind: 'program' });

  const data = cur.data;
  const modulesByProgram = useMemo(() => {
    const m: Record<string, svc.AcademyModule[]> = {};
    for (const mod of data?.modules ?? []) (m[mod.program_id] ||= []).push(mod);
    return m;
  }, [data]);
  const lessonsByModule = useMemo(() => {
    const m: Record<string, svc.AcademyLesson[]> = {};
    for (const l of data?.lessons ?? []) (m[l.module_id] ||= []).push(l);
    return m;
  }, [data]);

  const seed = async () => {
    if (!seedBatch) return;
    setBusy(true);
    try {
      await svc.seedCurriculum(seedBatch);
      await cur.reload();
      onNotice('Starter curriculum created — /film-academy/learn now has modules to show.');
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const create = async () => {
    setBusy(true);
    try {
      await svc.saveCurriculum({ ...form });
      await cur.reload();
      onNotice('Curriculum updated — it is live on the learner’s phone.');
      setForm({ kind: form.kind });
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <Card title="Programmes, modules and lessons">
        <StateBlock loading={cur.loading} error={cur.error} empty={(data?.programs ?? []).length === 0}
          emptyText="No programmes yet. Seed a starter curriculum below, or create one — until then Learn is empty on the phone.">
          <div style={{ display: 'grid', gap: '0.7rem' }}>
            {(data?.programs ?? []).map((p) => (
              <div key={p.id} style={card()}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem' }}>
                  <strong>{p.title}</strong>
                  <Badge status={p.is_published ? 'published' : 'draft'} />
                </div>
                {(modulesByProgram[p.id] ?? []).map((m) => (
                  <div key={m.id} style={{ marginTop: '0.5rem', paddingLeft: '0.8rem', borderLeft: `2px solid ${colors.border}` }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                      {m.order_index ?? '—'}. {m.title} <Badge status={m.is_published ? 'published' : 'draft'} />
                    </div>
                    <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1rem', fontSize: '0.8rem', color: colors.muted }}>
                      {(lessonsByModule[m.id] ?? []).map((l) => (
                        <li key={l.id}>{l.title}{l.estimated_minutes ? ` · ${l.estimated_minutes} min` : ''}{l.is_published ? '' : ' · draft'}</li>
                      ))}
                      {(lessonsByModule[m.id] ?? []).length === 0 ? <li>No lessons yet</li> : null}
                    </ul>
                  </div>
                ))}
                {(modulesByProgram[p.id] ?? []).length === 0 ? (
                  <p style={{ fontSize: '0.8rem', color: colors.muted, margin: '0.4rem 0 0' }}>No modules yet.</p>
                ) : null}
              </div>
            ))}
          </div>
        </StateBlock>
      </Card>

      <Card title="Seed a starter curriculum">
        <FilterBar>
          <div style={{ minWidth: 240 }}>
            <span style={label()}>Batch</span>
            <select style={select()} value={seedBatch} onChange={(e) => setSeedBatch(e.target.value)}>
              <option value="">Choose a batch…</option>
              {(data?.batches ?? []).map((b) => <option key={b.id} value={b.id}>{b.batch_name}</option>)}
            </select>
          </div>
          <button style={btnPrimary()} disabled={!seedBatch || busy} onClick={() => void seed()}>
            {busy ? 'Working…' : 'Seed curriculum'}
          </button>
        </FilterBar>
      </Card>

      <PartsEditor assignments={data?.assignments ?? []} onNotice={onNotice} />

      <Card title="Add an item">
        <FilterBar>
          <div style={{ minWidth: 160 }}>
            <span style={label()}>Type</span>
            <select style={select()} value={form.kind}
              onChange={(e) => setForm({ kind: e.target.value as typeof form.kind })}>
              {['program', 'module', 'lesson', 'assignment'].map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 220 }}>
            <span style={label()}>Title</span>
            <input style={input()} value={form.title ?? ''} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          {form.kind === 'program' ? (
            <div style={{ minWidth: 220 }}>
              <span style={label()}>Batch</span>
              <select style={select()} value={form.batch_id ?? ''} onChange={(e) => setForm({ ...form, batch_id: e.target.value })}>
                <option value="">Choose…</option>
                {(data?.batches ?? []).map((b) => <option key={b.id} value={b.id}>{b.batch_name}</option>)}
              </select>
            </div>
          ) : null}
          {form.kind === 'module' ? (
            <div style={{ minWidth: 220 }}>
              <span style={label()}>Programme</span>
              <select style={select()} value={form.program_id ?? ''} onChange={(e) => setForm({ ...form, program_id: e.target.value })}>
                <option value="">Choose…</option>
                {(data?.programs ?? []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
          ) : null}
          {form.kind === 'lesson' ? (
            <div style={{ minWidth: 220 }}>
              <span style={label()}>Module</span>
              <select style={select()} value={form.module_id ?? ''} onChange={(e) => setForm({ ...form, module_id: e.target.value })}>
                <option value="">Choose…</option>
                {(data?.modules ?? []).map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
              </select>
            </div>
          ) : null}
          {form.kind === 'assignment' ? (
            <>
              <div style={{ minWidth: 200 }}>
                <span style={label()}>Programme or batch</span>
                <select style={select()} value={form.program_id ?? ''} onChange={(e) => setForm({ ...form, program_id: e.target.value })}>
                  <option value="">Programme…</option>
                  {(data?.programs ?? []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </div>
              <div style={{ minWidth: 140 }}>
                <span style={label()}>Max score</span>
                <input type="number" min={1} style={input()} value={form.max_score ?? '100'}
                  onChange={(e) => setForm({ ...form, max_score: e.target.value })} />
              </div>
              <div style={{ minWidth: 160 }}>
                <span style={label()}>Due date</span>
                <input type="date" style={input()} value={form.due_date ?? ''}
                  onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
              </div>
            </>
          ) : null}
          <button style={btnPrimary()} disabled={busy || !form.title} onClick={() => void create()}>
            {busy ? 'Saving…' : 'Create'}
          </button>
        </FilterBar>
        <p style={{ fontSize: '0.75rem', color: colors.muted, margin: 0 }}>
          An assignment needs a programme or a batch — with neither it belongs to nobody and no learner
          would ever see it.
        </p>
      </Card>
    </>
  );
}

function SubmissionsTab({ onNotice }: NoticeProp) {
  const [status, setStatus] = useState('');
  const subs = useAsync(() => svc.listSubmissions(status || undefined), [status]);
  const [draft, setDraft] = useState<Record<string, { score?: string; grade?: string; feedback?: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const grade = async (id: string) => {
    const d = draft[id] ?? {};
    setBusy(id);
    try {
      await svc.gradeSubmission({
        submissionId: id,
        score: d.score !== undefined && d.score !== '' ? Number(d.score) : undefined,
        grade: d.grade || undefined,
        feedback: d.feedback || undefined,
      });
      await subs.reload();
      onNotice('Graded — the learner sees the score on /film-academy/assignments.');
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const list = subs.data ?? [];

  return (
    <Card title="Assignment submissions">
      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <span style={label()}>Status</span>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {['submitted', 'graded', 'returned'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button style={btn()} onClick={() => void subs.reload()}>Refresh</button>
      </FilterBar>

      <StateBlock loading={subs.loading} error={subs.error} empty={list.length === 0}
        emptyText="No submissions yet.">
        <div style={{ display: 'grid', gap: '0.7rem' }}>
          {list.map((s) => {
            const d = draft[s.id] ?? {};
            const link = typeof s.submission_link === 'string' ? s.submission_link : '';
            const text = typeof s.submission_text === 'string' ? s.submission_text : '';
            return (
              <div key={s.id} style={card()}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: '0.8rem', color: colors.muted }}>
                    Submitted {fmtDate(s.submitted_at)}
                  </div>
                  <Badge status={s.status ?? 'submitted'} />
                </div>
                {link ? (
                  <p style={{ fontSize: '0.82rem', margin: '0.4rem 0' }}>
                    <a href={link} target="_blank" rel="noreferrer" style={{ color: colors.primary }}>{link}</a>
                  </p>
                ) : null}
                {text ? <p style={{ fontSize: '0.82rem', whiteSpace: 'pre-wrap', margin: '0.4rem 0' }}>{text}</p> : null}
                {s.score != null ? (
                  <p style={{ fontSize: '0.8rem', margin: '0.3rem 0', color: colors.muted }}>
                    Current: {s.score}{s.grade ? ` · ${s.grade}` : ''}
                  </p>
                ) : null}
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '0.4rem' }}>
                  <div style={{ width: 110 }}>
                    <span style={label()}>Score</span>
                    <input type="number" style={input()} value={d.score ?? ''}
                      onChange={(e) => setDraft({ ...draft, [s.id]: { ...d, score: e.target.value } })} />
                  </div>
                  <div style={{ width: 110 }}>
                    <span style={label()}>Grade</span>
                    <input style={input()} value={d.grade ?? ''}
                      onChange={(e) => setDraft({ ...draft, [s.id]: { ...d, grade: e.target.value } })} />
                  </div>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <span style={label()}>Feedback</span>
                    <input style={input()} value={d.feedback ?? ''}
                      onChange={(e) => setDraft({ ...draft, [s.id]: { ...d, feedback: e.target.value } })} />
                  </div>
                  <button style={btnPrimary()} disabled={busy === s.id} onClick={() => void grade(s.id)}>
                    {busy === s.id ? 'Saving…' : 'Save grade'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </StateBlock>
    </Card>
  );
}

// Adding parts is what turns a single-shot assignment into a staged one. An
// assignment with NO parts keeps submitting whole, so this is opt-in per brief
// rather than a change to how every existing assignment behaves.

function PartsEditor({ assignments, onNotice }: NoticeProp & { assignments: svc.AcademyAssignment[] }) {
  const [assignmentId, setAssignmentId] = useState('');
  const parts = useAsync(() => svc.listAssignmentParts(assignmentId), [assignmentId], !!assignmentId);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ title: '', week_number: '1', due_date: '', max_score: '', description: '', is_required: true });

  const add = async () => {
    if (!assignmentId || !draft.title.trim()) return;
    setBusy(true);
    try {
      await svc.createAssignmentPart({
        assignment_id: assignmentId,
        title: draft.title.trim(),
        week_number: Number(draft.week_number) || 1,
        description: draft.description || undefined,
        due_date: draft.due_date || null,
        max_score: draft.max_score === '' ? null : Number(draft.max_score),
        is_required: draft.is_required,
      });
      setDraft({ title: '', week_number: String((Number(draft.week_number) || 1) + 1), due_date: '', max_score: '', description: '', is_required: true });
      await parts.reload();
      onNotice('Part added — it appears on the learner’s assignment as its own week.');
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const remove = async (id: string, title: string) => {
    if (!window.confirm(`Delete part "${title}"? Any submissions learners already made for it are deleted too.`)) return;
    setBusy(true);
    try {
      const n = await svc.deleteAssignmentPart(id);
      await parts.reload();
      onNotice(n > 0 ? `Part deleted, along with ${n} learner submission${n === 1 ? '' : 's'}.` : 'Part deleted.');
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const list = parts.data ?? [];

  return (
    <Card title="Assignment timeline (submit in parts)">
      <p style={{ fontSize: '0.8rem', color: colors.muted, marginTop: 0 }}>
        Break a brief into parts, each due in its own programme week. The learner submits each part
        separately and keeps every one — before this, a single submission row per assignment meant a
        second upload replaced the first. Leave an assignment with no parts to keep it single-shot.
      </p>

      <FilterBar>
        <div style={{ minWidth: 280 }}>
          <span style={label()}>Assignment</span>
          <select style={select()} value={assignmentId} onChange={(e) => setAssignmentId(e.target.value)}>
            <option value="">Choose an assignment…</option>
            {assignments.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
        </div>
      </FilterBar>

      {!assignmentId ? null : (
        <>
          <StateBlock loading={parts.loading} error={parts.error} empty={list.length === 0}
            emptyText="No parts yet — this assignment is submitted whole.">
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '0.8rem' }}>
              <thead><tr>
                <th style={th()}>Week</th><th style={th()}>Part</th><th style={th()}>Title</th>
                <th style={th()}>Due</th><th style={th()}>Max score</th><th style={th()}>Required</th><th style={th()} />
              </tr></thead>
              <tbody>
                {list.map((pt) => (
                  <tr key={pt.id}>
                    <td style={td()}>{pt.week_number}</td>
                    <td style={td()}>{pt.part_number}</td>
                    <td style={td()}>{pt.title}</td>
                    <td style={td()}>{fmtDate(pt.due_date)}</td>
                    <td style={td()}>{pt.max_score ?? '—'}</td>
                    <td style={td()}>{pt.is_required ? 'yes' : 'optional'}</td>
                    <td style={td()}>
                      <button style={btnDanger()} disabled={busy} onClick={() => void remove(pt.id, pt.title)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </StateBlock>

          <FilterBar>
            <div style={{ width: 100 }}>
              <span style={label()}>Week</span>
              <input type="number" min={1} style={input()} value={draft.week_number}
                onChange={(e) => setDraft({ ...draft, week_number: e.target.value })} />
            </div>
            <div style={{ minWidth: 220, flex: 1 }}>
              <span style={label()}>Part title</span>
              <input style={input()} placeholder="e.g. Treatment and logline" value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </div>
            <div style={{ width: 160 }}>
              <span style={label()}>Due</span>
              <input type="date" style={input()} value={draft.due_date}
                onChange={(e) => setDraft({ ...draft, due_date: e.target.value })} />
            </div>
            <div style={{ width: 130 }}>
              <span style={label()}>Max score</span>
              <input type="number" min={1} style={input()} placeholder="blank = none" value={draft.max_score}
                onChange={(e) => setDraft({ ...draft, max_score: e.target.value })} />
            </div>
            <label style={{ ...btn(), display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={draft.is_required}
                onChange={(e) => setDraft({ ...draft, is_required: e.target.checked })} />
              Required
            </label>
            <button style={btnPrimary()} disabled={busy || !draft.title.trim()} onClick={() => void add()}>
              {busy ? 'Saving…' : 'Add part'}
            </button>
          </FilterBar>
          <p style={{ fontSize: '0.75rem', color: colors.muted, margin: 0 }}>
            Leave <strong>max score</strong> blank for a weekly checkpoint that tracks progress without
            its own mark. An optional part shows on the timeline but never counts as missing.
          </p>
        </>
      )}
    </Card>
  );
}

function ProgressTab({ onNotice }: NoticeProp) {
  const batches = useAsync(() => svc.listBatches(), []);
  const [batchId, setBatchId] = useState('');
  const progress = useAsync(() => svc.getAssignmentProgress(batchId), [batchId], !!batchId);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [onlyBehind, setOnlyBehind] = useState(false);

  const learners = useMemo(() => {
    const list = progress.data?.learners ?? [];
    return onlyBehind ? list.filter((l) => l.submitted < l.expected) : list;
  }, [progress.data, onlyBehind]);

  const totals = progress.data?.totals;

  return (
    <>
      <Card title="Cohort progress">
        <FilterBar>
          <div style={{ minWidth: 240 }}>
            <span style={label()}>Batch</span>
            <select style={select()} value={batchId} onChange={(e) => { setBatchId(e.target.value); setExpanded(null); }}>
              <option value="">Choose a batch…</option>
              {(batches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.batch_name}</option>)}
            </select>
          </div>
          <label style={{ ...btn(), display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={onlyBehind} onChange={(e) => setOnlyBehind(e.target.checked)} />
            Only those behind
          </label>
          <button style={btn()} disabled={!batchId} onClick={() => void progress.reload()}>Refresh</button>
        </FilterBar>

        {!batchId ? (
          <p style={{ color: colors.muted, fontSize: '0.85rem' }}>
            Pick a batch to see who has sent which part.
          </p>
        ) : (
          <StateBlock loading={progress.loading} error={progress.error} empty={(progress.data?.learners ?? []).length === 0}
            emptyText="No enrolled learners in this batch yet — progress appears once applications are approved.">
            {totals ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '0.6rem', marginBottom: '1rem' }}>
                <Kpi label="Learners" value={String(totals.learners)} />
                <Kpi label="Submitted" value={`${totals.submitted}/${totals.expected}`} sub={`${totals.completionPct}% complete`} />
                <Kpi label="Graded" value={String(totals.graded)} />
                <Kpi label="Overdue" value={String(totals.overdue)} accent={totals.overdue > 0 ? colors.danger : undefined} />
              </div>
            ) : null}

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                <thead><tr>
                  <th style={th()}>Learner</th><th style={th()}>Progress</th>
                  <th style={th()}>Submitted</th><th style={th()}>Graded</th>
                  <th style={th()}>Overdue</th><th style={th()} />
                </tr></thead>
                <tbody>
                  {learners.map((l) => (
                    <React.Fragment key={l.enrollmentId}>
                      <tr>
                        <td style={td()}>
                          <div style={{ fontWeight: 600 }}>{l.name || '—'}</div>
                          <div style={{ fontSize: '0.75rem', color: colors.muted }}>{l.email}</div>
                        </td>
                        <td style={{ ...td(), minWidth: 160 }}>
                          <Bar value={l.submitted} max={Math.max(l.expected, 1)}
                            color={l.overdue > 0 ? colors.danger : colors.primary}
                            labelRight={`${l.completionPct}%`} />
                        </td>
                        <td style={td()}>{l.submitted}/{l.expected}</td>
                        <td style={td()}>{l.graded}</td>
                        <td style={{ ...td(), color: l.overdue > 0 ? colors.danger : undefined, fontWeight: l.overdue > 0 ? 600 : undefined }}>
                          {l.overdue}
                        </td>
                        <td style={td()}>
                          <button style={btn()} onClick={() => setExpanded(expanded === l.enrollmentId ? null : l.enrollmentId)}>
                            {expanded === l.enrollmentId ? 'Hide' : 'Detail'}
                          </button>
                        </td>
                      </tr>
                      {expanded === l.enrollmentId ? (
                        <tr>
                          <td style={{ ...td(), background: colors.bg }} colSpan={6}>
                            <div style={{ display: 'grid', gap: '0.5rem' }}>
                              {l.items.map((it) => (
                                <div key={it.assignmentId} style={{ ...card(), padding: '0.7rem' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap' }}>
                                    <strong style={{ fontSize: '0.85rem' }}>
                                      {it.weekNumber ? `Week ${it.weekNumber} · ` : ''}{it.title}
                                    </strong>
                                    <span style={{ fontSize: '0.78rem', color: colors.muted }}>
                                      {it.staged ? `${it.submitted}/${it.expected} parts` : it.submitted ? 'submitted' : 'not sent'}
                                    </span>
                                  </div>
                                  {it.staged ? (
                                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.4rem' }}>
                                      <thead><tr>
                                        <th style={th()}>Week</th><th style={th()}>Part</th>
                                        <th style={th()}>Due</th><th style={th()}>State</th><th style={th()}>Score</th>
                                      </tr></thead>
                                      <tbody>
                                        {it.parts.map((pt) => (
                                          <tr key={pt.partId}>
                                            <td style={td()}>{pt.weekNumber}</td>
                                            <td style={td()}>{pt.partNumber}. {pt.title}</td>
                                            <td style={td()}>{fmtDate(pt.dueDate)}</td>
                                            <td style={td()}>
                                              {pt.graded ? <Badge status="graded" label="graded" />
                                                : pt.submitted ? <Badge status="submitted" label="submitted" />
                                                : pt.overdue ? <Badge status="failed" label="overdue" />
                                                : <Badge status="pending" label="not sent" />}
                                            </td>
                                            <td style={td()}>{pt.score ?? '—'}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </StateBlock>
        )}
      </Card>
    </>
  );
}

function SettingsTab({ onNotice }: NoticeProp) {
  const settings = useAsync(() => svc.getSettings(), []);
  const areas = useAsync(() => svc.listInterestAreas(), []);
  const [form, setForm] = useState<svc.AcademySettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [newArea, setNewArea] = useState({ label: '' });

  useEffect(() => { if (settings.data) setForm(settings.data); }, [settings.data]);

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      await svc.updateSettings({
        registration_type: form.registration_type,
        application_fee: Number(form.application_fee) || 0,
        application_fee_refundable: !!form.application_fee_refundable,
        tuition_fee: Number(form.tuition_fee) || 0,
      });
      await settings.reload();
      onNotice('Settings saved — the apply form on the phone uses these immediately.');
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const addArea = async () => {
    if (!newArea.label.trim()) return;
    setBusy(true);
    try {
      await svc.createInterestArea({ label: newArea.label.trim(), fee_ngn: 0 });
      setNewArea({ label: '' });
      await areas.reload();
      onNotice('Area added — it now appears in the app’s apply form.');
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  // Options per area id (all, incl. inactive). Loaded up front for every area so the
  // row summary ("from ₦X") is right without expanding.
  const [optionsByArea, setOptionsByArea] = useState<Record<string, svc.AcademyAreaOption[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const areaList = areas.data;
  useEffect(() => {
    if (!areaList) return;
    let cancelled = false;
    void (async () => {
      try {
        const lists = await Promise.all(areaList.map((a) => svc.listAreaOptions(a.id)));
        if (cancelled) return;
        const next: Record<string, svc.AcademyAreaOption[]> = {};
        areaList.forEach((a, i) => { next[a.id] = lists[i]; });
        setOptionsByArea(next);
      } catch (e) {
        if (!cancelled) onNotice(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaList]);
  const reloadOptions = async (areaId: string) => {
    const list = await svc.listAreaOptions(areaId);
    setOptionsByArea((m) => ({ ...m, [areaId]: list }));
  };

  const toggleArea = async (a: svc.AcademyInterestArea) => {
    setBusy(true);
    try {
      await svc.updateInterestArea({ id: a.id, is_active: !a.is_active });
      await areas.reload();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <Card title="Fees">
        <StateBlock loading={settings.loading} error={settings.error} empty={!form}>
          {form ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '0.8rem' }}>
                <Field label="Registration type">
                  <select style={select()} value={form.registration_type}
                    onChange={(e) => setForm({ ...form, registration_type: e.target.value })}>
                    {['free', 'paid'].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="Application fee (₦)">
                  <input type="number" min={0} style={input()} value={form.application_fee}
                    onChange={(e) => setForm({ ...form, application_fee: Number(e.target.value) })} />
                </Field>
                <Field label="Application fee refundable">
                  <select style={select()} value={form.application_fee_refundable ? 'yes' : 'no'}
                    onChange={(e) => setForm({ ...form, application_fee_refundable: e.target.value === 'yes' })}>
                    <option value="no">no</option><option value="yes">yes</option>
                  </select>
                </Field>
              </div>
              <div style={{ marginTop: '0.9rem' }}>
                <button style={btnPrimary()} disabled={busy} onClick={() => void save()}>
                  {busy ? 'Saving…' : 'Save settings'}
                </button>
              </div>
              <AuditNote>Amounts are whole naira, as stored by the academy tables — not kobo.</AuditNote>
            </>
          ) : null}
        </StateBlock>
      </Card>

      <Card title="Areas of interest">
        <p style={{ fontSize: '0.8rem', color: colors.muted, marginTop: 0 }}>
          These are the specialisations the apply form offers. Tuition is set per option under each
          area (a schedule, with a price without boarding and optionally one with boarding). An area
          with no active options is shown to applicants as &quot;Pricing coming soon&quot; and cannot be
          chosen. The slug is what the application row stores, so renaming a label is safe but the
          slug is the contract.
        </p>
        <FilterBar>
          <div style={{ minWidth: 240 }}>
            <span style={label()}>New area</span>
            <input style={input()} placeholder="e.g. Cinematography" value={newArea.label}
              onChange={(e) => setNewArea({ ...newArea, label: e.target.value })} />
          </div>
          <button style={btnPrimary()} disabled={busy || !newArea.label.trim()} onClick={() => void addArea()}>Add</button>
        </FilterBar>

        <StateBlock loading={areas.loading} error={areas.error} empty={(areas.data ?? []).length === 0}
          emptyText="No areas yet — the apply form will show none until you add them.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()} /><th style={th()}>Label</th><th style={th()}>Slug</th>
              <th style={th()}>Pricing</th><th style={th()}>Active</th><th style={th()} />
            </tr></thead>
            <tbody>
              {(areas.data ?? []).map((a) => {
                const opts = optionsByArea[a.id];
                const activeOpts = (opts ?? []).filter((o) => o.is_active);
                const from = activeOpts.length
                  ? Math.min(...activeOpts.map((o) => o.price_no_boarding_ngn)) : null;
                const open = !!expanded[a.id];
                return (
                  <React.Fragment key={a.id}>
                    <tr>
                      <td style={td()}>
                        <button style={btn()} aria-expanded={open}
                          aria-label={`${open ? 'Collapse' : 'Expand'} ${a.label} options`}
                          onClick={() => setExpanded((m) => ({ ...m, [a.id]: !m[a.id] }))}>
                          {open ? '▾' : '▸'}
                        </button>
                      </td>
                      <td style={td()}>{a.label}</td>
                      <td style={td()}><code style={{ fontSize: '0.78rem' }}>{a.slug}</code></td>
                      <td style={td()}>
                        {opts === undefined ? (
                          <span style={{ color: colors.muted }}>…</span>
                        ) : from === null ? (
                          <span style={{ color: colors.muted }}>No options yet</span>
                        ) : (
                          <span>from {naira(from)} · {opts.length} option{opts.length === 1 ? '' : 's'}</span>
                        )}
                      </td>
                      <td style={td()}><Badge status={a.is_active ? 'active' : 'draft'} label={a.is_active ? 'active' : 'inactive'} /></td>
                      <td style={td()}>
                        <button style={btn()} disabled={busy} onClick={() => void toggleArea(a)}>
                          {a.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td style={td()} />
                        <td style={td()} colSpan={5}>
                          <AreaOptionsEditor area={a} options={opts ?? []}
                            onChanged={() => reloadOptions(a.id)} onNotice={onNotice} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </>
  );
}

/** Whole non-negative naira from an input string, or null when blank/invalid.
 *  Callers additionally require > 0 for option prices. */
function parseNaira(s: string): number | null {
  const t = s.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

type OptionDraft = { label: string; duration: string; noBoarding: string; withBoarding: string; active: boolean };

/** Returns the request fields when the draft is valid, else a short hint. */
function validateOptionDraft(d: OptionDraft):
  | { ok: true; label: string; duration_label: string | null; no: number; with: number | null }
  | { ok: false; hint: string } {
  if (!d.label.trim()) return { ok: false, hint: 'Schedule label is required.' };
  const no = parseNaira(d.noBoarding);
  // Zero is not "free": a zero tuition total falls back to the batch fee in the
  // tuition services, so a ₦0 option would bill the wrong amount. The server and
  // a DB CHECK enforce the same rule.
  if (no === null || no <= 0) {
    return { ok: false, hint: 'Enter a whole-naira price without boarding, greater than ₦0.' };
  }
  let withB: number | null = null;
  if (d.withBoarding.trim() !== '') {
    withB = parseNaira(d.withBoarding);
    if (withB === null || withB <= 0) {
      return { ok: false, hint: 'Boarding price must be a whole number greater than ₦0 (or blank).' };
    }
    if (withB < no) return { ok: false, hint: 'Boarding price cannot be lower than the no-boarding price.' };
  }
  return { ok: true, label: d.label.trim(), duration_label: d.duration.trim() || null, no, with: withB };
}

function AreaOptionsEditor({ area, options, onChanged, onNotice }: {
  area: svc.AcademyInterestArea;
  options: svc.AcademyAreaOption[];
  onChanged: () => Promise<void>;
  onNotice: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const blank: OptionDraft = { label: '', duration: '', noBoarding: '', withBoarding: '', active: true };
  const [adding, setAdding] = useState<OptionDraft>(blank);
  const [drafts, setDrafts] = useState<Record<string, OptionDraft>>({});

  const draftOf = (o: svc.AcademyAreaOption): OptionDraft => drafts[o.id] ?? {
    label: o.label, duration: o.duration_label ?? '', noBoarding: String(o.price_no_boarding_ngn),
    withBoarding: o.price_with_boarding_ngn === null ? '' : String(o.price_with_boarding_ngn),
    active: o.is_active,
  };
  const isDirty = (o: svc.AcademyAreaOption) => {
    const d = drafts[o.id];
    if (!d) return false;
    const v = validateOptionDraft(d);
    return !v.ok || v.label !== o.label || v.duration_label !== o.duration_label || v.no !== o.price_no_boarding_ngn
      || v.with !== o.price_with_boarding_ngn || d.active !== o.is_active;
  };

  const saveOption = async (o: svc.AcademyAreaOption) => {
    const v = validateOptionDraft(draftOf(o));
    if (!v.ok) return;
    setBusy(true);
    try {
      await svc.updateAreaOption({
        id: o.id, label: v.label, duration_label: v.duration_label,
        price_no_boarding_ngn: v.no, price_with_boarding_ngn: v.with, is_active: draftOf(o).active,
      });
      setDrafts(({ [o.id]: _gone, ...rest }) => rest);
      await onChanged();
      onNotice(`${area.label} — option “${v.label}” saved.`);
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const addOption = async () => {
    const v = validateOptionDraft(adding);
    if (!v.ok) return;
    setBusy(true);
    try {
      const nextSort = options.reduce((m, o) => Math.max(m, o.sort_order ?? 0), 0) + 10;
      await svc.createAreaOption({
        area_id: area.id, label: v.label, duration_label: v.duration_label,
        price_no_boarding_ngn: v.no, price_with_boarding_ngn: v.with,
        is_active: adding.active, sort_order: nextSort,
      });
      setAdding(blank);
      await onChanged();
      onNotice(`${area.label} — option “${v.label}” added.`);
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const rows: Array<{ key: string; o: svc.AcademyAreaOption | null; d: OptionDraft; set: (n: OptionDraft) => void }> = [
    ...options.map((o) => ({ key: o.id, o, d: draftOf(o), set: (n: OptionDraft) => setDrafts((m) => ({ ...m, [o.id]: n })) })),
    { key: '__new', o: null, d: adding, set: setAdding },
  ];

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <th style={th()}>Schedule</th><th style={th()}>Duration</th>
          <th style={th()}>Price without boarding (₦)</th>
          <th style={th()}>Price with boarding (₦, blank = not offered)</th>
          <th style={th()}>Active</th><th style={th()} />
        </tr></thead>
        <tbody>
          {rows.map(({ key, o, d, set }) => {
            const v = validateOptionDraft(d);
            // Stay quiet on an untouched "add" row; always explain a bad edit.
            const hint = !v.ok && (o !== null || d.label || d.noBoarding || d.withBoarding) ? v.hint : null;
            const canSave = v.ok && !busy && (o === null || isDirty(o));
            return (
              <tr key={key}>
                <td style={td()}>
                  <input style={input()} aria-label="Schedule" placeholder={o ? undefined : 'e.g. Weekdays'}
                    value={d.label} onChange={(e) => set({ ...d, label: e.target.value })} />
                </td>
                <td style={td()}>
                  <input style={input()} aria-label="Duration" placeholder={o ? undefined : 'e.g. 12 weeks'}
                    value={d.duration} onChange={(e) => set({ ...d, duration: e.target.value })} />
                </td>
                <td style={td()}>
                  <input type="number" min={1} step={1} style={{ ...input(), width: 140 }}
                    aria-label="Price without boarding" value={d.noBoarding}
                    onChange={(e) => set({ ...d, noBoarding: e.target.value })} />
                </td>
                <td style={td()}>
                  <input type="number" min={1} step={1} style={{ ...input(), width: 140 }}
                    aria-label="Price with boarding" placeholder="not offered" value={d.withBoarding}
                    onChange={(e) => set({ ...d, withBoarding: e.target.value })} />
                </td>
                <td style={td()}>
                  <input type="checkbox" aria-label="Active" checked={d.active}
                    onChange={(e) => set({ ...d, active: e.target.checked })} />
                </td>
                <td style={td()}>
                  <button style={btnPrimary()} disabled={!canSave}
                    onClick={() => void (o ? saveOption(o) : addOption())}>
                    {o ? 'Save' : 'Add option'}
                  </button>
                  {hint ? <div style={{ fontSize: '0.72rem', color: colors.muted, marginTop: 4 }}>{hint}</div> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {options.length === 0 ? (
        <p style={{ fontSize: '0.78rem', color: colors.muted, margin: '0.5rem 0 0' }}>
          No options yet — add one below; applicants cannot choose this area until it has an active option.
        </p>
      ) : null}
    </div>
  );
}

// ── ASSESSMENT: question-bank import, SME review, exams ─────────────────────
// The whole plane is behind FEATURE_FILM_ACADEMY_ASSESSMENT_ENABLED on the web
// app; with it off every call here 503s, which the call() helper surfaces as a
// plain error message. Import stages drafts only — a question becomes exam-
// eligible ONLY via an approve here (scores:manage), so the 256 starter MCQs
// never reach a learner unreviewed.

const FILM_STAGES = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'];

/** Read a picked .csv file into text. */
function readFileAsText(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result ?? ''));
    r.onerror = () => rej(new Error('Could not read that file'));
    r.readAsText(file);
  });
}

function ImportTab({ onNotice }: NoticeProp) {
  const [filename, setFilename] = useState('assessment-bank.csv');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<svc.FilmImportPreview | null>(null);
  const [busy, setBusy] = useState<null | 'preview' | 'commit'>(null);
  const [error, setError] = useState<string | null>(null);

  const onPick = async (f: File | undefined) => {
    if (!f) return;
    setFilename(f.name); setError(null);
    try { setCsv(await readFileAsText(f)); setPreview(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const runPreview = async () => {
    if (!csv.trim()) { setError('Choose a CSV file (or paste its text) first.'); return; }
    setBusy('preview'); setError(null);
    try { setPreview(await svc.previewQuestionImport(filename, csv)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setPreview(null); }
    finally { setBusy(null); }
  };

  const runCommit = async () => {
    if (!csv.trim()) return;
    if (!window.confirm(
      'Commit these rows as DRAFT questions?\n\nImporting NEVER approves a question and NEVER auto-publishes — every row lands as a draft in the review queue.',
    )) return;
    setBusy('commit'); setError(null);
    try {
      const r = await svc.commitQuestionImport(filename, csv);
      const c = r.committed;
      onNotice(`Imported ${c.inserted} new, updated ${c.updated}, unchanged ${c.unchanged}; ${c.locked} approved item(s) left untouched.`);
      setPreview(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  return (
    <>
      <Card title="Import the question bank" right={
        <span style={{ fontSize: '0.75rem', color: colors.muted }}>CSV · one row per MCQ</span>
      }>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.75rem' }}>
          <input type="file" accept=".csv,text/csv" onChange={(e) => void onPick(e.target.files?.[0])} />
          <input style={{ ...input(), maxWidth: 260 }} value={filename}
            onChange={(e) => setFilename(e.target.value)} aria-label="filename" />
        </div>
        <textarea
          style={{ ...input(), minHeight: 120, fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem', whiteSpace: 'pre' }}
          value={csv}
          onChange={(e) => { setCsv(e.target.value); setPreview(null); }}
          placeholder="…or paste the CSV text here"
        />
        {error ? <p style={{ color: colors.danger, fontSize: '0.85rem' }}>{error}</p> : null}
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
          <button style={btn()} disabled={busy !== null || !csv.trim()} onClick={() => void runPreview()}>
            {busy === 'preview' ? 'Previewing…' : 'Preview'}
          </button>
          <button style={btnPrimary()} disabled={busy !== null || !csv.trim() || !preview} onClick={() => void runCommit()}>
            {busy === 'commit' ? 'Committing…' : 'Commit as drafts'}
          </button>
        </div>
        <AuditNote>
          A preview records an uncommitted batch and changes nothing. Commit re-validates the CSV on the server
          (it never trusts this browser’s counts) and is idempotent: a repeat import of identical rows updates
          matching drafts and leaves any approved/retired question untouched.
        </AuditNote>
      </Card>

      {preview ? (
        <Card title="Preview">
          <div style={{ display: 'flex', gap: '0.9rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <Kpi label="Rows" value={String(preview.totals.rows)} />
            <Kpi label="Valid" value={String(preview.totals.accepted)} accent={colors.success} />
            <Kpi label="Rejected" value={String(preview.totals.rejected)} accent={preview.totals.rejected ? colors.danger : colors.muted} />
            <Kpi label="Warnings" value={String(preview.totals.warned)} accent={colors.muted} />
          </div>

          {preview.rejected.length > 0 ? (
            <>
              <h3 style={{ fontSize: '0.85rem', margin: '0.5rem 0' }}>Rejected rows (fix &amp; re-import)</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th()}>Row</th><th style={th()}>Question ID</th><th style={th()}>Problem</th></tr></thead>
                  <tbody>
                    {preview.rejected.map((p, i) => (
                      <tr key={i}><td style={td()}>{p.row}</td><td style={td()}>{p.externalCode ?? '—'}</td><td style={td()}>{p.message}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {preview.warned.length > 0 ? (
            <details style={{ marginTop: '0.75rem' }}>
              <summary style={{ fontSize: '0.82rem', cursor: 'pointer' }}>{preview.warned.length} warning(s)</summary>
              <ul style={{ fontSize: '0.78rem', color: colors.muted }}>
                {preview.warned.map((p, i) => <li key={i}>Row {p.row}: {p.message}</li>)}
              </ul>
            </details>
          ) : null}
        </Card>
      ) : null}
    </>
  );
}

function QuestionBankTab({ onNotice }: NoticeProp) {
  const [status, setStatus] = useState('');
  const [stage, setStage] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const list = useAsync(
    () => svc.listQuestions({ status: status || undefined, stage: stage || undefined, q: q || undefined, page, pageSize: 25 }),
    [status, stage, q, page, reloadKey],
  );

  const act = async (id: string, decision: string, done: string) => {
    setBusy(id);
    try {
      await svc.reviewQuestion(id, decision, '');
      onNotice(done);
      setReloadKey((k) => k + 1);
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const rows = list.data?.questions ?? [];
  const total = list.data?.total ?? 0;
  const hasMore = list.data?.hasMore ?? false;

  return (
    <>
      <Card title="Question bank &amp; SME review">
        <FilterBar>
          <select style={select()} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Any status</option>
            <option value="draft">draft</option>
            <option value="review">review</option>
            <option value="approved">approved</option>
            <option value="retired">retired</option>
          </select>
          <select style={select()} value={stage} onChange={(e) => { setStage(e.target.value); setPage(1); }}>
            <option value="">Any stage</option>
            {FILM_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input style={input()} placeholder="Search stem or Question ID" value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </FilterBar>

        <StateBlock loading={list.loading} error={list.error} empty={rows.length === 0}
          emptyText="No questions match. Import the bank first (Import tab).">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead><tr>
                <th style={th()}>Question ID</th><th style={th()}>Stage</th><th style={th()}>Module</th>
                <th style={th()}>Stem</th><th style={th()}>Status</th><th style={th()} />
              </tr></thead>
              <tbody>
                {rows.map((row) => {
                  const isOpen = openId === row.id;
                  const editable = row.status === 'draft' || row.status === 'review';
                  return (
                    <React.Fragment key={row.id}>
                      <tr style={{ cursor: 'pointer' }} onClick={() => setOpenId(isOpen ? null : row.id)}>
                        <td style={td()}><code style={{ fontSize: '0.75rem' }}>{row.external_code}</code></td>
                        <td style={td()}>{row.film_stage}</td>
                        <td style={td()}>{row.film_module_code}</td>
                        <td style={{ ...td(), maxWidth: 360 }}>{row.stem}</td>
                        <td style={td()}><Badge status={row.status} /></td>
                        <td style={{ ...td(), whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                          {editable ? (
                            <button style={btnPrimary()} disabled={busy === row.id}
                              onClick={() => void act(row.id, 'approve', 'Approved — the question is now exam-eligible.')}>
                              Approve
                            </button>
                          ) : null}
                          {row.status === 'approved' ? (
                            <button style={btnDanger()} disabled={busy === row.id}
                              onClick={() => void act(row.id, 'suspend', 'Suspended — withdrawn from future draws.')}>
                              Suspend
                            </button>
                          ) : null}
                          {row.status === 'retired' ? (
                            <button style={btn()} disabled={busy === row.id}
                              onClick={() => void act(row.id, 'reactivate', 'Reactivated — approved again.')}>
                              Reactivate
                            </button>
                          ) : null}
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr><td colSpan={6} style={{ ...td(), backgroundColor: 'rgba(128,128,128,0.06)' }}>
                          <QuestionDetail row={row} onNotice={onNotice} onSaved={() => setReloadKey((k) => k + 1)} />
                        </td></tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.6rem', fontSize: '0.8rem', color: colors.muted }}>
            <span>Page {page} · {total} matching</span>
            <span>
              <button style={btn()} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>{' '}
              <button style={btn()} disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>Next</button>
            </span>
          </div>
        </StateBlock>
        <AuditNote>
          Approving requires the reviewer capability (scores:manage), separate from the import/authoring
          capability (programs:manage) — separation of duties. An approved question is content-locked; to
          change it, reimport a corrected row (which creates a new version rather than mutating an examined one).
        </AuditNote>
      </Card>
    </>
  );
}

/** Expanded view of one bank row: content, the correct answer, review history, and
 * (for a draft) an in-place editor. */
function QuestionDetail({ row, onNotice, onSaved }: { row: svc.FilmQuestion; onNotice: (s: string | null) => void; onSaved: () => void }) {
  const [detail, setDetail] = useState<{ question: svc.FilmQuestion; reviews: svc.FilmReview[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const editable = row.status === 'draft' || row.status === 'review';
  const [stem, setStem] = useState(row.stem);
  const [opts, setOpts] = useState(row.options);
  const [correct, setCorrect] = useState(row.answer?.correct?.[0] ?? '');
  const [points, setPoints] = useState(String(row.film_points ?? 1));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    svc.getQuestion(row.id).then((d) => { if (alive) setDetail(d); })
      .catch(() => { if (alive) setDetail(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [row.id]);

  const save = async () => {
    setBusy(true);
    try {
      await svc.editQuestion({ id: row.id, stem, options: opts, correctOptionIds: correct ? [correct] : [], points: Number(points) || 1 });
      onNotice('Draft updated.');
      onSaved();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      <div style={{ fontSize: '0.75rem', color: colors.muted }}>
        Dept {row.film_department ?? '—'} · Outcome {row.film_learning_outcome ?? '—'} · Cognitive {row.film_cognitive ?? '—'} · Difficulty {row.film_difficulty ?? '—'} · v{row.source_version ?? '—'}
      </div>

      {editable ? (
        <>
          <Field label="Stem">
            <textarea style={{ ...input(), minHeight: 60 }} value={stem} onChange={(e) => setStem(e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            {opts.map((o, i) => (
              <div key={o.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="radio" name={`correct-${row.id}`} checked={correct === o.id} onChange={() => setCorrect(o.id)} />
                <span style={{ width: 14, fontWeight: 700 }}>{String.fromCharCode(65 + i)}</span>
                <input style={input()} value={o.text}
                  onChange={(e) => setOpts((prev) => prev.map((p, j) => (j === i ? { ...p, text: e.target.value } : p)))} />
              </div>
            ))}
          </div>
          <Field label="Points">
            <input type="number" min={1} style={{ ...input(), width: 100 }} value={points} onChange={(e) => setPoints(e.target.value)} />
          </Field>
          <div><button style={btnPrimary()} disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save draft'}</button></div>
        </>
      ) : (
        <>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.82rem' }}>
            {opts.map((o) => (
              <li key={o.id} style={{ fontWeight: correct === o.id ? 700 : 400 }}>
                {o.text}{detail?.question.answer?.correct?.includes(o.id) ? '  ✓ correct' : ''}
              </li>
            ))}
          </ul>
        </>
      )}

      {detail?.question?.answer?.explanation ? (
        <div style={{ fontSize: '0.78rem', color: colors.muted }}><strong>Explanation:</strong> {detail.question.answer.explanation}</div>
      ) : null}

      {loading ? <div style={{ fontSize: '0.8rem', color: colors.muted }}>Loading review history…</div> : null}
      {detail && detail.reviews.length > 0 ? (
        <div style={{ fontSize: '0.76rem' }}>
          <strong>Review history</strong>
          <ul style={{ margin: '0.2rem 0 0', paddingLeft: '1.1rem', color: colors.muted }}>
            {detail.reviews.map((rv) => (
              <li key={rv.id}>{rv.decision}: {rv.from_status ?? '—'} → {rv.to_status ?? '—'} · {fmtDate(rv.created_at)}{rv.note ? ` · ${rv.note}` : ''}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ExamsTab({ onNotice }: NoticeProp) {
  const curriculum = useAsync(() => svc.getCurriculum(), []);
  const exams = useAsync(() => svc.listExams(), [], true);
  const programs = curriculum.data?.programs ?? [];
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => { void exams.reload(); /* re-run when reloadKey changes */ }, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const [form, setForm] = useState({
    program_id: '', title: '', description: '', kind: 'stage_exam',
    draw_stage: 'L1', draw_module_codes: '', draw_count: '10',
    pass_mark: '70', time_limit_minutes: '30', max_attempts: '1',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const create = async () => {
    if (!form.program_id || !form.title.trim()) { setError('Choose a programme and give the exam a title.'); return; }
    setSaving(true); setError(null);
    try {
      await svc.createExam({
        program_id: form.program_id,
        title: form.title.trim(),
        description: form.description || null,
        kind: form.kind,
        draw_stage: form.draw_stage || null,
        draw_module_codes: form.draw_module_codes.split(',').map((s) => s.trim()).filter(Boolean),
        draw_count: Number(form.draw_count) || 10,
        pass_mark: Number(form.pass_mark),
        time_limit_minutes: Number(form.time_limit_minutes) || 30,
        max_attempts: Number(form.max_attempts) || 1,
      });
      setForm((f) => ({ ...f, title: '', description: '' }));
      setReloadKey((k) => k + 1);
      onNotice('Exam created (unpublished). Publish it once its approved pool covers the draw.');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };

  const publish = async (id: string) => {
    setBusy(id);
    try { await svc.publishExam(id); onNotice('Published.'); setReloadKey((k) => k + 1); }
    catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const rows = exams.data ?? [];

  return (
    <>
      <Card title="Author an exam">
        {error ? <p style={{ color: colors.danger, fontSize: '0.85rem' }}>{error}</p> : null}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '0.8rem' }}>
          <Field label="Programme">
            <select style={select()} value={form.program_id} onChange={(e) => setForm({ ...form, program_id: e.target.value })}>
              <option value="">Choose…</option>
              {programs.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </Field>
          <Field label="Title"><input style={input()} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Kind">
            <select style={select()} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="practice">practice</option>
              <option value="checkpoint">checkpoint</option>
              <option value="stage_exam">stage exam</option>
            </select>
          </Field>
          <Field label="Draw stage">
            <select style={select()} value={form.draw_stage} onChange={(e) => setForm({ ...form, draw_stage: e.target.value })}>
              {FILM_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Module codes (comma, optional)"><input style={input()} value={form.draw_module_codes}
            placeholder="FM01, FM02" onChange={(e) => setForm({ ...form, draw_module_codes: e.target.value })} /></Field>
          <Field label="Questions to draw"><input type="number" min={1} style={input()} value={form.draw_count} onChange={(e) => setForm({ ...form, draw_count: e.target.value })} /></Field>
          <Field label="Pass mark (%)"><input type="number" min={0} max={100} style={input()} value={form.pass_mark} onChange={(e) => setForm({ ...form, pass_mark: e.target.value })} /></Field>
          <Field label="Time limit (min)"><input type="number" min={1} style={input()} value={form.time_limit_minutes} onChange={(e) => setForm({ ...form, time_limit_minutes: e.target.value })} /></Field>
          <Field label="Max attempts"><input type="number" min={1} style={input()} value={form.max_attempts} onChange={(e) => setForm({ ...form, max_attempts: e.target.value })} /></Field>
        </div>
        <Field label="Description">
          <textarea style={{ ...input(), minHeight: 50 }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div style={{ marginTop: '0.75rem' }}>
          <button style={btnPrimary()} disabled={saving} onClick={() => void create()}>{saving ? 'Creating…' : 'Create exam'}</button>
        </div>
      </Card>

      <Card title="Exams">
        <StateBlock loading={exams.loading} error={exams.error} empty={rows.length === 0}
          emptyText="No exams yet. Author one above — it starts unpublished.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
              <thead><tr>
                <th style={th()}>Title</th><th style={th()}>Kind</th><th style={th()}>Draw</th>
                <th style={th()}>Pass</th><th style={th()}>Limit</th><th style={th()}>State</th><th style={th()} />
              </tr></thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.id}>
                    <td style={td()}>{x.title}</td>
                    <td style={td()}>{x.kind}</td>
                    <td style={td()}>{x.draw_stage ?? '—'}{x.draw_module_codes?.length ? ` · ${x.draw_module_codes.join(', ')}` : ''} · {x.draw_count ?? 0}q</td>
                    <td style={td()}>{x.pass_mark}%</td>
                    <td style={td()}>{x.time_limit_minutes}m · {x.max_attempts}×</td>
                    <td style={td()}><Badge status={x.is_published ? 'approved' : 'draft'} label={x.is_published ? 'published' : 'unpublished'} /></td>
                    <td style={{ ...td(), whiteSpace: 'nowrap' }}>
                      {x.is_published ? (
                        <button style={btn()} disabled={busy === x.id} onClick={() => void (async () => {
                          setBusy(x.id); try { await svc.unpublishExam(x.id); setReloadKey((k) => k + 1); }
                          catch (e) { alert(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
                        })()}>Unpublish</button>
                      ) : (
                        <button style={btnPrimary()} disabled={busy === x.id} onClick={() => void publish(x.id)}>Publish</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StateBlock>
        <AuditNote>
          Publishing runs a server-side pool preflight: an exam only goes live when its draw stage (and optional
          module restriction) has at least as many APPROVED questions as its draw count. If it fails, the reason —
          the exact shortfall — is shown; approve more questions or lower the count.
        </AuditNote>
      </Card>
    </>
  );
}
