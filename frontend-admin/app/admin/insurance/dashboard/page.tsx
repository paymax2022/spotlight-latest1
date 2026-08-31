'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  getDashboard,
  getCatalog,
  getProviders,
  formatNaira,
  formatPct,
  floatSeverity,
} from '@/services/insuranceAdminService';
import type { CatalogResponse, DashboardBreakdown, InsuranceDashboard, ProvidersReport } from '@/types/insuranceAdmin';
import {
  PageHeader,
  InsuranceTabs,
  Card,
  MetricTile,
  NotReported,
  DisclosureNote,
  LiveState,
  FloatAlarm,
  FloatPanel,
  EndpointErrorCard,
  toFailure,
  type EndpointFailure,
  btn,
  th,
  td,
  fmtDate,
} from '../_ui';
import { colors } from '@/components/ui/vuexy';

/**
 * Insurance overview.
 *
 * Two INDEPENDENT loads: the KPI block from /dashboard and the catalog-readiness
 * block from /catalog. They fail separately on purpose — one endpoint being
 * unbuilt should not blank a screen the other endpoint can still fill.
 *
 * Nothing on this page is synthesised. Every figure is either a value the API
 * returned or the words "not reported". Paymax has sold zero policies so far, so
 * the honest render of this screen today is a set of explicit zeroes and an
 * explanation — not a chart.
 */
