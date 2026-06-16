'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { authFetch, isUnauthorized, redirectToLogin } from '@/src/lib/auth/flow';

type UtilityCategory = 'airtime' | 'data' | 'electricity' | 'cable_tv' | 'internet' | 'education';

type Category = { id: UtilityCategory; label: string };
type Biller = {
  id: string;
  category: UtilityCategory;
  name: string;
  customer_reference_label: string;
  requires_validation: boolean;
};
type Product = {
  id: string;
  biller_id: string;
  category: UtilityCategory;
  name: string;
  amount_type: 'fixed' | 'variable';
  amount_kobo: number | null;
  min_amount_kobo: number | null;
  max_amount_kobo: number | null;
  convenience_fee_kobo: number;
};
type UtilityTransaction = {
  id: string;
  category: UtilityCategory;
  status: string;
  customer_reference: string;
  customer_name: string | null;
  amount_kobo: number;
  retail_amount_kobo: number;
  receipt_number: string | null;
  token: string | null;
  created_at: string;
};

function formatNaira(kobo: number | null | undefined) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format((kobo ?? 0) / 100);
}

function statusClass(status: string) {
  if (status === 'successful') return 'badge-approved';
  if (status === 'provider_pending' || status === 'wallet_debited' || status === 'initiated') return 'badge-pending';
  if (status === 'reversed' || status === 'failed') return 'badge-rejected';
  return 'badge-paid';
}

function buildIdempotencyKey(category: string, reference: string) {
  const random = Math.random().toString(36).slice(2, 10);
  return `UTILITY-${category}-${Date.now()}-${reference.replace(/\W/g, '').slice(-6)}-${random}`;
}

