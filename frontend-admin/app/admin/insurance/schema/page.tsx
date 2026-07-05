'use client';

import { useEffect, useState } from 'react';
import { getSchema, updateSchema } from '@/services/insuranceAdminService';
import type { SchemaField } from '@/types/insuranceAdmin';
import {
  PageHeader, InsuranceTabs, Card, StateBlock, DisclosureNote,
  btnPrimary, th, td, input, select,
} from '../_ui';

const FIELD_TYPES: SchemaField['type'][] = ['string', 'number', 'date', 'boolean', 'enum', 'file'];

export default function InsuranceSchemaPage() {
  const [fields, setFields] = useState<SchemaField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [piiOnly, setPiiOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setFields(await getSchema()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function patchField(key: string, change: Partial<SchemaField>) {
    setSaved(false);
    setFields((fs) => fs.map((f) => (f.key === key ? { ...f, ...change } : f)));
  }

  async function save() {
    setSaving(true); setError(null); setSaved(false);
    try {
      setFields(await updateSchema(fields));
      setSaved(true);
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }

  const visible = piiOnly ? fields.filter((f) => f.pii) : fields;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Field schema"
        subtitle="Defines the data fields products may collect. Only fields a product actually needs are shared with its provider."
        action={
          <button style={{ ...btnPrimary(), opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }} onClick={save} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save schema'}
          </button>
        }
      />
      <InsuranceTabs active="catalog" />

      <DisclosureNote>
        Data minimisation: only share the fields a product strictly needs with its underwriter. PII fields (highlighted) require an explicit consent scope before being transmitted.
      </DisclosureNote>

      <Card
        title="Schema fields"
        right={
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: '#374151' }}>
            <input type="checkbox" checked={piiOnly} onChange={(e) => setPiiOnly(e.target.checked)} />
            PII only
          </label>
        }
      >
        <StateBlock loading={loading} error={error} empty={visible.length === 0} emptyText="No schema fields.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>Key</th>
                  <th style={th()}>Label</th>
                  <th style={th()}>Type</th>
                  <th style={th()}>Required</th>
                  <th style={th()}>PII</th>
                  <th style={th()}>Product lines</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((f) => (
                  <tr key={f.key} style={f.pii ? { background: '#fef2f2' } : undefined}>
                    <td style={td()}><code style={{ fontSize: '0.8rem' }}>{f.key}</code></td>
                    <td style={td()}>
                      <input style={input()} value={f.label} onChange={(e) => patchField(f.key, { label: e.target.value })} />
                    </td>
                    <td style={{ ...td(), width: 130 }}>
                      <select style={select()} value={f.type} onChange={(e) => patchField(f.key, { type: e.target.value as SchemaField['type'] })}>
                        {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td style={td()}>
                      <input type="checkbox" checked={f.required} onChange={(e) => patchField(f.key, { required: e.target.checked })} />
                    </td>
                    <td style={td()}>
                      <input type="checkbox" checked={f.pii} onChange={(e) => patchField(f.key, { pii: e.target.checked })} />
                    </td>
                    <td style={{ ...td(), color: '#6b7280', fontSize: '0.78rem' }}>
                      {f.product_lines.map((l) => l.replace(/_/g, ' ')).join(', ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {saved && <p style={{ color: '#15803d', fontSize: '0.82rem', fontWeight: 600, marginTop: '0.8rem' }}>Schema saved.</p>}
        </StateBlock>
      </Card>
    </div>
  );
}
