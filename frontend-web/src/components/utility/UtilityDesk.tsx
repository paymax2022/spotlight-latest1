'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
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

type Note = { text: string; tone: 'error' | 'success' };

const CATEGORY_META: Record<UtilityCategory, { label: string; title: string; icon: string }> = {
  airtime: { label: 'Airtime', title: 'Buy airtime', icon: 'u-airtime' },
  data: { label: 'Data', title: 'Buy a data bundle', icon: 'u-data' },
  electricity: { label: 'Electricity', title: 'Pay for electricity', icon: 'u-power' },
  cable_tv: { label: 'Cable TV', title: 'Renew cable TV', icon: 'u-tv' },
  internet: { label: 'Internet', title: 'Renew home internet', icon: 'u-internet' },
  education: { label: 'Education', title: 'Buy an exam PIN', icon: 'u-education' },
};

const FALLBACK_CATEGORIES: Category[] = (Object.keys(CATEGORY_META) as UtilityCategory[]).map((id) => ({
  id,
  label: CATEGORY_META[id].label,
}));

const NIGERIAN_PHONE = /^(?:\+?234|0)[789][01]\d{8}$/;

function formatNaira(kobo: number | null | undefined) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 2,
  }).format((kobo ?? 0) / 100);
}

function isCategory(value: string): value is UtilityCategory {
  return value in CATEGORY_META;
}

function categoryLabel(category: string) {
  return isCategory(category) ? CATEGORY_META[category].label : category.replace(/_/g, ' ');
}

function maskReference(reference: string) {
  const trimmed = reference.trim();
  return trimmed.length > 4 ? `•••• ${trimmed.slice(-4)}` : trimmed;
}

function buildIdempotencyKey(category: string, reference: string) {
  const random = Math.random().toString(36).slice(2, 10);
  return `UTILITY-${category}-${Date.now()}-${reference.replace(/\W/g, '').slice(-6)}-${random}`;
}

// Airtime/data use a phone number; every other provider reference is a short
// alphanumeric account/meter/decoder number.
function validateCustomerReference(category: UtilityCategory, rawValue: string): string | null {
  const value = rawValue.trim();
  if (!value) return 'Please enter a reference.';
  if (category === 'airtime' || category === 'data') {
    const digitsOnly = value.replace(/[\s-]/g, '');
    if (!NIGERIAN_PHONE.test(digitsOnly)) {
      return 'Enter a valid Nigerian phone number, e.g. 08012345678.';
    }
    return null;
  }
  if (!/^[A-Za-z0-9-]{4,30}$/.test(value)) {
    return 'Enter a valid reference (letters and numbers, 4-30 characters).';
  }
  return null;
}

function validateAmount(product: Product | null, amountNaira: string): string | null {
  if (!product || product.amount_type !== 'variable') return null;
  const trimmed = amountNaira.trim();
  if (!trimmed) return 'Please enter an amount.';
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return 'Enter a valid amount.';
  const minNaira = (product.min_amount_kobo ?? 100) / 100;
  const maxNaira = (product.max_amount_kobo ?? 100_000_000) / 100;
  if (value < minNaira) return `Amount must be at least ${formatNaira(product.min_amount_kobo ?? 100)}.`;
  if (value > maxNaira) return `Amount must not exceed ${formatNaira(product.max_amount_kobo ?? 100_000_000)}.`;
  return null;
}

