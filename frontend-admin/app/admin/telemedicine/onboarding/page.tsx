'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  listOnboarding, getOnboarding, decideOnboarding, ONBOARDING_STAGES,
  type OnboardingList, type OnboardingDetail, type OnboardingAction, type OnboardingStage,
} from '@/services/telemedAdminOnboardingService';
import {
  PageHeader, TelemedTabs, Card, Badge, Kpi, StateBlock, FilterBar,
  btn, btnPrimary, btnDanger, th, td, input, label, select, fmtDate, timeAgo,
} from '../_ui';
import { colors } from '@/components/ui/vuexy';

const PAGE_SIZE = 25;

const STAGE_LABEL: Record<string, string> = Object.fromEntries(ONBOARDING_STAGES.map((s) => [s.value, s.label]));

const ACTION_COPY: Record<OnboardingAction, { title: string; confirm: string; help: string }> = {
  approve: {
    title: 'Approve provider',
    confirm: 'Approve',
    help: 'Marks the MDCN verification approved, makes the provider discoverable and completes their onboarding. A licence-expiry check is scheduled automatically.',
  },
  need_info: {
    title: 'Request more information',
    confirm: 'Send request',
    help: 'Keeps the provider unpublished and asks them to resubmit. The reason is recorded against the application.',
  },
  reject: {
    title: 'Reject application',
    confirm: 'Reject',
    help: 'Rejects the verification and keeps the provider unpublished. The reason is recorded against the application.',
  },
};

function stageBadge(stage: string) {
  return <Badge status={stage} label={STAGE_LABEL[stage] ?? stage} />;
}

