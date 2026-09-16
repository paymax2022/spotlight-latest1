'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  getProduct,
  setProductActive,
  formatNaira,
  formatPct,
  formatRateBps,
  productPrice,
  commissionKoboFor,
} from '@/services/insuranceAdminService';
import type { InsuranceProduct, SharingFormula } from '@/types/insuranceAdmin';
import {
  PageHeader,
  InsuranceTabs,
  Card,
  Badge,
  NotReported,
  LiveState,
  EndpointErrorCard,
  toFailure,
  type EndpointFailure,
  btn,
  th,
  td,
} from '../../_ui';
import { colors } from '@/components/ui/vuexy';

const dt: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.3,
  color: colors.muted,
  fontWeight: 600,
  marginBottom: 3,
};

/**
 * One product, as stored from MyCover.
 *
 * The commission block is the commercially important part of this page: it shows
 * every band of the sharing formula, which slice is OURS, and — critically —
 * whether each slice is computed from the original or the final premium. Those
 * two bases give different naira on the same percentage, so showing the rate
 * without the basis would be an incomplete number.
 */
export default function InsuranceProductDetailPage() {
  const params = useParams<{ code: string }>();
  const code = decodeURIComponent(String(params?.code ?? ''));

  const [product, setProduct] = useState<InsuranceProduct | null>(null);
  const [failure, setFailure] = useState<EndpointFailure | null>(null);
  const [loading, setLoading] = useState(true);

  const [toggling, setToggling] = useState(false);
  const [toggleFail, setToggleFail] = useState<EndpointFailure | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    try {
      setProduct(await getProduct(code));
    } catch (e) {
      setProduct(null);
      setFailure(toFailure(e));
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Real PATCH against /catalog/:code/active. No optimistic local flip: the row
   *  only changes after the server confirms, so the screen can never show a
   *  state the database does not hold. */
  async function toggleActive() {
    if (!product) return;
    setToggling(true);
    setToggleFail(null);
    try {
      await setProductActive(product.code, !product.active);
      await load();
    } catch (e) {
      setToggleFail(toFailure(e));
    } finally {
      setToggling(false);
    }
  }

  const price = product ? productPrice(product) : null;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title={product?.name || code}
        subtitle={product?.description ?? 'Product detail read live from /api/insurance/admin/catalog.'}
        action={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Link href="/admin/insurance/catalog" style={{ ...btn(), textDecoration: 'none' }}>
              Back to catalog
            </Link>
            {product ? (
              <button onClick={toggleActive} disabled={toggling} style={{ ...btn(), opacity: toggling ? 0.6 : 1 }}>
                {toggling ? 'Saving…' : product.active ? 'Deactivate' : 'Activate'}
              </button>
            ) : null}
          </div>
        }
      />
      <InsuranceTabs active="catalog" />

      {toggleFail ? (
        <div style={{ marginBottom: '1rem' }}>
          <EndpointErrorCard failure={toggleFail} onRetry={toggleActive} />
        </div>
      ) : null}

      <LiveState loading={loading} failure={failure} empty={!product} emptyTitle="Product not found" onRetry={load}>
        {product && price && (
          <>
            <Card title="Cover">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
                <Field label="Code">
                  <code style={{ fontSize: 12 }}>{product.code}</code>
                </Field>
                <Field label="Underwriter">{product.underwriter || <NotReported />}</Field>
                <Field label="Aggregator">{product.aggregator}</Field>
                <Field label="Category">{product.category || product.product_line}</Field>
                <Field label={product.is_percentage ? 'Rate' : 'Premium'}>
                  <span style={{ fontWeight: 700 }}>{price.text}</span>
                  {product.is_percentage ? (
                    <div style={{ fontSize: 11, color: colors.muted }}>
                      Percentage product: the premium is {formatRateBps(product.rate_bps)} of the sum insured, computed at
                      quote time. There is no fixed naira price.
                    </div>
                  ) : null}
                </Field>
                <Field label="Sum insured">
                  {product.sum_insured_kobo === null || product.sum_insured_kobo === undefined ? (
                    <NotReported />
                  ) : (
                    formatNaira(product.sum_insured_kobo)
                  )}
                </Field>
                <Field label="Cover period">
                  {product.cover_period_days === null || product.cover_period_days === undefined ? (
                    <NotReported />
                  ) : (
                    `${product.cover_period_days.toLocaleString('en-NG')} days`
                  )}
                </Field>
                <Field label="Provider route">
                  {product.provider_buy_path ? (
                    <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{product.provider_buy_path}</code>
                  ) : product.provider_product_code ? (
                    <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{product.provider_product_code}</code>
                  ) : (
                    <NotReported hint="MyCover's purchase path is bespoke per product and is not derivable from the name." />
                  )}
                </Field>
                <Field label="Status">
                  <Badge status={product.active ? 'active' : 'inactive'} label={product.active ? 'Active' : 'Inactive'} />
                </Field>
                <Field label="Capabilities">
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Flag on={product.is_claimable} label="Claimable" />
                    <Flag on={product.is_renewable} label="Renewable" />
                    <Flag on={product.is_certificateable} label="Certificate" />
                    <Flag on={product.is_inspectable} label="Inspection" />
                  </div>
                </Field>
              </div>
            </Card>

            <CommissionCard product={product} />

            {product.key_benefits_html || product.how_it_works_html || product.how_to_claim_html ? (
              <Card title="Policy wording (as supplied by the provider)">
                <p style={{ fontSize: '0.75rem', color: colors.muted, marginTop: 0 }}>
                  Provider-authored HTML, rendered here as plain text. It is deliberately not injected as
                  markup — this content comes from a third party and is never trusted into the DOM.
                </p>
                <Prose label="Key benefits" html={product.key_benefits_html} />
                <Prose label="How it works" html={product.how_it_works_html} />
                <Prose label="How to claim" html={product.how_to_claim_html} />
              </Card>
            ) : null}
          </>
        )}
      </LiveState>
    </div>
  );
}

