'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getCommission,
  getCatalog,
  formatNaira,
  formatPct,
  productPrice,
  commissionKoboFor,
  primaryBand,
} from '@/services/insuranceAdminService';
import type { CatalogResponse, CommissionSummary, InsuranceProduct } from '@/types/insuranceAdmin';
import {
  PageHeader,
  InsuranceTabs,
  Card,
  MetricTile,
  NotReported,
  DisclosureNote,
  WarningNote,
  LiveState,
  EndpointErrorCard,
  toFailure,
  type EndpointFailure,
  btn,
  th,
  td,
  label,
  select,
  input,
  fmtDate,
} from '../_ui';
import { colors } from '@/components/ui/vuexy';

/**
 * Commission — Paymax's actual revenue from insurance distribution.
 *
 * Two halves, and keeping them apart is the entire point of the screen:
 *
 *   REALISED (top) comes from the ledger via /commission. It is money we have
 *   actually earned. With zero policies sold it is zero, and it says so.
 *
 *   RATES (bottom) comes from the catalog's sharing_formula. It is what each
 *   product WOULD pay per sale. It is a rate card, never revenue.
 *
 * Merging the two — showing projected earnings under a "commission earned"
 * heading — would be the single most misleading thing this console could do, so
 * the projection column is labelled per-sale and the section is headed as a rate
 * card.
 *
 * `*_commission_from` is displayed beside every rate because the same percentage
 * applied to original_premium and to final_premium is materially different money
 * once discounts or add-ons move the final premium.
 */