export default function OnboardingPage() {
  const [data, setData] = useState<OnboardingList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState('');
  const [q, setQ] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await listOnboarding({ stage: stage || undefined, q: appliedQ || undefined, limit: PAGE_SIZE, offset })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [stage, appliedQ, offset]);

  useEffect(() => { load(); }, [load]);

  const counts = data?.counts ?? {};
  const total = data?.total ?? 0;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Provider onboarding"
        subtitle="Doctors, specialists and veterinarians moving through the mobile onboarding flow — review applications and approve, reject or ask for more information."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <TelemedTabs active="onboarding" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Pending review" value={String(counts.pending_review ?? 0)} accent={(counts.pending_review ?? 0) > 0 ? '#9a3412' : undefined} />
        <Kpi label="Needs info" value={String(counts.needs_info ?? 0)} />
        <Kpi label="In progress" value={String((counts.in_progress ?? 0) + (counts.type_selected ?? 0) + (counts.started ?? 0))} sub="not yet submitted" />
        <Kpi label="Approved" value={String(counts.approved ?? 0)} accent="#15803d" />
        <Kpi label="Rejected / suspended" value={String((counts.rejected ?? 0) + (counts.suspended ?? 0))} />
      </div>

      <FilterBar>
        <div style={{ minWidth: 220 }}>
          <label style={label()}>Search</label>
          <input
            style={input()} placeholder="Name, email, phone or MDCN number…" value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setOffset(0); setAppliedQ(q.trim()); } }}
          />
        </div>
        <div>
          <label style={label()}>Stage</label>
          <select style={select()} value={stage} onChange={(e) => { setOffset(0); setStage(e.target.value); }}>
            <option value="">All stages{data ? ` (${Object.values(counts).reduce((a, b) => a + b, 0)})` : ''}</option>
            {ONBOARDING_STAGES.map((s) => <option key={s.value} value={s.value}>{s.label} ({counts[s.value] ?? 0})</option>)}
          </select>
        </div>
        <button style={btn()} onClick={() => { setOffset(0); setAppliedQ(q.trim()); }}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading && !data} error={error} empty={!!data && data.items.length === 0}
          emptyText={stage || appliedQ ? 'No applications match these filters.' : 'No providers have started onboarding yet.'}>
          <table style={{ width: '100%', borderCollapse: 'collapse', opacity: loading ? 0.6 : 1 }}>
            <thead><tr>
              <th style={th()}>Applicant</th><th style={th()}>Type</th><th style={th()}>Stage</th><th style={th()}>MDCN</th>
              <th style={th()}>Consents</th><th style={th()}>Submitted</th><th style={th()}></th>
            </tr></thead>
            <tbody>
              {(data?.items ?? []).map((a) => (
                <tr key={a.user_id}>
                  <td style={td()}>
                    {a.name || <span style={{ color: colors.muted }}>(no name yet)</span>}
                    <div style={{ fontSize: '0.72rem', color: colors.muted }}>{a.email ?? a.phone ?? a.user_id}</div>
                  </td>
                  <td style={td()}>{a.selected_type ?? a.provider_type}</td>
                  <td style={td()}>{stageBadge(a.stage)}</td>
                  <td style={td()}>{a.mdcn_number ? <code style={{ fontSize: '0.78rem' }}>{a.mdcn_number}</code> : '—'}</td>
                  <td style={td()}>{a.consents_accepted}/{a.consents_required}</td>
                  <td style={td()}>{a.submitted_at ? timeAgo(a.submitted_at) : '—'}</td>
                  <td style={td()}><button style={a.stage === 'pending_review' ? btnPrimary() : btn()} onClick={() => setOpenId(a.user_id)}>{a.stage === 'pending_review' ? 'Review' : 'View'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', fontSize: '0.8rem', color: colors.muted }}>
            <span>{total === 0 ? '0' : `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)}`} of {total}</span>
            <span style={{ display: 'flex', gap: '0.4rem' }}>
              <button style={btn()} disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
              <button style={btn()} disabled={offset + PAGE_SIZE >= total || loading} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</button>
            </span>
          </div>
        </StateBlock>
      </Card>

      {openId && <Drawer userId={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

function Drawer({ userId, onClose, onChanged }: { userId: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<OnboardingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<OnboardingAction | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setD(await getOnboarding(userId)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  return (
    <div role="dialog" aria-label="Application review" style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }} onClick={onClose}>
      <div style={{ width: 'min(620px, 100%)', background: colors.card, height: '100%', overflowY: 'auto', padding: '1.25rem' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.2rem', color: colors.text }}>{d?.name || 'Application'}</h2>
            {d && <div style={{ marginTop: '0.3rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>{stageBadge(d.stage)}<span style={{ color: colors.muted, fontSize: '0.8rem' }}>{d.selected_type ?? d.provider_type}</span></div>}
          </div>
          <button style={btn()} onClick={onClose}>Close</button>
        </div>

        <StateBlock loading={loading && !d} error={error} empty={!d} emptyText="Application not found.">
          {d && (
            <>
              <Section title="Applicant">
                <Row k="Email" v={d.email} /><Row k="Phone" v={d.phone} />
                <Row k="Specialty" v={d.specialty} /><Row k="Hospital" v={d.hospital} />
                <Row k="MDCN number" v={d.mdcn_number} />
                <Row k="Profile steps done" v={String(d.steps_completed)} />
                <Row k="Discoverable to patients" v={d.is_published ? 'Yes' : 'No'} />
                <Row k="Onboarding request" v={d.upgrade_state ?? 'not requested'} />
              </Section>

              <Section title={`Legal consents (${d.consents_accepted}/${d.consents_required})`}>
                {d.consents.length === 0 ? <Muted>None accepted yet.</Muted> : d.consents.map((c) => (
                  <Row key={`${c.kind}-${c.version}`} k={`${c.kind.replace(/_/g, ' ')} · ${c.version}`} v={c.accepted ? `Accepted ${fmtDate(c.accepted_at)}` : 'Not accepted'} />
                ))}
              </Section>

              <Section title="App permissions">
                {d.permissions.length === 0 ? <Muted>No permission choices recorded.</Muted> : d.permissions.map((p) => <Row key={p.kind} k={p.kind.replace(/_/g, ' ')} v={p.state} />)}
              </Section>

              <Section title="Verification">
                {d.verifications.length === 0 ? <Muted>No verification has been submitted.</Muted> : d.verifications.map((v) => (
                  <div key={v.id} style={{ borderTop: `1px solid ${colors.border}`, padding: '0.5rem 0' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}><Badge status={v.status} /><span style={{ color: colors.muted, fontSize: '0.78rem' }}>{v.kind} · submitted {fmtDate(v.submitted_at)}</span></div>
                    <Row k="Discipline" v={v.discipline} /><Row k="Licence expiry" v={v.licence_expiry} />
                    {v.notes && <Row k="Reviewer notes" v={v.notes} />}
                  </div>
                ))}
                {d.documents.length > 0 && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: colors.muted, textTransform: 'uppercase' }}>Documents ({d.documents.length})</div>
                    {d.documents.map((doc) => <Row key={doc.id} k={doc.label ?? doc.doc_type} v={doc.file_name ?? 'uploaded'} />)}
                    <Muted>Open the document viewer in the MDCN review console — every file access there is logged.</Muted>
                  </div>
                )}
                {d.review_path && <div style={{ marginTop: '0.5rem' }}><Link href={d.review_path} style={{ color: colors.primary, fontSize: '0.85rem' }}>Open MDCN review console →</Link></div>}
              </Section>

              <Section title="Audit trail">
                {d.audit.length === 0 ? <Muted>No review activity yet.</Muted> : d.audit.map((a) => (
                  <Row key={a.id} k={a.action.replace(/^doctor\./, '')} v={`${timeAgo(a.created_at)}${typeof a.detail.status === 'string' ? ` · ${a.detail.status}` : ''}`} />
                ))}
              </Section>

              {d.can_decide ? (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', borderTop: `1px solid ${colors.border}`, paddingTop: '1rem' }}>
                  <button style={btnPrimary()} onClick={() => setAction('approve')}>Approve</button>
                  <button style={btn()} onClick={() => setAction('need_info')}>Request more info</button>
                  <button style={btnDanger()} onClick={() => setAction('reject')}>Reject</button>
                </div>
              ) : (
                <Muted>{d.verification_id ? 'This verification has been decided.' : 'Decisions open once the provider submits their verification.'}</Muted>
              )}
            </>
          )}
        </StateBlock>

        {action && d && (
          <DecisionModal
            userId={userId} action={action} defaultMdcn={d.mdcn_number}
            onCancel={() => setAction(null)}
            onDone={async () => { setAction(null); await load(); onChanged(); }}
          />
        )}
      </div>
    </div>
  );
}

function DecisionModal({ userId, action, defaultMdcn, onCancel, onDone }: {
  userId: string; action: OnboardingAction; defaultMdcn: string | null; onCancel: () => void; onDone: () => void | Promise<void>;
}) {
  const copy = ACTION_COPY[action];
  const [expiry, setExpiry] = useState('');
  const [discipline, setDiscipline] = useState<'medical' | 'dental' | ''>('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const needsNotes = action !== 'approve';
  const today = new Date().toISOString().slice(0, 10);
  const invalid = action === 'approve'
    ? !expiry || expiry <= today || !discipline
    : notes.trim().length === 0;

  async function submit() {
    setBusy(true); setErr(null);
    try {
      await decideOnboarding(userId, {
        action,
        ...(action === 'approve' ? { licence_expiry: expiry, discipline: discipline as 'medical' | 'dental' } : {}),
        notes: notes.trim() || undefined,
      });
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div role="alertdialog" aria-label={copy.title} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={(e) => e.stopPropagation()}>
      <div style={{ width: 'min(460px, 100%)', background: colors.card, borderRadius: '0.5rem', padding: '1.25rem' }}>
        <h3 style={{ margin: '0 0 0.4rem', color: colors.text }}>{copy.title}</h3>
        <p style={{ margin: '0 0 0.9rem', fontSize: '0.82rem', color: colors.muted }}>{copy.help}</p>
        {action === 'approve' && (
          <>
            <div style={{ marginBottom: '0.7rem' }}>
              <label style={label()}>Licence expiry (must be in the future)</label>
              <input style={input()} type="date" min={today} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
              <div style={{ fontSize: '0.72rem', color: colors.muted, marginTop: '0.2rem' }}>Confirmed against the register{defaultMdcn ? ` for ${defaultMdcn}` : ''}; the account is auto-suspended on this date.</div>
            </div>
            <div style={{ marginBottom: '0.7rem' }}>
              <label style={label()}>Discipline</label>
              <select style={select()} value={discipline} onChange={(e) => setDiscipline(e.target.value as 'medical' | 'dental' | '')}>
                <option value="">Select…</option><option value="medical">Medical</option><option value="dental">Dental</option>
              </select>
            </div>
          </>
        )}
        <div style={{ marginBottom: '0.7rem' }}>
          <label style={label()}>{needsNotes ? 'Reason (required)' : 'Notes (optional)'}</label>
          <textarea style={{ ...input(), minHeight: 80 }} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {err && <p style={{ color: '#dc2626', fontSize: '0.82rem', margin: '0 0 0.7rem' }}>{err}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button style={btn()} disabled={busy} onClick={onCancel}>Cancel</button>
          <button style={action === 'reject' ? btnDanger() : btnPrimary()} disabled={busy || invalid} onClick={submit}>{busy ? 'Saving…' : copy.confirm}</button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '1.1rem' }}>
      <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, margin: '0 0 0.4rem' }}>{title}</h3>
      {children}
    </div>
  );
}
function Row({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.85rem', padding: '0.2rem 0' }}>
      <span style={{ color: colors.muted, textTransform: 'capitalize' }}>{k}</span>
      <span style={{ color: colors.text, textAlign: 'right' }}>{v || '—'}</span>
    </div>
  );
}
function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ color: colors.muted, fontSize: '0.8rem', margin: '0.3rem 0' }}>{children}</p>;
}
