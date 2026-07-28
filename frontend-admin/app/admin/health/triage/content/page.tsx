'use client';

import { useEffect, useState } from 'react';
import {
  listContent, createContent, governContent, LANGUAGE_LABELS,
} from '@/services/healthTriageAdminService';
import type { ClinicalContentItem, ClinicalContentInput, ClinicalContentKind, GovernanceAction, TriageLanguage } from '@/types/healthTriageAdmin';
import {
  PageHeader, TriageTabs, Card, Badge, DisclosureNote, StateBlock, AuditNote, FilterBar,
  btn, btnPrimary, th, td, select, input, label, timeAgo, fmtDate,
} from '../../_ui';

const KIND_LABELS: Record<ClinicalContentKind, string> = {
  condition_library: 'Condition library', disclaimer: 'Disclaimer',
  care_guidance: 'Care guidance', channel_notice: 'Channel notice',
};

// Which lifecycle actions are valid from each state (publish needs APPROVED).
const NEXT_ACTIONS: Record<string, GovernanceAction[]> = {
  draft: ['submit'],
  clinical_review: ['approve'],
  approved: ['publish', 'deprecate'],
  published: ['deprecate'],
  deprecated: [],
};
const ACTION_LABEL: Record<GovernanceAction, string> = {
  submit: 'Submit for clinical review', approve: 'Approve (clinician sign-off)',
  publish: 'Publish', deprecate: 'Deprecate',
};