export default function InsuranceCommissionPage() {
  const [realised, setRealised] = useState<CommissionSummary | null>(null);
  const [realisedFail, setRealisedFail] = useState<EndpointFailure | null>(null);
  const [realisedLoading, setRealisedLoading] = useState(true);

  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [catFail, setCatFail] = useState<EndpointFailure | null>(null);
  const [catLoading, setCatLoading] = useState(true);

  const [underwriter, setUnderwriter] = useState('all');
  const [q, setQ] = useState('');
  const [onlyEarning, setOnlyEarning] = useState(false);

  const loadRealised = useCallback(async () => {
    setRealisedLoading(true);
    setRealisedFail(null);
    try {
      setRealised(await getCommission());
    } catch (e) {
      setRealised(null);
      setRealisedFail(toFailure(e));
    } finally {
      setRealisedLoading(false);
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    setCatLoading(true);
    setCatFail(null);
    try {
      setCatalog(await getCatalog());
    } catch (e) {
      setCatalog(null);
      setCatFail(toFailure(e));
    } finally {
      setCatLoading(false);
    }
  }, []);

  const loadAll = useCallback(() => {
    void loadRealised();
    void loadCatalog();
  }, [loadRealised, loadCatalog]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const products = useMemo(() => catalog?.products ?? [], [catalog]);
  const underwriters = useMemo(
    () => Array.from(new Set(products.map((p) => p.underwriter).filter(Boolean))).sort(),
    [products],
  );

  const rateRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products
      .filter((p) => {
        if (underwriter !== 'all' && p.underwriter !== underwriter) return false;
        if (needle && !`${p.code} ${p.name} ${p.underwriter}`.toLowerCase().includes(needle)) return false;
        if (onlyEarning && (primaryBand(p)?.distributor_commission_pct ?? 0) <= 0) return false;
        return true;
      })
      .sort((a, b) => (primaryBand(b)?.distributor_commission_pct ?? -1) - (primaryBand(a)?.distributor_commission_pct ?? -1));
  }, [products, underwriter, q, onlyEarning]);

  // Rate-card statistics, computed only over products that actually reported a
  // formula. Products with no formula are counted separately rather than folded
  // in as 0%, which would drag the average toward a number nobody agreed to.
  const reported = products.map((p) => primaryBand(p)?.distributor_commission_pct).filter((v): v is number => v !== null && v !== undefined);
  const unreported = products.length - reported.length;
  const maxPct = reported.length ? Math.max(...reported) : null;
  const minPct = reported.length ? Math.min(...reported) : null;
  const zeroPct = reported.filter((v) => v === 0).length;

  const entries = realised?.entries ?? [];
  // Prefer the API's own total; only fall back to summing the rows we were given,
  // and label that fallback as page-scoped rather than passing it off as a book total.
  const totalFromApi = realised?.total_commission_kobo ?? null;
  const totalFromRows = entries.reduce((s, e) => s + (e.commission_kobo ?? 0), 0);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Commission"
        subtitle="What Paymax earns for distributing cover. Realised commission comes from the ledger; the rate card below comes from each product's sharing formula."
        action={<button onClick={loadAll} style={btn()}>Refresh</button>}
      />
      <InsuranceTabs active="commission" />

      <DisclosureNote>
        Premium is a <strong>pass-through liability</strong> owed to the underwriter. The{' '}
        <strong>distributor_commission</strong> slice below is the only part that is Paymax income, and it
        is recognised on a separate ledger account from premium.
      </DisclosureNote>

      <Card
        title="Realised commission (from the ledger)"
        right={realised?.period_from ? <span style={{ fontSize: '0.75rem', color: colors.muted }}>{fmtDate(realised.period_from)} → {fmtDate(realised.period_to)}</span> : null}
      >
        <LiveState loading={realisedLoading} failure={realisedFail} empty={false} onRetry={loadRealised}>
          {realised && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: entries.length ? '1rem' : 0 }}>
                <MetricTile
                  label="Commission earned"
                  value={totalFromApi !== null ? formatNaira(totalFromApi) : entries.length ? formatNaira(totalFromRows) : formatNaira(0)}
                  sub={totalFromApi !== null ? 'Reported by the API' : entries.length ? 'Summed from the rows shown' : 'No commission entries exist'}
                  accent={colors.success}
                />
                <MetricTile
                  label="Premium it came from"
                  value={realised.total_premium_kobo !== null && realised.total_premium_kobo !== undefined ? formatNaira(realised.total_premium_kobo) : null}
                  sub="Gross written, pass-through"
                />
                <MetricTile label="Entries" value={entries.length.toLocaleString('en-NG')} />
              </div>

              {entries.length === 0 ? (
                <p style={{ color: colors.muted, fontSize: '0.85rem', margin: 0, lineHeight: 1.5 }}>
                  No commission has been recognised yet — no policy has been bound, so there is nothing for a
                  commission entry to attach to. This zero is a real ledger zero.
                </p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={th()}>Policy</th>
                        <th style={th()}>Product</th>
                        <th style={th()}>Underwriter</th>
                        <th style={th()}>Premium</th>
                        <th style={th()}>Rate</th>
                        <th style={th()}>Basis</th>
                        <th style={th()}>Commission</th>
                        <th style={th()}>Ledger</th>
                        <th style={th()}>Recognised</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e) => (
                        <tr key={e.id}>
                          <td style={td()}>
                            {e.policy_id ? (
                              <Link href={`/admin/insurance/policies/${encodeURIComponent(e.policy_id)}`} style={{ color: colors.primary, textDecoration: 'none' }}>
                                <code style={{ fontSize: '0.76rem' }}>{e.policy_id}</code>
                              </Link>
                            ) : (
                              <NotReported />
                            )}
                          </td>
                          <td style={td()}>{e.product_name || e.product_code || <NotReported />}</td>
                          <td style={td()}>{e.underwriter || <NotReported />}</td>
                          <td style={td()}>{e.premium_kobo === null || e.premium_kobo === undefined ? <NotReported /> : formatNaira(e.premium_kobo)}</td>
                          <td style={td()}>{formatPct(e.basis_pct)}</td>
                          <td style={td()}>
                            {e.basis ? <span style={{ fontSize: '0.78rem' }}>{String(e.basis).replace('_', ' ')}</span> : <NotReported hint="Without the basis, this rate cannot be reconciled against a MyCover statement." />}
                          </td>
                          <td style={{ ...td(), color: colors.success, fontWeight: 700 }}>
                            {e.commission_kobo === null || e.commission_kobo === undefined ? <NotReported /> : formatNaira(e.commission_kobo)}
                          </td>
                          <td style={td()}><code style={{ fontSize: '0.72rem' }}>{e.ledger_ref || '—'}</code></td>
                          <td style={td()}>{e.created_at ? fmtDate(e.created_at) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </LiveState>
      </Card>

      <Card
        title="Rate card — what each product pays us"
        right={<span style={{ fontSize: '0.75rem', color: colors.muted }}>{rateRows.length.toLocaleString('en-NG')} of {products.length.toLocaleString('en-NG')} products</span>}
      >
        {catFail ? (
          <EndpointErrorCard failure={catFail} onRetry={loadCatalog} />
        ) : (
          <>
            <WarningNote title="These are rates, not earnings">
              Every figure in this table is arithmetic on the catalog price. It describes what a single sale
              would pay, and nothing here means money has been received. Earned commission is the section
              above.
            </WarningNote>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
              <MetricTile label="Best rate" value={maxPct === null ? null : formatPct(maxPct)} sub="Highest distributor share" accent={colors.success} />
              <MetricTile label="Lowest rate" value={minPct === null ? null : formatPct(minPct)} sub={`${zeroPct} product${zeroPct === 1 ? '' : 's'} pay 0%`} />
              <MetricTile
                label="No formula reported"
                value={unreported.toLocaleString('en-NG')}
                sub="Excluded from these stats, not treated as 0%"
                accent={unreported ? colors.warning : undefined}
              />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.9rem', alignItems: 'end' }}>
              <div style={{ minWidth: 190 }}>
                <label style={label()}>Underwriter</label>
                <select style={select()} value={underwriter} onChange={(e) => setUnderwriter(e.target.value)}>
                  <option value="all">All underwriters</option>
                  {underwriters.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={label()}>Search</label>
                <input style={input()} placeholder="Product or underwriter…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem', paddingBottom: '0.45rem' }}>
                <input type="checkbox" checked={onlyEarning} onChange={(e) => setOnlyEarning(e.target.checked)} />
                Only products that pay us
              </label>
            </div>

            <LiveState
              loading={catLoading}
              failure={null}
              empty={rateRows.length === 0}
              emptyTitle={products.length === 0 ? 'No products stored' : 'No products match these filters'}
              emptyNote={
                products.length === 0
                  ? 'Sync the catalog first — the rate card is derived from each product’s sharing formula, so it is empty until products exist.'
                  : 'Clear a filter to see the rest of the rate card.'
              }
            >
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th()}>Product</th>
                      <th style={th()}>Underwriter</th>
                      <th style={th()}>Price</th>
                      <th style={th()}>Ours</th>
                      <th style={th()}>MyCover</th>
                      <th style={th()}>Underwriter share</th>
                      <th style={th()}>Computed from</th>
                      <th style={th()}>We earn per sale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rateRows.map((p) => (
                      <RateRow key={p.code || p.name} product={p} />
                    ))}
                  </tbody>
                </table>
              </div>
            </LiveState>
          </>
        )}
      </Card>
    </div>
  );
}

