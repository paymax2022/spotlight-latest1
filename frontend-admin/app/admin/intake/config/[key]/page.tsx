'use client';

import { use, useEffect, useState } from 'react';
import type { IntakeConfig, ReminderConfigValue, SummaryTemplateValue, ContentLocalizationValue } from '@/types/intakeAdmin';
import { getConfig, saveConfig } from '@/services/intakeAdminService';
import { BackLink, PageHeader, Notice, card, btn, btnPrimary, input, useIntakePermissions, INTAKE_PERMS } from '../../_ui';

// A5/A6/A7 share one config endpoint keyed by config_key. The console maps the
// friendly route slug to the backend key and renders the matching editor.
const SLUG_MAP: Record<string, { key: string; code: string; title: string; subtitle: string }> = {
  reminder: { key: 'reminder', code: 'A5', title: 'Reminder Settings', subtitle: 'Timing offsets (hours before the appointment) and channels for intake-completion reminders.' },
  summary: { key: 'summary_template', code: 'A6', title: 'Doctor Summary Template', subtitle: 'Order the sections of the clinician-facing intake summary (§6) and choose which are highlighted.' },
  content: { key: 'content_localization', code: 'A7', title: 'Content & Localization', subtitle: 'Question text, urgent-care and crisis guidance copy. Keep urgent and crisis copy calm and supportive.' },
};

