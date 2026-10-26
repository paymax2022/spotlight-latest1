'use client';

// The working console for the Spotlight Film Academy, replacing the BRIDGE that
// used to sit here.
// The bridge shipped four links to /admin/film-academy on the web app. Those
// pages were removed when the admin portal was consolidated into this console,
// so every link went to a login redirect and then nowhere — the section looked
// present and did nothing. The API behind them was never removed, so the screens
// belong here now, against that same API.
// The course tabs are TMFA ONLY. The old modules/lessons course, its module
// quizzes and its assignments are retired from the learner app; their historical
// rows are preserved and are not edited or deleted here.
//
//   Batches / Areas / Settings  → mobile GET /api/academy/apply       (hub, apply)
//   Applications (decide)       → mobile GET /api/academy/application (status)
//   Tuition plans               → mobile GET /api/academy/installments(tuition)
//   Topics (TMFA)               → /api/admin/academy/topics* and the mobile
//                                 /film-academy/path, topic, practical and
//                                 certificate screens
// convention). So `formatNaira` from ../_ui is deliberately NOT used here — it
// divides by 100 and would render ₦150,000 as ₦1,500. `naira()` below formats
// the values as stored.

import React, { useCallback, useEffect, useState } from 'react';
import { Page, colors } from '@/components/ui/vuexy';
import {
  AcademyTabs, Card, PageHeader, Badge, StateBlock, FilterBar, DisclosureNote, AuditNote,
  btn, btnPrimary, btnDanger, th, td, input, label, select, card, fmtDate,
} from '../_ui';
import * as svc from '@/services/filmAcademyAdminService';
import { TopicsTab } from './TopicsTab';

type TabKey = 'batches' | 'applications' | 'tuition' | 'topics' | 'settings';

const TABS: Array<{ key: TabKey; label: string; hint: string }> = [
  { key: 'batches',     label: 'Batches',      hint: 'Cohorts the app offers on /film-academy' },
  { key: 'applications',label: 'Applications', hint: 'View applicants and their interest areas' },
  { key: 'tuition',     label: 'Tuition',      hint: 'Plans shown on /film-academy/tuition' },
  { key: 'topics',      label: 'Course',       hint: 'TMFA publication gates, curriculum import, question pool, media, practicals and mastery holds' },
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
        subtitle="Cohorts, applications, tuition and the TMFA course for the Spotlight Film Academy."
      />
      <AcademyTabs active="film" />

      <DisclosureNote>
        Everything here is the live data plane the mobile app reads at
        {' '}<code>/film-academy</code>. Approving an application creates its instalment plan and,
        once tuition is settled (or where none is due), opens the TMFA topic path on the phone.
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
      {tab === 'applications' ? <ApplicationsTab /> : null}
      {tab === 'tuition'      ? <TuitionTab onNotice={setNotice} /> : null}
      {tab === 'topics'       ? <TopicsTab onNotice={setNotice} /> : null}
      {tab === 'settings'     ? <SettingsTab onNotice={setNotice} /> : null}
    </Page>
  );
}

type NoticeProp = { onNotice: (s: string | null) => void };

/** The values academy_batches.status actually accepts (a Postgres enum). */
const BATCH_STATUSES = ['upcoming', 'ongoing', 'completed', 'cancelled'];

/** The values academy_batches.training_schedule actually accepts. */
const TRAINING_SCHEDULES = ['weekdays', 'weekends', 'accelerated'];

const EMPTY_BATCH: svc.BatchInput = {
  batch_name: '', status: 'upcoming', start_date: '', end_date: '', application_deadline: '',
  max_students: null, training_schedule: 'weekdays', duration_weeks: 12,
  installments_count: 1, fee_frequency: 'monthly',
  one_off_discount_pct: 0, fee_start_offset_days: 0, interest_area_slugs: [],
};

