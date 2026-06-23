'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { authFetch, isUnauthorized, redirectToLogin } from '@/src/lib/auth/flow';

type Provider = {
  id: string;
  name: string;
  code: string;
  adapter_code: string;
  status: string;
  health_status: string;
  supported_categories: string[];
  priority: number;
};

type Biller = {
  id: string;
  name: string;
  code: string;
  category: string;
  status: string;
  requires_validation: boolean;
};

type CategorySetting = {
  category: string;
  enabled: boolean;
  availability_message: string | null;
  daily_limit_kobo: number | null;
  min_amount_kobo: number | null;
  max_amount_kobo: number | null;
};

type Product = {
  id: string;
  biller_id: string;
  name: string;
  code: string;
  category: string;
  amount_type: string;
  amount_kobo: number | null;
  provider_discount_bps: number;
};

type ProviderProductMapping = {
  id: string;
  provider_id: string;
  product_id: string;
  provider_product_code: string;
  provider_biller_code: string | null;
  provider_cost_kobo: number | null;
  provider_discount_bps: number;
  status: string;
};

type Transaction = {
  id: string;
  category: string;
  customer_reference: string;
  status: string;
  retail_amount_kobo: number;
  gross_profit_kobo: number;
  receipt_number: string | null;
  created_at: string;
};

type ProfitReport = {
  total_transactions: number;
  gross_transaction_value_kobo: number;
  provider_cost_kobo: number;
  gross_profit_kobo: number;
};

type ProviderPerformance = {
  provider_id: string;
  attempts: number;
  successful: number;
  timeout: number;
  error: number;
  average_duration_ms: number;
  success_rate_bps: number;
};

function formatNaira(kobo: number | null | undefined) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format((kobo ?? 0) / 100);
}

function badge(status: string) {
  if (status === 'active' || status === 'healthy' || status === 'successful') return 'badge-approved';
  if (status === 'disabled' || status === 'down' || status === 'failed' || status === 'reversed') return 'badge-rejected';
  return 'badge-pending';
}

function formatBps(bps: number | null | undefined) {
  return `${((bps ?? 0) / 100).toFixed(2)}%`;
}

function percentToBps(value: FormDataEntryValue | null) {
  const percent = Number(value || 0);
  return Math.round(percent * 100);
}

