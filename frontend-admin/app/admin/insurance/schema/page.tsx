'use client';

import { useEffect, useState } from 'react';
import { getSchema, updateSchema } from '@/services/insuranceAdminService';
import type { SchemaField } from '@/types/insuranceAdmin';
import { InsuranceTabs, DisclosureNote, StateBlock } from '../_ui';
import { Page, PageHeader, Card, Button, Input, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader
        title="Field schema"
        subtitle="Defines the data fields products may collect. Only fields a product actually needs are shared with its provider."
        actions={
          <Button variant="primary" onClick={save} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save schema'}
          </Button>
        }
      />
      <InsuranceTabs active="catalog" />

      <DisclosureNote>
        Data minimisation: only share the fields a product strictly needs with its underwriter. PII fields (highlighted) require an explicit consent scope before being transmitted.
      </DisclosureNote>

      <Card title="Schema fields">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: colors.text, marginBottom: 14 }}>
          <input type="checkbox" checked={piiOnly} onChange={(e) => setPiiOnly(e.target.checked)} />
          PII only
        </label>

        <StateBlock loading={loading} error={error} empty={visible.length === 0} emptyText="No schema fields.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>Key</th>
                  <th style={thCell}>Label</th>
                  <th style={thCell}>Type</th>
                  <th style={thCell}>Required</th>
                  <th style={thCell}>PII</th>
                  <th style={thCell}>Product lines</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((f) => (
                  <tr key={f.key} style={f.pii ? { background: tint(colors.danger, 0.06) } : undefined}>
                    <td style={tdCell}><code style={{ fontSize: 13 }}>{f.key}</code></td>
                    <td style={tdCell}>
                      <Input value={f.label} onChange={(e) => patchField(f.key, { label: e.target.value })} />
                    </td>
                    <td style={{ ...tdCell, width: 130 }}>
                      <select value={f.type} onChange={(e) => patchField(f.key, { type: e.target.value as SchemaField['type'] })}>
                        {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td style={tdCell}>
                      <input type="checkbox" checked={f.required} onChange={(e) => patchField(f.key, { required: e.target.checked })} />
                    </td>
                    <td style={tdCell}>
                      <input type="checkbox" checked={f.pii} onChange={(e) => patchField(f.key, { pii: e.target.checked })} />
                    </td>
                    <td style={{ ...tdCell, color: colors.muted, fontSize: 12 }}>
                      {f.product_lines.map((l) => l.replace(/_/g, ' ')).join(', ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {saved && <p style={{ color: colors.success, fontSize: 13, fontWeight: 600, marginTop: 13 }}>Schema saved.</p>}
        </StateBlock>
      </Card>
    </Page>
  );
}
