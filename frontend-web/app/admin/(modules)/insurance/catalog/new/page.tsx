'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { upsertProduct, formatNaira } from '@/services/insuranceAdminService';
import type { ProductUpsert, Provider, BindingMode, PremiumModel } from '@/types/insuranceAdmin';
import {
  PageHeader, InsuranceTabs, Card, DisclosureNote,
  btnPrimary, label, input, select,
} from '../../_ui';
import { colors } from '@/components/ui/vuexy';

interface NewForm {
  code: string;
  name: string;
  provider: Provider;
  provider_product_code: string;
  underwriter: string;
  binding_mode: BindingMode;
  premium_model: PremiumModel;
  required_kyc_tier: number;
  base_premium_kobo: number;
  commission_basis_pct: number;
  sum_insured_min_kobo: number;
  sum_insured_max_kobo: number;
  sum_insured_default_kobo: number;
  description: string;
  active: boolean;
}

const DEFAULTS: NewForm = {
  code: '',
  name: '',
  provider: 'mycover',
  provider_product_code: '',
  underwriter: '',
  binding_mode: 'voluntary',
  premium_model: 'one_off',
  required_kyc_tier: 0,
  base_premium_kobo: 0,
  commission_basis_pct: 0,
  sum_insured_min_kobo: 0,
  sum_insured_max_kobo: 0,
  sum_insured_default_kobo: 0,
  description: '',
  active: false,
};