export default function UtilityAdminConsole() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [categories, setCategories] = useState<CategorySetting[]>([]);
  const [billers, setBillers] = useState<Biller[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [mappings, setMappings] = useState<ProviderProductMapping[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [profitReport, setProfitReport] = useState<ProfitReport | null>(null);
  const [providerPerformance, setProviderPerformance] = useState<ProviderPerformance[]>([]);
  const [providerName, setProviderName] = useState('');
  const [providerCode, setProviderCode] = useState('');
  const [providerAdapterCode, setProviderAdapterCode] = useState('sandbox');
  const [productCategory, setProductCategory] = useState('airtime');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const metrics = useMemo(() => [
    ['Transactions', String(profitReport?.total_transactions ?? transactions.length)],
    ['Gross Value', formatNaira(profitReport?.gross_transaction_value_kobo ?? transactions.reduce((sum, row) => sum + row.retail_amount_kobo, 0))],
    ['Provider Cost', formatNaira(profitReport?.provider_cost_kobo)],
    ['Gross Profit', formatNaira(profitReport?.gross_profit_kobo ?? transactions.reduce((sum, row) => sum + row.gross_profit_kobo, 0))],
  ], [profitReport, transactions]);

  const providerById = useMemo(() => new Map(providers.map((provider) => [provider.id, provider])), [providers]);
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const billerById = useMemo(() => new Map(billers.map((biller) => [biller.id, biller])), [billers]);

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

  async function parseResponse(response: Response) {
    const payload = await response.json().catch(() => ({}));
    if (isUnauthorized(response)) {
      redirectToLogin('/admin/utility');
      return null;
    }
    if (!response.ok || payload?.success === false) {
      throw new Error(String(payload?.error || 'Utility admin request failed.'));
    }
    return payload;
  }

  async function loadAll() {
    setBusy(true);
    setMessage('');
    try {
      const [providerRes, categoryRes, billerRes, productRes, mappingRes, transactionRes, reportRes, performanceRes] = await Promise.all([
        authFetch('/api/admin/utility/providers', { cache: 'no-store' }),
        authFetch('/api/admin/utility/categories', { cache: 'no-store' }),
        authFetch('/api/admin/utility/billers', { cache: 'no-store' }),
        authFetch('/api/admin/utility/products', { cache: 'no-store' }),
        authFetch('/api/admin/utility/provider-products', { cache: 'no-store' }),
        authFetch('/api/admin/utility/transactions?limit=10', { cache: 'no-store' }),
        authFetch('/api/admin/utility/reports/profitability', { cache: 'no-store' }),
        authFetch('/api/admin/utility/reports/provider-performance', { cache: 'no-store' }),
      ]);

      const [providerPayload, categoryPayload, billerPayload, productPayload, mappingPayload, transactionPayload, reportPayload, performancePayload] = await Promise.all([
        parseResponse(providerRes),
        parseResponse(categoryRes),
        parseResponse(billerRes),
        parseResponse(productRes),
        parseResponse(mappingRes),
        parseResponse(transactionRes),
        parseResponse(reportRes),
        parseResponse(performanceRes),
      ]);

      setProviders(Array.isArray(providerPayload?.providers) ? providerPayload.providers : []);
      setCategories(Array.isArray(categoryPayload?.categories) ? categoryPayload.categories : []);
      setBillers(Array.isArray(billerPayload?.billers) ? billerPayload.billers : []);
      setProducts(Array.isArray(productPayload?.products) ? productPayload.products : []);
      setMappings(Array.isArray(mappingPayload?.mappings) ? mappingPayload.mappings : []);
      setTransactions(Array.isArray(transactionPayload?.transactions) ? transactionPayload.transactions : []);
      setProfitReport(reportPayload?.report ?? null);
      setProviderPerformance(Array.isArray(performancePayload?.report) ? performancePayload.report : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load utility admin data.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function createProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await authFetch('/api/admin/utility/providers', {
        method: 'POST',
        body: JSON.stringify({
          name: providerName,
          code: providerCode,
          adapter_code: providerAdapterCode,
          supported_categories: ['airtime', 'data', 'electricity', 'cable_tv', 'internet', 'education'],
          priority: 50,
          health_status: 'unknown',
        }),
      }, { json: true });
      await parseResponse(response);
      setProviderName('');
      setProviderCode('');
      setProviderAdapterCode('sandbox');
      setMessage('Provider created.');
      await loadAll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create provider.');
    } finally {
      setBusy(false);
    }
  }

  async function updateProvider(id: string, status: string) {
    setBusy(true);
    try {
      const response = await authFetch(`/api/admin/utility/providers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }, { json: true });
      await parseResponse(response);
      await loadAll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update provider.');
    } finally {
      setBusy(false);
    }
  }

  async function updateCategory(category: string, patch: Partial<CategorySetting>) {
    setBusy(true);
    try {
      const response = await authFetch(`/api/admin/utility/categories/${category}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }, { json: true });
      await parseResponse(response);
      await loadAll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update category.');
    } finally {
      setBusy(false);
    }
  }

  async function createBiller(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage('');
    try {
      const response = await authFetch('/api/admin/utility/billers', {
        method: 'POST',
        body: JSON.stringify({
          name: String(form.get('name') || '').trim(),
          code: String(form.get('code') || '').trim(),
          category: String(form.get('category') || 'airtime'),
          requires_validation: form.get('requires_validation') === 'on',
          customer_reference_label: String(form.get('customer_reference_label') || 'Customer reference').trim(),
          status: 'active',
          dynamic_fields: [],
        }),
      }, { json: true });
      await parseResponse(response);
      event.currentTarget.reset();
      setMessage('Biller created.');
      await loadAll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create biller.');
    } finally {
      setBusy(false);
    }
  }

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amountNaira = Number(form.get('amount_naira') || 0);
    const minAmountNaira = Number(form.get('min_amount_naira') || 0);
    const maxAmountNaira = Number(form.get('max_amount_naira') || 0);
    setBusy(true);
    setMessage('');
    try {
      const response = await authFetch('/api/admin/utility/products', {
        method: 'POST',
        body: JSON.stringify({
          name: String(form.get('name') || '').trim(),
          code: String(form.get('code') || '').trim(),
          category: productCategory,
          biller_id: String(form.get('biller_id') || ''),
          amount_type: String(form.get('amount_type') || 'fixed'),
          amount_kobo: amountNaira > 0 ? Math.round(amountNaira * 100) : null,
          min_amount_kobo: minAmountNaira > 0 ? Math.round(minAmountNaira * 100) : null,
          max_amount_kobo: maxAmountNaira > 0 ? Math.round(maxAmountNaira * 100) : null,
          convenience_fee_kobo: 0,
          markup_bps: Number(form.get('markup_bps') || 0),
          provider_discount_bps: Number(form.get('provider_discount_bps') || 0),
          status: 'active',
          metadata: {},
        }),
      }, { json: true });
      await parseResponse(response);
      event.currentTarget.reset();
      setMessage('Product created.');
      await loadAll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create product.');
    } finally {
      setBusy(false);
    }
  }

  async function createMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const providerCostNaira = Number(form.get('provider_cost_naira') || 0);
    setBusy(true);
    setMessage('');
    try {
      const response = await authFetch('/api/admin/utility/provider-products', {
        method: 'POST',
        body: JSON.stringify({
          provider_id: String(form.get('provider_id') || ''),
          product_id: String(form.get('product_id') || ''),
          provider_product_code: String(form.get('provider_product_code') || '').trim(),
          provider_biller_code: String(form.get('provider_biller_code') || '').trim() || null,
          provider_cost_kobo: providerCostNaira > 0 ? Math.round(providerCostNaira * 100) : null,
          provider_discount_bps: Number(form.get('provider_discount_bps') || 0),
          status: 'active',
        }),
      }, { json: true });
      await parseResponse(response);
      event.currentTarget.reset();
      setMessage('Provider product mapping created.');
      await loadAll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create provider product mapping.');
    } finally {
      setBusy(false);
    }
  }

  async function updateMappingDiscount(event: FormEvent<HTMLFormElement>, mapping: ProviderProductMapping) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const providerCostNaira = Number(form.get('provider_cost_naira') || 0);
    setBusy(true);
    setMessage('');
    try {
      const response = await authFetch(`/api/admin/utility/provider-products/${mapping.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          provider_discount_bps: percentToBps(form.get('discount_percent')),
          provider_cost_kobo: providerCostNaira > 0 ? Math.round(providerCostNaira * 100) : null,
          status: String(form.get('status') || mapping.status),
        }),
      }, { json: true });
      await parseResponse(response);
      setMessage('Provider service discount updated.');
      await loadAll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update provider service discount.');
    } finally {
      setBusy(false);
    }
  }

  async function healthCheckProvider(id: string) {
    setBusy(true);
    try {
      const response = await authFetch(`/api/admin/utility/providers/${id}/health-check`, { method: 'POST' });
      await parseResponse(response);
      await loadAll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to check provider health.');
    } finally {
      setBusy(false);
    }
  }

  async function requeryTransaction(id: string) {
    setBusy(true);
    try {
      const response = await authFetch(`/api/admin/utility/transactions/${id}/requery`, { method: 'POST' });
      await parseResponse(response);
      await loadAll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to requery transaction.');
    } finally {
      setBusy(false);
    }
  }

  async function reverseTransaction(id: string) {
    const reason = window.prompt('Reason for reversal');
    if (!reason) return;
    setBusy(true);
    try {
      const response = await authFetch(`/api/admin/utility/transactions/${id}/reverse`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }, { json: true });
      await parseResponse(response);
      await loadAll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to reverse transaction.');
    } finally {
      setBusy(false);
    }
  }

  async function requeryPendingBatch() {
    setBusy(true);
    try {
      const response = await authFetch('/api/admin/utility/workers/requery-pending?limit=25', { method: 'POST' });
      const payload = await parseResponse(response);
      setMessage(`Pending requery processed ${payload?.processed ?? 0} transactions.`);
      await loadAll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to run pending requery.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="max-w-7xl mx-auto px-2 md:px-4 pb-6">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-3xl md:text-4xl text-foreground">Utility Payments</h1>
          <p className="text-foreground-muted mt-1">Provider routing, catalogue, monitoring, reversals and profitability.</p>
        </div>
        <button type="button" className="btn-outline py-2 px-3 text-[11px]" onClick={() => void loadAll()} disabled={busy}>
          Refresh
        </button>
        <button type="button" className="btn-outline py-2 px-3 text-[11px]" onClick={() => void requeryPendingBatch()} disabled={busy}>
          Requery Pending
        </button>
        <a className="btn-outline py-2 px-3 text-[11px]" href="/api/admin/utility/reports/reconciliation?format=csv">
          Export CSV
        </a>
        <a className="btn-outline py-2 px-3 text-[11px]" href="/api/admin/utility/reports/provider-performance?format=csv">
          Provider CSV
        </a>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
        {metrics.map(([label, value]) => (
          <div key={label} className="glass-card rounded-md p-4">
            <div className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">{label}</div>
            <div className="text-3xl font-bold text-foreground mt-1">{value}</div>
          </div>
        ))}
      </div>

      {message ? <div className="glass-card rounded-md p-3 text-foreground-muted mb-4">{message}</div> : null}

      <div className="grid grid-cols-1 xl:grid-cols-[420px_minmax(0,1fr)] gap-4 mb-6">
        <div className="glass-card rounded-md p-4">
          <h2 className="font-display text-xl text-foreground">Add Provider</h2>
          <form onSubmit={createProvider} className="mt-3 space-y-3">
            <label className="d-block">
              <span className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">Provider Name</span>
              <input className="form-input mt-1" value={providerName} onChange={(event) => setProviderName(event.target.value)} required />
            </label>
            <label className="d-block">
              <span className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">Provider Code</span>
              <input className="form-input mt-1" value={providerCode} onChange={(event) => setProviderCode(event.target.value)} required />
            </label>
            <label className="d-block">
              <span className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">Adapter</span>
              <select className="form-input mt-1" value={providerAdapterCode} onChange={(event) => setProviderAdapterCode(event.target.value)} required>
                <option value="sandbox">Sandbox</option>
                <option value="vtpass">VTPass</option>
              </select>
            </label>
            <button type="submit" className="btn-primary py-2.5 px-4 text-[11px]" disabled={busy}>
              Create Provider
            </button>
          </form>
        </div>

        <div className="glass-card rounded-md p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="font-display text-xl text-foreground mb-0">Providers</h2>
            <span className="text-foreground-dim text-xs">{providers.length} configured</span>
          </div>
          <div className="overflow-x-auto border border-border rounded-sm">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-bg-card">
                <tr className="text-left text-foreground-dim uppercase tracking-[0.1em] text-[10px]">
                  <th className="py-3 px-3">Provider</th>
                  <th className="py-3 px-3">Adapter</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Health</th>
                  <th className="py-3 px-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((provider) => (
                  <tr key={provider.id} className="border-t border-border text-foreground-muted">
                    <td className="py-2.5 px-3">
                      <div className="text-foreground font-semibold">{provider.name}</div>
                      <div className="text-xs text-foreground-dim">{provider.code}</div>
                    </td>
                    <td className="py-2.5 px-3">{provider.adapter_code}</td>
                    <td className="py-2.5 px-3"><span className={`inline-flex px-2 py-0.5 rounded-sm text-[11px] font-semibold ${badge(provider.status)}`}>{provider.status}</span></td>
                    <td className="py-2.5 px-3"><span className={`inline-flex px-2 py-0.5 rounded-sm text-[11px] font-semibold ${badge(provider.health_status)}`}>{provider.health_status}</span></td>
                    <td className="py-2.5 px-3">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="btn-outline py-1.5 px-2 text-[10px]" onClick={() => void healthCheckProvider(provider.id)}>Health</button>
                        <button type="button" className="btn-outline py-1.5 px-2 text-[10px]" onClick={() => void updateProvider(provider.id, provider.status === 'active' ? 'disabled' : 'active')}>
                          {provider.status === 'active' ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
        <div className="glass-card rounded-md p-4 xl:col-span-2">
          <h2 className="font-display text-xl text-foreground">Category Controls</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3 mt-3">
            {categories.map((item) => (
              <div key={item.category} className="border border-border rounded-sm p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-foreground font-semibold capitalize">{item.category.replace(/_/g, ' ')}</div>
                    <div className="text-xs text-foreground-dim mt-1">Daily {formatNaira(item.daily_limit_kobo)}</div>
                  </div>
                  <span className={`inline-flex px-2 py-0.5 rounded-sm text-[11px] font-semibold ${badge(item.enabled ? 'active' : 'disabled')}`}>
                    {item.enabled ? 'enabled' : 'disabled'}
                  </span>
                </div>
                {item.availability_message ? <p className="text-xs text-foreground-muted mt-2 mb-0">{item.availability_message}</p> : null}
                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    type="button"
                    className="btn-outline py-1.5 px-2 text-[10px]"
                    onClick={() => void updateCategory(item.category, { enabled: !item.enabled })}
                  >
                    {item.enabled ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card rounded-md p-4 xl:col-span-2">
          <h2 className="font-display text-xl text-foreground">Catalogue Management</h2>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-3 items-stretch">
            <form onSubmit={createBiller} className="admin-catalogue-form">
              <div>
                <h3 className="font-display text-lg text-foreground mb-1">Add Biller</h3>
                <p className="text-sm text-foreground-muted mb-0">Create the customer-facing service owner, such as MTN, Glo or Ikeja Electric.</p>
              </div>
              <label className="d-block">
                <span className="form-label">Biller Name</span>
                <input name="name" className="form-input mt-1" placeholder="MTN Nigeria" required />
              </label>
              <label className="d-block">
                <span className="form-label">Unique Code</span>
                <input name="code" className="form-input mt-1" placeholder="mtn" required />
              </label>
              <label className="d-block">
                <span className="form-label">Category</span>
                <select name="category" className="form-input mt-1" required>
                  {['airtime', 'data', 'electricity', 'cable_tv', 'internet', 'education'].map((category) => (
                    <option key={category} value={category}>{category.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </label>
              <label className="d-block">
                <span className="form-label">Customer Reference Label</span>
                <input name="customer_reference_label" className="form-input mt-1" placeholder="Phone number" defaultValue="Phone number" required />
              </label>
              <label className="admin-checkbox-row">
                <input name="requires_validation" type="checkbox" />
                <span>Requires validation before payment</span>
              </label>
              <div className="admin-form-actions">
                <button type="submit" className="btn-primary py-2.5 px-4 text-[11px]" disabled={busy}>Create Biller</button>
              </div>
            </form>

            <form onSubmit={createProduct} className="admin-catalogue-form">
              <div>
                <h3 className="font-display text-lg text-foreground mb-1">Add Product</h3>
                <p className="text-sm text-foreground-muted mb-0">Define the unified Spotlight product shown to customers.</p>
              </div>
              <label className="d-block">
                <span className="form-label">Product Name</span>
                <input name="name" className="form-input mt-1" placeholder="MTN 1GB - 30 Days" required />
              </label>
              <label className="d-block">
                <span className="form-label">Unique Code</span>
                <input name="code" className="form-input mt-1" placeholder="mtn-1gb-30days" required />
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="d-block">
                  <span className="form-label">Category</span>
                  <select className="form-input mt-1" value={productCategory} onChange={(event) => setProductCategory(event.target.value)} required>
                    {['airtime', 'data', 'electricity', 'cable_tv', 'internet', 'education'].map((category) => (
                      <option key={category} value={category}>{category.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </label>
                <label className="d-block">
                  <span className="form-label">Biller</span>
                  <select name="biller_id" className="form-input mt-1" required>
                    <option value="">Select biller</option>
                    {billers.filter((biller) => biller.category === productCategory).map((biller) => (
                      <option key={biller.id} value={biller.id}>{biller.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="d-block">
                <span className="form-label">Amount Type</span>
                <select name="amount_type" className="form-input mt-1" required>
                  <option value="fixed">Fixed amount</option>
                  <option value="variable">Variable amount</option>
                </select>
              </label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label className="d-block">
                  <span className="form-label">Fixed Amount (NGN)</span>
                  <input name="amount_naira" className="form-input mt-1" placeholder="1000" type="number" min="0" step="1" />
                </label>
                <label className="d-block">
                  <span className="form-label">Minimum (NGN)</span>
                  <input name="min_amount_naira" className="form-input mt-1" placeholder="100" type="number" min="0" step="1" />
                </label>
                <label className="d-block">
                  <span className="form-label">Maximum (NGN)</span>
                  <input name="max_amount_naira" className="form-input mt-1" placeholder="50000" type="number" min="0" step="1" />
                </label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="d-block">
                  <span className="form-label">Customer Markup (bps)</span>
                  <input name="markup_bps" className="form-input mt-1" placeholder="0" type="number" min="0" step="1" />
                </label>
                <label className="d-block">
                  <span className="form-label">Default Provider Discount (bps)</span>
                  <input name="provider_discount_bps" className="form-input mt-1" placeholder="500" type="number" min="0" step="1" />
                </label>
              </div>
              <div className="admin-form-actions">
                <button type="submit" className="btn-primary py-2.5 px-4 text-[11px]" disabled={busy || billers.length === 0}>Create Product</button>
              </div>
            </form>

            <form onSubmit={createMapping} className="admin-catalogue-form">
              <div>
                <h3 className="font-display text-lg text-foreground mb-1">Map Provider Code</h3>
                <p className="text-sm text-foreground-muted mb-0">Connect a Spotlight product to each provider code and discount.</p>
              </div>
              <label className="d-block">
                <span className="form-label">Provider</span>
                <select name="provider_id" className="form-input mt-1" required>
                  <option value="">Select provider</option>
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.name}</option>
                  ))}
                </select>
              </label>
              <label className="d-block">
                <span className="form-label">Spotlight Product</span>
                <select name="product_id" className="form-input mt-1" required>
                  <option value="">Select product</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>{product.name}</option>
                  ))}
                </select>
              </label>
              <label className="d-block">
                <span className="form-label">Provider Product Code</span>
                <input name="provider_product_code" className="form-input mt-1" placeholder="mtn-data-1gb" required />
              </label>
              <label className="d-block">
                <span className="form-label">Provider Biller Code</span>
                <input name="provider_biller_code" className="form-input mt-1" placeholder="Optional" />
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="d-block">
                  <span className="form-label">Fixed Provider Cost (NGN)</span>
                  <input name="provider_cost_naira" className="form-input mt-1" placeholder="Optional" type="number" min="0" step="1" />
                </label>
                <label className="d-block">
                  <span className="form-label">Provider Discount (bps)</span>
                  <input name="provider_discount_bps" className="form-input mt-1" placeholder="500 for 5%" type="number" min="0" step="1" />
                </label>
              </div>
              <div className="admin-form-actions">
                <button type="submit" className="btn-primary py-2.5 px-4 text-[11px]" disabled={busy || providers.length === 0 || products.length === 0}>Create Mapping</button>
              </div>
            </form>
          </div>

          <div className="mt-5">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2 mb-3">
              <div>
                <h3 className="font-display text-lg text-foreground mb-0">Provider Service Discounts</h3>
                <p className="text-sm text-foreground-muted mb-0">
                  Set the discount received from each provider for each mapped service. These values drive provider cost and gross profit reporting.
                </p>
              </div>
              <span className="text-xs text-foreground-dim">{discountRows.length} service mappings</span>
            </div>
            <div className="overflow-x-auto border border-border rounded-sm">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-bg-card">
                  <tr className="text-left text-foreground-dim uppercase tracking-[0.1em] text-[10px]">
                    <th className="py-3 px-3">Provider</th>
                    <th className="py-3 px-3">Service</th>
                    <th className="py-3 px-3">Biller</th>
                    <th className="py-3 px-3">Provider Codes</th>
                    <th className="py-3 px-3">Discount</th>
                    <th className="py-3 px-3">Provider Cost</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {discountRows.length === 0 ? (
                    <tr>
                      <td className="py-5 px-3 text-foreground-muted" colSpan={8}>
                        No provider service mappings yet. Create a provider code mapping above to manage its discount.
                      </td>
                    </tr>
                  ) : discountRows.map(({ mapping, provider, product, biller }) => (
                    <tr key={mapping.id} className="border-t border-border text-foreground-muted">
                      <td className="py-2.5 px-3">
                        <div className="text-foreground font-semibold">{provider?.name ?? 'Unknown provider'}</div>
                        <div className="text-xs text-foreground-dim">{provider?.code ?? mapping.provider_id}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="text-foreground font-semibold">{product?.name ?? 'Unknown service'}</div>
                        <div className="text-xs text-foreground-dim capitalize">{(product?.category ?? '').replace(/_/g, ' ')}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div>{biller?.name ?? '-'}</div>
                        <div className="text-xs text-foreground-dim">{biller?.code ?? ''}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div>{mapping.provider_product_code}</div>
                        {mapping.provider_biller_code ? <div className="text-xs text-foreground-dim">{mapping.provider_biller_code}</div> : null}
                      </td>
                      <td className="py-2.5 px-3">
                        <form id={`discount-${mapping.id}`} onSubmit={(event) => void updateMappingDiscount(event, mapping)} className="flex items-center gap-2">
                          <input
                            name="discount_percent"
                            className="form-input w-28"
                            type="number"
                            min="0"
                            step="0.01"
                            defaultValue={(mapping.provider_discount_bps / 100).toFixed(2)}
                            aria-label="Provider discount percent"
                          />
                          <span className="text-foreground-dim">%</span>
                        </form>
                        <div className="text-xs text-foreground-dim mt-1">Current {formatBps(mapping.provider_discount_bps)}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <input
                          form={`discount-${mapping.id}`}
                          name="provider_cost_naira"
                          className="form-input w-32"
                          type="number"
                          min="0"
                          step="1"
                          defaultValue={mapping.provider_cost_kobo ? String(mapping.provider_cost_kobo / 100) : ''}
                          placeholder="Auto"
                          aria-label="Provider fixed cost"
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <select form={`discount-${mapping.id}`} name="status" className="form-input w-32" defaultValue={mapping.status}>
                          <option value="active">Active</option>
                          <option value="disabled">Disabled</option>
                        </select>
                      </td>
                      <td className="py-2.5 px-3">
                        <button form={`discount-${mapping.id}`} type="submit" className="btn-outline py-1.5 px-2 text-[10px]" disabled={busy}>
                          Save
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-3">
            <div className="border border-border rounded-sm p-3">
              <div className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim mb-2">Billers</div>
              <div className="space-y-2">
                {billers.slice(0, 6).map((biller) => (
                  <div key={biller.id} className="flex justify-between gap-3 text-sm">
                    <span className="text-foreground">{biller.name}</span>
                    <span className="text-foreground-dim">{biller.category}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="border border-border rounded-sm p-3">
              <div className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim mb-2">Products</div>
              <div className="space-y-2">
                {products.slice(0, 6).map((product) => (
                  <div key={product.id} className="flex justify-between gap-3 text-sm">
                    <span className="text-foreground">{product.name}</span>
                    <span className="text-foreground-dim">{product.amount_kobo ? formatNaira(product.amount_kobo) : 'Variable'}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="border border-border rounded-sm p-3">
              <div className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim mb-2">Provider Mappings</div>
              <div className="space-y-2">
                {mappings.slice(0, 6).map((mapping) => (
                  <div key={mapping.id} className="flex justify-between gap-3 text-sm">
                    <span className="text-foreground">{mapping.provider_product_code}</span>
                    <span className="text-foreground-dim">{mapping.provider_cost_kobo ? formatNaira(mapping.provider_cost_kobo) : `${mapping.provider_discount_bps} bps`}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="glass-card rounded-md p-4">
          <h2 className="font-display text-xl text-foreground">Reliability Rules</h2>
          <ul className="text-sm text-foreground-muted mt-3 list-disc pl-5 space-y-2">
            <li>Provider credentials remain server-side and are stripped from admin list responses.</li>
            <li>Provider routes skip disabled providers and providers marked down.</li>
            <li>Pending transactions are re-queried before reversals or customer support resolution.</li>
            <li>Successful transactions retain provider cost, gross value, and gross profit in kobo.</li>
          </ul>
        </div>
      </div>

      <div className="glass-card rounded-md p-4 mb-6">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="font-display text-xl text-foreground mb-0">Provider Performance</h2>
          <span className="text-foreground-dim text-xs">{providerPerformance.length} providers with attempts</span>
        </div>
        <div className="overflow-x-auto border border-border rounded-sm">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-bg-card">
              <tr className="text-left text-foreground-dim uppercase tracking-[0.1em] text-[10px]">
                <th className="py-3 px-3">Provider</th>
                <th className="py-3 px-3">Attempts</th>
                <th className="py-3 px-3">Success</th>
                <th className="py-3 px-3">Timeouts</th>
                <th className="py-3 px-3">Errors</th>
                <th className="py-3 px-3">Avg Latency</th>
              </tr>
            </thead>
            <tbody>
              {providerPerformance.length === 0 ? (
                <tr><td className="py-5 px-3 text-foreground-muted" colSpan={6}>No provider attempts recorded yet.</td></tr>
              ) : providerPerformance.map((row) => (
                <tr key={row.provider_id} className="border-t border-border text-foreground-muted">
                  <td className="py-2.5 px-3">{row.provider_id}</td>
                  <td className="py-2.5 px-3">{row.attempts}</td>
                  <td className="py-2.5 px-3">{(row.success_rate_bps / 100).toFixed(1)}%</td>
                  <td className="py-2.5 px-3">{row.timeout}</td>
                  <td className="py-2.5 px-3">{row.error}</td>
                  <td className="py-2.5 px-3">{row.average_duration_ms}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="glass-card rounded-md p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="font-display text-xl text-foreground mb-0">Transaction Monitoring</h2>
          <span className="text-foreground-dim text-xs">{transactions.length} latest</span>
        </div>
        <div className="overflow-x-auto border border-border rounded-sm">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="bg-bg-card">
              <tr className="text-left text-foreground-dim uppercase tracking-[0.1em] text-[10px]">
                <th className="py-3 px-3">Receipt</th>
                <th className="py-3 px-3">Category</th>
                <th className="py-3 px-3">Customer Ref</th>
                <th className="py-3 px-3">Value</th>
                <th className="py-3 px-3">Profit</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr><td className="py-5 px-3 text-foreground-muted" colSpan={7}>No utility transactions yet.</td></tr>
              ) : transactions.map((transaction) => (
                <tr key={transaction.id} className="border-t border-border text-foreground-muted">
                  <td className="py-2.5 px-3">{transaction.receipt_number || transaction.id.slice(0, 8)}</td>
                  <td className="py-2.5 px-3">{transaction.category}</td>
                  <td className="py-2.5 px-3">{transaction.customer_reference}</td>
                  <td className="py-2.5 px-3">{formatNaira(transaction.retail_amount_kobo)}</td>
                  <td className="py-2.5 px-3">{formatNaira(transaction.gross_profit_kobo)}</td>
                  <td className="py-2.5 px-3"><span className={`inline-flex px-2 py-0.5 rounded-sm text-[11px] font-semibold ${badge(transaction.status)}`}>{transaction.status.replace(/_/g, ' ')}</span></td>
                  <td className="py-2.5 px-3">
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn-outline py-1.5 px-2 text-[10px]" onClick={() => void requeryTransaction(transaction.id)}>Requery</button>
                      <button type="button" className="btn-outline py-1.5 px-2 text-[10px]" onClick={() => void reverseTransaction(transaction.id)}>Reverse</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
