'use client';

/**
 * Utility Payments — Catalogue: providers, category settings, billers,
 * products and provider service discounts. A Path A console (admin
 * consolidation; see docs/adr/ADR-047-admin-console-consolidation-path-a.md
 * and utilityCatalogAdminService.ts for the data-path and permission notes).
 *
 * Sibling to ../page.tsx (transaction monitoring / reversal, from PR #180) —
 * that page owns utility_transactions, this one owns everything upstream of
 * a transaction: what providers exist, which categories are enabled, what
 * billers/products customers can buy, and how each is priced against each
 * provider. Ported from the orphaned UtilityAdminConsole.tsx.
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  listProviders, createProvider, updateProviderStatus, healthCheckProvider,
  listCategorySettings, updateCategorySetting,
  listBillers, createBiller,
  listProducts, createProduct,
  listProviderProductMappings, createProviderProductMapping, updateProviderProductMapping,
  formatNaira, formatBps,
  UTILITY_CATEGORIES,
  type UtilityProvider, type UtilityCategorySetting, type UtilityBiller,
  type UtilityProduct, type UtilityProviderProductMapping,
} from '@/services/utilityCatalogAdminService';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

type Tab = 'providers' | 'categories' | 'catalogue';

const TABS: { key: Tab; label: string }[] = [
  { key: 'providers', label: 'Providers' },
  { key: 'categories', label: 'Categories' },
  { key: 'catalogue', label: 'Billers, Products & Discounts' },
];

const STATUS_COLOR: Record<string, string> = {
  active: colors.success,
  healthy: colors.success,
  disabled: colors.danger,
  down: colors.danger,
  unknown: colors.warning,
};

const labelStyle: React.CSSProperties = { display: 'block', marginBottom: 10, fontSize: 12, fontWeight: 600, color: colors.text };
const selectStyle: React.CSSProperties = {
  display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', fontSize: 13,
  border: `1px solid ${colors.inputBorder}`, borderRadius: 6, boxSizing: 'border-box', background: colors.card,
};

function statusBadge(status: string) {
  return <Badge text={status} color={STATUS_COLOR[status] ?? colors.secondary} />;
}

export default function UtilityCatalogueAdminPage() {
  const [tab, setTab] = useState<Tab>('providers');

  const [providers, setProviders] = useState<UtilityProvider[]>([]);
  const [categories, setCategories] = useState<UtilityCategorySetting[]>([]);
  const [billers, setBillers] = useState<UtilityBiller[]>([]);
  const [products, setProducts] = useState<UtilityProduct[]>([]);
  const [mappings, setMappings] = useState<UtilityProviderProductMapping[]>([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [providerRows, categoryRows, billerRows, productRows, mappingRows] = await Promise.all([
        listProviders(), listCategorySettings(), listBillers(), listProducts(), listProviderProductMappings(),
      ]);
      setProviders(providerRows);
      setCategories(categoryRows);
      setBillers(billerRows);
      setProducts(productRows);
      setMappings(mappingRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the utility catalogue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const providerById = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const billerById = useMemo(() => new Map(billers.map((b) => [b.id, b])), [billers]);

  const discountRows = useMemo(() => mappings.map((mapping) => {
    const provider = providerById.get(mapping.provider_id);
    const product = productById.get(mapping.product_id);
    const biller = product ? billerById.get(product.biller_id) : undefined;
    return { mapping, provider, product, biller };
  }).sort((a, b) => {
    const providerCompare = (a.provider?.name ?? '').localeCompare(b.provider?.name ?? '');
    if (providerCompare) return providerCompare;
    return (a.product?.name ?? '').localeCompare(b.product?.name ?? '');
  }), [billerById, mappings, productById, providerById]);

  // ── Providers ────────────────────────────────────────────────────────────
  const [providerName, setProviderName] = useState('');
  const [providerCode, setProviderCode] = useState('');
  const [providerAdapterCode, setProviderAdapterCode] = useState('sandbox');

  async function handleCreateProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createProvider({ name: providerName, code: providerCode, adapter_code: providerAdapterCode });
      setProviderName('');
      setProviderCode('');
      setProviderAdapterCode('sandbox');
      flash('Provider created.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to create provider.');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleProvider(provider: UtilityProvider) {
    setBusy(true);
    setError(null);
    try {
      await updateProviderStatus(provider.id, provider.status === 'active' ? 'disabled' : 'active');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update provider.');
    } finally {
      setBusy(false);
    }
  }

  async function handleHealthCheck(providerId: string) {
    setBusy(true);
    setError(null);
    try {
      await healthCheckProvider(providerId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to check provider health.');
    } finally {
      setBusy(false);
    }
  }

  // ── Categories ───────────────────────────────────────────────────────────
  async function handleToggleCategory(item: UtilityCategorySetting) {
    setBusy(true);
    setError(null);
    try {
      await updateCategorySetting(item.category, { enabled: !item.enabled });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update category.');
    } finally {
      setBusy(false);
    }
  }

  // ── Billers ──────────────────────────────────────────────────────────────
  async function handleCreateBiller(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await createBiller({
        name: String(form.get('name') || '').trim(),
        code: String(form.get('code') || '').trim(),
        category: String(form.get('category') || 'airtime'),
        requires_validation: form.get('requires_validation') === 'on',
        customer_reference_label: String(form.get('customer_reference_label') || 'Customer reference').trim(),
      });
      event.currentTarget.reset();
      flash('Biller created.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to create biller.');
    } finally {
      setBusy(false);
    }
  }

  // ── Products ─────────────────────────────────────────────────────────────
  const [productCategory, setProductCategory] = useState<string>(UTILITY_CATEGORIES[0]);

  async function handleCreateProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await createProduct({
        name: String(form.get('name') || '').trim(),
        code: String(form.get('code') || '').trim(),
        category: productCategory,
        biller_id: String(form.get('biller_id') || ''),
        amount_type: String(form.get('amount_type') || 'fixed'),
        amount_naira: Number(form.get('amount_naira') || 0),
        min_amount_naira: Number(form.get('min_amount_naira') || 0),
        max_amount_naira: Number(form.get('max_amount_naira') || 0),
        markup_bps: Number(form.get('markup_bps') || 0),
        provider_discount_bps: Number(form.get('provider_discount_bps') || 0),
      });
      event.currentTarget.reset();
      flash('Product created.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to create product.');
    } finally {
      setBusy(false);
    }
  }

  // ── Provider ↔ product mappings ─────────────────────────────────────────
  async function handleCreateMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await createProviderProductMapping({
        provider_id: String(form.get('provider_id') || ''),
        product_id: String(form.get('product_id') || ''),
        provider_product_code: String(form.get('provider_product_code') || '').trim(),
        provider_biller_code: String(form.get('provider_biller_code') || '').trim(),
        provider_cost_naira: Number(form.get('provider_cost_naira') || 0),
        provider_discount_bps: Number(form.get('provider_discount_bps') || 0),
      });
      event.currentTarget.reset();
      flash('Provider service mapping created.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to create provider service mapping.');
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateMappingDiscount(event: FormEvent<HTMLFormElement>, mapping: UtilityProviderProductMapping) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await updateProviderProductMapping(mapping.id, {
        discount_percent: String(form.get('discount_percent') || 0),
        provider_cost_naira: Number(form.get('provider_cost_naira') || 0),
        status: String(form.get('status') || mapping.status),
      });
      flash('Provider service discount updated.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update provider service discount.');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !providers.length && !categories.length) {
    return <Page><p style={{ color: colors.muted }}>Loading utility catalogue…</p></Page>;
  }

  return (
    <Page>
      <PageHeader
        title="Utility Payments — Catalogue"
        subtitle="Provider routing, category availability, and the biller/product catalogue behind Utility Payments. Transaction monitoring and reversals live on the Utility Payments page."
        actions={(
          <>
            <Link href="/admin/utility-payments"><Button variant="outline">Transactions</Button></Link>
            <Button variant="outline" onClick={() => void load()} disabled={busy}>Refresh</Button>
          </>
        )}
      />

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
        {TABS.map((t) => (
          <Button key={t.key} variant={tab === t.key ? 'primary' : 'outline'} sm onClick={() => setTab(t.key)}>
            {t.label}
          </Button>
        ))}
      </div>

      {toast && <p style={{ color: colors.success, marginBottom: '1rem' }}>{toast}</p>}
      {error && <p style={{ color: colors.danger, marginBottom: '1rem' }}>{error}</p>}

      {tab === 'providers' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,320px) minmax(0,1fr)', gap: '1rem', alignItems: 'start' }}>
          <Card title="Add Provider">
            <form onSubmit={handleCreateProvider} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
              <label style={labelStyle}>
                Provider Name
                <Input style={{ marginTop: 4 }} value={providerName} onChange={(e) => setProviderName(e.target.value)} required />
              </label>
              <label style={labelStyle}>
                Provider Code
                <Input style={{ marginTop: 4 }} value={providerCode} onChange={(e) => setProviderCode(e.target.value)} required />
              </label>
              <label style={labelStyle}>
                Adapter
                <select style={selectStyle} value={providerAdapterCode} onChange={(e) => setProviderAdapterCode(e.target.value)} required>
                  <option value="sandbox">Sandbox</option>
                  <option value="vtpass">VTPass</option>
                </select>
              </label>
              <Button type="submit" variant="primary" disabled={busy}>Create Provider</Button>
            </form>
          </Card>

          <Card title="Providers" right={<span style={{ fontSize: 12, color: colors.muted }}>{providers.length} configured</span>}>
            <div style={{ overflowX: 'auto', marginTop: 12 }}>
              <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thCell}>Provider</th>
                    <th style={thCell}>Adapter</th>
                    <th style={thCell}>Status</th>
                    <th style={thCell}>Health</th>
                    <th style={thCell}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {providers.length === 0 ? (
                    <tr><td style={tdCell} colSpan={5}>No providers yet.</td></tr>
                  ) : providers.map((provider) => (
                    <tr key={provider.id}>
                      <td style={tdCell}>
                        <div style={{ fontWeight: 600 }}>{provider.name}</div>
                        <div style={{ fontSize: 11, color: colors.muted }}>{provider.code}</div>
                      </td>
                      <td style={tdCell}>{provider.adapter_code}</td>
                      <td style={tdCell}>{statusBadge(provider.status)}</td>
                      <td style={tdCell}>{statusBadge(provider.health_status)}</td>
                      <td style={tdCell}>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <Button sm variant="outline" disabled={busy} onClick={() => void handleHealthCheck(provider.id)}>Health</Button>
                          <Button sm variant="outline" disabled={busy} onClick={() => void handleToggleProvider(provider)}>
                            {provider.status === 'active' ? 'Disable' : 'Enable'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === 'categories' && (
        <Card title="Category Controls">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginTop: 12 }}>
            {categories.length === 0 ? (
              <p style={{ color: colors.muted }}>No category settings yet.</p>
            ) : categories.map((item) => (
              <div key={item.category} style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, textTransform: 'capitalize' }}>{item.category.replace(/_/g, ' ')}</div>
                    <div style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>Daily {formatNaira(item.daily_limit_kobo)}</div>
                  </div>
                  {statusBadge(item.enabled ? 'active' : 'disabled')}
                </div>
                {item.availability_message ? (
                  <p style={{ fontSize: 12, color: colors.text, marginTop: 8 }}>{item.availability_message}</p>
                ) : null}
                <Button sm variant="outline" disabled={busy} onClick={() => void handleToggleCategory(item)} style={{ marginTop: 10 }}>
                  {item.enabled ? 'Disable' : 'Enable'}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'catalogue' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
            <Card title="Add Biller">
              <p style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>Create the customer-facing service owner, such as MTN, Glo or Ikeja Electric.</p>
              <form onSubmit={handleCreateBiller} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                <label style={labelStyle}>Biller Name<Input name="name" style={{ marginTop: 4 }} placeholder="MTN Nigeria" required /></label>
                <label style={labelStyle}>Unique Code<Input name="code" style={{ marginTop: 4 }} placeholder="mtn" required /></label>
                <label style={labelStyle}>
                  Category
                  <select name="category" style={selectStyle} required defaultValue={UTILITY_CATEGORIES[0]}>
                    {UTILITY_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                  </select>
                </label>
                <label style={labelStyle}>
                  Customer Reference Label
                  <Input name="customer_reference_label" style={{ marginTop: 4 }} placeholder="Phone number" defaultValue="Phone number" required />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: colors.text }}>
                  <input name="requires_validation" type="checkbox" />
                  Requires validation before payment
                </label>
                <Button type="submit" variant="primary" disabled={busy}>Create Biller</Button>
              </form>
            </Card>

            <Card title="Add Product">
              <p style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>Define the unified Spotlight product shown to customers.</p>
              <form onSubmit={handleCreateProduct} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                <label style={labelStyle}>Product Name<Input name="name" style={{ marginTop: 4 }} placeholder="MTN 1GB - 30 Days" required /></label>
                <label style={labelStyle}>Unique Code<Input name="code" style={{ marginTop: 4 }} placeholder="mtn-1gb-30days" required /></label>
                <label style={labelStyle}>
                  Category
                  <select style={selectStyle} value={productCategory} onChange={(e) => setProductCategory(e.target.value)} required>
                    {UTILITY_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                  </select>
                </label>
                <label style={labelStyle}>
                  Biller
                  <select name="biller_id" style={selectStyle} required defaultValue="">
                    <option value="" disabled>Select biller</option>
                    {billers.filter((b) => b.category === productCategory).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </label>
                <label style={labelStyle}>
                  Amount Type
                  <select name="amount_type" style={selectStyle} required defaultValue="fixed">
                    <option value="fixed">Fixed amount</option>
                    <option value="variable">Variable amount</option>
                  </select>
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  <label style={labelStyle}>Fixed (NGN)<Input name="amount_naira" style={{ marginTop: 4 }} type="number" min={0} step={1} placeholder="1000" /></label>
                  <label style={labelStyle}>Min (NGN)<Input name="min_amount_naira" style={{ marginTop: 4 }} type="number" min={0} step={1} placeholder="100" /></label>
                  <label style={labelStyle}>Max (NGN)<Input name="max_amount_naira" style={{ marginTop: 4 }} type="number" min={0} step={1} placeholder="50000" /></label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                  <label style={labelStyle}>Customer Markup (bps)<Input name="markup_bps" style={{ marginTop: 4 }} type="number" min={0} step={1} placeholder="0" /></label>
                  <label style={labelStyle}>Default Provider Discount (bps)<Input name="provider_discount_bps" style={{ marginTop: 4 }} type="number" min={0} step={1} placeholder="500" /></label>
                </div>
                <Button type="submit" variant="primary" disabled={busy || billers.length === 0}>Create Product</Button>
              </form>
            </Card>

            <Card title="Map Provider Code">
              <p style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>Connect a Spotlight product to each provider code and discount.</p>
              <form onSubmit={handleCreateMapping} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                <label style={labelStyle}>
                  Provider
                  <select name="provider_id" style={selectStyle} required defaultValue="">
                    <option value="" disabled>Select provider</option>
                    {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label style={labelStyle}>
                  Spotlight Product
                  <select name="product_id" style={selectStyle} required defaultValue="">
                    <option value="" disabled>Select product</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label style={labelStyle}>Provider Product Code<Input name="provider_product_code" style={{ marginTop: 4 }} placeholder="mtn-data-1gb" required /></label>
                <label style={labelStyle}>Provider Biller Code<Input name="provider_biller_code" style={{ marginTop: 4 }} placeholder="Optional" /></label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                  <label style={labelStyle}>Fixed Provider Cost (NGN)<Input name="provider_cost_naira" style={{ marginTop: 4 }} type="number" min={0} step={1} placeholder="Optional" /></label>
                  <label style={labelStyle}>Provider Discount (bps)<Input name="provider_discount_bps" style={{ marginTop: 4 }} type="number" min={0} step={1} placeholder="500 for 5%" /></label>
                </div>
                <Button type="submit" variant="primary" disabled={busy || providers.length === 0 || products.length === 0}>Create Mapping</Button>
              </form>
            </Card>
          </div>

          <Card
            title="Provider Service Discounts"
            right={<span style={{ fontSize: 12, color: colors.muted }}>{discountRows.length} service mappings</span>}
          >
            <p style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>
              The discount received from each provider for each mapped service. These values drive provider cost and gross profit reporting.
            </p>
            <div style={{ overflowX: 'auto', marginTop: 12 }}>
              <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thCell}>Provider</th>
                    <th style={thCell}>Service</th>
                    <th style={thCell}>Biller</th>
                    <th style={thCell}>Provider Codes</th>
                    <th style={thCell}>Discount</th>
                    <th style={thCell}>Provider Cost</th>
                    <th style={thCell}>Status</th>
                    <th style={thCell}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {discountRows.length === 0 ? (
                    <tr><td style={tdCell} colSpan={8}>No provider service mappings yet. Create a provider code mapping above to manage its discount.</td></tr>
                  ) : discountRows.map(({ mapping, provider, product, biller }) => {
                    const formId = `discount-${mapping.id}`;
                    return (
                      <tr key={mapping.id}>
                        <td style={tdCell}>
                          <div style={{ fontWeight: 600 }}>{provider?.name ?? 'Unknown provider'}</div>
                          <div style={{ fontSize: 11, color: colors.muted }}>{provider?.code ?? mapping.provider_id}</div>
                        </td>
                        <td style={tdCell}>
                          <div style={{ fontWeight: 600 }}>{product?.name ?? 'Unknown service'}</div>
                          <div style={{ fontSize: 11, color: colors.muted, textTransform: 'capitalize' }}>{(product?.category ?? '').replace(/_/g, ' ')}</div>
                        </td>
                        <td style={tdCell}>
                          <div>{biller?.name ?? '-'}</div>
                          <div style={{ fontSize: 11, color: colors.muted }}>{biller?.code ?? ''}</div>
                        </td>
                        <td style={tdCell}>
                          <div>{mapping.provider_product_code}</div>
                          {mapping.provider_biller_code ? <div style={{ fontSize: 11, color: colors.muted }}>{mapping.provider_biller_code}</div> : null}
                        </td>
                        <td style={tdCell}>
                          <form id={formId} onSubmit={(e) => void handleUpdateMappingDiscount(e, mapping)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input
                              name="discount_percent"
                              type="number"
                              min={0}
                              step={0.01}
                              defaultValue={(mapping.provider_discount_bps / 100).toFixed(2)}
                              aria-label="Provider discount percent"
                              style={{ width: 90, padding: '6px 8px', fontSize: 12, border: `1px solid ${colors.inputBorder}`, borderRadius: 6 }}
                            />
                            <span style={{ color: colors.muted }}>%</span>
                          </form>
                          <div style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>Current {formatBps(mapping.provider_discount_bps)}</div>
                        </td>
                        <td style={tdCell}>
                          <input
                            form={formId}
                            name="provider_cost_naira"
                            type="number"
                            min={0}
                            step={1}
                            defaultValue={mapping.provider_cost_kobo ? String(mapping.provider_cost_kobo / 100) : ''}
                            placeholder="Auto"
                            aria-label="Provider fixed cost"
                            style={{ width: 110, padding: '6px 8px', fontSize: 12, border: `1px solid ${colors.inputBorder}`, borderRadius: 6 }}
                          />
                        </td>
                        <td style={tdCell}>
                          <select form={formId} name="status" defaultValue={mapping.status} style={{ width: 110, padding: '6px 8px', fontSize: 12, border: `1px solid ${colors.inputBorder}`, borderRadius: 6 }}>
                            <option value="active">Active</option>
                            <option value="disabled">Disabled</option>
                          </select>
                        </td>
                        <td style={tdCell}>
                          <Button form={formId} type="submit" sm variant="outline" disabled={busy}>Save</Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </Page>
  );
}
