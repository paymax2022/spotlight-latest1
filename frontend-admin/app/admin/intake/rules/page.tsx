'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { RedFlagRule, RedFlagSeverity, RedFlagRouting } from '@/types/intakeAdmin';
import { listRules, upsertRule, toggleRule } from '@/services/intakeAdminService';
import { Page, PageHeader, Card, Button, Input, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';
import { useIntakePermissions, INTAKE_PERMS } from '../_ui';

const SEVERITIES: RedFlagSeverity[] = ['emergency', 'urgent'];
const ROUTINGS: RedFlagRouting[] = ['EMERGENCY', 'URGENT_CARE', 'CRISIS'];

const SEVERITY_COLORS: Record<string, string> = {
  emergency: colors.danger,
  urgent: colors.warning,
};

const ROUTING_COLORS: Record<string, string> = {
  EMERGENCY: colors.danger,
  URGENT_CARE: colors.warning,
  CRISIS: colors.info,
};

const emptyRule: RedFlagRule = {
  code: '', label: '', match_json: '{"field":"reason_for_visit","contains":[]}',
  level: 4, severity: 'urgent', routing: 'URGENT_CARE', guidance_key: '', active: true, version: 1,
};

function Notice({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: tint(colors.success, 0.12), border: `1px solid ${tint(colors.success, 0.3)}`, color: colors.text, padding: '10px 12px', borderRadius: 8, fontSize: 13, marginTop: 14, display: 'flex', gap: 8 }}>
      <span aria-hidden>🤝</span>
      <span>{children}</span>
    </div>
  );
}

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

  const onToggle = async (code: string, nextActive: boolean) => {
    setBusy(true); setError(''); setMessage('');
    try {
      await toggleRule(code, nextActive);
      setRules((rs) => rs.map((r) => (r.code === code ? { ...r, active: nextActive } : r)));
      setMessage(`Toggled rule ${code}.`);
    } catch (e) {
      setError(`Toggle failed: ${String(e)}`);
    } finally { setBusy(false); }
  };

  return (
    <Page>
      <div style={{ marginBottom: 14 }}>
        <Link href="/admin/intake" style={{ fontSize: 13, color: colors.primary }}>← Intake console</Link>
      </div>
      <PageHeader
        title="A2 · Red-flag Rules"
        subtitle="Define which patient answers trigger the safety triage gate, and the guidance and routing each produces. These are a product-safety gate (§5), not form fields."
        actions={
          <Button
            variant="primary"
            disabled={!canManage}
            title={!canManage ? 'Requires health.admin.intake' : 'Add a new rule'}
            onClick={() => { setForm(emptyRule); setShowForm((s) => !s); }}
          >
            {showForm ? 'Close' : '+ Add rule'}
          </Button>
        }
      />
      <Notice>
        Crisis-routed rules (e.g. self-harm) connect a patient to supportive help. Keep labels and guidance compassionate and non-judgemental.
      </Notice>

      {message ? <p style={{ color: colors.success }}>{message}</p> : null}
      {error ? <p style={{ color: colors.danger }}>{error}</p> : null}

      {showForm ? (
        <Card style={{ marginTop: 14, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
          <label style={{ fontSize: 12 }}>code<Input style={{ width: '100%' }} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} /></label>
          <label style={{ fontSize: 12, gridColumn: 'span 2' }}>label<Input style={{ width: '100%' }} value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} /></label>
          <label style={{ fontSize: 12 }}>level (1–5)<Input type="number" min={1} max={5} style={{ width: '100%' }} value={form.level} onChange={(e) => setForm((f) => ({ ...f, level: Number(e.target.value) }))} /></label>
          <label style={{ fontSize: 12 }}>severity
            <select className="vx-input" style={{ width: '100%' }} value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value as RedFlagSeverity }))}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12 }}>routing
            <select className="vx-input" style={{ width: '100%' }} value={form.routing} onChange={(e) => setForm((f) => ({ ...f, routing: e.target.value as RedFlagRouting }))}>
              {ROUTINGS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12 }}>guidance_key<Input style={{ width: '100%' }} value={form.guidance_key} onChange={(e) => setForm((f) => ({ ...f, guidance_key: e.target.value }))} /></label>
          <label style={{ fontSize: 12 }}>version<Input type="number" min={1} style={{ width: '100%' }} value={form.version} onChange={(e) => setForm((f) => ({ ...f, version: Number(e.target.value) }))} /></label>
          <label style={{ fontSize: 12, gridColumn: 'span 3' }}>match_json<textarea className="vx-input" style={{ width: '100%', height: 60, fontFamily: 'monospace', fontSize: 11 }} value={form.match_json} onChange={(e) => setForm((f) => ({ ...f, match_json: e.target.value }))} /></label>
          <div style={{ gridColumn: 'span 3' }}>
            <Button variant="primary" disabled={busy || !canManage} onClick={() => void onSave()}>{busy ? 'Saving…' : 'Save rule'}</Button>
          </div>
        </Card>
      ) : null}

      {loading ? <p style={{ color: colors.muted, marginTop: 16 }}>Loading…</p> : (
        <Card style={{ padding: 0, overflow: 'hidden', marginTop: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Code', 'Label', 'Match', 'Level', 'Severity', 'Routing', 'Guidance', 'Active', ''].map((h) => <th key={h} style={thCell}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.code}>
                  <td style={{ ...tdCell, fontFamily: 'monospace', fontSize: 11 }}>{r.code}<div style={{ color: colors.muted }}>v{r.version}</div></td>
                  <td style={tdCell}>{r.label}</td>
                  <td style={{ ...tdCell, maxWidth: 220, fontFamily: 'monospace', fontSize: 10, color: colors.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.match_json}</td>
                  <td style={tdCell}>{r.level}</td>
                  <td style={tdCell}><Badge text={r.severity} color={SEVERITY_COLORS[r.severity] ?? colors.secondary} /></td>
                  <td style={tdCell}><Badge text={r.routing === 'CRISIS' ? 'Crisis support' : r.routing.replace(/_/g, ' ').toLowerCase()} color={ROUTING_COLORS[r.routing] ?? colors.secondary} /></td>
                  <td style={{ ...tdCell, fontFamily: 'monospace', fontSize: 11, color: colors.muted }}>{r.guidance_key}</td>
                  <td style={tdCell}><Badge text={r.active ? 'active' : 'inactive'} color={r.active ? colors.success : colors.secondary} /></td>
                  <td style={tdCell}>
                    <Button variant="outline" sm disabled={!canManage} onClick={() => edit(r)}>Edit</Button>{' '}
                    <Button variant="outline" sm disabled={busy || !canManage} onClick={() => void onToggle(r.code, !r.active)}>{r.active ? 'Disable' : 'Enable'}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Page>
  );
}
