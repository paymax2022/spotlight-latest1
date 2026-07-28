'use client';

import { useEffect, useState } from 'react';
import type { IntakeSchema, IntakeSchemaField } from '@/types/intakeAdmin';
import { getSchema, publishSchema, toLocal } from '@/services/intakeAdminService';
import { BackLink, PageHeader, Notice, card, th, td, btn, btnPrimary, input, useIntakePermissions, INTAKE_PERMS } from '../_ui';

export default function FormBuilderPage() {
  const { can } = useIntakePermissions();
  const canManage = can(INTAKE_PERMS.manage);

  const [schema, setSchema] = useState<IntakeSchema | null>(null);
  const [fields, setFields] = useState<IntakeSchemaField[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const s = await getSchema();
        setSchema(s);
        setFields([...s.fields].sort((a, b) => a.order - b.order));
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const move = (idx: number, dir: -1 | 1) => {
    setFields((f) => {
      const next = [...f];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return next;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next.map((fld, i) => ({ ...fld, order: i + 1 }));
    });
  };

  const toggleRequired = (key: string) =>
    setFields((f) => f.map((fld) => (fld.key === key ? { ...fld, required: !fld.required } : fld)));

  const onPublish = async () => {
    if (!confirm('Publish a new schema version? This becomes the live intake form. Existing fields are additive — published versions are retained.')) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await publishSchema(fields.map((f, i) => ({ ...f, order: i + 1 })));
      setMessage('New schema version published.');
    } catch (e) {
      setError(`Publish failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <BackLink />
      <PageHeader title="A1 · Intake Form Builder" subtitle="Manage which questions the intake asks, whether each is required, and the order patients answer them. Publishing creates a new schema version that becomes the live form." />
      <Notice kind="info">
        Conditional fields render only when their <code>conditional_on</code> field has an answer. This is a structured editor with guardrails — the live schema is versioned, never overwritten.
      </Notice>

      {message ? <p style={{ color: 'lightgreen' }}>{message}</p> : null}
      {error ? <p style={{ color: 'salmon' }}>{error}</p> : null}
      {loading ? <p style={{ opacity: 0.6, marginTop: 16 }}>Loading…</p> : null}

      {schema && !loading ? (
        <>
          <div style={{ ...card, marginTop: 16, display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>Live version <strong>v{schema.version}</strong></span>
            <span style={{ opacity: 0.7 }}>Status: {schema.status}</span>
            <span style={{ opacity: 0.7 }}>Updated {toLocal(schema.updated_at)}{schema.updated_by ? ` by ${schema.updated_by}` : ''}</span>
            <button
              style={canManage ? btnPrimary : { ...btn, opacity: 0.5, cursor: 'not-allowed' }}
              onClick={() => void onPublish()}
              disabled={busy || !canManage}
              title={!canManage ? 'Requires health.admin.intake' : 'Publish a new schema version'}
            >
              {busy ? 'Publishing…' : 'Publish new version'}
            </button>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 16 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a2a', textAlign: 'left' }}>
                {['Order', 'Field key', 'Label', 'Type', 'Required', 'Conditional on', ''].map((h) => <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {fields.map((f, idx) => (
                <tr key={f.key} style={{ borderBottom: '1px solid #1c1c1c' }}>
                  <td style={td}>{f.order}</td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{f.key}</td>
                  <td style={td}>{f.label}{f.help_text ? <div style={{ fontSize: 11, opacity: 0.5 }}>{f.help_text}</div> : null}</td>
                  <td style={{ ...td, opacity: 0.8 }}>{f.type}</td>
                  <td style={td}>
                    <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: canManage ? 'pointer' : 'default' }}>
                      <input type="checkbox" checked={f.required} disabled={!canManage} onChange={() => toggleRequired(f.key)} />
                      {f.required ? 'Required' : 'Optional'}
                    </label>
                  </td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 11, opacity: 0.7 }}>{f.conditional_on ?? '—'}</td>
                  <td style={td}>
                    <button style={{ ...btn, padding: '2px 8px' }} disabled={!canManage || idx === 0} onClick={() => move(idx, -1)}>↑</button>{' '}
                    <button style={{ ...btn, padding: '2px 8px' }} disabled={!canManage || idx === fields.length - 1} onClick={() => move(idx, 1)}>↓</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <details style={{ marginTop: 20 }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, opacity: 0.8 }}>Raw schema (JSON)</summary>
            <textarea
              readOnly
              style={{ ...input, width: '100%', height: 220, marginTop: 8, fontFamily: 'monospace', fontSize: 11 }}
              value={JSON.stringify(fields, null, 2)}
            />
          </details>
        </>
      ) : null}
    </div>
  );
}
