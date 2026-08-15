'use client';

// Mapping approval workbench — symptom taxonomy suggest-approve console
// (PRD §4: AI proposes term synonyms and cluster→class mappings; NOTHING
// AI-drafted is user-visible until a licensed pharmacist approves it here).
// Tabs: Terms | Clusters→Classes. Every approval confirms via a modal because
// approval makes the mapping live in user-facing symptom search immediately.
// Cluster rules are read-only on this surface (rule changes go through the
// versioned taxonomy/rules pipeline, not the console).
// RBAC: health.pharmacy.symptom.mappings — UI gate is convenience only.

import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { hasAnyPermission, type AuthUser } from '@/features/auth/rbac';
import {
  listSymptomTerms,
  listClusters,
  actOnTerm,
  actOnClassMap,
  type SymptomTermMapping,
  type ConditionClusterMapping,
  type MappingStatus,
  type SymptomLanguage,
} from '@/services/pharmacySymptomAdminService';
import { PageHeader, Card, DisclosureNote, AuditNote, StateBlock, btn, btnPrimary, btnDanger, th, td, timeAgo } from '../_ui';
import { TierBadge } from '../pharmacy-reviews/_ui';

export const SYMPTOM_MAPPING_PERMS = ['health.pharmacy.symptom.mappings'];

function useMappingPermissions() {
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('spotlight_admin_user');
      if (raw) setUser(JSON.parse(raw) as AuthUser);
    } catch {
      /* unauthenticated handled by route guard */
    }
  }, []);
  return { user, can: (perms: string[]) => hasAnyPermission(user, perms) };
}

// ── Local badges ──────────────────────────────────────────────────────────────

const LANGUAGE_LABELS: Record<SymptomLanguage, string> = { en: 'English', pcm: 'Pidgin', ha: 'Hausa', yo: 'Yoruba', ig: 'Igbo' };
const LANGUAGES: SymptomLanguage[] = ['en', 'pcm', 'ha', 'yo', 'ig'];
const STATUSES: MappingStatus[] = ['AI_SUGGESTED', 'APPROVED', 'RETIRED'];

function MappingStatusBadge({ status }: { status: MappingStatus }) {
  const c =
    status === 'AI_SUGGESTED' ? { fg: '#9a3412', bg: '#ffedd5', label: 'AI suggested · needs review' }
    : status === 'APPROVED' ? { fg: '#15803d', bg: '#dcfce7', label: 'Approved' }
    : { fg: '#6b7280', bg: '#f3f4f6', label: 'Retired' };
  return (
    <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 700, color: c.fg, background: c.bg, whiteSpace: 'nowrap' }}>
      {c.label}
    </span>
  );
}

function LangBadge({ lang }: { lang: SymptomLanguage }) {
  return (
    <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: '#1d4ed8', background: '#dbeafe', whiteSpace: 'nowrap' }}>
      {LANGUAGE_LABELS[lang] ?? lang}
    </span>
  );
}

const chip = (active: boolean): CSSProperties => ({
  padding: '0.3rem 0.7rem', borderRadius: 9999, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
  border: active ? '1px solid #340075' : '1px solid #d1d5db',
  background: active ? '#340075' : '#fff', color: active ? '#fff' : '#374151',
});

type Flash = { kind: 'ok' | 'error'; text: string } | null;

function FlashBanner({ flash }: { flash: NonNullable<Flash> }) {
  const ok = flash.kind === 'ok';
  return (
    <div style={{ border: `1px solid ${ok ? '#bbf7d0' : '#fecaca'}`, background: ok ? '#f0fdf4' : '#fef2f2', color: ok ? '#15803d' : '#b91c1c', borderRadius: '0.5rem', padding: '0.55rem 0.8rem', fontSize: '0.8rem', marginBottom: '1rem' }}>
      {flash.text}
    </div>
  );
}

// Confirmation modal — the suggest-approve gravity moment: approving publishes
// the mapping to user-facing symptom search immediately.
type PendingAction = {
  action: 'approve' | 'retire';
  summary: string;
  run: () => Promise<void>;
};

