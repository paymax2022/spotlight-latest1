'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { IntakeSchema, IntakeSchemaField } from '@/types/intakeAdmin';
import { getSchema, publishSchema, toLocal } from '@/services/intakeAdminService';
import { Page, PageHeader, Card, Button, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';
import { useIntakePermissions, INTAKE_PERMS } from '../_ui';

function Notice({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: tint(colors.info, 0.12), border: `1px solid ${tint(colors.info, 0.3)}`, color: colors.text, padding: '10px 12px', borderRadius: 8, fontSize: 13, marginTop: 14, display: 'flex', gap: 8 }}>
      <span aria-hidden>ℹ︎</span>
      <span>{children}</span>
    </div>
  );
}

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
    <Page>
      <div style={{ marginBottom: 14 }}>
        <Link href="/admin/intake" style={{ fontSize: 13, color: colors.primary }}>← Intake console</Link>
      </div>
      <PageHeader title="A1 · Intake Form Builder" subtitle="Manage which questions the intake asks, whether each is required, and the order patients answer them. Publishing creates a new schema version that becomes the live form." />
      <Notice>
        Conditional fields render only when their <code>conditional_on</code> field has an answer. This is a structured editor with guardrails — the live schema is versioned, never overwritten.
      </Notice>

      {message ? <p style={{ color: colors.success }}>{message}</p> : null}
      {error ? <p style={{ color: colors.danger }}>{error}</p> : null}
      {loading ? <p style={{ color: colors.muted, marginTop: 16 }}>Loading…</p> : null}

      {schema && !loading ? (
        <>
          <Card style={{ marginTop: 16, display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>Live version <strong>v{schema.version}</strong></span>
            <span style={{ color: colors.muted }}>Status: {schema.status}</span>
            <span style={{ color: colors.muted }}>Updated {toLocal(schema.updated_at)}{schema.updated_by ? ` by ${schema.updated_by}` : ''}</span>
            <Button
              variant="primary"
              onClick={() => void onPublish()}
              disabled={busy || !canManage}
              title={!canManage ? 'Requires health.admin.intake' : 'Publish a new schema version'}
            >
              {busy ? 'Publishing…' : 'Publish new version'}
            </Button>
          </Card>

          <Card style={{ padding: 0, overflow: 'hidden', marginTop: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Order', 'Field key', 'Label', 'Type', 'Required', 'Conditional on', ''].map((h) => <th key={h} style={thCell}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {fields.map((f, idx) => (
                  <tr key={f.key}>
                    <td style={tdCell}>{f.order}</td>
                    <td style={{ ...tdCell, fontFamily: 'monospace', fontSize: 11 }}>{f.key}</td>
                    <td style={tdCell}>{f.label}{f.help_text ? <div style={{ fontSize: 11, color: colors.muted }}>{f.help_text}</div> : null}</td>
                    <td style={{ ...tdCell, color: colors.muted }}>{f.type}</td>
                    <td style={tdCell}>
                      <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: canManage ? 'pointer' : 'default' }}>
                        <input type="checkbox" checked={f.required} disabled={!canManage} onChange={() => toggleRequired(f.key)} />
                        {f.required ? 'Required' : 'Optional'}
                      </label>
                    </td>
                    <td style={{ ...tdCell, fontFamily: 'monospace', fontSize: 11, color: colors.muted }}>{f.conditional_on ?? '—'}</td>
                    <td style={tdCell}>
                      <Button variant="outline" sm disabled={!canManage || idx === 0} onClick={() => move(idx, -1)}>↑</Button>{' '}
                      <Button variant="outline" sm disabled={!canManage || idx === fields.length - 1} onClick={() => move(idx, 1)}>↓</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <details style={{ marginTop: 20 }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, color: colors.muted }}>Raw schema (JSON)</summary>
            <textarea
              readOnly
              className="vx-input"
              style={{ width: '100%', height: 220, marginTop: 8, fontFamily: 'monospace', fontSize: 11 }}
              value={JSON.stringify(fields, null, 2)}
            />
          </details>
        </>
      ) : null}
    </Page>
  );
}