export default function ConfigPage({ params }: { params: Promise<{ key: string }> }) {
  const { key: slug } = use(params);
  const meta = SLUG_MAP[slug];
  const { can } = useIntakePermissions();
  const canManage = can(INTAKE_PERMS.manage);

  const [config, setConfig] = useState<IntakeConfig | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!meta) { setLoading(false); return; }
    void (async () => {
      setLoading(true);
      try {
        const c = await getConfig(meta.key);
        setConfig(c);
        setDraft(c.value);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [meta]);

  if (!meta) {
    return (
      <div>
        <BackLink />
        <p style={{ color: 'salmon' }}>Unknown config section: {slug}</p>
      </div>
    );
  }

  const onSave = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      await saveConfig(meta.key, draft);
      setMessage('Configuration saved.');
    } catch (e) {
      setError(`Save failed: ${String(e)}`);
    } finally { setBusy(false); }
  };

  return (
    <div>
      <BackLink />
      <PageHeader title={`${meta.code} · ${meta.title}`} subtitle={meta.subtitle} />
      {slug === 'content' ? (
        <Notice kind="support">Urgent and crisis copy is shown to patients at a vulnerable moment. Keep it calm, supportive, and free of alarmist or stigmatizing language.</Notice>
      ) : null}

      {message ? <p style={{ color: 'lightgreen' }}>{message}</p> : null}
      {error ? <p style={{ color: 'salmon' }}>{error}</p> : null}
      {loading ? <p style={{ opacity: 0.6, marginTop: 16 }}>Loading…</p> : null}

      {config && !loading ? (
        <div style={{ ...card, marginTop: 16, display: 'grid', gap: 14 }}>
          {slug === 'reminder' ? <ReminderEditor value={draft as unknown as ReminderConfigValue} onChange={setDraft} disabled={!canManage} /> : null}
          {slug === 'summary' ? <SummaryEditor value={draft as unknown as SummaryTemplateValue} onChange={setDraft} disabled={!canManage} /> : null}
          {slug === 'content' ? <ContentEditor value={draft as unknown as ContentLocalizationValue} onChange={setDraft} disabled={!canManage} /> : null}

          <div>
            <button style={canManage ? btnPrimary : { ...btn, opacity: 0.5, cursor: 'not-allowed' }} disabled={busy || !canManage} title={!canManage ? 'Requires health.admin.intake' : 'Save configuration'} onClick={() => void onSave()}>
              {busy ? 'Saving…' : 'Save configuration'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const label: React.CSSProperties = { fontSize: 12, opacity: 0.8, display: 'block', marginBottom: 4 };

function ReminderEditor({ value, onChange, disabled }: { value: ReminderConfigValue; onChange: (v: Record<string, unknown>) => void; disabled: boolean }) {
  const offsets = (value.offsets_hours ?? []).join(', ');
  const channels = (value.channels ?? []).join(', ');
  return (
    <>
      <div>
        <label style={label}>Enabled</label>
        <input type="checkbox" checked={!!value.enabled} disabled={disabled} onChange={(e) => onChange({ ...value, enabled: e.target.checked })} />
      </div>
      <div>
        <label style={label}>Offsets (hours before appointment, comma-separated)</label>
        <input style={{ ...input, width: '100%' }} disabled={disabled} value={offsets} onChange={(e) => onChange({ ...value, offsets_hours: e.target.value.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)) })} />
      </div>
      <div>
        <label style={label}>Channels (comma-separated)</label>
        <input style={{ ...input, width: '100%' }} disabled={disabled} value={channels} onChange={(e) => onChange({ ...value, channels: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
      </div>
    </>
  );
}

function SummaryEditor({ value, onChange, disabled }: { value: SummaryTemplateValue; onChange: (v: Record<string, unknown>) => void; disabled: boolean }) {
  const order = value.section_order ?? [];
  const move = (idx: number, dir: -1 | 1) => {
    const next = [...order];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange({ ...value, section_order: next });
  };
  return (
    <div>
      <label style={label}>Section order (top → bottom). Highlighted sections are shown in bold to the doctor.</label>
      <div style={{ display: 'grid', gap: 6 }}>
        {order.map((s, idx) => {
          const highlighted = (value.highlight_sections ?? []).includes(s);
          return (
            <div key={s} style={{ display: 'flex', gap: 8, alignItems: 'center', border: '1px solid #2a2a2a', borderRadius: 6, padding: '6px 10px' }}>
              <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}>{idx + 1}. {s}{highlighted ? <span style={{ marginLeft: 8, color: '#fde68a', fontSize: 11 }}>★ highlighted</span> : null}</span>
              <button style={{ ...btn, padding: '2px 8px' }} disabled={disabled || idx === 0} onClick={() => move(idx, -1)}>↑</button>
              <button style={{ ...btn, padding: '2px 8px' }} disabled={disabled || idx === order.length - 1} onClick={() => move(idx, 1)}>↓</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ContentEditor({ value, onChange, disabled }: { value: ContentLocalizationValue; onChange: (v: Record<string, unknown>) => void; disabled: boolean }) {
  const questions = value.questions ?? {};
  const setQuestion = (k: string, v: string) => onChange({ ...value, questions: { ...questions, [k]: v } });
  return (
    <>
      <div>
        <label style={label}>Locale</label>
        <input style={{ ...input, width: 120 }} disabled={disabled} value={value.locale ?? ''} onChange={(e) => onChange({ ...value, locale: e.target.value })} />
      </div>
      <div>
        <label style={label}>Urgent-care copy</label>
        <textarea style={{ ...input, width: '100%', height: 70 }} disabled={disabled} value={value.urgent_care_copy ?? ''} onChange={(e) => onChange({ ...value, urgent_care_copy: e.target.value })} />
      </div>
      <div>
        <label style={label}>Crisis copy (calm, supportive)</label>
        <textarea style={{ ...input, width: '100%', height: 90 }} disabled={disabled} value={value.crisis_copy ?? ''} onChange={(e) => onChange({ ...value, crisis_copy: e.target.value })} />
      </div>
      <div>
        <label style={label}>Question text</label>
        <div style={{ display: 'grid', gap: 8 }}>
          {Object.entries(questions).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 11, width: 180, opacity: 0.7 }}>{k}</span>
              <input style={{ ...input, flex: 1 }} disabled={disabled} value={v} onChange={(e) => setQuestion(k, e.target.value)} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