function ConfirmModal({ pending, busy, onConfirm, onCancel }: { pending: PendingAction; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const approving = pending.action === 'approve';
  return (
    <>
      <div onClick={busy ? undefined : onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)', zIndex: 50 }} />
      <div role="dialog" aria-modal="true" style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 'min(440px, 92vw)', background: '#fff', borderRadius: '0.6rem', border: '1px solid #e5e7eb', boxShadow: '0 16px 40px rgba(0,0,0,0.18)', zIndex: 51, padding: '1.1rem 1.2rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>{approving ? 'Approve mapping?' : 'Retire mapping?'}</h3>
        <p style={{ fontSize: '0.85rem', color: '#374151', margin: '0.6rem 0' }}>{pending.summary}</p>
        {approving ? (
          <p style={{ fontSize: '0.8rem', color: '#9a3412', background: '#ffedd5', borderRadius: '0.375rem', padding: '0.5rem 0.7rem', margin: '0 0 0.6rem' }}>
            Approving publishes this mapping to user-facing symptom search <strong>immediately</strong>. Your identity and timestamp are recorded as the approving pharmacist — this is the human-accountable decision PCN can be shown.
          </p>
        ) : (
          <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: '0 0 0.6rem' }}>
            Retiring removes this mapping from user-facing resolution immediately. Taxonomy rows are retired, never hard-deleted (cluster→class rows are the one exception — removal deletes just the join row); the action stays in the audit trail either way.
          </p>
        )}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button style={btn()} disabled={busy} onClick={onCancel}>Cancel</button>
          <button style={approving ? btnPrimary() : btnDanger()} disabled={busy} onClick={onConfirm}>
            {busy ? 'Applying…' : approving ? 'Approve — go live now' : 'Retire mapping'}
          </button>
        </div>
      </div>
    </>
  );
}

// ── Page component ────────────────────────────────────────────────────────────