export default function TriageContentPage() {
  const [rows, setRows] = useState<ClinicalContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stateF, setStateF] = useState('');
  const [lang, setLang] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [form, setForm] = useState<ClinicalContentInput>({ title: '', kind: 'condition_library', language: 'en', body_preview: '' });
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listContent({ state: stateF || undefined, language: lang || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [stateF, lang]);

  async function act(id: string, action: GovernanceAction) {
    setBusy(id); setResult(null);
    try { const r = await governContent(id, action); setResult(r.message); await load(); }
    catch (e) { setResult(String(e)); }
    finally { setBusy(null); }
  }

  async function submitNew() {
    if (!form.title.trim()) return;
    setCreating(true); setResult(null);
    try { const c = await createContent(form); setResult(`Draft created: ${c.id} (${c.title}). Move it through CLINICAL_REVIEW → APPROVED before publish (SC-6).`); setForm({ title: '', kind: 'condition_library', language: 'en', body_preview: '' }); await load(); }
    catch (e) { setResult(String(e)); }
    finally { setCreating(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Clinical content governance"
        subtitle="Curated condition explainers, disclaimers, care guidance and channel notices. Lifecycle DRAFT → CLINICAL_REVIEW → APPROVED → PUBLISHED → DEPRECATED. PUBLISH requires a licensed-clinician sign-off; content is versioned & auditable (SC-6)."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <TriageTabs active="content" />

      <DisclosureNote>
        All patient-facing content is clinician-vetted curated material (RAG) — the LLM never freely generates
        clinical conclusions (SC-10). Content reads as &ldquo;possible causes / guidance&rdquo;, never a
        diagnosis (SC-1). <strong>A licensed-clinician review &amp; sign-off is required before any item can be
        PUBLISHED (SC-6)</strong> — publish is fail-closed until an item reaches APPROVED. Every lifecycle
        change is versioned and written to the immutable audit (SC-6 / SC-12).
      </DisclosureNote>

      {result ? <div style={{ border: '1px solid #ddd6fe', background: '#f5f3ff', color: '#5b21b6', borderRadius: '0.5rem', padding: '0.6rem 0.8rem', fontSize: '0.82rem', marginBottom: '1rem' }}>{result}</div> : null}

      <Card title="New content draft">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.6rem', alignItems: 'flex-end' }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={label()}>Title</label>
            <input style={input()} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Malaria — possible causes & guidance (EN)" />
          </div>
          <div>
            <label style={label()}>Kind</label>
            <select style={select()} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as ClinicalContentKind }))}>
              {(Object.keys(KIND_LABELS) as ClinicalContentKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </select>
          </div>
          <div>
            <label style={label()}>Language</label>
            <select style={select()} value={form.language} onChange={(e) => setForm((f) => ({ ...f, language: e.target.value as TriageLanguage }))}>
              {Object.keys(LANGUAGE_LABELS).map((l) => <option key={l} value={l}>{LANGUAGE_LABELS[l]}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={label()}>Body preview</label>
            <textarea style={{ ...input(), minHeight: 60, fontFamily: 'inherit' }} value={form.body_preview} onChange={(e) => setForm((f) => ({ ...f, body_preview: e.target.value }))} placeholder="Plain-language guidance. Must read as possible causes / guidance, never a diagnosis (SC-1)." />
          </div>
          <div>
            <button disabled={creating || !form.title.trim()} onClick={submitNew} style={{ ...btnPrimary(), opacity: creating || !form.title.trim() ? 0.5 : 1 }}>Create draft</button>
          </div>
        </div>
        <AuditNote>New items start in DRAFT and cannot be published until a clinician signs off in APPROVED (SC-6).</AuditNote>
      </Card>

      <Card title="Content items">
        <FilterBar>
          <div>
            <label style={label()}>State</label>
            <select style={select()} value={stateF} onChange={(e) => setStateF(e.target.value)}>
              <option value="">All</option>
              {['draft', 'clinical_review', 'approved', 'published', 'deprecated'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <label style={label()}>Language</label>
            <select style={select()} value={lang} onChange={(e) => setLang(e.target.value)}>
              <option value="">All</option>
              {Object.keys(LANGUAGE_LABELS).map((l) => <option key={l} value={l}>{LANGUAGE_LABELS[l]}</option>)}
            </select>
          </div>
          <button onClick={load} style={btn()}>Apply</button>
        </FilterBar>

        <StateBlock loading={loading} error={error} empty={!rows.length} emptyText="No content items.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th()}>Title</th><th style={th()}>Kind</th><th style={th()}>Lang</th>
                <th style={th()}>State</th><th style={th()}>Ver</th><th style={th()}>Clinician sign-off</th>
                <th style={th()}>Updated</th><th style={th()}>Actions</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={td()}><div style={{ fontWeight: 600 }}>{r.title}</div><div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.body_preview.slice(0, 80)}{r.body_preview.length > 80 ? '…' : ''}</div></td>
                    <td style={td()}>{KIND_LABELS[r.kind]}</td>
                    <td style={td()}>{LANGUAGE_LABELS[r.language] ?? r.language}</td>
                    <td style={td()}><Badge status={r.state} /></td>
                    <td style={td()}>v{r.version}</td>
                    <td style={td()}>{r.reviewer_id ? <span style={{ color: '#15803d' }}>✓ {r.reviewer_id}<div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{fmtDate(r.signed_off_at)}</div></span> : <span style={{ color: '#b91c1c', fontSize: '0.78rem' }}>Not signed off</span>}</td>
                    <td style={td()}>{timeAgo(r.updated_at)}</td>
                    <td style={td()}>
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        {(NEXT_ACTIONS[r.state] ?? []).map((a) => (
                          <button key={a} disabled={busy === r.id} onClick={() => act(r.id, a)} style={a === 'publish' ? { ...btnPrimary(), fontSize: '0.75rem', padding: '0.25rem 0.55rem' } : { ...btn(), fontSize: '0.75rem', padding: '0.25rem 0.55rem' }} title={a === 'publish' && !r.reviewer_id ? 'Requires clinician sign-off (SC-6)' : undefined}>{ACTION_LABEL[a]}</button>
                        ))}
                        {!(NEXT_ACTIONS[r.state] ?? []).length ? <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>—</span> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StateBlock>
      </Card>
    </div>
  );
}