export default function InsuranceNewProductPage() {
  const router = useRouter();
  const [form, setForm] = useState<NewForm>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function patch<K extends keyof NewForm>(key: K, value: NewForm[K]) {
    setSaved(false); setError(null);
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    if (!form.code.trim()) { setError('Product code is required.'); return; }
    setSaving(true); setError(null); setSaved(false);
    try {
      const payload: ProductUpsert = {
        code: form.code.trim(),
        name: form.name,
        provider: form.provider,
        provider_product_code: form.provider_product_code,
        underwriter: form.underwriter,
        binding_mode: form.binding_mode,
        premium_model: form.premium_model,
        required_kyc_tier: form.required_kyc_tier,
        base_premium_kobo: form.base_premium_kobo,
        commission_basis_pct: form.commission_basis_pct,
        sum_insured: {
          min_kobo: form.sum_insured_min_kobo,
          max_kobo: form.sum_insured_max_kobo,
          default_kobo: form.sum_insured_default_kobo,
        },
        description: form.description,
        active: form.active,
      };
      const created = await upsertProduct(payload);
      setSaved(true);
      router.push(`/admin/insurance/catalog/${encodeURIComponent(created.code)}`);
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="New insurance product"
        subtitle="Create a catalog product. It is created inactive — enable it only after the routing rule and underwriter contract are confirmed."
        action={<Link href="/admin/insurance/catalog" style={{ ...btnPrimary(), background: colors.card, color: colors.primary, textDecoration: 'none' }}>Back to catalog</Link>}
      />
      <InsuranceTabs active="catalog" />

      <DisclosureNote>
        Set the NAICOM-licensed <strong>underwriter</strong> — it is disclosed on every quote, policy and document and must match the routing table.
      </DisclosureNote>

      <Card title="Product configuration">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.9rem' }}>
          <div>
            <label style={label()}>Code</label>
            <input style={input()} placeholder="e.g. SME-PKG-01" value={form.code} onChange={(e) => patch('code', e.target.value)} />
          </div>
          <div>
            <label style={label()}>Name</label>
            <input style={input()} value={form.name} onChange={(e) => patch('name', e.target.value)} />
          </div>
          <div>
            <label style={label()}>Provider</label>
            <select style={select()} value={form.provider} onChange={(e) => patch('provider', e.target.value as Provider)}>
              <option value="mycover">MyCover.ai</option>
              <option value="octamile">Octamile</option>
            </select>
          </div>
          <div>
            <label style={label()}>Provider product code</label>
            <input style={input()} value={form.provider_product_code} onChange={(e) => patch('provider_product_code', e.target.value)} />
          </div>
          <div>
            <label style={label()}>Underwriter (disclosed)</label>
            <input style={input()} placeholder="NAICOM-licensed insurer" value={form.underwriter} onChange={(e) => patch('underwriter', e.target.value)} />
          </div>
          <div>
            <label style={label()}>Binding mode</label>
            <select style={select()} value={form.binding_mode} onChange={(e) => patch('binding_mode', e.target.value as BindingMode)}>
              <option value="embedded">Embedded</option>
              <option value="voluntary">Voluntary</option>
            </select>
          </div>
          <div>
            <label style={label()}>Premium model</label>
            <select style={select()} value={form.premium_model} onChange={(e) => patch('premium_model', e.target.value as PremiumModel)}>
              <option value="one_off">One-off</option>
              <option value="recurring">Recurring</option>
              <option value="per_event">Per event</option>
            </select>
          </div>
          <div>
            <label style={label()}>Required KYC tier (0–3)</label>
            <input type="number" min={0} max={3} style={input()} value={form.required_kyc_tier} onChange={(e) => patch('required_kyc_tier', Number(e.target.value))} />
          </div>
          <div>
            <label style={label()}>Base premium (kobo)</label>
            <input type="number" min={0} style={input()} value={form.base_premium_kobo} onChange={(e) => patch('base_premium_kobo', Number(e.target.value))} />
            <div style={{ fontSize: '0.72rem', color: colors.muted, marginTop: 2 }}>= {formatNaira(form.base_premium_kobo)}</div>
          </div>
          <div>
            <label style={label()}>Commission basis (%)</label>
            <input type="number" min={0} step={0.1} style={input()} value={form.commission_basis_pct} onChange={(e) => patch('commission_basis_pct', Number(e.target.value))} />
          </div>
          <div>
            <label style={label()}>Sum insured — min (kobo)</label>
            <input type="number" min={0} style={input()} value={form.sum_insured_min_kobo} onChange={(e) => patch('sum_insured_min_kobo', Number(e.target.value))} />
            <div style={{ fontSize: '0.72rem', color: colors.muted, marginTop: 2 }}>= {formatNaira(form.sum_insured_min_kobo)}</div>
          </div>
          <div>
            <label style={label()}>Sum insured — max (kobo)</label>
            <input type="number" min={0} style={input()} value={form.sum_insured_max_kobo} onChange={(e) => patch('sum_insured_max_kobo', Number(e.target.value))} />
            <div style={{ fontSize: '0.72rem', color: colors.muted, marginTop: 2 }}>= {formatNaira(form.sum_insured_max_kobo)}</div>
          </div>
          <div>
            <label style={label()}>Sum insured — default (kobo)</label>
            <input type="number" min={0} style={input()} value={form.sum_insured_default_kobo} onChange={(e) => patch('sum_insured_default_kobo', Number(e.target.value))} />
            <div style={{ fontSize: '0.72rem', color: colors.muted, marginTop: 2 }}>= {formatNaira(form.sum_insured_default_kobo)}</div>
          </div>
        </div>

        <div style={{ marginTop: '0.9rem' }}>
          <label style={label()}>Description</label>
          <textarea style={{ ...input(), minHeight: 80, resize: 'vertical', fontFamily: 'inherit' }} value={form.description} onChange={(e) => patch('description', e.target.value)} />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.9rem', fontSize: '0.85rem', color: colors.text }}>
          <input type="checkbox" checked={form.active} onChange={(e) => patch('active', e.target.checked)} />
          Active (feature-flag enabled for binding)
        </label>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '1rem' }}>
          <button style={{ ...btnPrimary(), opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }} onClick={save} disabled={saving}>
            {saving ? 'Creating…' : 'Create product'}
          </button>
          {saved && <span style={{ color: colors.success, fontSize: '0.82rem', fontWeight: 600 }}>Created — redirecting…</span>}
          {error && <span style={{ color: colors.danger, fontSize: '0.82rem' }}>{error}</span>}
        </div>
      </Card>
    </div>
  );
}
