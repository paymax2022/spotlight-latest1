'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCategory, listCategories, createCategory, updateCategory } from '@/services/marketplaceAdminService';
import type { MktAttributeProp, MktAttributeSchema, MktAttributeType, MktCategory, MktCategoryInput } from '@/types/marketplaceAdmin';
import {
  PageHeader, MarketplaceTabs, Card, DisclosureNote, AuditNote, PermissionBanner,
  btn, btnPrimary, btnDanger, btnDisabled, th, td, input, select, textarea, label as lbl, mono,
  MARKETPLACE_PERMS, useMarketplacePermission,
} from '../../_ui';

// One editable attribute row (flattened from attribute_schema for the form).
interface AttrRow {
  key: string;
  type: MktAttributeType;
  required: boolean;
  enumCsv: string; // comma-separated allowed values (blank = unconstrained)
  min: string;
  max: string;
}

const ATTR_TYPES: MktAttributeType[] = ['string', 'integer', 'number', 'boolean'];

function schemaToRows(schema: MktAttributeSchema): AttrRow[] {
  const req = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([key, p]) => ({
    key,
    type: p.type ?? 'string',
    required: req.has(key),
    enumCsv: (p.enum ?? []).join(', '),
    min: p.minimum != null ? String(p.minimum) : '',
    max: p.maximum != null ? String(p.maximum) : '',
  }));
}

function rowsToSchema(rows: AttrRow[], additionalProperties: boolean): { schema: MktAttributeSchema; error: string | null } {
  const properties: NonNullable<MktAttributeSchema['properties']> = {};
  const required: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const key = r.key.trim();
    if (!key) return { schema: {}, error: 'Every attribute needs a key.' };
    if (!/^[a-z0-9_]+$/.test(key)) return { schema: {}, error: `Attribute key “${key}” must be lowercase letters, digits, and underscores.` };
    if (seen.has(key)) return { schema: {}, error: `Duplicate attribute key “${key}”.` };
    seen.add(key);
    const prop: MktAttributeProp = { type: r.type };
    const enumVals = r.enumCsv.split(',').map((s) => s.trim()).filter(Boolean);
    if (enumVals.length) {
      prop.enum = (r.type === 'integer' || r.type === 'number') ? enumVals.map(Number) : enumVals;
      if (prop.enum.some((v: string | number) => typeof v === 'number' && Number.isNaN(v))) return { schema: {}, error: `Enum for “${key}” has a non-numeric value but the type is ${r.type}.` };
    }
    if (r.type === 'integer' || r.type === 'number') {
      if (r.min.trim()) prop.minimum = Number(r.min);
      if (r.max.trim()) prop.maximum = Number(r.max);
      if (prop.minimum != null && prop.maximum != null && prop.minimum > prop.maximum) return { schema: {}, error: `“${key}” minimum is greater than maximum.` };
    }
    properties[key] = prop;
    if (r.required) required.push(key);
  }
  const schema: MktAttributeSchema = { properties, additionalProperties };
  if (required.length) schema.required = required;
  return { schema, error: null };
}