export default function UtilityDesk() {
  const [categories, setCategories] = useState<Category[]>(FALLBACK_CATEGORIES);
  const [billers, setBillers] = useState<Biller[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [transactions, setTransactions] = useState<UtilityTransaction[]>([]);
  const [category, setCategory] = useState<UtilityCategory>('airtime');
  const [billerId, setBillerId] = useState('');
  const [productId, setProductId] = useState('');
  const [customerReference, setCustomerReference] = useState('');
  const [amountNaira, setAmountNaira] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [latest, setLatest] = useState<UtilityTransaction | null>(null);
  const [lastPaid, setLastPaid] = useState<UtilityTransaction | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const selectedBiller = useMemo(
    () => billers.find((item) => item.id === billerId) ?? null,
    [billers, billerId],
  );
  const selectedProduct = useMemo(
    () => products.find((item) => item.id === productId) ?? null,
    [products, productId],
  );
  const meta = CATEGORY_META[category];
  const referenceLabel =
    selectedBiller?.customer_reference_label ||
    (category === 'airtime' || category === 'data' ? 'Phone number' : 'Customer reference');
  const referenceIsPhone = category === 'airtime' || category === 'data';

  const amountKobo = selectedProduct?.amount_type === 'fixed'
    ? selectedProduct.amount_kobo ?? 0
    : Math.round(Number(amountNaira || 0) * 100);
  const feeKobo = selectedProduct?.convenience_fee_kobo ?? 0;
  const totalKobo = amountKobo + feeKobo;

  const quickAmounts = useMemo(() => {
    if (selectedProduct?.amount_type !== 'variable') return [];
    const min = (selectedProduct.min_amount_kobo ?? 100) / 100;
    const max = (selectedProduct.max_amount_kobo ?? 100_000_000) / 100;
    const candidates = category === 'airtime'
      ? [100, 200, 500, 1000, 2000]
      : [1000, 2000, 5000, 10000];
    const inRange = candidates.filter((value) => value >= min && value <= max);
    return inRange.length ? inRange : [Math.min(Math.max(min, 100), max)];
  }, [selectedProduct, category]);

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
    if (!payload) return;
    const rows = Array.isArray(payload.categories) ? payload.categories : [];
    const known: Category[] = rows.filter(
      (row: unknown): row is Category => {
        if (!row || typeof row !== 'object') return false;
        const id = (row as { id?: unknown }).id;
        return typeof id === 'string' && isCategory(id);
      },
    );
    const byId = new Map(known.map((row) => [row.id, row]));
    const ordered = (Object.keys(CATEGORY_META) as UtilityCategory[])
      .filter((id) => byId.has(id))
      .map((id) => ({ id, label: CATEGORY_META[id].label }));
    if (ordered.length) setCategories(ordered);
  }

  async function loadBillers(nextCategory: UtilityCategory) {
    const response = await authFetch(`/api/v1/utility/billers?category=${nextCategory}`, { cache: 'no-store' });
    const payload = await parseResponse(response);
    const rows = Array.isArray(payload?.billers) ? payload.billers : [];
    setBillers(rows);
    setBillerId((current) => (rows.some((item: Biller) => item.id === current) ? current : rows[0]?.id ?? ''));
  }

  async function loadProducts(nextCategory: UtilityCategory, nextBillerId: string) {
    if (!nextBillerId) {
      setProducts([]);
      setProductId('');
      return;
    }
    const response = await authFetch(
      `/api/v1/utility/products?category=${nextCategory}&biller_id=${nextBillerId}`,
      { cache: 'no-store' },
    );
    const payload = await parseResponse(response);
    const rows = Array.isArray(payload?.products) ? payload.products : [];
    setProducts(rows);
    setProductId((current) => (rows.some((item: Product) => item.id === current) ? current : rows[0]?.id ?? ''));
  }

  async function loadTransactions() {
    const response = await authFetch('/api/v1/utility/transactions?limit=5', { cache: 'no-store' });
    const payload = await parseResponse(response);
    if (payload) setTransactions(Array.isArray(payload.transactions) ? payload.transactions : []);
  }

  useEffect(() => {
    void Promise.all([loadCategories(), loadBillers('airtime'), loadTransactions()])
      .catch((error) => {
        setNote({
          text: error instanceof Error ? error.message : 'Unable to load utility services.',
          tone: 'error',
        });
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void loadProducts(category, billerId).catch((error) => {
      setNote({
        text: error instanceof Error ? error.message : 'Unable to load products.',
        tone: 'error',
      });
    });
  }, [category, billerId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (reviewOpen && !dialog.open) dialog.showModal();
    if (!reviewOpen && dialog.open) dialog.close();
  }, [reviewOpen]);

  async function onCategoryChange(nextCategory: UtilityCategory) {
    if (nextCategory === category) return;
    setCategory(nextCategory);
    setCustomerName('');
    setCustomerReference('');
    setAmountNaira('');
    setNote(null);
    setReviewOpen(false);
    try {
      await loadBillers(nextCategory);
    } catch (error) {
      setNote({
        text: error instanceof Error ? error.message : 'Unable to load providers.',
        tone: 'error',
      });
    }
  }

  function checkReferenceAndAmount(): boolean {
    if (!selectedBiller || !selectedProduct) {
      setNote({ text: 'Choose a provider and product first.', tone: 'error' });
      return false;
    }
    const referenceError = validateCustomerReference(category, customerReference);
    if (referenceError) {
      setNote({ text: referenceError, tone: 'error' });
      return false;
    }
    const amountError = validateAmount(selectedProduct, amountNaira);
    if (amountError) {
      setNote({ text: amountError, tone: 'error' });
      return false;
    }
    return true;
  }

  function reviewPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!checkReferenceAndAmount()) return;
    setNote(null);
    setLastPaid(null);
    setReviewOpen(true);
  }

  async function validateCustomer() {
    if (!selectedBiller) {
      setNote({ text: 'Choose a provider first.', tone: 'error' });
      return;
    }
    const referenceError = validateCustomerReference(category, customerReference);
    if (referenceError) {
      setNote({ text: referenceError, tone: 'error' });
      return;
    }
    setBusy(true);
    setNote(null);
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
      setNote(
        payload.valid
          ? { text: 'Customer validation passed.', tone: 'success' }
          : { text: String(payload.message || 'Customer could not be validated.'), tone: 'error' },
      );
    } catch (error) {
      setNote({ text: error instanceof Error ? error.message : 'Validation failed.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    if (!checkReferenceAndAmount() || !selectedBiller || !selectedProduct) return;
    setBusy(true);
    setNote(null);
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
      setLastPaid(payload.transaction as UtilityTransaction);
      setNote({ text: 'Payment submitted.', tone: 'success' });
      await loadTransactions();
    } catch (error) {
      setNote({ text: error instanceof Error ? error.message : 'Payment failed.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function payWithCard() {
    if (!checkReferenceAndAmount() || !selectedBiller || !selectedProduct) return;
    setBusy(true);
    setNote(null);
    try {
      const response = await authFetch('/api/v1/utility/paystack/initiate', {
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
      if (payload.authorization_url) {
        window.location.href = String(payload.authorization_url);
        return;
      }
      setNote({ text: 'Unable to start card payment.', tone: 'error' });
    } catch (error) {
      setNote({ text: error instanceof Error ? error.message : 'Unable to start card payment.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="u-wrap u-desk" id="payment" aria-label="Payment desk">
        <div className="u-desk-head">
          <span>Payment desk</span>
          <span className="u-badge">Live</span>
        </div>
        <div className="u-workspace">
        <div className="u-rail">
          <p className="u-eyebrow">SERVICES</p>
          <div className="u-services" aria-label="Bill categories">
            {categories.map((item) => (
              <button
                key={item.id}
                type="button"
                className="u-service"
                aria-pressed={category === item.id}
                onClick={() => void onCategoryChange(item.id)}
              >
                <svg aria-hidden="true">
                  <use href={`#${CATEGORY_META[item.id].icon}`} />
                </svg>
                <span>{CATEGORY_META[item.id].label}</span>
              </button>
            ))}
          </div>
        </div>

        <form id="u-bill" className="u-bill" onSubmit={reviewPayment}>
          <div className="u-form-head">
            <div>
              <p className="u-eyebrow">01 / BILL DETAILS</p>
              <h3>{meta.title}</h3>
            </div>
            <span className="u-form-icon" aria-hidden="true">
              <svg>
                <use href={`#${meta.icon}`} />
              </svg>
            </span>
          </div>

          <div className="u-fields">
            <label className="u-field">
              Provider
              <select
                value={billerId}
                onChange={(event) => setBillerId(event.target.value)}
                disabled={loading || billers.length === 0}
              >
                <option value="">
                  {loading ? 'Loading providers…' : billers.length ? 'Select provider' : 'No providers available'}
                </option>
                {billers.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>

            {products.length > 0 ? (
              <label className="u-field">
                Product
                <select value={productId} onChange={(event) => setProductId(event.target.value)}>
                  {products.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}{item.amount_kobo ? ` — ${formatNaira(item.amount_kobo)}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="u-field">
              {referenceLabel}
              <input
                value={customerReference}
                onChange={(event) => setCustomerReference(event.target.value)}
                inputMode={referenceIsPhone ? 'tel' : 'text'}
                placeholder={referenceIsPhone ? '0800 000 0000' : 'Enter reference'}
                maxLength={30}
                autoComplete="off"
                required
              />
            </label>

            {selectedProduct?.amount_type === 'variable' ? (
              <label className="u-field">
                Amount (₦)
                <input
                  type="number"
                  min={(selectedProduct.min_amount_kobo ?? 100) / 100}
                  max={(selectedProduct.max_amount_kobo ?? 100_000_000) / 100}
                  step="1"
                  value={amountNaira}
                  onChange={(event) => setAmountNaira(event.target.value)}
                  placeholder="0.00"
                  required
                />
              </label>
            ) : selectedProduct?.amount_type === 'fixed' ? (
              <div className="u-field">
                Amount (₦)
                <div className="u-fixed-amount">{formatNaira(selectedProduct.amount_kobo)}</div>
              </div>
            ) : null}
          </div>

          {quickAmounts.length > 0 ? (
            <div className="u-quick" aria-label="Example amounts">
              {quickAmounts.map((value) => (
                <button
                  type="button"
                  key={value}
                  onClick={() => setAmountNaira(String(value))}
                >
                  ₦{value.toLocaleString('en-NG')}
                </button>
              ))}
            </div>
          ) : null}

          <div className="u-form-actions">
            <button
              type="button"
              className="u-link-button"
              disabled={busy || !customerReference}
              onClick={() => void validateCustomer()}
            >
              Validate customer
            </button>
            <span className="u-hint">Validate meter, smartcard or phone details before you pay.</span>
          </div>

          {customerName ? (
            <p className="u-hint">Account name: <strong>{customerName}</strong></p>
          ) : null}

          {note && !reviewOpen ? (
            <p className="u-note" data-tone={note.tone} role="status">{note.text}</p>
          ) : null}
        </form>

        <aside className="u-summary" aria-labelledby="u-summary-title">
          <p className="u-eyebrow">02 / REVIEW</p>
          <h3 id="u-summary-title">Payment summary</h3>
          <dl>
            <div>
              <dt>Service</dt>
              <dd>{meta.label}</dd>
            </div>
            <div>
              <dt>Bill amount</dt>
              <dd>{formatNaira(amountKobo)}</dd>
            </div>
            <div>
              <dt>Fee</dt>
              <dd>{formatNaira(feeKobo)}</dd>
            </div>
            <div className="u-total">
              <dt>Total</dt>
              <dd>{formatNaira(totalKobo)}</dd>
            </div>
          </dl>
          <button
            type="submit"
            form="u-bill"
            className="u-cta u-full"
            disabled={busy}
          >
            Review payment
            <svg aria-hidden="true">
              <use href="#u-arrow" />
            </svg>
          </button>
          {latest && !reviewOpen ? (
            <div className="u-latest">
              <span>Latest receipt</span>
              <strong>{latest.receipt_number || latest.id}</strong>
              <em>{latest.status.replace(/_/g, ' ')}</em>
              <Link href={`/utility/receipt/${latest.id}`}>View receipt</Link>
            </div>
          ) : null}
        </aside>
        </div>
      </section>

      <section className="u-wrap u-extras">
        <article id="activity">
          <p className="u-eyebrow"><i /> 02 / ACTIVITY</p>
          <h2>Recent payments</h2>
          {transactions.length === 0 ? (
            <p className="u-muted">Pay a bill and it will appear here for this account.</p>
          ) : (
            <ul className="u-activity-list" aria-live="polite">
              {transactions.map((transaction) => (
                <li key={transaction.id}>
                  <Link href={`/utility/receipt/${transaction.id}`}>
                    <span>
                      <strong>{categoryLabel(transaction.category)}</strong>
                      <span className="u-activity-status">
                        {maskReference(transaction.customer_reference)} · {transaction.status.replace(/_/g, ' ')}
                      </span>
                    </span>
                    <span className="u-activity-price">{formatNaira(transaction.retail_amount_kobo)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article id="help">
          <p className="u-eyebrow"><i /> 03 / HELP DESK</p>
          <h2>Need a hand?</h2>
          <details>
            <summary>What details do I need?</summary>
            <p>Choose your service and provider. Depending on the service, have your phone number, meter number, decoder number or customer reference ready.</p>
          </details>
          <details>
            <summary>How are payments charged?</summary>
            <p>Pay from your Spotlight wallet or by card. The total shown includes any provider convenience fee.</p>
          </details>
          <Link className="u-text-link" href="/contact">Contact Spotlight</Link>
        </article>
      </section>

      <dialog
        ref={dialogRef}
        className="u-dialog"
        aria-labelledby="u-review-title"
        onClose={() => setReviewOpen(false)}
      >
        <form method="dialog" className="u-close-form">
          <button className="u-close" aria-label="Close review">×</button>
        </form>
        <p className="u-eyebrow">REVIEW / CONFIRM</p>
        <h2 id="u-review-title">Review your details</h2>
        <dl>
          <div>
            <dt>Service</dt>
            <dd>{meta.label}</dd>
          </div>
          <div>
            <dt>Provider</dt>
            <dd>{selectedBiller?.name || '—'}</dd>
          </div>
          {selectedProduct ? (
            <div>
              <dt>Product</dt>
              <dd>{selectedProduct.name}</dd>
            </div>
          ) : null}
          <div>
            <dt>{referenceLabel}</dt>
            <dd>{maskReference(customerReference)}</dd>
          </div>
          <div>
            <dt>Bill amount</dt>
            <dd>{formatNaira(amountKobo)}</dd>
          </div>
          <div>
            <dt>Fee</dt>
            <dd>{formatNaira(feeKobo)}</dd>
          </div>
          <div className="u-review-total">
            <dt>Total</dt>
            <dd>{formatNaira(totalKobo)}</dd>
          </div>
        </dl>

        {lastPaid ? (
          <div className="u-dialog-actions">
            <p className="u-note" data-tone="success" role="status">
              Payment submitted{lastPaid.receipt_number ? ` · ${lastPaid.receipt_number}` : ''}.
            </p>
            <Link className="u-cta u-full" href={`/utility/receipt/${lastPaid.id}`}>
              View receipt
              <svg aria-hidden="true">
                <use href="#u-arrow" />
              </svg>
            </Link>
            <button type="button" className="u-cta u-ghost u-full" onClick={() => setReviewOpen(false)}>
              Done
            </button>
          </div>
        ) : (
          <div className="u-dialog-actions">
            {note ? (
              <p className="u-note" data-tone={note.tone} role="status">{note.text}</p>
            ) : null}
            <button type="button" className="u-cta u-full" disabled={busy} onClick={() => void pay()}>
              {busy ? 'Processing…' : 'Pay from wallet'}
              <svg aria-hidden="true">
                <use href="#u-arrow" />
              </svg>
            </button>
            <button type="button" className="u-cta u-ghost u-full" disabled={busy} onClick={() => void payWithCard()}>
              {busy ? 'Processing…' : 'Pay with card'}
            </button>
          </div>
        )}
      </dialog>
    </>
  );
}