export default function SymptomMappingWorkbench() {
  const { can } = useMappingPermissions();
  const canManage = can(SYMPTOM_MAPPING_PERMS);

  const [tab, setTab] = useState<'terms' | 'clusters'>('terms');
  const [terms, setTerms] = useState<SymptomTermMapping[]>([]);
  const [clusters, setClusters] = useState<ConditionClusterMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<MappingStatus | ''>('');
  const [langFilter, setLangFilter] = useState<SymptomLanguage | ''>('');
  const [flash, setFlash] = useState<Flash>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [t, c] = await Promise.all([
        listSymptomTerms({ status: statusFilter, language: langFilter }),
        listClusters(),
      ]);
      setTerms(t); setClusters(c);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [statusFilter, langFilter]);
  useEffect(() => { load(); }, [load]);

  function requestTermAction(t: SymptomTermMapping, action: 'approve' | 'retire') {
    setPending({
      action,
      summary: `Term "${t.term}" (${LANGUAGE_LABELS[t.language]}) → concept "${t.concept_name}".`,
      run: async () => {
        const res = await actOnTerm(t.id, action);
        setFlash({ kind: 'ok', text: res.message });
      },
    });
  }

  // Approval lives on the therapeutic CLASS (the cluster→class join has no
  // lifecycle of its own), so approving publishes the class in EVERY cluster
  // that maps to it; retiring only removes this cluster's mapping row.
  function requestClassMapAction(c: ConditionClusterMapping, therapeuticClassId: string, className: string, action: 'approve' | 'retire') {
    setPending({
      action,
      summary: action === 'approve'
        ? `Therapeutic class "${className}" — approval applies to the class itself, so it goes live in every cluster that maps to it (including "${c.name}").`
        : `Remove therapeutic class "${className}" from cluster "${c.name}" only — the class itself is not retired.`,
      run: async () => {
        const res = await actOnClassMap(c.id, therapeuticClassId, action);
        setFlash({ kind: 'ok', text: res.message });
      },
    });
  }

  async function confirmPending() {
    if (!pending) return;
    setBusy(true);
    try {
      await pending.run();
      setPending(null);
      await load();
    } catch (e) {
      setFlash({ kind: 'error', text: `Action failed — nothing changed. ${e instanceof Error ? e.message : String(e)}` });
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  const needsReviewCount = terms.filter((t) => t.status === 'AI_SUGGESTED').length
    + clusters.reduce((n, c) => n + c.class_maps.filter((m) => m.status === 'AI_SUGGESTED').length, 0);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Symptom mapping workbench"
        subtitle="Suggest-approve console for the symptom taxonomy: term synonyms (English, Pidgin, Hausa, Yoruba, Igbo) and cluster→therapeutic-class mappings. AI drafts; a licensed pharmacist approves."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <DisclosureNote>
        Nothing AI-suggested is user-visible until approved here. Every approval records approver + timestamp + version to the immutable audit log —
        the answer to any future PCN query is a database export. Mappings are retired, never deleted. Cluster combination rules are versioned and read-only on this surface.
      </DisclosureNote>

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'center' }}>
        <button style={chip(tab === 'terms')} onClick={() => setTab('terms')}>Terms</button>
        <button style={chip(tab === 'clusters')} onClick={() => setTab('clusters')}>Clusters → Classes</button>
        <span style={{ fontSize: '0.75rem', color: needsReviewCount > 0 ? '#9a3412' : '#6b7280', fontWeight: 600, marginLeft: '0.4rem' }}>
          {needsReviewCount} AI suggestion{needsReviewCount === 1 ? '' : 's'} awaiting review
        </span>
      </div>

      {flash ? <FlashBanner flash={flash} /> : null}
      {!canManage ? (
        <p style={{ fontSize: '0.78rem', color: '#9a3412', background: '#ffedd5', borderRadius: '0.375rem', padding: '0.4rem 0.6rem', marginBottom: '1rem' }}>
          You do not hold health.pharmacy.symptom.mappings — approve/retire actions are disabled. The server enforces this regardless.
        </p>
      ) : null}

      {tab === 'terms' ? (
        <>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.6rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>Status</span>
            <button style={chip(statusFilter === '')} onClick={() => setStatusFilter('')}>All</button>
            {STATUSES.map((s) => (
              <button key={s} style={chip(statusFilter === s)} onClick={() => setStatusFilter(statusFilter === s ? '' : s)}>{s.replace(/_/g, ' ')}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>Language</span>
            <button style={chip(langFilter === '')} onClick={() => setLangFilter('')}>All</button>
            {LANGUAGES.map((l) => (
              <button key={l} style={chip(langFilter === l)} onClick={() => setLangFilter(langFilter === l ? '' : l)}>{LANGUAGE_LABELS[l]}</button>
            ))}
          </div>

          <Card title="Symptom terms" right={<span style={{ fontSize: '0.75rem', color: '#6b7280' }}>{terms.length} term{terms.length === 1 ? '' : 's'}</span>}>
            <StateBlock loading={loading} error={error} empty={terms.length === 0} emptyText="No terms match — grown continuously from failed-search logs (AI-suggested, pharmacist-approved).">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th()}>Term</th><th style={th()}>Language</th><th style={th()}>Concept</th>
                  <th style={th()}>Status</th><th style={th()}>Source</th><th style={th()}>Approved</th><th style={th()} />
                </tr></thead>
                <tbody>
                  {terms.map((t) => (
                    <tr key={t.id} style={{ background: t.status === 'AI_SUGGESTED' ? '#fffbeb' : undefined }}>
                      <td style={td()}>
                        {t.status === 'AI_SUGGESTED' ? (
                          // Diff-style proposal view: what goes live if approved.
                          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem' }}>
                            <div style={{ color: '#15803d', background: '#f0fdf4', padding: '0.15rem 0.4rem', borderRadius: 4 }}>
                              + &ldquo;{t.term}&rdquo; <span style={{ color: '#6b7280' }}>[{t.language}]</span> → {t.concept_name}
                            </div>
                          </div>
                        ) : (
                          <span style={{ fontWeight: 600 }}>&ldquo;{t.term}&rdquo;</span>
                        )}
                        <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: 2 }}>{t.id} · {timeAgo(t.created_at)}</div>
                      </td>
                      <td style={td()}><LangBadge lang={t.language} /></td>
                      <td style={td()}>{t.concept_name}<div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{t.concept_id}</div></td>
                      <td style={td()}><MappingStatusBadge status={t.status} /></td>
                      <td style={td()}><span style={{ fontSize: '0.75rem', color: t.source === 'AI_SUGGESTED' ? '#9a3412' : '#6b7280' }}>{t.source === 'AI_SUGGESTED' ? 'AI' : 'Curated'}</span></td>
                      <td style={td()}>{t.approved_by ? <>{t.approved_by}<div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{t.approved_at ? timeAgo(t.approved_at) : ''}</div></> : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                      <td style={td()}>
                        {t.status === 'AI_SUGGESTED' ? (
                          <div style={{ display: 'flex', gap: '0.35rem' }}>
                            <button style={{ ...btnPrimary(), opacity: canManage ? 1 : 0.5 }} disabled={!canManage} onClick={() => requestTermAction(t, 'approve')}>Approve</button>
                            <button style={{ ...btnDanger(), opacity: canManage ? 1 : 0.5 }} disabled={!canManage} onClick={() => requestTermAction(t, 'retire')}>Retire</button>
                          </div>
                        ) : t.status === 'APPROVED' ? (
                          <button style={{ ...btn(), opacity: canManage ? 1 : 0.5 }} disabled={!canManage} onClick={() => requestTermAction(t, 'retire')}>Retire</button>
                        ) : (
                          <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>retired</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </StateBlock>
            <AuditNote>Approve = live in user-facing symptom search immediately, with approver + timestamp recorded. Retire = removed from resolution; row kept for audit.</AuditNote>
          </Card>
        </>
      ) : (
        <StateBlock loading={loading} error={error} empty={clusters.length === 0} emptyText="No condition clusters — taxonomy v1 ships ~150 concepts (or the mappings backend is not deployed yet).">
          {clusters.map((c) => (
            <Card
              key={c.id}
              title={c.name}
              right={<div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}><TierBadge tier={c.triage_tier} /><span style={{ fontSize: '0.72rem', color: '#6b7280' }}>rules v{c.rule_version}</span></div>}
            >
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: '0.35rem' }}>Therapeutic-class mappings</div>
              {c.class_maps.length === 0 ? (
                <p style={{ color: '#6b7280', fontSize: '0.82rem' }}>No product classes — {c.triage_tier === 'T4' ? 'T4 emergency clusters never map to commerce.' : c.triage_tier === 'T3' ? 'T3 clusters route to consult, not products.' : 'none mapped yet.'}</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '0.6rem' }}>
                  <thead><tr><th style={th()}>Rank</th><th style={th()}>Therapeutic class</th><th style={th()}>Status</th><th style={th()}>Approved</th><th style={th()} /></tr></thead>
                  <tbody>
                    {c.class_maps.map((m) => (
                      <tr key={m.id} style={{ background: m.status === 'AI_SUGGESTED' ? '#fffbeb' : undefined }}>
                        <td style={td()}>{m.rank}</td>
                        <td style={td()}>
                          {m.status === 'AI_SUGGESTED' ? (
                            <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', color: '#15803d', background: '#f0fdf4', padding: '0.15rem 0.4rem', borderRadius: 4 }}>+ {m.class_name}</span>
                          ) : (
                            m.class_name
                          )}
                          <div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{m.therapeutic_class_id}</div>
                        </td>
                        <td style={td()}><MappingStatusBadge status={m.status} /></td>
                        <td style={td()}>{m.approved_by ? <>{m.approved_by}<div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{m.approved_at ? timeAgo(m.approved_at) : ''}</div></> : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                        <td style={td()}>
                          {m.status === 'AI_SUGGESTED' ? (
                            <div style={{ display: 'flex', gap: '0.35rem' }}>
                              <button style={{ ...btnPrimary(), opacity: canManage ? 1 : 0.5 }} disabled={!canManage} onClick={() => requestClassMapAction(c, m.therapeutic_class_id, m.class_name, 'approve')}>Approve class</button>
                              <button style={{ ...btnDanger(), opacity: canManage ? 1 : 0.5 }} disabled={!canManage} onClick={() => requestClassMapAction(c, m.therapeutic_class_id, m.class_name, 'retire')}>Remove from cluster</button>
                            </div>
                          ) : m.status === 'APPROVED' ? (
                            <button style={{ ...btn(), opacity: canManage ? 1 : 0.5 }} disabled={!canManage} onClick={() => requestClassMapAction(c, m.therapeutic_class_id, m.class_name, 'retire')}>Remove from cluster</button>
                          ) : (
                            <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>retired</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.3, margin: '0.6rem 0 0.35rem' }}>Combination rules (read-only · versioned)</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Priority</th><th style={th()}>Expression</th><th style={th()}>Effect</th></tr></thead>
                <tbody>
                  {c.rules.map((r) => (
                    <tr key={r.id}>
                      <td style={td()}>{r.priority}</td>
                      <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.expression}</code></td>
                      <td style={td()}><span style={{ fontSize: '0.78rem', fontWeight: 600, color: r.effect.includes('T4') ? '#b91c1c' : r.effect.includes('T3') ? '#9a3412' : r.effect.includes('T2') ? '#1d4ed8' : '#15803d' }}>{r.effect}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
        </StateBlock>
      )}

      {pending ? <ConfirmModal pending={pending} busy={busy} onConfirm={confirmPending} onCancel={() => setPending(null)} /> : null}
    </div>
  );
}
