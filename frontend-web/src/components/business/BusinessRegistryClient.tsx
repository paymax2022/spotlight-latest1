'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatNaira } from '@/src/lib/referral/format';
import {
  type Business,
  type BusinessEntityType,
  type BusinessStatus,
  type NameCheckResult,
  type Proprietor,
  checkName,
  getBusinessStatus,
  getCertificate,
  listMyBusinesses,
  payBusinessFee,
  initBusinessFeePaystack,
  verifyBusinessFeePaystack,
  registerBusiness,
  reserveName,
  submitBusiness,
  verifyBusiness,
} from '@/src/lib/business/api';

// CAC registration fee (₦15,000 in kobo). Used as a display fallback before the
// backend stamps business.feeKobo at pay-time; the backend charge is authoritative.
const CAC_FEE_KOBO = 1_500_000;      // CAC registration fee (pass-through)
const PLATFORM_FEE_KOBO = 200_000;   // Paymax/Spotlight processing charge
const TOTAL_FEE_KOBO = CAC_FEE_KOBO + PLATFORM_FEE_KOBO; // ₦17,000

// ── presentation helpers ────────────────────────────────────────────────────
const ENTITY_LABELS: Record<BusinessEntityType, string> = {
  business_name: 'Business Name',
  company: 'Company (Ltd)',
  incorporated_trustee: 'Incorporated Trustee',
};

const ENTITY_OPTIONS: Array<[BusinessEntityType, string]> = [
  ['business_name', 'Business Name'],
  ['company', 'Company (Ltd)'],
  ['incorporated_trustee', 'Incorporated Trustee'],
];

// Multi-select line-of-business categories (joined into a comma string for the API).
const LINE_OF_BUSINESS = [
  'Agriculture & Agro-allied', 'Trading / Retail', 'Wholesale / Distribution', 'Import & Export',
  'Fashion, Clothing & Tailoring', 'Beauty, Cosmetics & Salon', 'Food, Restaurant & Catering',
  'Hospitality & Tourism', 'ICT & Software', 'Telecommunications', 'Consulting & Professional Services',
  'Financial Services & Fintech', 'Construction & Engineering', 'Real Estate & Property',
  'Logistics, Haulage & Transport', 'Automobile & Auto Parts', 'Manufacturing & Production',
  'Oil, Gas & Energy', 'Media, Entertainment & Events', 'Education & Training',
  'Healthcare & Pharmaceuticals', 'Agro-processing', 'Printing & Publishing',
  'Mining & Solid Minerals', 'General Merchandise', 'Other',
];

// Single-select proprietor roles: [backend slug, display label].
const ROLE_OPTIONS: Array<[string, string]> = [
  ['proprietor', 'Proprietor'],
  ['partner', 'Partner'],
  ['director', 'Director'],
  ['trustee', 'Trustee'],
  ['shareholder', 'Shareholder'],
  ['company_secretary', 'Company Secretary'],
  ['signatory', 'Signatory'],
];

function statusClass(status: BusinessStatus | string): string {
  switch (status) {
    case 'registered':
    case 'verified':
      return 'bg-emerald-500/15 text-emerald-300';
    case 'rejected':
    case 'failed':
      return 'bg-red-500/15 text-red-300';
    case 'name_reserved':
    case 'registration_submitted':
    case 'submitted':
    case 'under_review':
      return 'bg-amber-500/15 text-amber-300';
    default:
      return 'bg-slate-500/15 text-slate-300';
  }
}