function ApplicationsTab() {
  const batches = useAsync(() => svc.listBatches(), []);
  const [batchId, setBatchId] = useState('');
  const apps = useAsync(() => svc.listApplications({ batchId: batchId || undefined }), [batchId]);

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
        <button style={btn()} onClick={() => void apps.reload()}>Refresh</button>
      </FilterBar>

      <StateBlock loading={apps.loading} error={apps.error} empty={list.length === 0}
        emptyText="No applications found.">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead><tr>
              <th style={th()}>Applicant</th><th style={th()}>Batch</th><th style={th()}>Areas</th>
              <th style={th()}>App. fee paid</th><th style={th()}>Applied</th>
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
                  <td style={td()}>{naira(a.application_fee_paid)}</td>
                  <td style={td()}>{fmtDate(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </StateBlock>
      <AuditNote>
        Applicants gain immediate access to learning materials after payment. No admin approval needed.
      </AuditNote>
    </Card>
  );
}

function BatchesTab({ onNotice }: NoticeProp) {
  const batches = useAsync(() => svc.listBatches(), []);
  const areas = useAsync(() => svc.listInterestAreas(), []);
  const [editing, setEditing] = useState<svc.BatchInput | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pricingBusy, setPricingBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // The batch editor prices in place: the five lines belong to the training's
  // own catalogue rows, shared by every batch that offers it — the same rows
  // the Settings tab edits and the server charges from.
  const saveBatchAreaPricing = async (
    a: svc.AcademyInterestArea,
    pricing: Array<{ key: svc.AcademyPricingKey; price_ngn: number }>,
  ) => {
    setPricingBusy(true);
    try {
      await svc.updateInterestArea({ id: a.id, pricing });
      await areas.reload();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setPricingBusy(false); }
  };

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
        batch_name: b.batch_name ?? '', status: b.status ?? 'upcoming',
        start_date: b.start_date ?? '', end_date: b.end_date ?? '',
        application_deadline: b.application_deadline ?? '',
        max_students: b.max_students ?? null,
        training_schedule: b.training_schedule ?? 'weekdays',
        duration_weeks: b.duration_weeks ?? 12,
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
    // A batch carries exactly the trainings ticked for it — with the old
    // "empty means unrestricted" rule gone, a batch saved with none would be
    // unappliable, so the console refuses it here as well as on the server.
    if ((editing.interest_area_slugs ?? []).length === 0) {
      setFormError('Tick at least one training this batch will offer.');
      return;
    }
    setSaving(true); setFormError(null);
    try {
      // Dates are optional; send null rather than '' so Postgres stores a real NULL.
      const payload: svc.BatchInput = {
        ...editing,
        start_date: editing.start_date || null,
        end_date: editing.end_date || null,
        application_deadline: editing.application_deadline || null,
        // A cleared number input arrives as 0; the column has no guard, and a
        // zero-week batch is not something the app should ever show.
        duration_weeks: Math.max(1, Number(editing.duration_weeks) || 12),
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
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 940 }}>
              <thead><tr>
                <th style={th()}>Batch</th><th style={th()}>Status</th><th style={th()}>Starts</th>
                <th style={th()}>Deadline</th><th style={th()}>Duration</th><th style={th()}>Capacity</th>
                <th style={th()}>Instalments</th>
                <th style={th()}>Applications</th><th style={th()} />
              </tr></thead>
              <tbody>
                {list.map((b) => (
                  <tr key={b.id}>
                    <td style={td()}>{b.batch_name}</td>
                    <td style={td()}><Badge status={b.status ?? 'upcoming'} /></td>
                    <td style={td()}>{fmtDate(b.start_date)}</td>
                    <td style={td()}>{fmtDate(b.application_deadline)}</td>
                    <td style={td()}>
                      {b.duration_weeks ? `${b.duration_weeks} weeks` : '—'}
                      {b.training_schedule ? <div style={{ fontSize: '0.72rem', color: colors.muted }}>{b.training_schedule}</div> : null}
                    </td>
                    <td style={td()}>{b.max_students ?? '—'}</td>
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
              <select style={select()} value={editing.status ?? 'upcoming'}
                onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                {BATCH_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Starts"><input type="date" style={input()} value={editing.start_date ?? ''}
              onChange={(e) => setEditing({ ...editing, start_date: e.target.value })} /></Field>
            <Field label="Ends"><input type="date" style={input()} value={editing.end_date ?? ''}
              onChange={(e) => setEditing({ ...editing, end_date: e.target.value })} /></Field>
            <Field label="Application deadline"><input type="date" style={input()} value={editing.application_deadline ?? ''}
              onChange={(e) => setEditing({ ...editing, application_deadline: e.target.value })} /></Field>
            {/* Both are shown to the applicant on the phone, so they have to be
                editable here — the mobile card renders "N weeks · schedule". */}
            <Field label="Duration (weeks)">
              <input type="number" min={1} style={input()} value={editing.duration_weeks ?? 12}
                onChange={(e) => setEditing({ ...editing, duration_weeks: Number(e.target.value) })} />
            </Field>
            <Field label="Training schedule">
              <select style={select()} value={editing.training_schedule ?? 'weekdays'}
                onChange={(e) => setEditing({ ...editing, training_schedule: e.target.value })}>
                {TRAINING_SCHEDULES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Capacity (blank = unlimited)">
              <input type="number" min={0} style={input()} value={editing.max_students ?? ''}
                onChange={(e) => setEditing({ ...editing, max_students: e.target.value === '' ? null : Number(e.target.value) })} />
            </Field>
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
              This batch offers <strong>only</strong> the trainings you tick — at least one is
              required, and a ticked training is what the phone shows inside this cohort. Open a
              training&rsquo;s accordion to see and edit its five tuition lines; prices belong to
              the training and are shared by every batch that offers it.
            </p>
            <div style={{ display: 'grid', gap: '0.4rem', marginTop: '0.4rem' }}>
              {(areas.data ?? []).filter((a) => a.is_active !== false).map((a) => {
                const on = (editing.interest_area_slugs ?? []).includes(a.slug);
                return (
                  <BatchAreaAccordion
                    key={a.id}
                    area={a}
                    busy={pricingBusy}
                    checked={on}
                    onCheck={(next) => {
                      const cur = new Set(editing.interest_area_slugs ?? []);
                      if (next) cur.add(a.slug); else cur.delete(a.slug);
                      setEditing({ ...editing, interest_area_slugs: [...cur] });
                    }}
                    onSavePricing={(pricing) => void saveBatchAreaPricing(a, pricing)}
                  />
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

/**
 * One training inside the batch editor, on the same accordion contract as the
 * applicant screens: the header carries no fee text, and opening it reveals
 * the five tuition subs — each with its price, editable in place. Saving
 * writes the training's own catalogue rows (shared by every batch), which is
 * what the applicant accordions render and the server charges from.
 */
function BatchAreaAccordion({ area, busy, checked, onCheck, onSavePricing }: {
  area: svc.AcademyInterestArea;
  busy: boolean;
  checked: boolean;
  onCheck: (next: boolean) => void;
  onSavePricing: (
    pricing: Array<{ key: svc.AcademyPricingKey; price_ngn: number }>,
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = area.pricing_options ?? [];
  const [prices, setPrices] = useState<Record<string, string>>({});
  useEffect(() => {
    setPrices(Object.fromEntries(options.map((o) => [o.key, String(o.price_ngn)])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area.pricing_options]);

  const dirty = options.some((o) => Number(prices[o.key]) !== Number(o.price_ngn));

  return (
    <div style={{
      border: `1px solid ${checked ? colors.primary : 'rgba(128,128,128,0.35)'}`,
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.55rem 0.75rem', cursor: 'pointer' }}
        onClick={() => setOpen((v) => !v)}
      >
        <input type="checkbox" checked={checked}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onCheck(e.target.checked)} />
        <strong style={{ fontSize: '0.85rem', flex: 1 }}>{area.label}</strong>
        {dirty ? (
          <span style={{ fontSize: '0.7rem', color: colors.primary }}>prices edited</span>
        ) : null}
        <span style={{ fontSize: '0.65rem', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s' }}>▶</span>
      </div>
      {open && (
        <div style={{ padding: '0.2rem 0.75rem 0.6rem 2.3rem', display: 'grid', gap: '0.4rem' }}>
          {options.map((o) => (
            <div key={o.key} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 220, flex: 1, fontSize: '0.78rem' }}>
                {o.label}{o.note ? ` (${o.note})` : ''}
              </div>
              <span style={{ fontSize: '0.75rem', color: colors.muted, whiteSpace: 'nowrap' }}>
                = {naira(Math.max(0, Number(prices[o.key]) || 0))}
              </span>
              <span style={{ fontSize: '0.75rem', color: colors.muted }}>₦</span>
              <input type="number" min={0} style={{ ...input(), width: 130 }}
                value={prices[o.key] ?? ''}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setPrices((prev) => ({ ...prev, [o.key]: e.target.value }))} />
            </div>
          ))}
          {options.length === 0 ? (
            <span style={{ fontSize: '0.75rem', color: colors.muted }}>
              No tuition lines yet — open this training under Settings and save its five prices.
            </span>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.15rem' }}>
              <button
                style={btnPrimary()}
                disabled={busy || !dirty}
                onClick={(e) => {
                  e.stopPropagation();
                  void onSavePricing(
                    options.map((o) => ({ key: o.key, price_ngn: Math.max(0, Number(prices[o.key]) || 0) })),
                  );
                }}
              >
                {dirty ? (busy ? 'Saving…' : 'Save prices') : 'Prices saved'}
              </button>
              <span style={{ fontSize: '0.7rem', color: colors.muted }}>
                Applies to {area.label} in every batch.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
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

function SettingsTab({ onNotice }: NoticeProp) {
  const settings = useAsync(() => svc.getSettings(), []);
  const areas = useAsync(() => svc.listInterestAreas(), []);
  const [form, setForm] = useState<svc.AcademySettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [newArea, setNewArea] = useState('');

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
    if (!newArea.trim()) return;
    setBusy(true);
    try {
      // The server gives a new training the five standard tuition formats —
      // there is no single fee to ask for any more.
      await svc.createInterestArea({ label: newArea.trim() });
      setNewArea('');
      await areas.reload();
      onNotice('Area added — it now appears in the app’s apply form with the standard tuition structure.');
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const toggleArea = async (a: svc.AcademyInterestArea) => {
    setBusy(true);
    try {
      await svc.updateInterestArea({ id: a.id, is_active: !a.is_active });
      await areas.reload();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const saveAreaPricing = async (
    a: svc.AcademyInterestArea,
    pricing: Array<{ key: svc.AcademyPricingKey; price_ngn: number }>,
    applyAll: boolean,
  ) => {
    setBusy(true);
    try {
      await svc.updateInterestArea({ id: a.id, pricing });
      if (applyAll) {
        // The structure applies to every area, so the console offers setting it
        // once. Each area keeps its own rows — an area can still be repriced
        // alone later.
        for (const other of (areas.data ?? []).filter((x) => x.id !== a.id)) {
          await svc.updateInterestArea({ id: other.id, pricing });
        }
      }
      await areas.reload();
      onNotice(applyAll
        ? 'Tuition updated for every training.'
        : `Tuition updated for ${a.label}.`);
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

      <Card title="Trainings and their tuition structure">
        <p style={{ fontSize: '0.8rem', color: colors.muted, marginTop: 0 }}>
          Every training is priced by the same composite structure: Weekend -
          Saturday &amp; Sunday (No Boarding / With Boarding), Week days -
          Mondays - Fridays (No Boarding / Boarding), and 1 month (30 days)
          with Boarding for non Lagos residents. These prices are the
          tuition shown on the phone — payable after approval, not at application. The single legacy
          training fee is retired; the slug is what the application row stores, so renaming a label
          is safe but the slug is the contract.
        </p>
        <FilterBar>
          <div style={{ minWidth: 240 }}>
            <span style={label()}>New training</span>
            <input style={input()} placeholder="e.g. Cinematography" value={newArea}
              onChange={(e) => setNewArea(e.target.value)} />
          </div>
          <button style={btnPrimary()} disabled={busy || !newArea.trim()} onClick={() => void addArea()}>Add</button>
        </FilterBar>

        <StateBlock loading={areas.loading} error={areas.error} empty={(areas.data ?? []).length === 0}
          emptyText="No trainings yet — the apply form will show none until you add them.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Training</th><th style={th()}>Slug</th>
              <th style={th()}>Active</th><th style={th()} />
            </tr></thead>
            <tbody>
              {(areas.data ?? []).map((a) => (
                <InterestAreaPricingRow
                  key={a.id}
                  area={a}
                  busy={busy}
                  onSavePricing={(pricing, applyAll) => saveAreaPricing(a, pricing, applyAll)}
                  onToggle={() => toggleArea(a)}
                />
              ))}
            </tbody>
          </table>
        </StateBlock>

        <AuditNote>
          What every tuition buys: 2 movie projects; a potential talent management contract and
          signing into Timeless Movies Production; assistance to produce your own movie and to set
          up &amp; manage a YouTube channel. Tuition excludes feeding and project fees (script
          print-out, make-up, props &amp; set design, location — ₦20,000 per movie project). This is
          the copy the applicant-facing screens show.
        </AuditNote>
      </Card>
    </>
  );
}

/**
 * One training as an accordion row. The header carries no fee text — the same
 * rule the applicant-facing accordions follow — and opening it reveals the five
 * composite tuition lines, each editable in place. GET always serves all five
 * formats per area (the server fills any missing row with the launch
 * structure), so the editor never has to invent formats.
 */
function InterestAreaPricingRow({ area, busy, onSavePricing, onToggle }: {
  area: svc.AcademyInterestArea;
  busy: boolean;
  onSavePricing: (
    pricing: Array<{ key: svc.AcademyPricingKey; price_ngn: number }>,
    applyAll: boolean,
  ) => Promise<void>;
  onToggle: () => Promise<void>;
}) {
  const options = area.pricing_options ?? [];
  const [open, setOpen] = useState(false);
  const [applyAll, setApplyAll] = useState(false);
  const [prices, setPrices] = useState<Record<string, string>>({});
  useEffect(() => {
    setPrices(Object.fromEntries(options.map((o) => [o.key, String(o.price_ngn)])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area.pricing_options]);

  const dirty = options.some((o) => Number(prices[o.key]) !== Number(o.price_ngn));

  return (
    <>
      <tr
        style={{ opacity: area.is_active ? 1 : 0.55, cursor: 'pointer' }}
        onClick={() => setOpen((v) => !v)}
      >
        <td style={td()}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <span
              style={{
                fontSize: '0.65rem',
                transform: open ? 'rotate(90deg)' : 'none',
                transition: 'transform 0.12s',
              }}
            >
              ▶
            </span>
            <strong>{area.label}</strong>
            <span style={{ fontSize: '0.72rem', color: colors.muted }}>
              {open ? '' : '— open to edit its five tuition lines'}
            </span>
          </span>
        </td>
        <td style={td()}><code style={{ fontSize: '0.78rem' }}>{area.slug}</code></td>
        <td style={td()}>
          <Badge status={area.is_active ? 'active' : 'draft'} label={area.is_active ? 'active' : 'inactive'} />
        </td>
        <td style={{ ...td(), whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
          <button style={btn()} disabled={busy} onClick={() => void onToggle()}>
            {area.is_active ? 'Deactivate' : 'Activate'}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={4} style={{ ...td(), backgroundColor: 'rgba(128,128,128,0.06)' }}>
            <div style={{ display: 'grid', gap: '0.5rem', padding: '0.35rem 0' }}>
              {options.map((o) => (
                <div key={o.key} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 260, flex: 1 }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{o.label}</div>
                    {o.note ? <div style={{ fontSize: '0.72rem', color: colors.muted }}>{o.note}</div> : null}
                  </div>
                  <span style={{ fontSize: '0.78rem', color: colors.muted, whiteSpace: 'nowrap' }}>
                    = {naira(Math.max(0, Number(prices[o.key]) || 0))}
                  </span>
                  <span style={{ fontSize: '0.78rem', color: colors.muted }}>₦</span>
                  <input type="number" min={0} style={{ ...input(), width: 140 }}
                    value={prices[o.key] ?? ''}
                    onChange={(e) => setPrices((prev) => ({ ...prev, [o.key]: e.target.value }))} />
                </div>
              ))}
              {options.length === 0 && (
                <div style={{ fontSize: '0.78rem', color: colors.muted }}>
                  No pricing loaded — reload this tab; the server should serve all five formats.
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.25rem' }}>
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '0.78rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} />
                  Apply these prices to <strong>all</strong> trainings
                </label>
                <button style={btnPrimary()} disabled={busy || !dirty || options.length === 0}
                  onClick={() => void onSavePricing(
                    options.map((o) => ({ key: o.key, price_ngn: Math.max(0, Number(prices[o.key]) || 0) })),
                    applyAll,
                  )}>
                  {dirty ? 'Save tuition' : 'Saved'}
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