export default function InsuranceDashboardPage() {
  const [kpi, setKpi] = useState<InsuranceDashboard | null>(null);
  const [kpiFail, setKpiFail] = useState<EndpointFailure | null>(null);
  const [kpiLoading, setKpiLoading] = useState(true);

  const [providers, setProviders] = useState<ProvidersReport | null>(null);
  const [provFail, setProvFail] = useState<EndpointFailure | null>(null);
  const [provLoading, setProvLoading] = useState(true);

  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [catFail, setCatFail] = useState<EndpointFailure | null>(null);
  const [catLoading, setCatLoading] = useState(true);

  const loadKpi = useCallback(async () => {
    setKpiLoading(true);
    setKpiFail(null);
    try {
      setKpi(await getDashboard());
    } catch (e) {
      setKpi(null);
      setKpiFail(toFailure(e));
    } finally {
      setKpiLoading(false);
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

  const loadProviders = useCallback(async () => {
    setProvLoading(true);
    setProvFail(null);
    try {
      setProviders(await getProviders());
    } catch (e) {
      setProviders(null);
      setProvFail(toFailure(e));
    } finally {
      setProvLoading(false);
    }
  }, []);

  const loadAll = useCallback(() => {
    void loadKpi();
    void loadCatalog();
    void loadProviders();
  }, [loadKpi, loadCatalog, loadProviders]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const n = (v: number | null | undefined) => (v === null || v === undefined ? null : v.toLocaleString('en-NG'));
  const money = (v: number | null | undefined) => (v === null || v === undefined ? null : formatNaira(v));

  // Loss ratio is only meaningful once premium has been earned. Reporting "0.0%"
  // on zero premium would read as an excellent book rather than an empty one.
  const lossRatio =
    kpi?.loss_ratio === null || kpi?.loss_ratio === undefined
      ? null
      : (kpi.gross_premium_kobo ?? 0) === 0
        ? null
        : formatPct(kpi.loss_ratio * 100);

  // The MyCover rail is the one that actually settles binds today. When the
  // providers endpoint is unavailable the float is UNKNOWN, not healthy — and
  // the alarm treats unknown as a warning, not silence.
  const mycover = (providers?.adapters ?? []).find((p) => p.provider === 'mycover') ?? (providers?.adapters ?? [])[0] ?? null;
  const float = mycover?.float ?? providers?.floats?.[0] ?? null;
  // The backend's top-level binding_paused is the launch gate and OVERRIDES the
  // per-rail derivation: if it says binds are paused, they are paused.
  const severity = provLoading ? 'ok' : providers?.binding_paused === true ? 'empty' : floatSeverity(float);

  const noPolicies = !!kpi && (kpi.policies_total ?? 0) === 0;
  const activeProducts = catalog?.products.filter((p) => p.active).length ?? null;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Insurance overview"
        subtitle="Policies sold, gross premium, Paymax's distributor commission, claims and loss ratio — read live from /api/insurance/admin. No sample data is shown on this screen."
        action={
          <button onClick={loadAll} style={btn()}>
            Refresh
          </button>
        }
      />
      <InsuranceTabs active="dashboard" />

      <DisclosureNote>
        Paymax does <strong>not</strong> underwrite. It distributes cover written by NAICOM-licensed
        insurers, sourced through the MyCover.ai aggregator. Premium is a pass-through liability; only
        the <strong>distributor commission</strong> below is Paymax revenue.
      </DisclosureNote>

      <FloatAlarm
        severity={severity}
        reason={providers?.binding_paused_reason ?? null}
        failures={float?.consecutive_failures ?? null}
        providerLabel={mycover?.display_name || mycover?.provider || 'MyCover'}
      />

      <Card
        title="Provider float (prefunded wallet)"
        right={<Link href="/admin/insurance/providers" style={{ fontSize: '0.8rem', color: colors.primary, textDecoration: 'none', fontWeight: 600 }}>Provider rails →</Link>}
      >
        {provFail ? (
          <EndpointErrorCard failure={provFail} onRetry={loadProviders} />
        ) : provLoading ? (
          <p style={{ color: colors.muted, fontSize: '0.9rem' }}>Loading from the live API…</p>
        ) : (
          <>
            <p style={{ fontSize: '0.82rem', color: colors.text, marginTop: 0, lineHeight: 1.55 }}>
              Every bind debits a wallet Paymax funds in advance with the aggregator — it is not charged per
              transaction. This balance, not our own wallet, is what decides whether a policy can be issued
              at all.
            </p>
            <FloatPanel float={float} severity={severity} />
          </>
        )}
      </Card>

      <Card title="Book" right={<span style={{ fontSize: '0.75rem', color: colors.muted }}>{kpi?.generated_at ? `as of ${fmtDate(kpi.generated_at)}` : null}</span>}>
        <LiveState loading={kpiLoading} failure={kpiFail} empty={false} onRetry={loadKpi}>
          {kpi && (
            <>
              {noPolicies ? (
                <div
                  style={{
                    border: `1px dashed ${colors.border}`,
                    borderRadius: '0.5rem',
                    padding: '0.85rem 1rem',
                    marginBottom: '1rem',
                    fontSize: '0.85rem',
                    color: colors.text,
                    lineHeight: 1.5,
                  }}
                >
                  <strong>No policies have been sold yet.</strong> Every figure below is a real zero
                  returned by the API, not a placeholder. Ratios that are undefined on an empty book
                  (loss ratio, average premium) are shown as <NotReported /> rather than 0%, because a
                  0% loss ratio on zero premium would read as a perfectly performing book.
                </div>
              ) : null}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem' }}>
                <MetricTile
                  label="Policies sold"
                  value={n(kpi.policies_total)}
                  sub={kpi.policies_pending !== null && kpi.policies_pending !== undefined ? `${n(kpi.policies_pending)} pending` : undefined}
                  accent={colors.primary}
                />
                <MetricTile label="Active" value={n(kpi.policies_active)} accent={colors.success} />
                <MetricTile
                  label="Lapsed"
                  value={n(kpi.policies_lapsed)}
                  sub={kpi.policies_expired !== null && kpi.policies_expired !== undefined ? `${n(kpi.policies_expired)} expired` : undefined}
                  accent={(kpi.policies_lapsed ?? 0) > 0 ? colors.danger : undefined}
                />
                <MetricTile label="Cancelled" value={n(kpi.policies_cancelled)} />
                <MetricTile
                  label="Gross premium"
                  value={money(kpi.gross_premium_kobo)}
                  sub="Written, pass-through"
                  hint="Gross written premium in kobo, converted for display only."
                />
                <MetricTile
                  label="Our commission"
                  value={money(kpi.commission_kobo)}
                  sub="Paymax distributor share"
                  accent={colors.success}
                  hint="The distributor_commission slice of the sharing formula — this is Paymax revenue, unlike premium."
                />
                <MetricTile label="Claims" value={n(kpi.claims_count)} sub={kpi.claims_open !== null && kpi.claims_open !== undefined ? `${n(kpi.claims_open)} open` : undefined} />
                <MetricTile label="Claims paid" value={money(kpi.claims_paid_kobo)} />
                <MetricTile
                  label="Loss ratio"
                  value={lossRatio}
                  sub={lossRatio === null ? 'Undefined on zero earned premium' : 'Incurred ÷ earned premium'}
                  accent={kpi.loss_ratio !== null && kpi.loss_ratio !== undefined && kpi.loss_ratio > 0.7 ? colors.danger : undefined}
                />
              </div>
            </>
          )}
        </LiveState>
      </Card>

      <Card
        title="By category"
        right={<span style={{ fontSize: '0.75rem', color: colors.muted }}>Premium and commission split by product category</span>}
      >
        {kpiFail ? (
          <SameFailureNote />
        ) : (
          <LiveState
            loading={kpiLoading}
            failure={null}
            empty={!kpi?.by_category || kpi.by_category.length === 0}
            emptyTitle={kpi ? 'No category split to show' : 'No data'}
            emptyNote="A split appears once at least one policy exists. The API reported no per-category rows."
          >
            <BreakdownTable rows={kpi?.by_category ?? []} firstColumn="Category" />
          </LiveState>
        )}
      </Card>

      <Card title="By underwriter" right={<span style={{ fontSize: '0.75rem', color: colors.muted }}>Who actually carries the risk</span>}>
        {kpiFail ? (
          <SameFailureNote />
        ) : (
          <LiveState
            loading={kpiLoading}
            failure={null}
            empty={!kpi?.by_underwriter || kpi.by_underwriter.length === 0}
            emptyTitle={kpi ? 'No underwriter split to show' : 'No data'}
            emptyNote="A split appears once at least one policy exists. The API reported no per-underwriter rows."
          >
            <BreakdownTable rows={kpi?.by_underwriter ?? []} firstColumn="Underwriter" />
          </LiveState>
        )}
      </Card>

      <Card
        title="Catalog readiness"
        right={
          <Link href="/admin/insurance/catalog" style={{ fontSize: '0.8rem', color: colors.primary, textDecoration: 'none', fontWeight: 600 }}>
            Open catalog →
          </Link>
        }
      >
        {catFail ? (
          <EndpointErrorCard failure={catFail} onRetry={loadCatalog} />
        ) : catLoading ? (
          <p style={{ color: colors.muted, fontSize: '0.9rem' }}>Loading from the live API…</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem' }}>
            <MetricTile label="Products stored" value={n(catalog?.products.length ?? null)} sub="In our database" />
            <MetricTile label="Active" value={n(activeProducts)} sub="Sellable right now" accent={colors.success} />
            <MetricTile
              label="At the provider"
              value={n(catalog?.sync?.provider_count ?? null)}
              sub="Reported by MyCover"
            />
            <MetricTile
              label="Last sync"
              value={catalog?.sync?.last_synced_at ? fmtDate(catalog.sync.last_synced_at) : null}
              sub={catalog?.sync?.last_sync_error ? 'Last sync reported an error' : undefined}
              accent={catalog?.sync?.last_sync_error ? colors.danger : undefined}
            />
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * The category and underwriter splits come from the SAME /dashboard call as the
 * Book card, so when that call fails all three cards would otherwise render the
 * identical error box three times. Three copies of one failure reads as three
 * problems and buries the one real message, so the dependent cards point at it
 * instead — while still saying plainly that nothing is being substituted.
 */
function SameFailureNote() {
  return (
    <p style={{ color: colors.muted, fontSize: '0.85rem', margin: 0, lineHeight: 1.5 }}>
      Unavailable for the same reason as <strong>Book</strong> above — this split comes from the same
      request. Nothing is shown in its place.
    </p>
  );
}

function BreakdownTable({ rows, firstColumn }: { rows: DashboardBreakdown[]; firstColumn: string }) {
  const money = (v: number | null | undefined) => (v === null || v === undefined ? <NotReported /> : formatNaira(v));
  const n = (v: number | null | undefined) => (v === null || v === undefined ? <NotReported /> : v.toLocaleString('en-NG'));
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th()}>{firstColumn}</th>
            <th style={th()}>Policies</th>
            <th style={th()}>Gross premium</th>
            <th style={th()}>Our commission</th>
            <th style={th()}>Claims</th>
            <th style={th()}>Claims paid</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td style={td()}>{r.key}</td>
              <td style={td()}>{n(r.policies)}</td>
              <td style={td()}>{money(r.gross_premium_kobo)}</td>
              <td style={{ ...td(), color: colors.success, fontWeight: 600 }}>{money(r.commission_kobo)}</td>
              <td style={td()}>{n(r.claims)}</td>
              <td style={td()}>{money(r.claims_paid_kobo)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
