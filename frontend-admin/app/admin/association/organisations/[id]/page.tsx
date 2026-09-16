'use client';

// Organisation detail + management.
//
// assoc_organisations was write-once before the admin routes behind this page
// landed: name, branding, group type, approval rule, registration fee, verified
// and published were all permanently immutable after creation, and its chapters,
// committees, dues tiers and rules had no editor anywhere. Everything on this
// page is org-scoped server-side (requireOrgAdmin) and written to the immutable
// audit log (NL-12).
//
// Money: registrationFeeKobo and duesKobo are INTEGER KOBO. The naira the
// operator types is converted once, at the form boundary, by nairaToKobo().

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import {
  getAdminOrganisation, updateAdminOrganisation, setOrganisationFlag, setSelectedOrgId,
  createChapter, updateChapter, deleteChapter,
  createCommittee, updateCommittee, deleteCommittee,
  createCategory, updateCategory, deleteCategory,
  createRule, updateRule, deleteRule,
  formatNaira, nairaToKobo, koboToNairaInput,
  CHAPTER_LEVELS, DUES_CADENCES, ORG_GROUP_TYPES, ORG_APPROVAL_RULES,
  type AdminOrganisationDetail, type ChapterLevel, type DuesCadence,
  type OrgGroupType, type OrgApprovalRule, type OrgFlagAction, type UpdateOrganisationInput,
} from '@/services/associationAdminService';
import {
  DisclosureNote, AuditNote, fmtDate,
  useAssociationPermissions, ASSOCIATION_PERMS, PermissionBanner,
} from '../../_ui';
import { Page, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const labelStyle: React.CSSProperties = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' };
const selectStyle: React.CSSProperties = {
  padding: '0.45rem 0.55rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem',
  fontSize: '0.85rem', background: colors.card, cursor: 'pointer', width: '100%', boxSizing: 'border-box',
};
const textareaStyle: React.CSSProperties = {
  padding: '0.45rem 0.55rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem',
  fontSize: '0.85rem', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={labelStyle}>{label}</label>{children}</div>;
}
function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: colors.text }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

type SubTab = 'chapters' | 'committees' | 'categories' | 'rules' | 'leaders';

