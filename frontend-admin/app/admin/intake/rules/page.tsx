'use client';

import { useCallback, useEffect, useState } from 'react';
import type { RedFlagRule, RedFlagSeverity, RedFlagRouting } from '@/types/intakeAdmin';
import { listRules, upsertRule, toggleRule } from '@/services/intakeAdminService';
import { BackLink, PageHeader, Notice, card, th, td, btn, btnPrimary, input, SeverityBadge, RoutingBadge, ActiveBadge, useIntakePermissions, INTAKE_PERMS } from '../_ui';

const SEVERITIES: RedFlagSeverity[] = ['emergency', 'urgent'];
const ROUTINGS: RedFlagRouting[] = ['EMERGENCY', 'URGENT_CARE', 'CRISIS'];

const emptyRule: RedFlagRule = {
  code: '', label: '', match_json: '{"field":"reason_for_visit","contains":[]}',
  level: 4, severity: 'urgent', routing: 'URGENT_CARE', guidance_key: '', active: true, version: 1,
};

export default function RulesPage() {
  const { can } = useIntakePermissions();
  const canManage = can(INTAKE_PERMS.manage);

  const [rules, setRules] = useState<RedFlagRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<RedFlagRule>(emptyRule);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRules(await listRules());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const edit = (r: RedFlagRule) => { setForm({ ...r }); setShowForm(true); };

  const onSave = async () => {
    if (!form.code.trim() || !form.label.trim()) { setError('code and label are required.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      await upsertRule(form);
      setMessage(`Saved rule ${form.code}.`);
      setShowForm(false);
      setForm(emptyRule);
      await load();
    } catch (e) {
      setError(`Save failed: ${String(e)}`);
    } finally { setBusy(false); }
  };

  const onToggle = async (code: string) => {
    setBusy(true); setError(''); setMessage('');
    try {
      await toggleRule(code);
      setRules((rs) => rs.map((r) => (r.code === code ? { ...r, active: !r.active } : r)));
      setMessage(`Toggled rule ${code}.`);
    } catch (e) {
      setError(`Toggle failed: ${String(e)}`);
    } finally { setBusy(false); }
  };

  return (
    <div>
      <BackLink />
      <PageHeader
        title="A2 · Red-flag Rules"
        subtitle="Define which patient answers trigger the safety triage gate, and the guidance and routing each produces. These are a product-safety gate (§5), not form fields."
        action={
          <button
            style={canManage ? btnPrimary : { ...btn, opacity: 0.5, cursor: 'not-allowed' }}
            disabled={!canManage}
            title={!canManage ? 'Requires health.admin.intake' : 'Add a new rule'}
            onClick={() => { setForm(emptyRule); setShowForm((s) => !s); }}
          >
            {showForm ? 'Close' : '+ Add rule'}
          </button>
        }
      />
      <Notice kind="support">
        Crisis-routed rules (e.g. self-harm) connect a patient to supportive help. Keep labels and guidance compassionate and non-judgemental.
      </Notice>

      {message ? <p style={{ color: 'lightgreen' }}>{message}</p> : null}
      {error ? <p style={{ color: 'salmon' }}>{error}</p> : null}

      {showForm ? (
        <div style={{ ...card, marginTop: 14, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
          <label style={{ fontSize: 12 }}>code<input style={{ ...input, width: '100%' }} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} /></label>
          <label style={{ fontSize: 12, gridColumn: 'span 2' }}>label<input style={{ ...input, width: '100%' }} value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} /></label>
          <label style={{ fontSize: 12 }}>level (1–5)<input type="number" min={1} max={5} style={{ ...input, width: '100%' }} value={form.level} onChange={(e) => setForm((f) => ({ ...f, level: Number(e.target.value) }))} /></label>
          <label style={{ fontSize: 12 }}>severity
            <select style={{ ...input, width: '100%' }} value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value as RedFlagSeverity }))}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12 }}>routing
            <select style={{ ...input, width: '100%' }} value={form.routing} onChange={(e) => setForm((f) => ({ ...f, routing: e.target.value as RedFlagRouting }))}>
              {ROUTINGS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12 }}>guidance_key<input style={{ ...input, width: '100%' }} value={form.guidance_key} onChange={(e) => setForm((f) => ({ ...f, guidance_key: e.target.value }))} /></label>
          <label style={{ fontSize: 12 }}>version<input type="number" min={1} style={{ ...input, width: '100%' }} value={form.version} onChange={(e) => setForm((f) => ({ ...f, version: Number(e.target.value) }))} /></label>
          <label style={{ fontSize: 12, gridColumn: 'span 3' }}>match_json<textarea style={{ ...input, width: '100%', height: 60, fontFamily: 'monospace', fontSize: 11 }} value={form.match_json} onChange={(e) => setForm((f) => ({ ...f, match_json: e.target.value }))} /></label>
          <div style={{ gridColumn: 'span 3' }}>
            <button style={btnPrimary} disabled={busy || !canManage} onClick={() => void onSave()}>{busy ? 'Saving…' : 'Save rule'}</button>
          </div>
        </div>
      ) : null}

      {loading ? <p style={{ opacity: 0.6, marginTop: 16 }}>Loading…</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 16 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2a2a', textAlign: 'left' }}>
              {['Code', 'Label', 'Match', 'Level', 'Severity', 'Routing', 'Guidance', 'Active', ''].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.code} style={{ borderBottom: '1px solid #1c1c1c' }}>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{r.code}<div style={{ opacity: 0.4 }}>v{r.version}</div></td>
                <td style={td}>{r.label}</td>
                <td style={{ ...td, maxWidth: 220, fontFamily: 'monospace', fontSize: 10, opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.match_json}</td>
                <td style={td}>{r.level}</td>
                <td style={td}><SeverityBadge severity={r.severity} /></td>
                <td style={td}><RoutingBadge routing={r.routing} /></td>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: 11, opacity: 0.7 }}>{r.guidance_key}</td>
                <td style={td}><ActiveBadge active={r.active} /></td>
                <td style={td}>
                  <button style={{ ...btn, padding: '2px 8px' }} disabled={!canManage} onClick={() => edit(r)}>Edit</button>{' '}
                  <button style={{ ...btn, padding: '2px 8px' }} disabled={busy || !canManage} onClick={() => void onToggle(r.code)}>{r.active ? 'Disable' : 'Enable'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
