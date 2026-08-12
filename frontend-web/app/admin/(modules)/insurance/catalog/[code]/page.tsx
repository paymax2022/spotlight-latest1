'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getProduct, upsertProduct, formatNaira } from '@/services/insuranceAdminService';
import type { InsuranceProductDetail } from '@/types/insuranceAdmin';
import {
  PageHeader, InsuranceTabs, Card, Badge, StateBlock, DisclosureNote,
  btnPrimary, th, td, label, input, select, fmtDate,
} from '../../_ui';
import { colors } from '@/components/ui/vuexy';

export default function InsuranceProductEditorPage() {
  const params = useParams();
  const code = params?.code as string;

  const [detail, setDetail] = useState<InsuranceProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setDetail(await getProduct(code)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  function patch<K extends keyof InsuranceProductDetail>(key: K, value: InsuranceProductDetail[K]) {
    setSaved(false);
    setDetail((d) => (d ? { ...d, [key]: value } : d));
  }
  function patchSum(key: 'min_kobo' | 'max_kobo' | 'default_kobo', value: number) {
    setSaved(false);
    setDetail((d) => (d ? { ...d, sum_insured: { ...d.sum_insured, [key]: value } } : d));
  }

  async function save() {
    if (!detail) return;
    setSaving(true); setError(null); setSaved(false);
    try {
      const updated = await upsertProduct({ ...detail, code: detail.code });
      setDetail(updated);
      setSaved(true);
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title={detail ? detail.name : 'Product'}
        subtitle={`Catalog code ${code} — versioned product editor. Changes publish a new version.`}
        action={<Link href="/admin/insurance/catalog" style={{ ...btnPrimary(), background: colors.card, color: colors.primary, textDecoration: 'none' }}>Back to catalog</Link>}
      />
      <InsuranceTabs active="catalog" />

      <StateBlock loading={loading} error={error && !detail ? error : null} empty={!detail} emptyText="Product not found.">
        {detail && (
          <>
            <DisclosureNote>
              Underwriter <strong>{detail.underwriter}</strong> (via {detail.provider}) is disclosed on every policy & document for this product. Current version <strong>v{detail.version}</strong>, consent <strong>{detail.consent_version}</strong>.
            </DisclosureNote>

            <Card
              title="Product configuration"
              right={<Badge status={detail.active ? 'active' : 'inactive'} label={detail.active ? 'Active' : 'Inactive'} />}
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.9rem' }}>
                <div>
                  <label style={label()}>Name</label>
                  <input style={input()} value={detail.name} onChange={(e) => patch('name', e.target.value)} />
                </div>
                <div>
                  <label style={label()}>Provider</label>
                  <select style={select()} value={detail.provider} onChange={(e) => patch('provider', e.target.value as InsuranceProductDetail['provider'])}>
                    <option value="mycover">MyCover.ai</option>
                    <option value="octamile">Octamile</option>
                  </select>
                </div>
                <div>
                  <label style={label()}>Provider product code</label>
                  <input style={input()} value={detail.provider_product_code} onChange={(e) => patch('provider_product_code', e.target.value)} />
                </div>
                <div>
                  <label style={label()}>Underwriter (disclosed)</label>
                  <input style={input()} value={detail.underwriter} onChange={(e) => patch('underwriter', e.target.value)} />
                </div>
                <div>
                  <label style={label()}>Binding mode</label>
                  <select style={select()} value={detail.binding_mode} onChange={(e) => patch('binding_mode', e.target.value as InsuranceProductDetail['binding_mode'])}>
                    <option value="embedded">Embedded</option>
                    <option value="voluntary">Voluntary</option>
                  </select>
                </div>
                <div>
                  <label style={label()}>Premium model</label>
                  <select style={select()} value={detail.premium_model} onChange={(e) => patch('premium_model', e.target.value as InsuranceProductDetail['premium_model'])}>
                    <option value="one_off">One-off</option>
                    <option value="recurring">Recurring</option>
                    <option value="per_event">Per event</option>
                  </select>
                </div>
                <div>
                  <label style={label()}>Required KYC tier (0–3)</label>
                  <input type="number" min={0} max={3} style={input()} value={detail.required_kyc_tier} onChange={(e) => patch('required_kyc_tier', Number(e.target.value))} />
                </div>
                <div>
                  <label style={label()}>Base premium (kobo)</label>
                  <input type="number" min={0} style={input()} value={detail.base_premium_kobo} onChange={(e) => patch('base_premium_kobo', Number(e.target.value))} />
                  <div style={{ fontSize: '0.72rem', color: colors.muted, marginTop: 2 }}>= {formatNaira(detail.base_premium_kobo)}</div>
                </div>
                <div>
                  <label style={label()}>Commission basis (%)</label>
                  <input type="number" min={0} step={0.1} style={input()} value={detail.commission_basis_pct} onChange={(e) => patch('commission_basis_pct', Number(e.target.value))} />
                </div>
                <div>
                  <label style={label()}>Sum insured — min (kobo)</label>
                  <input type="number" min={0} style={input()} value={detail.sum_insured.min_kobo} onChange={(e) => patchSum('min_kobo', Number(e.target.value))} />
                  <div style={{ fontSize: '0.72rem', color: colors.muted, marginTop: 2 }}>= {formatNaira(detail.sum_insured.min_kobo)}</div>
                </div>
                <div>
                  <label style={label()}>Sum insured — max (kobo)</label>
                  <input type="number" min={0} style={input()} value={detail.sum_insured.max_kobo} onChange={(e) => patchSum('max_kobo', Number(e.target.value))} />
                  <div style={{ fontSize: '0.72rem', color: colors.muted, marginTop: 2 }}>= {formatNaira(detail.sum_insured.max_kobo)}</div>
                </div>
                <div>
                  <label style={label()}>Sum insured — default (kobo)</label>
                  <input type="number" min={0} style={input()} value={detail.sum_insured.default_kobo} onChange={(e) => patchSum('default_kobo', Number(e.target.value))} />
                  <div style={{ fontSize: '0.72rem', color: colors.muted, marginTop: 2 }}>= {formatNaira(detail.sum_insured.default_kobo)}</div>
                </div>
              </div>

              <div style={{ marginTop: '0.9rem' }}>
                <label style={label()}>Description</label>
                <textarea style={{ ...input(), minHeight: 80, resize: 'vertical', fontFamily: 'inherit' }} value={detail.description} onChange={(e) => patch('description', e.target.value)} />
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.9rem', fontSize: '0.85rem', color: colors.text }}>
                <input type="checkbox" checked={detail.active} onChange={(e) => patch('active', e.target.checked)} />
                Active (feature-flag enabled for binding)
              </label>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '1rem' }}>
                <button style={{ ...btnPrimary(), opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }} onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                {saved && <span style={{ color: colors.success, fontSize: '0.82rem', fontWeight: 600 }}>Saved — now v{detail.version}</span>}
                {error && detail && <span style={{ color: colors.danger, fontSize: '0.82rem' }}>{error}</span>}
              </div>
            </Card>

            <Card title="Required fields">
              {detail.required_fields.length === 0 ? (
                <p style={{ color: colors.muted, fontSize: '0.85rem' }}>No fields configured.</p>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {detail.required_fields.map((f) => (
                    <span key={f} style={{ display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: 9999, background: colors.border, color: colors.text, fontSize: '0.78rem', fontWeight: 600 }}>{f}</span>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Version history">
              {detail.history.length === 0 ? (
                <p style={{ color: colors.muted, fontSize: '0.85rem' }}>No version history.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={th()}>Version</th>
                        <th style={th()}>Change</th>
                        <th style={th()}>Actor</th>
                        <th style={th()}>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.history.map((h) => (
                        <tr key={h.version}>
                          <td style={td()}>v{h.version}</td>
                          <td style={td()}>{h.change}</td>
                          <td style={td()}><code style={{ fontSize: '0.78rem' }}>{h.actor}</code></td>
                          <td style={td()}>{fmtDate(h.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