export default function AssociationOrganisationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAssociationPermissions();
  const canManage = can(ASSOCIATION_PERMS.manage);

  const [org, setOrg] = useState<AdminOrganisationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<SubTab>('chapters');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setOrg(await getAdminOrganisation(id)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  // ── Identity form ──
  const [form, setForm] = useState<Record<string, string>>({});
  const [flags, setFlags] = useState({ disableVoting: false, disableEvents: false, disableChat: false, disableCard: false });
  useEffect(() => {
    if (!org) return;
    setForm({
      name: org.name, acronym: org.acronym ?? '', category: org.category ?? '',
      description: org.description ?? '', logoUrl: org.logoUrl ?? '', coverUrl: org.coverUrl ?? '',
      website: org.website ?? '', location: org.location ?? '',
      foundedYear: org.foundedYear != null ? String(org.foundedYear) : '',
      structureType: org.structureType ?? '',
      groupType: org.groupType, approvalRule: org.approvalRule,
      registrationFee: koboToNairaInput(org.registrationFeeKobo),
      graceDays: String(org.restrictions.graceDays),
    });
    setFlags({
      disableVoting: org.restrictions.disableVoting, disableEvents: org.restrictions.disableEvents,
      disableChat: org.restrictions.disableChat, disableCard: org.restrictions.disableCard,
    });
  }, [org]);
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function saveIdentity() {
    if (!org) return;
    setBusy(true); setError(null); setMsg(null);
    try {
      // Only CHANGED fields are sent: the backend treats an omitted key as
      // "leave unchanged", so a narrow patch can never blank a column the
      // operator did not touch.
      const patch: UpdateOrganisationInput = {};
      const str = (key: keyof UpdateOrganisationInput, val: string, current: string) => {
        if (val.trim() !== current) (patch as Record<string, unknown>)[key] = val.trim();
      };
      str('name', form.name, org.name);
      str('acronym', form.acronym, org.acronym ?? '');
      str('category', form.category, org.category ?? '');
      str('description', form.description, org.description ?? '');
      str('logoUrl', form.logoUrl, org.logoUrl ?? '');
      str('coverUrl', form.coverUrl, org.coverUrl ?? '');
      str('website', form.website, org.website ?? '');
      str('location', form.location, org.location ?? '');
      str('structureType', form.structureType, org.structureType ?? '');
      if (form.groupType !== org.groupType) patch.groupType = form.groupType as OrgGroupType;
      if (form.approvalRule !== org.approvalRule) patch.approvalRule = form.approvalRule as OrgApprovalRule;

      if (form.foundedYear.trim() !== (org.foundedYear != null ? String(org.foundedYear) : '')) {
        const y = Number(form.foundedYear.trim());
        if (!Number.isInteger(y) || y < 1800 || y > new Date().getFullYear()) throw new Error(`Founded year must be a year between 1800 and ${new Date().getFullYear()}`);
        patch.foundedYear = y;
      }
      // Naira in the box, integer kobo on the wire. nairaToKobo throws on
      // anything that is not a clean 2-decimal amount rather than silently
      // truncating it.
      const feeKobo = nairaToKobo(form.registrationFee);
      if (feeKobo !== org.registrationFeeKobo) patch.registrationFeeKobo = feeKobo;

      const grace = Number(form.graceDays.trim());
      if (!Number.isInteger(grace) || grace < 0) throw new Error('Grace days must be a whole number of days, 0 or more');
      if (grace !== org.restrictions.graceDays) patch.graceDays = grace;

      if (flags.disableVoting !== org.restrictions.disableVoting) patch.disableVoting = flags.disableVoting;
      if (flags.disableEvents !== org.restrictions.disableEvents) patch.disableEvents = flags.disableEvents;
      if (flags.disableChat !== org.restrictions.disableChat) patch.disableChat = flags.disableChat;
      if (flags.disableCard !== org.restrictions.disableCard) patch.disableCard = flags.disableCard;

      if (Object.keys(patch).length === 0) { setMsg('Nothing changed — no request sent.'); return; }
      setOrg(await updateAdminOrganisation(id, patch));
      setMsg(`Saved ${Object.keys(patch).length} field(s). Recorded to the audit log (NL-12).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  // ── Lifecycle flags ──
  const [confirming, setConfirming] = useState<OrgFlagAction | null>(null);
  async function runFlag(action: OrgFlagAction) {
    setBusy(true); setError(null); setMsg(null);
    try {
      await setOrganisationFlag(id, action);
      setMsg(`Organisation ${action === 'restore' ? 'restored' : `${action}${action.endsWith('e') ? 'd' : 'ed'}`}. Recorded to the audit log (NL-12).`);
      setConfirming(null);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  // ── Child entity editors (chapters / committees / categories / rules) ──
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);

  function beginAdd(kind: SubTab) {
    setEditingId('new'); setMsg(null); setError(null);
    if (kind === 'chapters') setDraft({ name: '', level: 'STATE' });
    if (kind === 'committees') setDraft({ name: '', description: '' });
    if (kind === 'categories') setDraft({ label: '', description: '', dues: '0', cadence: 'ANNUAL' });
    if (kind === 'rules') setDraft({ body: '', position: String((org?.rules.length ?? 0) + 1) });
  }
  function beginEdit(kind: SubTab, row: Record<string, unknown>) {
    setEditingId(String(row.id)); setMsg(null); setError(null);
    if (kind === 'chapters') setDraft({ name: String(row.name), level: String(row.level || 'STATE') });
    if (kind === 'committees') setDraft({ name: String(row.name), description: String(row.description ?? '') });
    if (kind === 'categories') setDraft({ label: String(row.label), description: String(row.description ?? ''), dues: koboToNairaInput(Number(row.duesKobo)), cadence: String(row.duesCadence || 'ANNUAL') });
    if (kind === 'rules') setDraft({ body: String(row.body), position: String(row.position) });
  }

  async function saveChild(kind: SubTab) {
    setBusy(true); setError(null); setMsg(null);
    const isNew = editingId === 'new';
    try {
      if (kind === 'chapters') {
        const body = { name: draft.name.trim(), level: draft.level as ChapterLevel };
        if (!body.name) throw new Error('Chapter name is required');
        if (isNew) await createChapter(id, body); else await updateChapter(editingId!, body);
      } else if (kind === 'committees') {
        const body = { name: draft.name.trim(), description: draft.description.trim() || null };
        if (!body.name) throw new Error('Committee name is required');
        if (isNew) await createCommittee(id, body); else await updateCommittee(editingId!, body);
      } else if (kind === 'categories') {
        // MONEY PATH: dues typed in naira, sent as integer kobo, and both the
        // create and the update carry an Idempotency-Key (the backend rejects
        // them without one) so a retry cannot mint or re-price a tier twice.
        const body = {
          label: draft.label.trim(), description: draft.description.trim() || null,
          duesKobo: nairaToKobo(draft.dues), cadence: draft.cadence as DuesCadence,
        };
        if (!body.label) throw new Error('Category label is required');
        if (isNew) await createCategory(id, body); else await updateCategory(editingId!, body);
      } else if (kind === 'rules') {
        const pos = Number(draft.position);
        if (!Number.isInteger(pos) || pos < 0) throw new Error('Position must be a whole number');
        const body = { body: draft.body.trim(), position: pos };
        if (!body.body) throw new Error('Rule text is required');
        if (isNew) await createRule(id, body); else await updateRule(editingId!, body);
      }
      setMsg(`${isNew ? 'Created' : 'Updated'}. Recorded to the audit log (NL-12).`);
      setEditingId(null); setDraft({});
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function removeChild(kind: SubTab, childId: string, name: string) {
    // Chapter and dues-tier deletes are REFUSED by the backend while members
    // still reference them; the refusal message is surfaced verbatim.
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setBusy(true); setError(null); setMsg(null);
    try {
      if (kind === 'chapters') await deleteChapter(childId);
      else if (kind === 'committees') await deleteCommittee(childId);
      else if (kind === 'categories') await deleteCategory(childId);
      else if (kind === 'rules') await deleteRule(childId);
      setMsg(`Deleted "${name}". Recorded to the audit log (NL-12).`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const back = <p><Link href="/admin/association/organisations" style={{ color: colors.primary }}>← Back to organisations</Link></p>;
  if (loading) return <Page>{back}<p style={{ color: colors.muted }}>Loading organisation…</p></Page>;
  if (!org) return <Page>{back}<p style={{ color: colors.danger }}>{error ?? 'Organisation not found.'}</p></Page>;

  const suspended = (org.status || '').toUpperCase() === 'SUSPENDED';
  const editorOpen = editingId !== null;

  return (
    <Page>
      {back}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: '0.25rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>{org.name}</h1>
        {org.acronym && <code style={{ fontSize: '0.85rem', color: colors.muted }}>{org.acronym}</code>}
        <Badge text={org.published ? 'Published' : 'Draft'} color={org.published ? colors.success : colors.muted} />
        <Badge text={org.verified ? 'Verified' : 'Unverified'} color={org.verified ? colors.success : colors.warning} />
        <Badge text={org.status} color={suspended ? colors.danger : colors.success} />
      </div>
      <p style={{ fontSize: '0.85rem', color: colors.muted, margin: '0 0 1rem' }}>
        {org.category} · {org.groupType} · approval {org.approvalRule} · created {fmtDate(org.createdAt)}
        {org.suspendedAt ? ` · suspended ${fmtDate(org.suspendedAt)}` : ''}
      </p>

      <DisclosureNote>
        Writes go to <code>/api/finance/associations/admin/organisations/:id</code> and its child routes; every one is
        org-scoped server-side and recorded to the immutable audit log (NL-12). Registration fee and dues are stored as
        integer <strong>kobo</strong> — the naira you type is converted once, on submit.
        {' '}<Link href={`/admin/association/organisations/${id}/settings`} style={{ color: colors.primary, fontWeight: 600 }}>Custom settings →</Link>
      </DisclosureNote>
      {msg && <AuditNote>{msg}</AuditNote>}
      {error && <p style={{ color: colors.danger, fontSize: '0.85rem' }}>{error}</p>}
      {!canManage && <PermissionBanner text="You have read-only access — your role can view this organisation but cannot change it." />}

      {/* ── Counts ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        {([
          ['Members', org.memberCount], ['Active', org.activeCount], ['Pending', org.pendingCount],
          ['Chapters', org.chapterCount], ['Committees', org.committeeCount], ['Dues tiers', org.categoryCount],
        ] as [string, number][]).map(([k, v]) => (
          <div key={k} style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.7rem 0.9rem', background: colors.card }}>
            <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 600 }}>{k}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: '0.2rem' }}>{v.toLocaleString('en-NG')}</div>
          </div>
        ))}
      </div>

      {/* ── Lifecycle actions ── */}
      <Card title="Lifecycle">
        {!canManage ? <p style={{ fontSize: '0.85rem', color: colors.muted }}>Read-only.</p> : confirming ? (
          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            <p style={{ margin: 0, fontSize: '0.85rem' }}>
              Confirm <strong>{confirming}</strong> for <strong>{org.name}</strong>?
              {confirming === 'suspend' && ' Suspending blocks the organisation for all of its members.'}
              {confirming === 'unpublish' && ' Unpublishing removes it from public discovery.'}
              {confirming === 'verify' && ' Verification is a platform-super-admin action and will be rejected for anyone else.'}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="outline" disabled={busy} onClick={() => setConfirming(null)}>Cancel</Button>
              <Button variant={confirming === 'suspend' || confirming === 'unpublish' || confirming === 'unverify' ? 'danger' : 'primary'} disabled={busy} onClick={() => void runFlag(confirming)}>
                {busy ? 'Working…' : `Confirm ${confirming}`}
              </Button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <Button variant={org.verified ? 'outline' : 'primary'} onClick={() => setConfirming(org.verified ? 'unverify' : 'verify')}>{org.verified ? 'Unverify' : 'Verify'}</Button>
            <Button variant={org.published ? 'outline' : 'primary'} onClick={() => setConfirming(org.published ? 'unpublish' : 'publish')}>{org.published ? 'Unpublish' : 'Publish'}</Button>
            <Button variant={suspended ? 'primary' : 'danger'} onClick={() => setConfirming(suspended ? 'restore' : 'suspend')}>{suspended ? 'Restore' : 'Suspend'}</Button>
            <Button variant="secondary" onClick={() => { setSelectedOrgId(id); setMsg('This organisation is now the active scope for the rest of the association console.'); }}>Set as active org</Button>
          </div>
        )}
      </Card>

      {/* ── Identity & branding ── */}
      <Card title="Identity, branding & membership rules">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.8rem', marginTop: 12 }}>
          <Field label="Name"><Input value={form.name ?? ''} disabled={!canManage} onChange={set('name')} /></Field>
          <Field label="Acronym"><Input value={form.acronym ?? ''} disabled={!canManage} onChange={set('acronym')} placeholder="e.g. LTU" /></Field>
          <Field label="Category"><Input value={form.category ?? ''} disabled={!canManage} onChange={set('category')} placeholder="e.g. TRADE" /></Field>
          <Field label="Location"><Input value={form.location ?? ''} disabled={!canManage} onChange={set('location')} placeholder="e.g. Lagos, Nigeria" /></Field>
          <Field label="Website"><Input value={form.website ?? ''} disabled={!canManage} onChange={set('website')} placeholder="https://…" /></Field>
          <Field label="Founded year"><Input value={form.foundedYear ?? ''} disabled={!canManage} onChange={set('foundedYear')} placeholder="e.g. 2015" /></Field>
          <Field label="Logo URL"><Input value={form.logoUrl ?? ''} disabled={!canManage} onChange={set('logoUrl')} placeholder="https://…" /></Field>
          <Field label="Cover URL"><Input value={form.coverUrl ?? ''} disabled={!canManage} onChange={set('coverUrl')} placeholder="https://…" /></Field>
          <Field label="Structure type"><Input value={form.structureType ?? ''} disabled={!canManage} onChange={set('structureType')} placeholder="e.g. CHAPTERED" /></Field>
          <Field label="Group type">
            <select style={selectStyle} disabled={!canManage} value={form.groupType ?? ''} onChange={set('groupType')}>
              {ORG_GROUP_TYPES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
          <Field label="Approval rule">
            <select style={selectStyle} disabled={!canManage} value={form.approvalRule ?? ''} onChange={set('approvalRule')}>
              {ORG_APPROVAL_RULES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label={`Registration fee (naira) — currently ${formatNaira(org.registrationFeeKobo)}`}>
            <Input value={form.registrationFee ?? ''} disabled={!canManage} onChange={set('registrationFee')} placeholder="e.g. 5000" />
          </Field>
          <Field label="Dues grace period (days)"><Input value={form.graceDays ?? ''} disabled={!canManage} onChange={set('graceDays')} /></Field>
        </div>

        <div style={{ marginTop: '0.9rem' }}>
          <label style={labelStyle}>Description</label>
          <textarea rows={3} style={textareaStyle} disabled={!canManage} value={form.description ?? ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </div>

        <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', marginTop: '0.9rem' }}>
          <Check label="Disable voting" checked={flags.disableVoting} disabled={!canManage} onChange={(v) => setFlags((f) => ({ ...f, disableVoting: v }))} />
          <Check label="Disable events" checked={flags.disableEvents} disabled={!canManage} onChange={(v) => setFlags((f) => ({ ...f, disableEvents: v }))} />
          <Check label="Disable chat" checked={flags.disableChat} disabled={!canManage} onChange={(v) => setFlags((f) => ({ ...f, disableChat: v }))} />
          <Check label="Disable membership card" checked={flags.disableCard} disabled={!canManage} onChange={(v) => setFlags((f) => ({ ...f, disableCard: v }))} />
        </div>

        {canManage && (
          <div style={{ display: 'flex', gap: 8, marginTop: '1rem' }}>
            <Button variant="primary" disabled={busy} onClick={() => void saveIdentity()}>{busy ? 'Saving…' : 'Save changes'}</Button>
            <Button variant="outline" disabled={busy} onClick={() => void load()}>Discard</Button>
          </div>
        )}
      </Card>

      {/* ── Sub-sections ── */}
      <Card>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', borderBottom: `1px solid ${colors.border}`, paddingBottom: '0.5rem', marginBottom: '0.75rem' }}>
          {([
            ['chapters', `Chapters (${org.chapters.length})`], ['committees', `Committees (${org.committees.length})`],
            ['categories', `Dues tiers (${org.categories.length})`], ['rules', `Rules (${org.rules.length})`],
            ['leaders', `Chapter leaders (${org.leaders.length})`],
          ] as [SubTab, string][]).map(([k, lbl]) => (
            <button key={k} type="button" onClick={() => { setTab(k); setEditingId(null); }}
              style={{ padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, border: 'none', cursor: 'pointer', color: tab === k ? '#fff' : colors.text, background: tab === k ? colors.primary : colors.bg }}>
              {lbl}
            </button>
          ))}
        </div>

        {canManage && tab !== 'leaders' && !editorOpen && (
          <Button variant="outline" onClick={() => beginAdd(tab)}>+ Add {tab === 'categories' ? 'dues tier' : tab.replace(/s$/, '')}</Button>
        )}

        {canManage && editorOpen && tab !== 'leaders' && (
          <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.8rem', background: colors.bg, display: 'grid', gap: '0.7rem', marginBottom: '0.9rem' }}>
            <strong style={{ fontSize: '0.85rem' }}>{editingId === 'new' ? 'New' : 'Edit'} {tab === 'categories' ? 'dues tier' : tab.replace(/s$/, '')}</strong>
            {tab === 'chapters' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.7rem' }}>
                <Field label="Name"><Input value={draft.name ?? ''} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. Lagos Chapter" /></Field>
                <Field label="Level">
                  <select style={selectStyle} value={draft.level ?? 'STATE'} onChange={(e) => setDraft((d) => ({ ...d, level: e.target.value }))}>
                    {CHAPTER_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </Field>
              </div>
            )}
            {tab === 'committees' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.7rem' }}>
                <Field label="Name"><Input value={draft.name ?? ''} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. Welfare Committee" /></Field>
                <Field label="Description"><Input value={draft.description ?? ''} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} /></Field>
              </div>
            )}
            {tab === 'categories' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.7rem' }}>
                <Field label="Label"><Input value={draft.label ?? ''} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} placeholder="e.g. Standard" /></Field>
                <Field label="Description"><Input value={draft.description ?? ''} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} /></Field>
                <Field label="Dues (naira)"><Input value={draft.dues ?? ''} onChange={(e) => setDraft((d) => ({ ...d, dues: e.target.value }))} placeholder="e.g. 10000" /></Field>
                <Field label="Cadence">
                  <select style={selectStyle} value={draft.cadence ?? 'ANNUAL'} onChange={(e) => setDraft((d) => ({ ...d, cadence: e.target.value }))}>
                    {DUES_CADENCES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
              </div>
            )}
            {tab === 'rules' && (
              <>
                <Field label="Rule text"><textarea rows={3} style={textareaStyle} value={draft.body ?? ''} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} /></Field>
                <div style={{ maxWidth: 160 }}><Field label="Position"><Input value={draft.position ?? ''} onChange={(e) => setDraft((d) => ({ ...d, position: e.target.value }))} /></Field></div>
              </>
            )}
            {tab === 'categories' && (
              <p style={{ margin: 0, fontSize: '0.75rem', color: colors.muted }}>
                Money path: dues are stored as integer kobo and this request carries an <code>Idempotency-Key</code>.
                Re-pricing a tier does <strong>not</strong> re-price invoices already issued at the old amount.
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="outline" disabled={busy} onClick={() => { setEditingId(null); setDraft({}); }}>Cancel</Button>
              <Button variant="primary" disabled={busy} onClick={() => void saveChild(tab)}>{busy ? 'Saving…' : 'Save'}</Button>
            </div>
          </div>
        )}

        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
          {tab === 'chapters' && (
            <>
              <thead><tr><th style={thCell}>Chapter</th><th style={thCell}>Level</th><th style={thCell}>Members</th><th style={thCell}></th></tr></thead>
              <tbody>
                {org.chapters.length === 0 && <tr><td style={tdCell} colSpan={4}>No chapters yet.</td></tr>}
                {org.chapters.map((c) => (
                  <tr key={c.id}>
                    <td style={tdCell}>{c.name}</td>
                    <td style={tdCell}><Badge text={c.level || '—'} color={colors.info} /></td>
                    <td style={tdCell}>{c.memberCount.toLocaleString('en-NG')}</td>
                    <td style={tdCell}>{canManage && <RowActions onEdit={() => beginEdit('chapters', c as unknown as Record<string, unknown>)} onDelete={() => void removeChild('chapters', c.id, c.name)} busy={busy} />}</td>
                  </tr>
                ))}
              </tbody>
            </>
          )}
          {tab === 'committees' && (
            <>
              <thead><tr><th style={thCell}>Committee</th><th style={thCell}>Description</th><th style={thCell}>Members</th><th style={thCell}></th></tr></thead>
              <tbody>
                {org.committees.length === 0 && <tr><td style={tdCell} colSpan={4}>No committees yet.</td></tr>}
                {org.committees.map((c) => (
                  <tr key={c.id}>
                    <td style={tdCell}>{c.name}</td>
                    <td style={tdCell}>{c.description ?? '—'}</td>
                    <td style={tdCell}>{c.memberCount.toLocaleString('en-NG')}</td>
                    <td style={tdCell}>{canManage && <RowActions onEdit={() => beginEdit('committees', c as unknown as Record<string, unknown>)} onDelete={() => void removeChild('committees', c.id, c.name)} busy={busy} />}</td>
                  </tr>
                ))}
              </tbody>
            </>
          )}
          {tab === 'categories' && (
            <>
              <thead><tr><th style={thCell}>Tier</th><th style={thCell}>Description</th><th style={thCell}>Dues</th><th style={thCell}>Cadence</th><th style={thCell}></th></tr></thead>
              <tbody>
                {org.categories.length === 0 && <tr><td style={tdCell} colSpan={5}>No dues tiers yet.</td></tr>}
                {org.categories.map((c) => (
                  <tr key={c.id}>
                    <td style={tdCell}>{c.label}</td>
                    <td style={tdCell}>{c.description ?? '—'}</td>
                    <td style={tdCell}><strong>{formatNaira(c.duesKobo)}</strong></td>
                    <td style={tdCell}><Badge text={c.duesCadence} color={colors.info} /></td>
                    <td style={tdCell}>{canManage && <RowActions onEdit={() => beginEdit('categories', c as unknown as Record<string, unknown>)} onDelete={() => void removeChild('categories', c.id, c.label)} busy={busy} />}</td>
                  </tr>
                ))}
              </tbody>
            </>
          )}
          {tab === 'rules' && (
            <>
              <thead><tr><th style={thCell}>#</th><th style={thCell}>Rule</th><th style={thCell}></th></tr></thead>
              <tbody>
                {org.rules.length === 0 && <tr><td style={tdCell} colSpan={3}>No rules yet.</td></tr>}
                {org.rules.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...tdCell, width: 48 }}>{r.position}</td>
                    <td style={tdCell}>{r.body}</td>
                    <td style={tdCell}>{canManage && <RowActions onEdit={() => beginEdit('rules', r as unknown as Record<string, unknown>)} onDelete={() => void removeChild('rules', r.id, `rule #${r.position}`)} busy={busy} />}</td>
                  </tr>
                ))}
              </tbody>
            </>
          )}
          {tab === 'leaders' && (
            <>
              <thead><tr><th style={thCell}>State / jurisdiction</th><th style={thCell}>Leader</th><th style={thCell}>Contact</th><th style={thCell}>Can approve members</th></tr></thead>
              <tbody>
                {org.leaders.length === 0 && <tr><td style={tdCell} colSpan={4}>No chapter leaders recorded.</td></tr>}
                {org.leaders.map((l) => (
                  <tr key={l.id}>
                    <td style={tdCell}>{l.stateName || '—'}</td>
                    <td style={tdCell}>{l.leaderName ?? '—'}</td>
                    <td style={tdCell}>{l.leaderContact ?? '—'}</td>
                    <td style={tdCell}><Badge text={l.canApproveMembers ? 'Yes' : 'No'} color={l.canApproveMembers ? colors.success : colors.muted} /></td>
                  </tr>
                ))}
              </tbody>
            </>
          )}
        </table>
        {tab === 'leaders' && <p style={{ fontSize: '0.75rem', color: colors.muted, marginTop: 10 }}>Read-only — chapter leadership is assigned through elections handover, not edited here.</p>}
      </Card>
    </Page>
  );
}

function RowActions({ onEdit, onDelete, busy }: { onEdit: () => void; onDelete: () => void; busy: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 10, whiteSpace: 'nowrap' }}>
      <button type="button" disabled={busy} onClick={onEdit} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '0.8rem', color: colors.primary }}>Edit</button>
      <button type="button" disabled={busy} onClick={onDelete} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '0.8rem', color: colors.danger }}>Delete</button>
    </div>
  );
}
