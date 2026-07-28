'use client';

import { useEffect, useState } from 'react';
import {
  getTriageStats, listSessions, DISPOSITION_LABELS, LANGUAGE_LABELS, pct,
} from '@/services/healthTriageAdminService';
import type { TriageSession, TriageSessionStats } from '@/types/healthTriageAdmin';
import {
  PageHeader, TriageTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, FilterBar,
  btn, th, td, select, input, label, timeAgo,
} from '../_ui';

const LEVEL_BAR: Record<string, string> = {
  emergency_ambulance: '#b91c1c', emergency_urgent: '#dc2626',
  consult_24h: '#9a3412', consult_routine: '#1d4ed8', self_care: '#15803d',
};

export default function TriageSessionsPage() {
  const [stats, setStats] = useState<TriageSessionStats | null>(null);
  const [rows, setRows] = useState<TriageSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState('');
  const [level, setLevel] = useState('');
  const [channel, setChannel] = useState('');
  const [redFlag, setRedFlag] = useState('');
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try {
      const [s, list] = await Promise.all([
        getTriageStats(),
        listSessions({ state: state || undefined, level: level || undefined, channel: channel || undefined, red_flag: redFlag || undefined, q: q || undefined }),
      ]);
      setStats(s); setRows(list);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [state, level, channel, redFlag]);

  const maxChannel = stats ? Math.max(...stats.by_channel.map((c) => c.count), 1) : 1;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Symptom Checker — sessions monitor"
        subtitle="Live triage sessions and disposition mix across app, WhatsApp, USSD/SMS and agent-assisted channels. Triage + navigation only — output is possible causes & guidance, never a diagnosis (SC-1)."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <TriageTabs active="sessions" />

      <DisclosureNote>
        This is a triage &amp; navigation tool — it never presents a diagnosis; output is &ldquo;possible
        causes / guidance&rdquo; (SC-1). A deterministic RED-FLAG layer can ALWAYS override the engine toward
        higher urgency — emergency detection is rules-based, never probability-only (SC-2). On ambiguity the
        system favours safety and over-refers; EMERGENCY SENSITIVITY is optimised first (SC-3). High-risk
        dispositions hand off to licensed humans (SC-5). Sessions run de-identified with explicit consent; PII
        is minimised (SC-7). Every disposition &amp; escalation is written to an immutable audit (SC-12).
      </DisclosureNote>

      <StateBlock loading={loading && !stats} error={error} empty={!stats} emptyText="No triage data available.">
        {stats && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Sessions today" value={stats.sessions_today.toLocaleString('en-NG')} sub={`${stats.total_sessions.toLocaleString('en-NG')} all-time`} accent="#340075" />
              <Kpi label="Red-flag rate" value={pct(stats.red_flag_rate)} sub="deterministic rule fired (SC-2)" accent="#b91c1c" />
              <Kpi label="Emergency share" value={pct(stats.emergency_share)} sub="routed to an emergency level" accent="#b91c1c" />
              <Kpi label="Completion rate" value={pct(stats.completion_rate)} sub="reached a disposition" accent="#15803d" />
              <Kpi label="Open escalations" value={stats.open_escalations.toLocaleString('en-NG')} sub="human-in-loop (SC-5)" accent={stats.open_escalations > 0 ? '#9a3412' : undefined} />
            </div>

            <Card title="Disposition mix (5-level)">
              <p style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: 0 }}>
                Conservative, emergency-sensitivity-first triage (SC-3). Each level maps to a fulfilled care
                action — never a dead-end in advice.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                {stats.by_level.map((l) => (
                  <div key={l.level} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span style={{ width: 180, flexShrink: 0, fontSize: '0.8rem', color: '#374151' }}>
                      <Badge status={l.level} label={DISPOSITION_LABELS[l.level]} />
                    </span>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <div style={{ height: 14, width: `${l.share_pct * 100}%`, minWidth: 2, background: LEVEL_BAR[l.level], borderRadius: 3 }} title={`${l.count}`} />
                      <span style={{ fontSize: '0.72rem', color: '#6b7280', whiteSpace: 'nowrap' }}>{l.count.toLocaleString('en-NG')} · {pct(l.share_pct)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Channel breakdown">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                {stats.by_channel.map((c) => (
                  <div key={c.channel} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span style={{ width: 90, flexShrink: 0, fontSize: '0.78rem', color: '#374151', textTransform: 'capitalize' }}>{c.channel}</span>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <div style={{ height: 12, width: `${(c.count / maxChannel) * 100}%`, minWidth: 2, background: '#340075', borderRadius: 3 }} />
                      <span style={{ fontSize: '0.72rem', color: '#6b7280', whiteSpace: 'nowrap' }}>{c.count.toLocaleString('en-NG')} · {pct(c.share_pct)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}

        <Card title="Recent sessions">
          <FilterBar>
            <div>
              <label style={label()}>State</label>
              <select style={select()} value={state} onChange={(e) => setState(e.target.value)}>
                <option value="">All</option>
                {['interviewing', 'escalated', 'disposition_given', 'referred', 'abandoned'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label style={label()}>Disposition</label>
              <select style={select()} value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="">All</option>
                {Object.keys(DISPOSITION_LABELS).map((l) => <option key={l} value={l}>{DISPOSITION_LABELS[l]}</option>)}
              </select>
            </div>
            <div>
              <label style={label()}>Channel</label>
              <select style={select()} value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="">All</option>
                {['app', 'whatsapp', 'ussd', 'sms', 'agent'].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={label()}>Red flag</label>
              <select style={select()} value={redFlag} onChange={(e) => setRedFlag(e.target.value)}>
                <option value="">All</option>
                <option value="yes">Red-flag only</option>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={label()}>Search</label>
              <input style={input()} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(); }} placeholder="session id / language / channel" />
            </div>
            <button onClick={load} style={btn()}>Apply</button>
          </FilterBar>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th()}>Session</th><th style={th()}>State</th><th style={th()}>Disposition</th>
                <th style={th()}>Red flag</th><th style={th()}>Channel</th><th style={th()}>Language</th>
                <th style={th()}>Profile</th><th style={th()}>Possible causes</th><th style={th()}>Created</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.id}</code></td>
                    <td style={td()}><Badge status={r.state} /></td>
                    <td style={td()}>{r.disposition_level ? <Badge status={r.disposition_level} label={DISPOSITION_LABELS[r.disposition_level]} /> : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                    <td style={td()}>{r.red_flag ? <Badge status="raised" label="Red-flag" /> : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                    <td style={td()}><span style={{ textTransform: 'capitalize' }}>{r.channel}</span></td>
                    <td style={td()}>{LANGUAGE_LABELS[r.language] ?? r.language}</td>
                    <td style={td()}><span style={{ textTransform: 'capitalize' }}>{r.profile_kind}</span>{r.profile_kind === 'child' ? <span title="Paediatric caution (SC-9)" style={{ marginLeft: 4 }}>👶</span> : null}<div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{r.age_band}{r.consent_on_file ? '' : ' · no consent'}</div></td>
                    <td style={td()}>{r.top_condition_count > 0 ? `${r.top_condition_count} surfaced` : '—'}</td>
                    <td style={td()}>{timeAgo(r.created_at)}</td>
                  </tr>
                ))}
                {!rows.length && !loading ? <tr><td style={td()} colSpan={9}><span style={{ color: '#6b7280' }}>No sessions match the filter.</span></td></tr> : null}
              </tbody>
            </table>
          </div>
        </Card>
      </StateBlock>
    </div>
  );
}