/**
 * The revenue view of one product.
 *
 * Projection uses integer kobo arithmetic (commissionKoboFor) and is labelled as
 * a projection on a single sale, never presented as earned revenue. With zero
 * policies sold, earned commission is zero, and this card says so.
 */
function CommissionCard({ product }: { product: InsuranceProduct }) {
  const bands: SharingFormula[] = product.sharing_formula ?? [];
  if (bands.length === 0) {
    return (
      <Card title="Commission">
        <p style={{ color: colors.muted, fontSize: '0.85rem', margin: 0 }}>
          The API did not report a sharing formula for this product, so no commission split can be shown.
          It is not being assumed to be zero.
        </p>
      </Card>
    );
  }
  const flat = product.is_percentage ? null : product.base_price_kobo ?? null;
  return (
    <Card
      title="Commission split"
      right={<span style={{ fontSize: '0.75rem', color: colors.muted }}>{bands.length > 1 ? `${bands.length} bands` : 'single band'}</span>}
    >
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th()}>Band</th>
              <th style={th()}>Paymax (distributor)</th>
              <th style={th()}>MyCover (mca)</th>
              <th style={th()}>Underwriter (provider)</th>
              <th style={th()}>Computed from</th>
              <th style={th()}>Projected on one sale</th>
            </tr>
          </thead>
          <tbody>
            {bands.map((b, i) => {
              const ours = flat === null ? null : commissionKoboFor(flat, b.distributor_commission_pct);
              return (
                <tr key={i}>
                  <td style={td()}>
                    {b.min || b.max ? `${b.min ?? 0} – ${b.max ?? '∞'}` : 'all'}
                    {b.band_key ? <div style={{ fontSize: '0.68rem', color: colors.muted }}>{b.band_key}</div> : null}
                  </td>
                  <td style={{ ...td(), fontWeight: 700, color: colors.success }}>{formatPct(b.distributor_commission_pct)}</td>
                  <td style={td()}>{formatPct(b.mca_commission_pct)}</td>
                  <td style={td()}>{formatPct(b.provider_commission_pct)}</td>
                  <td style={td()}>
                    <div style={{ fontSize: '0.78rem' }}>
                      ours: {b.distributor_commission_from?.replace('_', ' ') ?? <NotReported />}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: colors.muted }}>
                      provider: {b.provider_commission_from?.replace('_', ' ') ?? '—'}
                    </div>
                  </td>
                  <td style={td()}>
                    {ours === null ? (
                      <NotReported hint="Percentage products have no fixed premium, so a per-sale projection needs a sum insured." />
                    ) : (
                      <span style={{ fontWeight: 600 }}>{formatNaira(ours)}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: '0.75rem', color: colors.muted, marginBottom: 0, marginTop: '0.75rem', lineHeight: 1.5 }}>
        <strong>Projected</strong> means &ldquo;what one sale at the listed price would earn&rdquo;. It is arithmetic on the
        catalog price, not money received. Realised commission is on the{' '}
        <Link href="/admin/insurance/commission" style={{ color: colors.primary }}>Commission</Link> screen and comes from
        the ledger.
        {product.is_percentage
          ? ' This is a percentage product, so no per-sale figure can be projected without a sum insured.'
          : null}
      </p>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={dt}>{label}</div>
      <div style={{ fontSize: 13, color: colors.text }}>{children}</div>
    </div>
  );
}

function Flag({ on, label }: { on: boolean | null | undefined; label: string }) {
  if (on === null || on === undefined) {
    return (
      <span style={{ fontSize: 11, color: colors.muted, border: `1px dashed ${colors.border}`, borderRadius: 9999, padding: '0.1rem 0.45rem' }}>
        {label}?
      </span>
    );
  }
  return <Badge status={on ? 'active' : 'inactive'} label={on ? label : `No ${label.toLowerCase()}`} />;
}

/** Strips provider HTML to text. Never dangerouslySetInnerHTML — third-party content. */
function Prose({ label, html }: { label: string; html: string | null | undefined }) {
  if (!html) return null;
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return null;
  return (
    <div style={{ marginBottom: '0.9rem' }}>
      <div style={dt}>{label}</div>
      <div style={{ fontSize: 13, color: colors.text, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{text}</div>
    </div>
  );
}
