'use client';

import { useEffect, useState } from 'react';
import {
  listRedFlagRules, createRedFlagRule, governRedFlagRule, DISPOSITION_LABELS,
} from '@/services/healthTriageAdminService';
import type { RedFlagRule, RedFlagRuleInput, GovernanceAction, DispositionLevel } from '@/types/healthTriageAdmin';
import {
  PageHeader, TriageTabs, Card, Badge, DisclosureNote, StateBlock, AuditNote, FilterBar,
  btn, btnPrimary, th, td, select, input, label, timeAgo, fmtDate,
} from '../../_ui';

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

// Disposition levels ordered by urgency — used to show that a rule only RAISES.
const URGENCY: DispositionLevel[] = ['self_care', 'consult_routine', 'consult_24h', 'emergency_urgent', 'emergency_ambulance'];

const DEFAULT_CONDITION = JSON.stringify({ any_of: ['symptom_code_a', 'symptom_code_b'], with: ['acute_onset'] }, null, 2);

export default function TriageRedFlagRulesPage() {
  const [rows, setRows] = useState<RedFlagRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stateF, setStateF] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [escalateTo, setEscalateTo] = useState<DispositionLevel>('emergency_urgent');
  const [rationale, setRationale] = useState('');
  const [conditionText, setConditionText] = useState(DEFAULT_CONDITION);
  const [jsonError, setJsonError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listRedFlagRules({ state: stateF || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [stateF]);

  async function act(id: string, action: GovernanceAction) {
    setBusy(id); setResult(null);
    try { const r = await governRedFlagRule(id, action); setResult(r.message); await load(); }
    catch (e) { setResult(String(e)); }
    finally { setBusy(null); }
  }

  async function submitNew() {
    setJsonError(null);
    let condition: Record<string, unknown>;
    try { condition = JSON.parse(conditionText) as Record<string, unknown>; }
    catch { setJsonError('Condition must be valid JSON.'); return; }
    if (!name.trim()) return;
    const input: RedFlagRuleInput = { name, escalate_to: escalateTo, condition, rationale };
    setCreating(true); setResult(null);
    try { const r = await createRedFlagRule(input); setResult(`Draft rule created: ${r.id} (${r.name}). It escalates to "${DISPOSITION_LABELS[r.escalate_to]}". Requires clinician sign-off before publish (SC-6).`); setName(''); setRationale(''); setConditionText(DEFAULT_CONDITION); await load(); }
    catch (e) { setResult(String(e)); }
    finally { setCreating(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Red-flag rule governance"
        subtitle="Deterministic, clinician-authored rules that drive emergency detection. A rule can ONLY raise urgency toward its escalate-to level — it never lowers a disposition (SC-2). Same lifecycle as content; publish requires clinician sign-off (SC-6)."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <TriageTabs active="red-flag-rules" />

      <DisclosureNote>
        The red-flag layer is the core safety mechanism. <strong>Rules are deterministic and can ALWAYS
        override the engine toward HIGHER urgency — never toward lower urgency (SC-2)</strong>; emergency
        detection is never left to probability alone (SC-3). Like clinical content, a red-flag rule needs a
        licensed-clinician review &amp; sign-off before it is PUBLISHED (SC-6). Rules are versioned and every
        change is written to the immutable audit (SC-12).
      </DisclosureNote>

      {result ? <div style={{ border: '1px solid #ddd6fe', background: '#f5f3ff', color: '#5b21b6', borderRadius: '0.5rem', padding: '0.6rem 0.8rem', fontSize: '0.82rem', marginBottom: '1rem' }}>{result}</div> : null}

      <Card title="New red-flag rule (draft)">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.6rem', alignItems: 'flex-start' }}>
          <div>
            <label style={label()}>Rule name</label>
            <input style={input()} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cardiac/stroke red-flag" />
          </div>
          <div>
            <label style={label()}>Escalate urgency to</label>
            <select style={select()} value={escalateTo} onChange={(e) => setEscalateTo(e.target.value as DispositionLevel)}>
              {URGENCY.slice().reverse().map((l) => <option key={l} value={l}>{DISPOSITION_LABELS[l]}</option>)}
            </select>
            <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: 4 }}>Rules only RAISE urgency to this level (SC-2).</div>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={label()}>Rationale (clinical)</label>
            <input style={input()} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Why this is a red flag — plain language." />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={label()}>Condition (JSON / jsonb)</label>
            <textarea style={{ ...input(), minHeight: 120, fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem' }} value={conditionText} onChange={(e) => setConditionText(e.target.value)} spellCheck={false} />
            {jsonError ? <div style={{ color: '#b91c1c', fontSize: '0.74rem', marginTop: 4 }}>{jsonError}</div> : null}
          </div>
          <div>
            <button disabled={creating || !name.trim()} onClick={submitNew} style={{ ...btnPrimary(), opacity: creating || !name.trim() ? 0.5 : 1 }}>Create draft</button>
          </div>
        </div>
        <AuditNote>New rules start in DRAFT and cannot be published until a clinician signs off in APPROVED (SC-6).</AuditNote>
      </Card>

      <Card title="Rules">
        <FilterBar>
          <div>
            <label style={label()}>State</label>
            <select style={select()} value={stateF} onChange={(e) => setStateF(e.target.value)}>
              <option value="">All</option>
              {['draft', 'clinical_review', 'approved', 'published', 'deprecated'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <button onClick={load} style={btn()}>Apply</button>
        </FilterBar>

        <StateBlock loading={loading} error={error} empty={!rows.length} emptyText="No red-flag rules.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {rows.map((r) => (
              <div key={r.id} style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.85rem 1rem', background: r.state === 'deprecated' ? '#fafafa' : '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: '0.9rem' }}>{r.name}</strong>
                    <code style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{r.id}</code>
                    <Badge status={r.state} /><span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>v{r.version}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.72rem', color: '#6b7280' }}>raises to</span>
                    <Badge status={r.escalate_to} label={DISPOSITION_LABELS[r.escalate_to]} />
                  </div>
                </div>
                <p style={{ margin: '0.5rem 0', fontSize: '0.82rem', color: '#374151' }}>{r.rationale}</p>
                <pre style={{ margin: 0, background: '#f9fafb', border: '1px solid #f3f4f6', borderRadius: '0.375rem', padding: '0.5rem 0.6rem', fontSize: '0.74rem', overflowX: 'auto', color: '#374151' }}>{JSON.stringify(r.condition, null, 2)}</pre>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.6rem' }}>
                  <div style={{ fontSize: '0.74rem' }}>
                    {r.reviewer_id ? <span style={{ color: '#15803d' }}>✓ Clinician sign-off: {r.reviewer_id} · {fmtDate(r.signed_off_at)}</span> : <span style={{ color: '#b91c1c' }}>Not signed off — cannot publish (SC-6)</span>}
                    <span style={{ color: '#9ca3af', marginLeft: 8 }}>updated {timeAgo(r.updated_at)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    {(NEXT_ACTIONS[r.state] ?? []).map((a) => (
                      <button key={a} disabled={busy === r.id} onClick={() => act(r.id, a)} style={a === 'publish' ? { ...btnPrimary(), fontSize: '0.75rem', padding: '0.25rem 0.55rem' } : { ...btn(), fontSize: '0.75rem', padding: '0.25rem 0.55rem' }} title={a === 'publish' && !r.reviewer_id ? 'Requires clinician sign-off (SC-6)' : undefined}>{ACTION_LABEL[a]}</button>
                    ))}
                    {!(NEXT_ACTIONS[r.state] ?? []).length ? <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>terminal</span> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </StateBlock>
      </Card>
    </div>
  );
}