export default function UtilityPaymentClient() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [billers, setBillers] = useState<Biller[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [transactions, setTransactions] = useState<UtilityTransaction[]>([]);
  const [category, setCategory] = useState<UtilityCategory>('airtime');
  const [billerId, setBillerId] = useState('');
  const [productId, setProductId] = useState('');
  const [customerReference, setCustomerReference] = useState('');
  const [amountNaira, setAmountNaira] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [latest, setLatest] = useState<UtilityTransaction | null>(null);

  const selectedBiller = useMemo(
    () => billers.find((item) => item.id === billerId) ?? null,
    [billers, billerId],
  );
  const selectedProduct = useMemo(
    () => products.find((item) => item.id === productId) ?? null,
    [products, productId],
  );

  const amountKobo = selectedProduct?.amount_type === 'fixed'
    ? selectedProduct.amount_kobo ?? 0
    : Math.round(Number(amountNaira || 0) * 100);
  const totalKobo = amountKobo + (selectedProduct?.convenience_fee_kobo ?? 0);

  async function parseResponse(response: Response) {
    const payload = await response.json().catch(() => ({}));
    if (isUnauthorized(response)) {
      redirectToLogin('/utility');
      return null;
    }
    if (!response.ok || payload?.success === false) {
      throw new Error(String(payload?.error || 'Utility request failed.'));
    }
    return payload;
  }

  async function loadCategories() {
    const response = await authFetch('/api/v1/utility/categories', { cache: 'no-store' });
    const payload = await parseResponse(response);
    if (payload) setCategories(Array.isArray(payload.categories) ? payload.categories : []);
  }

  async function loadBillers(nextCategory = category) {
    const response = await authFetch(`/api/v1/utility/billers?category=${nextCategory}`, { cache: 'no-store' });
    const payload = await parseResponse(response);
    const rows = Array.isArray(payload?.billers) ? payload.billers : [];
    setBillers(rows);
    setBillerId(rows[0]?.id ?? '');
  }

  async function loadProducts(nextCategory = category, nextBillerId = billerId) {
    if (!nextBillerId) {
      setProducts([]);
      setProductId('');
      return;
    }
    const response = await authFetch(`/api/v1/utility/products?category=${nextCategory}&biller_id=${nextBillerId}`, { cache: 'no-store' });
    const payload = await parseResponse(response);
    const rows = Array.isArray(payload?.products) ? payload.products : [];
    setProducts(rows);
    setProductId(rows[0]?.id ?? '');
  }

  async function loadTransactions() {
    const response = await authFetch('/api/v1/utility/transactions?limit=5', { cache: 'no-store' });
    const payload = await parseResponse(response);
    if (payload) setTransactions(Array.isArray(payload.transactions) ? payload.transactions : []);
  }

  useEffect(() => {
    void Promise.all([loadCategories(), loadBillers('airtime'), loadTransactions()]).catch((error) => {
      setMessage(error instanceof Error ? error.message : 'Unable to load utility services.');
    });
  }, []);

  useEffect(() => {
    void loadProducts(category, billerId).catch((error) => setMessage(error instanceof Error ? error.message : 'Unable to load products.'));
  }, [category, billerId]);

  async function onCategoryChange(nextCategory: UtilityCategory) {
    setCategory(nextCategory);
    setCustomerName('');
    setCustomerReference('');
    setAmountNaira('');
    await loadBillers(nextCategory);
  }

  async function validateCustomer() {
    if (!selectedBiller || !customerReference.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await authFetch('/api/v1/utility/validate', {
        method: 'POST',
        body: JSON.stringify({
          category,
          biller_id: selectedBiller.id,
          product_id: selectedProduct?.id,
          customer_reference: customerReference.trim(),
        }),
      }, { json: true });
      const payload = await parseResponse(response);
      if (!payload) return;
      setCustomerName(String(payload.customer_name || ''));
      setMessage(payload.valid ? 'Customer validation passed.' : String(payload.message || 'Customer could not be validated.'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Validation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedBiller || !selectedProduct) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await authFetch('/api/v1/utility/pay', {
        method: 'POST',
        headers: { 'Idempotency-Key': buildIdempotencyKey(category, customerReference) },
        body: JSON.stringify({
          category,
          biller_id: selectedBiller.id,
          product_id: selectedProduct.id,
          customer_reference: customerReference.trim(),
          amount_kobo: selectedProduct.amount_type === 'variable' ? amountKobo : undefined,
          metadata: { source: 'web_utility_page' },
        }),
      }, { json: true });
      const payload = await parseResponse(response);
      if (!payload) return;
      setLatest(payload.transaction as UtilityTransaction);
      setMessage('Payment submitted.');
      await loadTransactions();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Payment failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4">
      <form onSubmit={pay} className="glass-card rounded-md p-4 md:p-5">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-4">
          <div>
            <p className="section-label mb-2">Utility Bills</p>
            <h1 className="font-display text-3xl md:text-4xl text-foreground">Pay Bills</h1>
          </div>
          <Link href="/profile" className="btn-outline py-2 px-3 text-[11px]">Wallet & Profile</Link>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 mb-4">
          {(categories.length ? categories : [
            { id: 'airtime', label: 'Airtime' },
            { id: 'data', label: 'Data' },
            { id: 'electricity', label: 'Electricity' },
            { id: 'cable_tv', label: 'Cable TV' },
            { id: 'internet', label: 'Internet' },
            { id: 'education', label: 'Education' },
          ] as Category[]).map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => void onCategoryChange(item.id)}
              className={category === item.id ? 'btn-primary py-2 px-3 text-[11px]' : 'btn-outline py-2 px-3 text-[11px]'}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="d-block">
            <span className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">Biller</span>
            <select className="form-input mt-1" value={billerId} onChange={(event) => setBillerId(event.target.value)}>
              {billers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="d-block">
            <span className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">Product</span>
            <select className="form-input mt-1" value={productId} onChange={(event) => setProductId(event.target.value)}>
              {products.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}{item.amount_kobo ? ` - ${formatNaira(item.amount_kobo)}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="d-block">
            <span className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">{selectedBiller?.customer_reference_label || 'Customer reference'}</span>
            <input
              className="form-input mt-1"
              value={customerReference}
              onChange={(event) => setCustomerReference(event.target.value)}
              required
            />
          </label>
          {selectedProduct?.amount_type === 'variable' ? (
            <label className="d-block">
              <span className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">Amount</span>
              <input
                className="form-input mt-1"
                type="number"
                min={(selectedProduct.min_amount_kobo ?? 100) / 100}
                max={(selectedProduct.max_amount_kobo ?? 100000000) / 100}
                value={amountNaira}
                onChange={(event) => setAmountNaira(event.target.value)}
                required
              />
            </label>
          ) : (
            <div className="glass-card rounded-md p-3">
              <div className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">Amount</div>
              <div className="text-2xl font-bold text-foreground mt-1">{formatNaira(selectedProduct?.amount_kobo)}</div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
          <div className="glass-card rounded-md p-3">
            <div className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">Bill Amount</div>
            <div className="text-2xl font-bold text-foreground mt-1">{formatNaira(amountKobo)}</div>
          </div>
          <div className="glass-card rounded-md p-3">
            <div className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">Fee</div>
            <div className="text-2xl font-bold text-foreground mt-1">{formatNaira(selectedProduct?.convenience_fee_kobo)}</div>
          </div>
          <div className="glass-card rounded-md p-3">
            <div className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">Wallet Debit</div>
            <div className="text-2xl font-bold text-foreground mt-1">{formatNaira(totalKobo)}</div>
          </div>
        </div>

        {customerName ? (
          <div className="mt-4 border border-border rounded-sm p-3 text-foreground-muted">
            Customer: <strong className="text-foreground">{customerName}</strong>
          </div>
        ) : null}

        {message ? <p className="text-foreground-muted mt-4 mb-0">{message}</p> : null}

        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" className="btn-outline py-2.5 px-4 text-[11px]" disabled={busy || !customerReference} onClick={() => void validateCustomer()}>
            Validate
          </button>
          <button type="submit" className="btn-primary py-2.5 px-4 text-[11px]" disabled={busy || !productId || !customerReference || amountKobo <= 0}>
            {busy ? 'Processing...' : 'Pay From Wallet'}
          </button>
        </div>
      </form>

      <aside className="space-y-3">
        {latest ? (
          <div className="glass-card rounded-md p-4">
            <div className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">Latest Receipt</div>
            <h3 className="font-display text-2xl text-foreground mt-2">{latest.receipt_number || latest.id}</h3>
            <p className="text-foreground-muted mt-2 mb-1">{latest.customer_reference}</p>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[11px] font-semibold ${statusClass(latest.status)}`}>
              {latest.status.replace(/_/g, ' ')}
            </span>
            {latest.token ? <p className="text-foreground mt-3 mb-0">Token: <strong>{latest.token}</strong></p> : null}
          </div>
        ) : null}

        <div className="glass-card rounded-md p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="font-display text-xl text-foreground mb-0">Recent Payments</h3>
            <button type="button" className="btn-outline py-2 px-3 text-[11px]" onClick={() => void loadTransactions()}>Refresh</button>
          </div>
          {transactions.length === 0 ? (
            <p className="text-foreground-muted mb-0">No utility payments yet.</p>
          ) : (
            <div className="space-y-2">
              {transactions.map((transaction) => (
                <div key={transaction.id} className="border border-border rounded-sm p-3">
                  <div className="flex justify-between gap-3">
                    <div>
                      <div className="text-foreground font-semibold">{transaction.customer_reference}</div>
                      <div className="text-foreground-dim text-xs">{new Date(transaction.created_at).toLocaleString()}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-foreground font-semibold">{formatNaira(transaction.retail_amount_kobo)}</div>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[11px] font-semibold ${statusClass(transaction.status)}`}>
                        {transaction.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>
                  <Link href={`/api/v1/utility/transactions/${transaction.id}/receipt`} className="text-xs text-decoration-none mt-2 inline-flex">
                    Receipt
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