function RateRow({ product: p }: { product: InsuranceProduct }) {
  const band = primaryBand(p);
  const price = productPrice(p);
  const ours = band?.distributor_commission_pct ?? null;
  // Only a flat-priced product can be projected. A percentage product's premium
  // depends on the sum insured the customer chooses, so there is no per-sale
  // figure to state and the cell says why instead of showing a fabricated one.
  const perSale = p.is_percentage ? null : commissionKoboFor(p.base_price_kobo ?? 0, ours);
  const bands = p.sharing_formula?.length ?? 0;
  return (
    <tr>
      <td style={td()}>
        <Link href={`/admin/insurance/catalog/${encodeURIComponent(p.code)}`} style={{ color: colors.primary, fontWeight: 600, textDecoration: 'none' }}>
          {p.name || p.code}
        </Link>
        {bands > 1 ? <div style={{ fontSize: '0.68rem', color: colors.warning }}>{bands} bands — showing the first</div> : null}
      </td>
      <td style={td()}>{p.underwriter || <NotReported />}</td>
      <td style={td()}>
        {price.text}
        {price.kind === 'rate' ? <div style={{ fontSize: '0.68rem', color: colors.muted }}>rate of sum insured</div> : null}
      </td>
      <td style={{ ...td(), fontWeight: 700, color: ours ? colors.success : colors.muted }}>
        {ours === null ? <NotReported /> : formatPct(ours)}
      </td>
      <td style={td()}>{formatPct(band?.mca_commission_pct)}</td>
      <td style={td()}>{formatPct(band?.provider_commission_pct)}</td>
      <td style={td()}>
        <div style={{ fontSize: '0.78rem' }}>ours: {band?.distributor_commission_from?.replace('_', ' ') ?? <NotReported />}</div>
        <div style={{ fontSize: '0.7rem', color: colors.muted }}>provider: {band?.provider_commission_from?.replace('_', ' ') ?? '—'}</div>
      </td>
      <td style={td()}>
        {perSale === null ? (
          <span style={{ fontSize: '0.78rem', color: colors.muted, fontStyle: 'italic' }}>
            {p.is_percentage ? 'depends on sum insured' : 'no price reported'}
          </span>
        ) : (
          <span style={{ fontWeight: 600 }}>{formatNaira(perSale)}</span>
        )}
      </td>
    </tr>
  );
}
