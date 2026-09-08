'use client';

// Dues & finance.
//
// WHY THIS PAGE AND NOT content/dues: raising dues is the same subject as the
// collection summary and the offline-payment review already here — an operator
// looking at "₦18.9m outstanding" is one click from wanting to bill for it. A
// second page under Content would have split one job across two tabs and left
// this one showing a number with no way to act on it. Authoring pages create
// content; this creates INVOICES, which is finance.
//
// MONEY PATH. Two rules govern everything below:
//   1. Every amount is INTEGER KOBO. Naira exists only as text in an <input>;
//      nairaToKobo() converts once at the form boundary, formatNaira() renders.
//   2. The Idempotency-Key belongs to the FORM, not to the request. It is minted
//      once per intended run and kept across retries, because the backend's
//      replay guarantee (a UNIQUE INDEX on assoc_dues_runs.idempotency_key) only
//      protects a retry that reuses the same key. Retrying with a fresh key is
//      exactly how an entire roster gets billed twice.

import { useCallback, useEffect, useState } from 'react';
import {
  getAssociationFinance, listOfflinePayments, decideOfflinePayment,
  listAdminDuesRuns, runDues, createInvoice, getAdminOrganisation, listMembers,
  formatNaira, nairaToKobo, dateInputToRfc3339, newIdempotencyKey,
  INVOICE_SCOPES, DUES_CADENCES,
  type AssociationFinance, type OfflinePayment, type DuesRunRow, type DuesRunResult,
  type InvoiceScope, type DuesCadence, type OrgCategory, type OrgChapter, type MemberSummary,
} from '@/services/associationAdminService';
import {
  AssociationTabs, Kpi, DisclosureNote, StateBlock, AuditNote, OrgPicker, useSelectedOrg, fmtDate,
  useAssociationPermissions, ASSOCIATION_PERMS, PermissionBanner,
} from '../_ui';
import { Field, NotifyCheck, formGrid, selectStyle, textareaStyle } from '../content/_content';
import { Page, PageHeader, Card, Button, Input, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

export default function DuesPage() {
  const orgId = useSelectedOrg();
  const { can } = useAssociationPermissions();
  const canManage = can(ASSOCIATION_PERMS.manage);

  const [fin, setFin] = useState<AssociationFinance | null>(null);
  const [rows, setRows] = useState<OfflinePayment[]>([]);
  const [runs, setRuns] = useState<DuesRunRow[]>([]);
  const [categories, setCategories] = useState<OrgCategory[]>([]);
  const [chapters, setChapters] = useState<OrgChapter[]>([]);
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [activeCount, setActiveCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [f, o] = await Promise.all([getAssociationFinance(), listOfflinePayments()]);
      setFin(f); setRows(o);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }

    if (!orgId) { setRuns([]); setCategories([]); setChapters([]); setMembers([]); setActiveCount(null); return; }
    // Settled individually: a failure in one picker must not blank the others
    // and silently make the run form unusable without saying why.
    const [r, org, m] = await Promise.allSettled([
      listAdminDuesRuns(orgId, { limit: 50 }), getAdminOrganisation(orgId), listMembers(),
    ]);
    setRuns(r.status === 'fulfilled' ? r.value : []);
    setCategories(org.status === 'fulfilled' ? org.value.categories : []);
    setChapters(org.status === 'fulfilled' ? org.value.chapters : []);
    setActiveCount(org.status === 'fulfilled' ? org.value.activeCount : null);
    setMembers(m.status === 'fulfilled' ? m.value : []);
    if (r.status === 'rejected') setError(r.reason instanceof Error ? r.reason.message : String(r.reason));
  }, [orgId]);
  useEffect(() => { void load(); }, [load]);

  async function decide(o: OfflinePayment, decision: 'approve' | 'reject') {
    const ok = window.confirm(`${decision === 'approve' ? 'Approve' : 'Reject'} offline payment ${formatNaira(o.amountKobo)} from ${o.memberName}?`);
    if (!ok) return;
    setBusy(o.id); setMsg(null);
    try {
      await decideOfflinePayment(o.id, decision);
      setMsg(`Offline payment ${o.id}: ${decision}. ${decision === 'approve' ? 'Balanced ledger entry posted (NL-8).' : 'No funds moved.'} Recorded to audit (NL-12).`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  // ── Raise dues ────────────────────────────────────────────────────────────
  const [runForm, setRunForm] = useState({
    title: '', scope: 'NATIONAL' as InvoiceScope, dueDate: '',
    categoryId: '', chapterId: '', notify: false,
  });
  // Minted on the client only — a useState initializer would run during SSR too
  // and render a different key on the server than in the browser.
  const [runKey, setRunKey] = useState<string | null>(null);
  useEffect(() => { if (!runKey) setRunKey(newIdempotencyKey()); }, [runKey]);
  const [runResult, setRunResult] = useState<DuesRunResult | null>(null);

  async function doRunDues() {
    if (!orgId || !runKey) return;
    const title = runForm.title.trim();
    if (!title) { setError('Give the dues run a title — members see it on their invoice.'); return; }
    if (!window.confirm(
      `Raise "${title}" for every ACTIVE member of this organisation`
      + `${runForm.categoryId ? ' in the selected dues tier' : ''}`
      + `${runForm.chapterId ? ' in the selected chapter' : ''}?`
      + `\n\nThis creates one invoice per member. Re-submitting with the same key replays and raises nothing.`,
    )) return;
    setBusy('dues-run'); setError(null); setMsg(null);
    try {
      const res = await runDues(orgId, {
        title,
        scope: runForm.scope,
        dueDate: dateInputToRfc3339(runForm.dueDate),
        categoryId: runForm.categoryId || null,
        chapterId: runForm.chapterId || null,
        notify: runForm.notify,
      }, runKey);
      setRunResult(res);
      // The replay case is stated as a replay. Reporting "invoiced: 1,180"
      // again would read as a second successful billing of the same roster.
      setMsg(res.alreadyRaised
        ? `Nothing new was raised. This Idempotency-Key was already used, so the backend replayed run ${res.runId} and returned its original figures unchanged.`
        : `Raised ${res.invoiced.toLocaleString('en-NG')} invoice(s) totalling ${formatNaira(res.totalKobo)}${res.skipped > 0 ? `, skipping ${res.skipped.toLocaleString('en-NG')} member(s) with no priced dues tier` : ''}. Recorded to the audit log (NL-12).`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }

  function startNewRun() {
    setRunKey(newIdempotencyKey());
    setRunResult(null);
    setRunForm({ title: '', scope: 'NATIONAL', dueDate: '', categoryId: '', chapterId: '', notify: false });
    setMsg(null); setError(null);
  }

  // ── Ad-hoc single invoice ─────────────────────────────────────────────────
  const [invForm, setInvForm] = useState({
    membershipId: '', title: '', amount: '', description: '',
    cadence: 'ONE_OFF' as DuesCadence, scope: 'NATIONAL' as InvoiceScope, dueDate: '', notify: false,
  });
  const [invKey, setInvKey] = useState<string | null>(null);
  useEffect(() => { if (!invKey) setInvKey(newIdempotencyKey()); }, [invKey]);

  async function doCreateInvoice() {
    if (!invKey) return;
    setBusy('invoice'); setError(null); setMsg(null);
    try {
      if (!invForm.membershipId) throw new Error('Pick the member to invoice.');
      const title = invForm.title.trim();
      if (!title) throw new Error('Give the invoice a title — the member sees it.');
      const amountKobo = nairaToKobo(invForm.amount);
      if (amountKobo <= 0) throw new Error('The amount must be greater than ₦0.00.');
      const who = members.find((m) => m.id === invForm.membershipId);
      if (!window.confirm(`Invoice ${who?.fullName ?? 'this member'} ${formatNaira(amountKobo)} for "${title}"?`)) { setBusy(null); return; }
      const res = await createInvoice({
        membershipId: invForm.membershipId,
        title,
        amountKobo,
        description: invForm.description.trim() || null,
        cadence: invForm.cadence,
        scope: invForm.scope,
        dueDate: dateInputToRfc3339(invForm.dueDate),
        notify: invForm.notify,
      }, invKey);
      setMsg(`Invoice ${res.id} raised for ${who?.fullName ?? invForm.membershipId}: ${formatNaira(amountKobo)}. Re-submitting with the same key returns this same invoice rather than billing again. Recorded to the audit log (NL-12).`);
      setInvKey(newIdempotencyKey());
      setInvForm({ membershipId: '', title: '', amount: '', description: '', cadence: 'ONE_OFF', scope: 'NATIONAL', dueDate: '', notify: false });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }

  const keyBox: React.CSSProperties = {
    fontSize: '0.72rem', color: colors.muted, marginTop: 8,
    background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: '0.375rem', padding: '0.4rem 0.55rem',
  };

  return (
    <Page>
      <PageHeader title="Dues & finance" subtitle="Dues collection summary, dues runs and ad-hoc invoices, and offline (bank-transfer / cash) payment review." actions={<Button variant="outline" onClick={() => void load()}>Refresh</Button>} />
      <AssociationTabs active="dues" />
      <OrgPicker />
      <DisclosureNote>
        Approving an offline payment posts a balanced double-entry ledger entry (NL-8). Every decision is recorded to the
        immutable audit log (NL-12). Raising dues and raising an ad-hoc invoice each require an{' '}
        <strong>Idempotency-Key</strong>: the key shown on each form is minted once and reused on every retry, so a
        re-submission <em>replays</em> instead of billing a second time.
      </DisclosureNote>

      {!canManage && <PermissionBanner text="You have read-only access — your role can view dues but cannot raise them." />}
      {msg && <AuditNote>{msg}</AuditNote>}
      {error && <p style={{ color: colors.danger, fontSize: '0.85rem' }}>{error}</p>}

      <StateBlock loading={loading} error={null} empty={!fin} emptyText="Select an organisation above to see its finance summary.">
        {fin && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="Dues outstanding" value={formatNaira(fin.outstandingKobo)} accent={fin.outstandingKobo > 0 ? colors.warning : undefined} />
            <Kpi label="Dues collected" value={formatNaira(fin.collectedKobo)} accent={colors.primary} />
            <Kpi label="Paid members" value={fin.paidMembers.toLocaleString('en-NG')} />
            <Kpi label="Unpaid members" value={fin.unpaidMembers.toLocaleString('en-NG')} accent={fin.unpaidMembers > 0 ? colors.warning : undefined} />
            <Kpi label="Offline pending" value={fin.offlinePending.toLocaleString('en-NG')} />
          </div>
        )}
      </StateBlock>

      {/* ── Raise dues ── */}
      <Card title="Raise dues">
        {!orgId ? <p style={{ fontSize: '0.85rem', color: colors.muted, marginTop: 12 }}>Select an organisation above.</p>
          : !canManage ? <p style={{ fontSize: '0.85rem', color: colors.muted, marginTop: 12 }}>Read-only.</p> : (
          <>
            <p style={{ fontSize: '0.8rem', color: colors.muted, margin: '10px 0 0' }}>
              One invoice per ACTIVE member, priced from <strong>that member&apos;s own dues tier</strong> — not from a
              figure typed here. Members with no tier, or a tier priced at ₦0.00, are skipped rather than billed nothing.
              {activeCount != null && <> This organisation currently has <strong>{activeCount.toLocaleString('en-NG')}</strong> active member(s).</>}
            </p>
            <div style={formGrid}>
              <Field label="Title (members see this on the invoice)" wide>
                <Input value={runForm.title} onChange={(e) => setRunForm({ ...runForm, title: e.target.value })} placeholder="e.g. 2026 annual dues" />
              </Field>
              <Field label="Scope">
                <select style={selectStyle} value={runForm.scope} onChange={(e) => setRunForm({ ...runForm, scope: e.target.value as InvoiceScope })}>
                  {INVOICE_SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Due date">
                <Input type="date" value={runForm.dueDate} onChange={(e) => setRunForm({ ...runForm, dueDate: e.target.value })} />
              </Field>
              <Field label="Restrict to a dues tier (optional)">
                <select style={selectStyle} value={runForm.categoryId} onChange={(e) => setRunForm({ ...runForm, categoryId: e.target.value })}>
                  <option value="">Every tier</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.label} · {formatNaira(c.duesKobo)} {c.duesCadence}</option>)}
                </select>
              </Field>
              <Field label="Restrict to a chapter (optional)">
                <select style={selectStyle} value={runForm.chapterId} onChange={(e) => setRunForm({ ...runForm, chapterId: e.target.value })}>
                  <option value="">Every chapter</option>
                  {chapters.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.memberCount.toLocaleString('en-NG')} member(s)</option>)}
                </select>
              </Field>
              <NotifyCheck what="dues run" checked={runForm.notify} onChange={(v) => setRunForm({ ...runForm, notify: v })} memberCount={activeCount} />
            </div>

            <div style={keyBox}>
              Idempotency-Key for this run: <code>{runKey ?? '…'}</code><br />
              Submitting again with this key replays the original run and raises nothing. Use <em>Start a new run</em> to
              mint a fresh key when you genuinely intend to bill again.
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <Button variant="primary" disabled={busy !== null || !runKey} onClick={() => void doRunDues()}>
                {busy === 'dues-run' ? 'Raising…' : 'Raise dues'}
              </Button>
              <Button variant="outline" disabled={busy !== null} onClick={startNewRun}>Start a new run (new key)</Button>
            </div>

            {runResult && (
              <div style={{
                marginTop: 14, borderRadius: '0.5rem', padding: '0.7rem 0.9rem', fontSize: '0.82rem',
                border: `1px solid ${tint(runResult.alreadyRaised ? colors.warning : colors.success, 0.4)}`,
                background: tint(runResult.alreadyRaised ? colors.warning : colors.success, 0.08),
              }}>
                {runResult.alreadyRaised ? (
                  <>
                    <strong>Replay — nothing new was raised.</strong> This key had already been used, so the backend
                    returned run <code>{runResult.runId}</code> exactly as it was first recorded. The figures below are
                    that ORIGINAL run&apos;s, not a second billing:{' '}
                    {runResult.invoiced.toLocaleString('en-NG')} invoice(s), {runResult.skipped.toLocaleString('en-NG')} skipped,{' '}
                    {formatNaira(runResult.totalKobo)}.
                  </>
                ) : (
                  <>
                    <strong>Raised.</strong> Run <code>{runResult.runId}</code>:{' '}
                    <strong>{runResult.invoiced.toLocaleString('en-NG')}</strong> invoice(s),{' '}
                    <strong>{runResult.skipped.toLocaleString('en-NG')}</strong> skipped,{' '}
                    total <strong>{formatNaira(runResult.totalKobo)}</strong>.
                  </>
                )}
              </div>
            )}
          </>
        )}
      </Card>

      {/* ── Ad-hoc invoice ── */}
      <Card title="Raise a single invoice">
        {!orgId ? <p style={{ fontSize: '0.85rem', color: colors.muted, marginTop: 12 }}>Select an organisation above.</p>
          : !canManage ? <p style={{ fontSize: '0.85rem', color: colors.muted, marginTop: 12 }}>Read-only.</p> : (
          <>
            <p style={{ fontSize: '0.8rem', color: colors.muted, margin: '10px 0 0' }}>
              For a levy, a fine or a one-off charge against ONE member. Unlike a dues run, the amount is typed here — in
              naira — and stored as integer kobo.
            </p>
            <div style={formGrid}>
              <Field label={`Member (${members.length} in this organisation)`}>
                <select style={selectStyle} value={invForm.membershipId} onChange={(e) => setInvForm({ ...invForm, membershipId: e.target.value })}>
                  <option value="">— Select a member —</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.fullName} · {m.memberId} · {m.categoryLabel}</option>)}
                </select>
              </Field>
              <Field label="Title"><Input value={invForm.title} onChange={(e) => setInvForm({ ...invForm, title: e.target.value })} placeholder="e.g. Late-payment levy" /></Field>
              <Field label="Amount (naira)"><Input value={invForm.amount} onChange={(e) => setInvForm({ ...invForm, amount: e.target.value })} placeholder="e.g. 5000" /></Field>
              <Field label="Cadence">
                <select style={selectStyle} value={invForm.cadence} onChange={(e) => setInvForm({ ...invForm, cadence: e.target.value as DuesCadence })}>
                  {DUES_CADENCES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Scope">
                <select style={selectStyle} value={invForm.scope} onChange={(e) => setInvForm({ ...invForm, scope: e.target.value as InvoiceScope })}>
                  {INVOICE_SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Due date"><Input type="date" value={invForm.dueDate} onChange={(e) => setInvForm({ ...invForm, dueDate: e.target.value })} /></Field>
              <Field label="Description (optional)" wide>
                <textarea style={{ ...textareaStyle, minHeight: 60 }} value={invForm.description} onChange={(e) => setInvForm({ ...invForm, description: e.target.value })} />
              </Field>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: colors.text }}>
                  <input type="checkbox" checked={invForm.notify} onChange={(e) => setInvForm({ ...invForm, notify: e.target.checked })} />
                  Notify this member in-app
                </label>
              </div>
            </div>
            <div style={keyBox}>
              Idempotency-Key for this invoice: <code>{invKey ?? '…'}</code><br />
              A retry with this key returns the invoice that was already raised instead of billing the member twice. A
              fresh key is minted automatically once an invoice succeeds.
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <Button variant="primary" disabled={busy !== null || !invKey} onClick={() => void doCreateInvoice()}>
                {busy === 'invoice' ? 'Raising…' : 'Raise invoice'}
              </Button>
            </div>
          </>
        )}
      </Card>

      {/* ── Past runs ── */}
      <Card title={`Past dues runs (${runs.length})`}>
        <StateBlock loading={loading} error={null} empty={runs.length === 0} emptyText={orgId ? 'No dues have been raised for this organisation yet.' : 'Select an organisation above.'}>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
            <thead><tr>
              <th style={thCell}>Run</th><th style={thCell}>Scope</th><th style={thCell}>Invoiced</th>
              <th style={thCell}>Skipped</th><th style={thCell}>Total</th><th style={thCell}>Paid</th>
              <th style={thCell}>Outstanding</th><th style={thCell}>Raised</th>
            </tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td style={tdCell}>
                    <div style={{ fontWeight: 600 }}>{r.title}</div>
                    <div style={{ fontSize: '0.72rem', color: colors.muted }}><code>{r.id}</code></div>
                  </td>
                  <td style={tdCell}><Badge text={r.subtitle || 'NATIONAL'} color={colors.primary} /></td>
                  <td style={tdCell}>{(r.meta.invoiced ?? 0).toLocaleString('en-NG')}</td>
                  <td style={tdCell}>{(r.meta.skipped ?? 0).toLocaleString('en-NG')}</td>
                  <td style={tdCell}>{formatNaira(Number(r.meta.totalKobo ?? 0))}</td>
                  <td style={tdCell}>{(r.meta.paidCount ?? 0).toLocaleString('en-NG')}</td>
                  <td style={tdCell}>
                    {Number(r.meta.outstandingKobo ?? 0) > 0
                      ? <span style={{ color: colors.warning, fontWeight: 600 }}>{formatNaira(Number(r.meta.outstandingKobo))}</span>
                      : formatNaira(0)}
                  </td>
                  <td style={tdCell}>{fmtDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>

      {/* ── Offline payments ── */}
      <Card title="Offline payments awaiting review">
        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No offline payments pending review.">
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
            <thead><tr>
              <th style={thCell}>Payment</th><th style={thCell}>Member</th><th style={thCell}>Amount</th>
              <th style={thCell}>Method</th><th style={thCell}>Reference</th><th style={thCell}>For</th><th style={thCell}>Submitted</th><th style={thCell}>Action</th>
            </tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{o.id}</code></td>
                  <td style={tdCell}>{o.memberName} <span style={{ color: colors.muted, fontSize: '0.78rem' }}>({o.memberId})</span></td>
                  <td style={tdCell}>{formatNaira(o.amountKobo)}</td>
                  <td style={tdCell}>{o.method.replace(/_/g, ' ')}</td>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{o.reference}</code></td>
                  <td style={tdCell}>{o.forItem}</td>
                  <td style={tdCell}>{fmtDate(o.submittedAt)}</td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <Button variant="primary" sm disabled={busy === o.id || !canManage} onClick={() => decide(o, 'approve')}>{busy === o.id ? '…' : 'Approve'}</Button>
                      <Button variant="danger" sm disabled={busy === o.id || !canManage} onClick={() => decide(o, 'reject')}>Reject</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </Page>
  );
}