function StatusBadge({ status }: { status: BusinessStatus | string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[11px] font-semibold ${statusClass(status)}`}
    >
      {String(status).replace(/_/g, ' ')}
    </span>
  );
}

function labelFor(b: Business): string {
  return b.legalName || b.proposedName || 'Unnamed business';
}

const ACTIVE: BusinessStatus[] = ['registered', 'verified'];

// ── CAC certificate action ──────────────────────────────────────────────────
// If the business already carries a certificateUrl we render a direct link. If
// not (but it's registered/verified), we offer a button that fetches it on demand
// and opens it, surfacing the "not available yet" 404 gracefully.
function CertificateAction({ business }: { business: Business }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  if (business.certificateUrl) {
    return (
      <a
        href={business.certificateUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-outline py-1.5 px-3 text-[11px] inline-flex"
      >
        View / Download Certificate
      </a>
    );
  }

  async function fetchAndOpen() {
    setBusy(true);
    setNote('');
    try {
      const { certificateUrl } = await getCertificate(business.id);
      if (certificateUrl) {
        window.open(certificateUrl, '_blank', 'noopener,noreferrer');
      } else {
        setNote('Certificate is not available yet.');
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Certificate is not available yet.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        className="btn-outline py-1.5 px-3 text-[11px]"
        disabled={busy}
        onClick={() => void fetchAndOpen()}
      >
        {busy ? 'Fetching…' : 'Get certificate'}
      </button>
      {note ? <span className="text-amber-300 text-[11px]">{note}</span> : null}
    </div>
  );
}

const TERMINAL: BusinessStatus[] = ['registered', 'rejected', 'failed', 'verified'];

type View = 'list' | 'verify' | 'register';

// ── main component ──────────────────────────────────────────────────────────
export default function BusinessRegistryClient() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>('list');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setBusinesses(await listMyBusinesses());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load your businesses.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function onFlowDone() {
    setView('list');
    void load();
  }

  return (
    <div className="glass-card rounded-md p-4 md:p-5 mt-4">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-4">
        <div>
          <p className="section-label mb-2">Business / Merchant</p>
          <h2 className="font-display text-2xl md:text-3xl text-foreground mb-0">Business Registry</h2>
          <p className="text-foreground-muted mt-1 mb-0 text-sm">
            Verify an existing CAC business or register a new business name.
          </p>
        </div>
        {view === 'list' ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-outline py-2 px-3 text-[11px]" onClick={() => setView('verify')}>
              Verify existing business
            </button>
            <button type="button" className="btn-primary py-2 px-3 text-[11px]" onClick={() => setView('register')}>
              Register a new business name
            </button>
          </div>
        ) : (
          <button type="button" className="btn-outline py-2 px-3 text-[11px]" onClick={onFlowDone}>
            ← Back
          </button>
        )}
      </div>

      {error ? <p className="text-red-400 font-semibold">{error}</p> : null}

      {view === 'list' ? (
        <BusinessList businesses={businesses} loading={loading} onRefresh={load} />
      ) : null}
      {view === 'verify' ? <VerifyFlow onDone={onFlowDone} /> : null}
      {view === 'register' ? <RegisterWizard onDone={onFlowDone} /> : null}
    </div>
  );
}

// ── list / empty state ──────────────────────────────────────────────────────
function BusinessList({
  businesses,
  loading,
  onRefresh,
}: {
  businesses: Business[];
  loading: boolean;
  onRefresh: () => void;
}) {
  if (loading) return <p className="text-foreground-muted mb-0">Loading your businesses…</p>;

  if (businesses.length === 0) {
    return (
      <div className="border border-border rounded-sm p-4 text-center">
        <p className="text-foreground-muted mb-0">
          You have no registered or verified businesses yet. Use the actions above to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg text-foreground mb-0">Your businesses</h3>
        <button type="button" className="btn-outline py-1.5 px-3 text-[11px]" onClick={onRefresh}>
          Refresh
        </button>
      </div>
      {businesses.map((b) => (
        <div key={b.id} className="border border-border rounded-sm p-3">
          <div className="flex justify-between gap-3">
            <div>
              <div className="text-foreground font-semibold">{labelFor(b)}</div>
              <div className="text-foreground-dim text-xs">{ENTITY_LABELS[b.entityType] || b.entityType}</div>
              {b.lineOfBusiness ? (
                <div className="text-foreground-dim text-xs mt-0.5">{b.lineOfBusiness}</div>
              ) : null}
            </div>
            <div className="text-right">
              <StatusBadge status={b.status} />
              {b.rcOrBnNumber ? (
                <div className="text-foreground text-xs mt-1">RC/BN: {b.rcOrBnNumber}</div>
              ) : null}
              {ACTIVE.includes(b.status) ? (
                <div className="mt-2 flex justify-end">
                  <CertificateAction business={b} />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── verify existing ─────────────────────────────────────────────────────────
function VerifyFlow({ onDone }: { onDone: () => void }) {
  const [entityType, setEntityType] = useState<BusinessEntityType>('business_name');
  const [rcOrBnNumber, setRcOrBnNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Business | null>(null);

  async function submit() {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setResult(await verifyBusiness({ rcOrBnNumber: rcOrBnNumber.trim(), entityType }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3 className="font-display text-lg text-foreground mb-3">Verify an existing business</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="d-block">
          <span className="form-label">Entity type</span>
          <select
            className="form-input mt-1"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value as BusinessEntityType)}
          >
            {ENTITY_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="d-block">
          <span className="form-label">RC / BN number</span>
          <input
            className="form-input mt-1"
            value={rcOrBnNumber}
            onChange={(e) => setRcOrBnNumber(e.target.value)}
            placeholder="e.g. BN1234567 or RC1234567"
          />
        </label>
      </div>

      {error ? <p className="text-red-400 font-semibold mt-3">{error}</p> : null}

      {result ? (
        <div className="border border-border rounded-sm p-3 mt-4">
          <div className="flex justify-between gap-3">
            <div>
              <div className="text-foreground font-semibold">{labelFor(result)}</div>
              <div className="text-foreground-dim text-xs">{ENTITY_LABELS[result.entityType]}</div>
              {result.rcOrBnNumber ? (
                <div className="text-foreground text-xs mt-1">RC/BN: {result.rcOrBnNumber}</div>
              ) : null}
              {result.status === 'rejected' || result.status === 'failed' ? (
                <div className="text-red-300 text-xs mt-1">
                  {(result.metadata?.reason as string) || 'This business could not be verified.'}
                </div>
              ) : null}
            </div>
            <StatusBadge status={result.status} />
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary py-2.5 px-4 text-[11px]"
          disabled={busy || rcOrBnNumber.trim().length < 3}
          onClick={() => void submit()}
        >
          {busy ? 'Verifying…' : 'Verify'}
        </button>
        {result && (result.status === 'verified' || result.status === 'registered') ? (
          <button type="button" className="btn-outline py-2.5 px-4 text-[11px]" onClick={onDone}>
            Done
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ── register wizard ─────────────────────────────────────────────────────────
type Step = 'name' | 'proprietors' | 'review' | 'status';

const STEP_LABELS: Array<[Step, string]> = [
  ['name', 'Name'],
  ['proprietors', 'Proprietors'],
  ['review', 'Review & Fee'],
  ['status', 'Status'],
];

function emptyProprietor(): Proprietor {
  return { fullName: '', role: 'proprietor', sharePct: undefined, phone: '', email: '', bvn: '', nin: '' };
}

// ── multi-select dropdown (checkbox list) ────────────────────────────────────
function MultiSelectDropdown({
  options,
  selected,
  onChange,
  placeholder = 'Select one or more',
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  function toggle(opt: string) {
    onChange(selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt]);
  }

  return (
    <div className="relative mt-1" ref={ref}>
      <button
        type="button"
        className="form-input flex items-center justify-between gap-2 text-left w-full"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={selected.length ? 'text-foreground truncate' : 'text-foreground-dim truncate'}>
          {selected.length ? `${selected.length} selected` : placeholder}
        </span>
        <span className="text-foreground-dim">▾</span>
      </button>

      {selected.length ? (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {selected.map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1 bg-accent-gold/20 border border-border-gold text-foreground text-[11px] rounded-sm px-2 py-0.5"
            >
              {s}
              <button
                type="button"
                className="text-foreground-dim hover:text-foreground"
                onClick={() => toggle(s)}
                aria-label={`Remove ${s}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {open ? (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto glass-card border border-border rounded-sm p-1">
          {options.map((opt) => {
            const checked = selected.includes(opt);
            return (
              <label
                key={opt}
                className="flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-slate-500/10 text-sm text-foreground"
              >
                <input type="checkbox" checked={checked} onChange={() => toggle(opt)} />
                <span>{opt}</span>
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function RegisterWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>('name');

  // name step
  const [entityType, setEntityType] = useState<BusinessEntityType>('business_name');
  const [proposedName, setProposedName] = useState('');
  const [lineOfBusiness, setLineOfBusiness] = useState<string[]>([]);
  const [nameResult, setNameResult] = useState<NameCheckResult | null>(null);

  // shared
  const [business, setBusiness] = useState<Business | null>(null);
  const [proprietors, setProprietors] = useState<Proprietor[]>([emptyProprietor()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // fee step payment method
  const [payMethod, setPayMethod] = useState<'WALLET' | 'PAYSTACK'>('WALLET');
  const [psRef, setPsRef] = useState<string | null>(null);

  // ── step 1: name check → register → reserve ───────────────────────────────
  async function runNameCheck() {
    setBusy(true);
    setError('');
    setNameResult(null);
    try {
      setNameResult(
        await checkName({
          proposedName: proposedName.trim(),
          lineOfBusiness: lineOfBusiness.length ? lineOfBusiness.join(', ') : undefined,
          businessId: business?.id,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Name check failed.');
    } finally {
      setBusy(false);
    }
  }

  // Name step just advances once the name is confirmed available. Registration
  // (POST /register) is deferred until review so it is called exactly once with
  // all data (name + proprietors) — /register has no id, so calling it twice
  // would create duplicate drafts.
  function continueFromName() {
    setError('');
    setStep('proprietors');
  }

  // ── step 2: proprietors ───────────────────────────────────────────────────
  function updateProprietor(i: number, key: keyof Proprietor, value: string) {
    setProprietors((prev) =>
      prev.map((p, idx) =>
        idx === i ? { ...p, [key]: key === 'sharePct' ? (value === '' ? undefined : Number(value)) : value } : p,
      ),
    );
  }
  function addProprietor() {
    setProprietors((prev) => [...prev, emptyProprietor()]);
  }
  function removeProprietor(i: number) {
    setProprietors((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  // Proprietors → review: this is where we register (once, with all data) and
  // reserve the checked name, so the review step can show the CAC fee.
  async function registerAndReview() {
    setBusy(true);
    setError('');
    try {
      const cleaned = proprietors
        .filter((p) => p.fullName.trim())
        .map((p) => ({
          fullName: p.fullName.trim(),
          role: p.role?.trim() || undefined,
          sharePct: p.sharePct,
          phone: p.phone?.trim() || undefined,
          email: p.email?.trim() || undefined,
          bvn: p.bvn?.trim() || undefined,
          nin: p.nin?.trim() || undefined,
        }));
      if (cleaned.length === 0) throw new Error('Add at least one proprietor.');
      // Register once with the full payload (idempotent-per-draft on the backend
      // is not assumed — we only ever POST /register a single time per wizard run).
      const created = business ?? (await registerBusiness({
        entityType,
        proposedName: proposedName.trim(),
        lineOfBusiness: lineOfBusiness.length ? lineOfBusiness.join(', ') : undefined,
        proprietors: cleaned,
      }));
      // Reserve the checked name against the new draft.
      const reserved = await reserveName(created.id);
      setBusiness(reserved);
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not register the business.');
    } finally {
      setBusy(false);
    }
  }

  // ── step 3: pay fee → submit → status ─────────────────────────────────────
  async function payAndSubmit() {
    setBusy(true);
    setError('');
    try {
      if (!business) throw new Error('Missing business draft.');
      const paid = await payBusinessFee(business.id);
      setBusiness(paid);
      const submitted = await submitBusiness(business.id);
      setBusiness(submitted);
      setStep('status');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment or submission failed.');
    } finally {
      setBusy(false);
    }
  }

  // Payment-gateway (Paystack) fee flow: open a checkout, then verify on return.
  async function startPaystack() {
    if (!business) return;
    setBusy(true);
    setError('');
    try {
      const { authorizationUrl, reference, alreadyPaid } = await initBusinessFeePaystack(business.id);
      setPsRef(reference);
      if (!alreadyPaid && authorizationUrl) {
        window.open(authorizationUrl, '_blank', 'noopener');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start Paystack payment.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyPaystackAndSubmit() {
    if (!business || !psRef) return;
    setBusy(true);
    setError('');
    try {
      await verifyBusinessFeePaystack(business.id, psRef);
      const submitted = await submitBusiness(business.id);
      setBusiness(submitted);
      setStep('status');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment not confirmed yet.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Stepper current={step} />
      {error ? <p className="text-red-400 font-semibold mt-3">{error}</p> : null}

      {step === 'name' ? (
        <div className="mt-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="d-block">
              <span className="form-label">Entity type</span>
              <select
                className="form-input mt-1"
                value={entityType}
                onChange={(e) => setEntityType(e.target.value as BusinessEntityType)}
              >
                {ENTITY_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="d-block">
              <span className="form-label">Proposed name</span>
              <input
                className="form-input mt-1"
                value={proposedName}
                onChange={(e) => {
                  setProposedName(e.target.value);
                  setNameResult(null);
                }}
                placeholder="e.g. Bright Futures Ventures"
              />
            </label>
            <label className="d-block">
              <span className="form-label">Line of business</span>
              <MultiSelectDropdown
                options={LINE_OF_BUSINESS}
                selected={lineOfBusiness}
                onChange={setLineOfBusiness}
                placeholder="Select one or more"
              />
            </label>
          </div>

          {nameResult ? (
            <div className="border border-border rounded-sm p-3 mt-3">
              {nameResult.available ? (
                <p className="text-emerald-300 font-semibold mb-0">
                  “{proposedName}” is available.
                </p>
              ) : (
                <>
                  <p className="text-red-300 font-semibold mb-1">
                    “{proposedName}” is not available.
                    {nameResult.reason ? ` ${nameResult.reason}` : ''}
                  </p>
                  {nameResult.suggestions && nameResult.suggestions.length ? (
                    <div className="mt-1">
                      <span className="text-foreground-dim text-xs">Suggestions:</span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {nameResult.suggestions.map((s) => (
                          <button
                            key={s}
                            type="button"
                            className="btn-outline py-1 px-2 text-[11px]"
                            onClick={() => {
                              setProposedName(s);
                              setNameResult(null);
                            }}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-outline py-2.5 px-4 text-[11px]"
              disabled={busy || proposedName.trim().length < 2}
              onClick={() => void runNameCheck()}
            >
              {busy ? 'Checking…' : 'Check availability'}
            </button>
            <button
              type="button"
              className="btn-primary py-2.5 px-4 text-[11px]"
              disabled={busy || !nameResult?.available || lineOfBusiness.length === 0}
              onClick={continueFromName}
            >
              Continue
            </button>
          </div>
        </div>
      ) : null}

      {step === 'proprietors' ? (
        <div className="mt-3">
          <p className="text-foreground-muted text-sm mb-3">
            Add at least one proprietor. BVN/NIN are optional.
          </p>
          <div className="space-y-3">
            {proprietors.map((p, i) => (
              <div key={i} className="border border-border rounded-sm p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-foreground-dim text-xs">Proprietor {i + 1}</span>
                  {proprietors.length > 1 ? (
                    <button
                      type="button"
                      className="text-red-300 text-[11px]"
                      onClick={() => removeProprietor(i)}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <input
                    className="form-input"
                    placeholder="Full name"
                    value={p.fullName}
                    onChange={(e) => updateProprietor(i, 'fullName', e.target.value)}
                  />
                  <select
                    className="form-input"
                    value={p.role || 'proprietor'}
                    onChange={(e) => updateProprietor(i, 'role', e.target.value)}
                  >
                    {ROLE_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="form-input"
                    type="number"
                    min={0}
                    max={100}
                    placeholder="Share %"
                    value={p.sharePct ?? ''}
                    onChange={(e) => updateProprietor(i, 'sharePct', e.target.value)}
                  />
                  <input
                    className="form-input"
                    placeholder="Phone"
                    value={p.phone || ''}
                    onChange={(e) => updateProprietor(i, 'phone', e.target.value)}
                  />
                  <input
                    className="form-input"
                    placeholder="Email"
                    value={p.email || ''}
                    onChange={(e) => updateProprietor(i, 'email', e.target.value)}
                  />
                  <input
                    className="form-input"
                    placeholder="BVN (optional)"
                    value={p.bvn || ''}
                    onChange={(e) => updateProprietor(i, 'bvn', e.target.value)}
                  />
                  <input
                    className="form-input"
                    placeholder="NIN (optional)"
                    value={p.nin || ''}
                    onChange={(e) => updateProprietor(i, 'nin', e.target.value)}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-outline py-2 px-3 text-[11px]" onClick={addProprietor}>
              + Add proprietor
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn-outline py-2.5 px-4 text-[11px]" onClick={() => setStep('name')}>
              Back
            </button>
            <button
              type="button"
              className="btn-primary py-2.5 px-4 text-[11px]"
              disabled={busy || !proprietors.some((p) => p.fullName.trim())}
              onClick={() => void registerAndReview()}
            >
              {busy ? 'Registering…' : 'Continue'}
            </button>
          </div>
        </div>
      ) : null}

      {step === 'review' ? (
        <div className="mt-3">
          <div className="border border-border rounded-sm p-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-foreground-dim text-xs block">Proposed name</span>
                <span className="text-foreground font-semibold">{proposedName}</span>
              </div>
              <div>
                <span className="text-foreground-dim text-xs block">Entity type</span>
                <span className="text-foreground">{ENTITY_LABELS[entityType]}</span>
              </div>
              {lineOfBusiness.length ? (
                <div>
                  <span className="text-foreground-dim text-xs block">Line of business</span>
                  <span className="text-foreground">{lineOfBusiness.join(', ')}</span>
                </div>
              ) : null}
              <div>
                <span className="text-foreground-dim text-xs block">Proprietors</span>
                <span className="text-foreground">
                  {proprietors.filter((p) => p.fullName.trim()).length}
                </span>
              </div>
            </div>
          </div>

          <div className="glass-card rounded-md p-3 mt-3">
            <div className="flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">Fee breakdown</div>
              {business?.status ? <StatusBadge status={business.status} /> : null}
            </div>
            <div className="mt-2 space-y-1 text-[13px]">
              <div className="flex items-center justify-between text-foreground-dim">
                <span>CAC registration fee</span><span>{formatNaira(CAC_FEE_KOBO)}</span>
              </div>
              <div className="flex items-center justify-between text-foreground-dim">
                <span>Platform fee</span><span>{formatNaira(PLATFORM_FEE_KOBO)}</span>
              </div>
              <div className="flex items-center justify-between font-bold text-foreground pt-1 border-t border-foreground-dim/20">
                <span>Total</span><span className="text-lg">{formatNaira(TOTAL_FEE_KOBO)}</span>
              </div>
            </div>
          </div>

          {/* Payment method: wallet or payment gateway */}
          <div className="mt-3">
            <div className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim mb-2">Payment method</div>
            <div className="grid grid-cols-2 gap-2">
              {(['WALLET', 'PAYSTACK'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setPayMethod(m); setPsRef(null); setError(''); }}
                  className={`py-2.5 px-3 rounded-md text-[12px] font-semibold border ${
                    payMethod === m
                      ? 'border-primary text-primary bg-primary/10'
                      : 'border-foreground-dim/30 text-foreground-dim'
                  }`}
                >
                  {m === 'WALLET' ? 'Pay with Wallet' : 'Pay with Paystack'}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-outline py-2.5 px-4 text-[11px]"
              onClick={() => setStep('proprietors')}
            >
              Back
            </button>

            {payMethod === 'WALLET' ? (
              <button
                type="button"
                className="btn-primary py-2.5 px-4 text-[11px]"
                disabled={busy}
                onClick={() => void payAndSubmit()}
              >
                {busy ? 'Processing…' : `Pay ${formatNaira(TOTAL_FEE_KOBO)} from wallet & submit`}
              </button>
            ) : !psRef ? (
              <button
                type="button"
                className="btn-primary py-2.5 px-4 text-[11px]"
                disabled={busy}
                onClick={() => void startPaystack()}
              >
                {busy ? 'Opening Paystack…' : `Pay ${formatNaira(TOTAL_FEE_KOBO)} with Paystack`}
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary py-2.5 px-4 text-[11px]"
                disabled={busy}
                onClick={() => void verifyPaystackAndSubmit()}
              >
                {busy ? 'Verifying…' : "I've paid — verify & submit"}
              </button>
            )}
          </div>
        </div>
      ) : null}

      {step === 'status' && business ? (
        <StatusPoller businessId={business.id} initial={business} onDone={onDone} />
      ) : null}
    </div>
  );
}

function Stepper({ current }: { current: Step }) {
  const currentIdx = STEP_LABELS.findIndex(([s]) => s === current);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {STEP_LABELS.map(([s, label], idx) => (
        <div key={s} className="flex items-center gap-2">
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-sm text-[11px] font-semibold ${
              idx <= currentIdx
                ? 'bg-accent-gold/20 text-foreground border border-border-gold'
                : 'bg-slate-500/10 text-foreground-dim'
            }`}
          >
            {idx + 1}. {label}
          </span>
          {idx < STEP_LABELS.length - 1 ? <span className="text-foreground-dim">›</span> : null}
        </div>
      ))}
    </div>
  );
}

// ── status polling ──────────────────────────────────────────────────────────
function StatusPoller({
  businessId,
  initial,
  onDone,
}: {
  businessId: string;
  initial: Business;
  onDone: () => void;
}) {
  const [business, setBusiness] = useState<Business>(initial);
  const [polling, setPolling] = useState(!TERMINAL.includes(initial.status));
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;

    async function poll() {
      try {
        const next = await getBusinessStatus(businessId);
        if (cancelled) return;
        setBusiness(next);
        if (TERMINAL.includes(next.status)) {
          setPolling(false);
          if (timer.current) clearInterval(timer.current);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Unable to fetch status.');
      }
    }

    void poll();
    timer.current = setInterval(() => void poll(), 3000);
    return () => {
      cancelled = true;
      if (timer.current) clearInterval(timer.current);
    };
  }, [businessId, polling]);

  const isSuccess = business.status === 'registered';
  const isFailed = business.status === 'rejected' || business.status === 'failed';

  return (
    <div className="mt-3">
      <div className="border border-border rounded-sm p-4 text-center">
        <StatusBadge status={business.status} />
        <h3 className="font-display text-xl text-foreground mt-3 mb-1">{labelFor(business)}</h3>
        {polling ? (
          <p className="text-foreground-muted mb-0">
            Your registration is being processed. This page updates automatically…
          </p>
        ) : isSuccess ? (
          <>
            <p className="text-emerald-300 mb-2">
              Registered successfully. RC/BN: <strong>{business.rcOrBnNumber || '—'}</strong>
            </p>
            <div className="flex justify-center">
              <CertificateAction business={business} />
            </div>
          </>
        ) : isFailed ? (
          <p className="text-red-300 mb-0">
            {(business.metadata?.reason as string) || 'The registration was not successful.'}
          </p>
        ) : (
          <p className="text-foreground-muted mb-0">Status: {business.status.replace(/_/g, ' ')}</p>
        )}
        {error ? <p className="text-red-400 mt-2 mb-0">{error}</p> : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 justify-center">
        {!polling ? (
          <button type="button" className="btn-primary py-2.5 px-4 text-[11px]" onClick={onDone}>
            Done
          </button>
        ) : null}
      </div>
    </div>
  );
}
