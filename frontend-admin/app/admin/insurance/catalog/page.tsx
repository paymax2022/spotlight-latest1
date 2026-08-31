'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getCatalog,
  getProviders,
  syncCatalog,
  formatPct,
  productPrice,
  primaryBand,
  sellabilityOf,
} from '@/services/insuranceAdminService';
import type { CatalogResponse, CatalogSyncRun, InsuranceProduct } from '@/types/insuranceAdmin';
import {
  PageHeader,
  InsuranceTabs,
  Card,
  Badge,
  MetricTile,
  NotReported,
  DisclosureNote,
  LiveState,
  EndpointErrorCard,
  toFailure,
  type EndpointFailure,
  btn,
  btnPrimary,
  th,
  td,
  label,
  select,
  input,
  fmtDate,
  timeAgo,
} from '../_ui';
import { colors } from '@/components/ui/vuexy';

/**
 * Product catalog.
 *
 * Filtering and sorting happen CLIENT-side over the full catalog the API
 * returned. That is deliberate: the catalog is a bounded ~68-row list, and
 * filtering locally means the counts shown ("12 of 68") are always counts of
 * real rows we hold, never a guess at what a server-side filter would return.
 */
export default function InsuranceCatalogPage() {
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [failure, setFailure] = useState<EndpointFailure | null>(null);
  const [loading, setLoading] = useState(true);

  // The catalog endpoint returns products only; the sync RUN record lives on
  // /providers. Loaded separately so a missing sync record never blanks the
  // product table, and vice versa.
  const [lastSync, setLastSync] = useState<CatalogSyncRun | null>(null);
  const [syncRunFail, setSyncRunFail] = useState<EndpointFailure | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncFail, setSyncFail] = useState<EndpointFailure | null>(null);
  const [syncOk, setSyncOk] = useState<string | null>(null);

  const [underwriter, setUnderwriter] = useState('all');
  const [line, setLine] = useState('all');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    try {
      setData(await getCatalog());
    } catch (e) {
      setData(null);
      setFailure(toFailure(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSyncRun = useCallback(async () => {
    setSyncRunFail(null);
    try {
      setLastSync((await getProviders()).last_sync);
    } catch (e) {
      setLastSync(null);
      setSyncRunFail(toFailure(e));
    }
  }, []);

  useEffect(() => {
    void load();
    void loadSyncRun();
  }, [load, loadSyncRun]);

  /**
   * Real write against POST /catalog/sync. There is no simulated branch: if the
   * endpoint is absent or fails, the failure is displayed and NOTHING claims a
   * sync happened. A console that reports a sync it never performed is how a
   * stale catalog goes unnoticed for weeks.
   */
  async function runSync() {
    setSyncing(true);
    setSyncFail(null);
    setSyncOk(null);
    try {
      const r = await syncCatalog();
      const parts = [
        r.synced !== null && r.synced !== undefined ? `${r.synced} seen at the provider` : null,
        r.updated !== null && r.updated !== undefined ? `${r.updated} stored` : null,
        r.with_schema !== null && r.with_schema !== undefined ? `${r.with_schema} with a form schema` : null,
        r.failed ? `${r.failed} failed` : null,
      ].filter(Boolean);
      setSyncOk(parts.length ? parts.join(' · ') : 'Sync completed.');
      await load();
      await loadSyncRun();
    } catch (e) {
      setSyncFail(toFailure(e));
    } finally {
      setSyncing(false);
    }
  }

  const products = useMemo(() => data?.products ?? [], [data]);

  const underwriters = useMemo(
    () => Array.from(new Set(products.map((p) => p.underwriter).filter(Boolean))).sort(),
    [products],
  );
  const lines = useMemo(
    () => Array.from(new Set(products.map((p) => p.product_line).filter(Boolean))).sort(),
    [products],
  );

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products.filter((p) => {
      if (underwriter !== 'all' && p.underwriter !== underwriter) return false;
      if (line !== 'all' && p.product_line !== line) return false;
      if (status !== 'all' && p.active !== (status === 'active')) return false;
      if (needle && !`${p.code} ${p.name} ${p.underwriter} ${p.product_line}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [products, underwriter, line, status, q]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Insurance catalog"
        subtitle="Every product we can sell, as stored from the MyCover.ai catalog. Underwriter, category, price or rate, cover period and the claim/renew/certificate capabilities that drive what the mobile app may offer."
        action={
          <button onClick={runSync} disabled={syncing} style={{ ...btnPrimary(), opacity: syncing ? 0.6 : 1 }}>
            {syncing ? 'Syncing…' : 'Sync from MyCover'}
          </button>
        }
      />
      <InsuranceTabs active="catalog" />

      <DisclosureNote>
        The <strong>underwriter</strong> column is the NAICOM-licensed insurer carrying the risk.
        MyCover.ai is the aggregator, not the insurer, and every quote, policy and certificate must
        disclose the same underwriter shown here.
      </DisclosureNote>

      {syncOk ? (
        <div style={{ border: `1px solid ${colors.success}`, background: '#f0fdf4', color: '#166534', borderRadius: '0.5rem', padding: '0.6rem 0.85rem', fontSize: '0.82rem', marginBottom: '1rem' }}>
          <strong>Sync completed.</strong> {syncOk}
        </div>
      ) : null}
      {syncFail ? (
        <div style={{ marginBottom: '1rem' }}>
          <EndpointErrorCard failure={syncFail} onRetry={runSync} />
        </div>
      ) : null}

      <Card title="Sync status">
        {failure ? (
          <EndpointErrorCard failure={failure} onRetry={load} />
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem' }}>
              <MetricTile label="Stored locally" value={loading ? '…' : products.length.toLocaleString('en-NG')} sub="Rows in our catalog" accent={colors.primary} />
              <MetricTile label="Active" value={loading ? '…' : products.filter((p) => p.active).length.toLocaleString('en-NG')} sub="Sellable right now" accent={colors.success} />
              <MetricTile
                label="Seen at MyCover"
                value={lastSync?.products_seen === null || lastSync?.products_seen === undefined ? null : lastSync.products_seen.toLocaleString('en-NG')}
                sub="On the last sync run"
              />
              <MetricTile
                label="With a form schema"
                value={lastSync?.products_with_schema === null || lastSync?.products_with_schema === undefined ? null : lastSync.products_with_schema.toLocaleString('en-NG')}
                sub="Purchasable through the app"
              />
              <MetricTile
                label="Failed to store"
                value={lastSync?.products_failed === null || lastSync?.products_failed === undefined ? null : lastSync.products_failed.toLocaleString('en-NG')}
                sub="Seen but not written"
                accent={lastSync?.products_failed ? colors.danger : undefined}
              />
              <MetricTile
                label="Last sync"
                value={lastSync?.finished_at ? timeAgo(lastSync.finished_at) : null}
                sub={lastSync?.finished_at ? fmtDate(lastSync.finished_at) : 'Never synced, or not reported'}
                accent={lastSync?.status && lastSync.status !== 'ok' && lastSync.status !== 'success' ? colors.warning : undefined}
              />
            </div>

            {/* Drift: what the provider showed us on the last run vs what we hold
                now. Only stated when BOTH numbers are real — a gap computed
                against a missing count would be a fabricated discrepancy. */}
            {lastSync?.products_seen !== null && lastSync?.products_seen !== undefined && !loading ? (
              products.length === lastSync.products_seen ? (
                <p style={{ marginTop: '0.85rem', marginBottom: 0, fontSize: '0.82rem', color: colors.success }}>
                  No drift: we hold every one of the {lastSync.products_seen.toLocaleString('en-NG')} products the
                  provider listed on the last run.
                </p>
              ) : (
                <p style={{ marginTop: '0.85rem', marginBottom: 0, fontSize: '0.82rem', color: colors.danger }}>
                  <strong>Drift of {Math.abs(lastSync.products_seen - products.length).toLocaleString('en-NG')} products.</strong>{' '}
                  The provider listed {lastSync.products_seen.toLocaleString('en-NG')} on the last run and we hold{' '}
                  {products.length.toLocaleString('en-NG')}. Re-run the sync; if the gap persists, the failures
                  count above is where it went.
                </p>
              )
            ) : null}

            {lastSync?.error_text ? (
              <p style={{ marginTop: '0.6rem', marginBottom: 0, fontSize: '0.8rem', color: colors.danger }}>
                Last sync error: <code style={{ fontSize: '0.75rem' }}>{lastSync.error_text}</code>
              </p>
            ) : null}
            {lastSync?.skipped_codes?.length ? (
              <p style={{ marginTop: '0.6rem', marginBottom: 0, fontSize: '0.78rem', color: colors.muted }}>
                Skipped: <code style={{ fontSize: '0.74rem' }}>{lastSync.skipped_codes.slice(0, 20).join(', ')}</code>
                {lastSync.skipped_codes.length > 20 ? ` … +${lastSync.skipped_codes.length - 20} more` : ''}
              </p>
            ) : null}
            {syncRunFail && !lastSync ? (
              <p style={{ marginTop: '0.85rem', marginBottom: 0, fontSize: '0.8rem', color: colors.muted, lineHeight: 1.5 }}>
                The sync run record could not be read ({syncRunFail.method} {syncRunFail.path} → HTTP{' '}
                {syncRunFail.status || 'no response'}), so last-sync time and drift are unknown rather than
                assumed clean.
              </p>
            ) : null}
          </>
        )}
      </Card>

      <Card
        title="Products"
        right={<span style={{ fontSize: '0.75rem', color: colors.muted }}>{rows.length.toLocaleString('en-NG')} of {products.length.toLocaleString('en-NG')} shown</span>}
      >
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
          <div style={{ minWidth: 190 }}>
            <label style={label()}>Underwriter</label>
            <select style={select()} value={underwriter} onChange={(e) => setUnderwriter(e.target.value)}>
              <option value="all">All underwriters</option>
              {underwriters.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
          <div style={{ minWidth: 150 }}>
            <label style={label()}>Category</label>
            <select style={select()} value={line} onChange={(e) => setLine(e.target.value)}>
              <option value="all">All categories</option>
              {lines.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>
          <div style={{ minWidth: 130 }}>
            <label style={label()}>Status</label>
            <select style={select()} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={label()}>Search</label>
            <input style={input()} placeholder="Code, name or underwriter…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button onClick={load} style={btn()}>Refresh</button>
          </div>
        </div>

        <LiveState
          loading={loading}
          failure={failure}
          empty={rows.length === 0}
          emptyTitle={products.length === 0 ? 'The catalog is empty' : 'No products match these filters'}
          emptyNote={
            products.length === 0
              ? 'The API returned no products. Run "Sync from MyCover" above to pull the live catalog in — until that runs, there is genuinely nothing stored.'
              : 'Clear a filter to see the rest of the catalog.'
          }
          onRetry={load}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>Product</th>
                  <th style={th()}>Underwriter</th>
                  <th style={th()}>Category</th>
                  <th style={th()}>Price</th>
                  <th style={th()}>Cover period</th>
                  <th style={th()}>Capabilities</th>
                  <th style={th()}>Our share</th>
                  <th style={th()}>Sellable</th>
                  <th style={th()}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <ProductRow key={p.code || p.name} product={p} />
                ))}
              </tbody>
            </table>
          </div>
        </LiveState>
      </Card>
    </div>
  );
}

function ProductRow({ product: p }: { product: InsuranceProduct }) {
  // productPrice() is the single place that decides amount-vs-rate. Calling
  // formatNaira on a percentage product's base_price would print "₦0.50" for a
  // 0.5% rate.
  const price = productPrice(p);
  const band = primaryBand(p);
  const share = band?.distributor_commission_pct ?? null;
  return (
    <tr>
      <td style={td()}>
        <Link
          href={`/admin/insurance/catalog/${encodeURIComponent(p.code)}`}
          style={{ color: colors.primary, fontWeight: 600, textDecoration: 'none' }}
        >
          {p.name || p.code}
        </Link>
        <div style={{ fontSize: '0.72rem', color: colors.muted, marginTop: 2 }}>
          <code>{p.code}</code>
          {p.provider_product_code ? <> · {p.provider_product_code}</> : null}
        </div>
      </td>
      <td style={td()}>{p.underwriter || <NotReported />}</td>
      <td style={td()}>{p.category || p.product_line}</td>
      <td style={td()}>
        <span style={{ fontWeight: 600 }}>{price.text}</span>
        {price.kind === 'rate' ? (
          <div style={{ fontSize: '0.7rem', color: colors.muted }}>rate, not an amount</div>
        ) : null}
      </td>
      <td style={td()}>
        {p.cover_period_days === null || p.cover_period_days === undefined ? <NotReported /> : `${p.cover_period_days.toLocaleString('en-NG')} days`}
      </td>
      <td style={td()}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <Cap on={p.is_claimable} label="claimable" />
          <Cap on={p.is_renewable} label="renewable" />
          <Cap on={p.is_certificateable} label="certificate" />
        </div>
      </td>
      <td style={td()}>
        {share === null ? (
          <NotReported hint="The API did not report a sharing formula for this product." />
        ) : (
          <span style={{ fontWeight: 700, color: share > 0 ? colors.success : colors.muted }}>{formatPct(share)}</span>
        )}
        {band?.distributor_commission_from ? (
          <div style={{ fontSize: '0.68rem', color: colors.muted }}>of {band.distributor_commission_from.replace('_', ' ')}</div>
        ) : null}
      </td>
      <td style={td()}>
        <Sellable product={p} />
      </td>
      <td style={td()}>
        <Badge status={p.active ? 'active' : 'inactive'} label={p.active ? 'Active' : 'Inactive'} />
      </td>
    </tr>
  );
}

/**
 * Whether this product can actually be bound.
 *
 * Two independent blockers exist and they are not interchangeable: the prefunded
 * MyCover float (a treasury action) and the purchase family's API scope (an
 * account action). This column covers the second. It resolves strictly against
 * the buy path the backend stored — a family cannot be inferred from a product's
 * name or route, so an unstored path shows as unknown rather than as a guess.
 */
function Sellable({ product }: { product: InsuranceProduct }) {
  const s = sellabilityOf(product);
  if (s === 'scope_blocked') {
    return (
      <span style={{ fontSize: '0.7rem', fontWeight: 700, color: colors.danger, background: '#fef2f2', borderRadius: 9999, padding: '0.1rem 0.45rem' }} title="This product's purchase family returns 403 for our API key — it cannot be sold regardless of float balance.">
        scope-blocked
      </span>
    );
  }
  if (s === 'sellable') {
    return <span style={{ fontSize: '0.7rem', fontWeight: 600, color: colors.success }} title="Purchase family verified reachable. Still requires a funded float.">family reachable</span>;
  }
  return (
    <span style={{ fontSize: '0.7rem', color: colors.muted, fontStyle: 'italic' }} title="No purchase family path is stored for this product, so its sellability is genuinely unknown. It is not being assumed either way.">
      unknown
    </span>
  );
}

/** Tri-state capability chip: on, off, or genuinely unknown. */
function Cap({ on, label: lbl }: { on: boolean | null | undefined; label: string }) {
  if (on === null || on === undefined) {
    return <span style={{ fontSize: '0.68rem', color: colors.muted, border: `1px dashed ${colors.border}`, borderRadius: 9999, padding: '0.05rem 0.4rem' }} title="Not reported by the API">{lbl}?</span>;
  }
  return (
    <span
      style={{
        fontSize: '0.68rem',
        fontWeight: 600,
        borderRadius: 9999,
        padding: '0.05rem 0.4rem',
        color: on ? colors.success : colors.muted,
        background: on ? '#f0fdf4' : colors.headBg,
        textDecoration: on ? 'none' : 'line-through',
      }}
    >
      {lbl}
    </span>
  );
}
