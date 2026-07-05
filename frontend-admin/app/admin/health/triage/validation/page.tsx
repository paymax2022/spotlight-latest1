'use client';

import { useEffect, useState } from 'react';
import {
  runValidation, listVignettes, listLanguagePacks, DISPOSITION_LABELS, LANGUAGE_LABELS, pct,
} from '@/services/healthTriageAdminService';
import type { ValidationRun, Vignette, LanguagePack, LanguageParity } from '@/types/healthTriageAdmin';
import {
  PageHeader, TriageTabs, Card, Badge, DisclosureNote, StateBlock,
  btn, btnPrimary, th, td, timeAgo,
} from '../../_ui';

// CSS bar with a label + value (no chart libs).
function Bar({ label: lbl, value, color, danger }: { label: string; value: number; color: string; danger?: boolean }) {
  return (
    <div style={{ marginBottom: '0.55rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#374151', marginBottom: 2 }}>
        <span>{lbl}</span>
        <strong style={{ color: danger && value > 0.02 ? '#b91c1c' : '#111827' }}>{pct(value)}</strong>
      </div>
      <div style={{ height: 10, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(value * 100, 100)}%`, background: color, borderRadius: 4 }} />
      </div>
    </div>
  );
}

function ParityBlock({ title, p }: { title: string; p: LanguageParity }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.85rem 1rem', background: '#fff' }}>
      <div style={{ fontWeight: 700, marginBottom: '0.6rem' }}>{title}</div>
      <Bar label="Emergency sensitivity" value={p.emergency_sensitivity} color="#15803d" />
      <Bar label="Level accuracy" value={p.level_accuracy} color="#1d4ed8" />
      <Bar label="Over-triage (controlled)" value={p.over_triage} color="#9a3412" />
      <Bar label="Under-triage (must be ~0)" value={p.under_triage} color="#b91c1c" danger />
    </div>
  );
}

export default function TriageValidationPage() {
  const [run, setRun] = useState<ValidationRun | null>(null);
  const [vignettes, setVignettes] = useState<Vignette[]>([]);
  const [packs, setPacks] = useState<LanguagePack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function loadStatic() {
    setLoading(true); setError(null);
    try {
      const [v, lp] = await Promise.all([listVignettes(), listLanguagePacks()]);
      setVignettes(v); setPacks(lp);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadStatic(); }, []);

  async function run_() {
    setRunning(true); setError(null);
    try { setRun(await runValidation()); }
    catch (e) { setError(String(e)); }
    finally { setRunning(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Validation & accuracy"
        subtitle="Shadow-mode evaluation against the African clinical-vignette panel, run before any real patient. EMERGENCY SENSITIVITY is the headline gate (SC-3) — accuracy is secondary to never missing an emergency."
        action={<button disabled={running} onClick={run_} style={{ ...btnPrimary(), opacity: running ? 0.6 : 1 }}>{running ? 'Running shadow eval…' : 'Run shadow eval'}</button>}
      />
      <TriageTabs active="validation" />

      <DisclosureNote>
        Triage safety is not the same as diagnostic accuracy. We optimise EMERGENCY SENSITIVITY first — the
        share of true emergencies the system correctly escalates — accepting controlled over-triage (SC-3).
        Validation runs in shadow mode against a clinician-panel vignette set before directing any real patient,
        and accuracy must hold across languages (cross-language parity). Under-triage (a missed/under-referred
        emergency) is a release blocker and must be ~0.
      </DisclosureNote>

      {run ? (
        <>
          {/* Headline: EMERGENCY SENSITIVITY first, as a big number. */}
          <div style={{ border: '2px solid #15803d', background: '#f0fdf4', borderRadius: '0.75rem', padding: '1.25rem 1.5rem', marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: 0.4, color: '#15803d', fontWeight: 700 }}>Emergency sensitivity — the metric that matters most (SC-3)</div>
              <div style={{ fontSize: '3rem', fontWeight: 800, color: '#15803d', lineHeight: 1.05, marginTop: '0.25rem' }}>{pct(run.emergency_sensitivity)}</div>
              <div style={{ fontSize: '0.8rem', color: '#374151', marginTop: '0.25rem' }}>True emergencies correctly escalated · target near-100% (≈0 missed)</div>
            </div>
            <div style={{ textAlign: 'right', fontSize: '0.78rem', color: '#6b7280' }}>
              {run.shadow_mode ? <Badge status="investigating" label="Shadow mode" /> : <Badge status="active" label="Live eval" />}
              <div style={{ marginTop: '0.4rem' }}>{run.vignette_count.toLocaleString('en-NG')} vignettes</div>
              <div>ran {timeAgo(run.ran_at)}</div>
            </div>
          </div>

          <Card title="Secondary metrics">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem' }}>
              <div>
                <Bar label="Over-triage (controlled over-referral — acceptable)" value={run.over_triage} color="#9a3412" />
                <Bar label="Under-triage (missed/under-referred — release blocker, must be ~0)" value={run.under_triage} color="#b91c1c" danger />
                <Bar label="Level accuracy (exact 5-level agreement)" value={run.level_accuracy} color="#1d4ed8" />
              </div>
            </div>
            <p style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: 0 }}>{run.notes}</p>
          </Card>

          <Card title="Per-language parity (en vs pcm)">
            <p style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: 0 }}>Accuracy must hold across languages — vernacular must not degrade safety (SC-3).</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
              <ParityBlock title="English (en)" p={run.by_language.en} />
              <ParityBlock title="Pidgin (pcm)" p={run.by_language.pcm} />
            </div>
          </Card>
        </>
      ) : (
        <Card title="No run yet">
          <p style={{ color: '#6b7280', margin: 0 }}>Click <strong>Run shadow eval</strong> to evaluate the engine + red-flag layer against the clinician-panel vignette set. The headline emergency-sensitivity figure appears here first.</p>
        </Card>
      )}

      <Card title="Language packs">
        <StateBlock loading={loading} error={error} empty={!packs.length} emptyText="No language packs.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th()}>Language</th><th style={th()}>Voice</th><th style={th()}>Coverage</th>
                <th style={th()}>Published</th><th style={th()}>Pending sign-off</th><th style={th()}>Parity</th>
              </tr></thead>
              <tbody>
                {packs.map((p) => (
                  <tr key={p.code}>
                    <td style={td()}>{p.label} <code style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{p.code}</code></td>
                    <td style={td()}>{p.voice_supported ? <Badge status="active" label="Voice" /> : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                    <td style={td()}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <div style={{ width: 90, height: 8, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden' }}><div style={{ height: '100%', width: `${p.coverage_pct * 100}%`, background: '#340075' }} /></div>
                        <span style={{ fontSize: '0.74rem', color: '#6b7280' }}>{pct(p.coverage_pct)}</span>
                      </div>
                    </td>
                    <td style={td()}>{p.content_published}</td>
                    <td style={td()}>{p.content_pending > 0 ? <span style={{ color: '#9a3412' }}>{p.content_pending}</span> : 0}</td>
                    <td style={td()}>{p.parity_ok ? <Badge status="active" label="Parity OK" /> : <Badge status="pending" label="Below parity" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StateBlock>
      </Card>

      <Card title="Clinical vignette set">
        <StateBlock loading={loading} error={error} empty={!vignettes.length} emptyText="No vignettes.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th()}>Vignette</th><th style={th()}>Lang</th><th style={th()}>Category</th>
                <th style={th()}>Expected (gold)</th><th style={th()}>Last eval</th><th style={th()}>Result</th>
              </tr></thead>
              <tbody>
                {vignettes.map((v) => {
                  const match = v.last_eval_level === v.expected_level;
                  const missedEmergency = v.is_emergency && v.last_eval_level !== null && v.last_eval_level !== 'emergency_ambulance' && v.last_eval_level !== 'emergency_urgent';
                  return (
                    <tr key={v.id}>
                      <td style={td()}>{v.title}{v.is_emergency ? <Badge status="emergency" label="Emergency" /> : null}</td>
                      <td style={td()}>{LANGUAGE_LABELS[v.language] ?? v.language}</td>
                      <td style={td()}>{v.category}</td>
                      <td style={td()}><Badge status={v.expected_level} label={DISPOSITION_LABELS[v.expected_level]} /></td>
                      <td style={td()}>{v.last_eval_level ? <Badge status={v.last_eval_level} label={DISPOSITION_LABELS[v.last_eval_level]} /> : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                      <td style={td()}>{missedEmergency ? <span style={{ color: '#b91c1c', fontWeight: 700 }}>⚠ Missed emergency</span> : match ? <span style={{ color: '#15803d' }}>✓ Exact</span> : <span style={{ color: '#9a3412' }}>Off-level (safe)</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </StateBlock>
      </Card>
    </div>
  );
}