export default function TaxonomyEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? 'new';
  const isNew = id === 'new';
  const { allowed: canManage } = useMarketplacePermission(MARKETPLACE_PERMS.taxonomy);

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [allCats, setAllCats] = useState<MktCategory[]>([]);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [parentId, setParentId] = useState<string>('');
  const [riskTier, setRiskTier] = useState(1);
  const [commissionBps, setCommissionBps] = useState(500);
  const [isActive, setIsActive] = useState(true);
  const [additionalProps, setAdditionalProps] = useState(false);
  const [rows, setRows] = useState<AttrRow[]>([]);
  const [reason, setReason] = useState('');
  const [listingCount, setListingCount] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      const cats = await listCategories();
      setAllCats(cats);
      if (!isNew) {
        const c = await getCategory(id);
        setName(c.name); setSlug(c.slug); setParentId(c.parent_id ?? '');
        setRiskTier(c.risk_tier); setCommissionBps(c.commission_bps); setIsActive(c.is_active);
        setAdditionalProps(c.attribute_schema?.additionalProperties ?? false);
        setRows(schemaToRows(c.attribute_schema ?? {}));
        setListingCount(c.listing_count ?? 0);
      }
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [id, isNew]);
  useEffect(() => { void load(); }, [load]);

  const { schema, error: schemaError } = useMemo(() => rowsToSchema(rows, additionalProps), [rows, additionalProps]);

  const parentOptions = useMemo(
    () => allCats.filter((c) => c.id !== id && !c.parent_id), // only single-level nesting: parents must be roots
    [allCats, id],
  );

  function addRow() { setRows((r) => [...r, { key: '', type: 'string', required: false, enumCsv: '', min: '', max: '' }]); }
  function removeRow(i: number) { setRows((r) => r.filter((_, idx) => idx !== i)); }
  function patchRow(i: number, patch: Partial<AttrRow>) { setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row))); }

  async function save() {
    if (schemaError) { setError(schemaError); return; }
    const payload: MktCategoryInput = {
      name, slug, parent_id: parentId || null, risk_tier: riskTier, commission_bps: commissionBps,
      is_active: isActive, attribute_schema: schema, reason_code: reason.trim() || undefined,
    };
    setSaving(true); setError(null); setMsg(null);
    try {
      const saved = isNew ? await createCategory(payload) : await updateCategory(id, payload);
      setMsg(`Category “${saved.name}” ${isNew ? 'created' : 'updated'}. Audit entry recorded.`);
      if (isNew) { router.push(`/admin/marketplace/taxonomy/${saved.id}`); return; }
      await load();
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }

  if (loading) return <div style={{ padding: '2rem' }}><p style={{ color: '#6b7280' }}>Loading…</p></div>;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title={isNew ? 'Taxonomy — New category' : `Taxonomy — ${name || id}`}
        subtitle="Edit the category and its listing attribute schema. Schema changes apply to new/edited listings going forward."
        action={<Link href="/admin/marketplace/taxonomy" style={{ ...btn(), textDecoration: 'none' }}>← Back to taxonomy</Link>}
      />
      <MarketplaceTabs active="taxonomy" />
      <DisclosureNote>
        The attribute schema below is the exact draft-07 subset the backend enforces at write time:
        <code> required</code>, per-field <code>type</code> (string/integer/number/boolean), <code>enum</code>, and numeric <code>minimum</code>/<code>maximum</code>.
        With <em>additional properties</em> off, listings carrying any attribute not defined here are rejected.
      </DisclosureNote>

      {!canManage && <PermissionBanner permission={MARKETPLACE_PERMS.taxonomy} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {msg && <AuditNote>{msg}</AuditNote>}

      <Card title="Category">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div>
            <label style={lbl()}>Name</label>
            <input style={input()} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vehicles" />
          </div>
          <div>
            <label style={lbl()}>Slug</label>
            <input style={input()} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="e.g. vehicles" disabled={!isNew} />
            {!isNew ? <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: 2 }}>Slug is immutable after creation.</div> : null}
          </div>
          <div>
            <label style={lbl()}>Parent</label>
            <select style={select()} value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">— none (root) —</option>
              {parentOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl()}>Risk tier</label>
            <select style={select()} value={riskTier} onChange={(e) => setRiskTier(Number(e.target.value))}>
              <option value={0}>0 — auto-approve eligible</option>
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3 — highest risk</option>
            </select>
          </div>
          <div>
            <label style={lbl()}>Commission (bps)</label>
            <input style={input()} type="number" min={0} max={10000} value={commissionBps} onChange={(e) => setCommissionBps(Number(e.target.value))} />
            <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: 2 }}>{(commissionBps / 100).toFixed(2)}% take-rate</div>
          </div>
          <div>
            <label style={lbl()}>Active</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: '#374151', marginTop: '0.4rem' }}>
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Listable in this category
            </label>
            {!isNew && listingCount > 0 ? <div style={{ fontSize: '0.7rem', color: '#9a3412', marginTop: 2 }}>{listingCount.toLocaleString('en-NG')} active listing(s) — cannot disable until reassigned (EC-007).</div> : null}
          </div>
        </div>
      </Card>

      <Card title="Attribute schema" right={<button onClick={addRow} style={btn()}>+ Add attribute</button>}>
        {rows.length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>No attributes. Listings in this category carry no category-specific fields.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Key</th><th style={th()}>Type</th><th style={th()}>Required</th>
              <th style={th()}>Allowed values (enum)</th><th style={th()}>Min</th><th style={th()}>Max</th><th style={th()}></th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const numeric = r.type === 'integer' || r.type === 'number';
                return (
                  <tr key={i}>
                    <td style={td()}><input style={input()} value={r.key} onChange={(e) => patchRow(i, { key: e.target.value })} placeholder="make" /></td>
                    <td style={td()}>
                      <select style={select()} value={r.type} onChange={(e) => patchRow(i, { type: e.target.value as MktAttributeType })}>
                        {ATTR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td style={td()}><input type="checkbox" checked={r.required} onChange={(e) => patchRow(i, { required: e.target.checked })} /></td>
                    <td style={td()}>
                      {r.type === 'boolean'
                        ? <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>true / false</span>
                        : <input style={input()} value={r.enumCsv} onChange={(e) => patchRow(i, { enumCsv: e.target.value })} placeholder="toyota, honda, lexus" />}
                    </td>
                    <td style={td()}>{numeric ? <input style={{ ...input(), width: 70 }} value={r.min} onChange={(e) => patchRow(i, { min: e.target.value })} placeholder="—" /> : <span style={{ color: '#d1d5db' }}>—</span>}</td>
                    <td style={td()}>{numeric ? <input style={{ ...input(), width: 70 }} value={r.max} onChange={(e) => patchRow(i, { max: e.target.value })} placeholder="—" /> : <span style={{ color: '#d1d5db' }}>—</span>}</td>
                    <td style={td()}><button onClick={() => removeRow(i)} style={btnDanger()}>Remove</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: '#374151', marginTop: '0.9rem' }}>
          <input type="checkbox" checked={!additionalProps} onChange={(e) => setAdditionalProps(!e.target.checked)} />
          Reject listings carrying attributes not defined above (<code>additionalProperties: false</code>)
        </label>
        {schemaError ? <p style={{ color: '#dc2626', fontSize: '0.8rem', marginTop: '0.5rem' }}>{schemaError}</p> : null}
      </Card>

      <Card title="Schema preview (what the backend validates against)">
        <pre style={{ ...mono(), background: '#0b1021', color: '#d1fae5', padding: '0.9rem', borderRadius: '0.5rem', overflowX: 'auto', margin: 0 }}>
          {JSON.stringify(schema, null, 2)}
        </pre>
      </Card>

      <Card title="Save">
        <label style={lbl()}>Reason (audited)</label>
        <textarea style={textarea()} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this taxonomy change? (recorded in the audit log)" />
        <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.8rem' }}>
          <button
            style={canManage && !schemaError && name.trim() && slug.trim() && !saving ? btnPrimary() : btnDisabled()}
            disabled={!canManage || !!schemaError || !name.trim() || !slug.trim() || saving}
            onClick={() => void save()}
          >{saving ? 'Saving…' : isNew ? 'Create category' : 'Save changes'}</button>
          <Link href="/admin/marketplace/taxonomy" style={{ ...btn(), textDecoration: 'none' }}>Cancel</Link>
        </div>
        <AuditNote>Category config changes are recorded to the immutable audit log and apply to new and edited listings going forward (ADM-001).</AuditNote>
      </Card>
    </div>
  );
}
