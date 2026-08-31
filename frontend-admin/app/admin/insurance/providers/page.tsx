'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  getProviders,
  formatNaira,
  floatSeverity,
  policiesRemaining,
  FAMILY_PROBES,
  FAMILY_PROBE_DATE,
} from '@/services/insuranceAdminService';
import type { ProviderStatus } from '@/types/insuranceAdmin';
import {
  PageHeader,
  InsuranceTabs,
  Card,
  Badge,
  NotReported,
  LiveState,
  WarningNote,
  FloatAlarm,
  FloatPanel,
  MetricTile,
  th,
  td,
  toFailure,
  type EndpointFailure,
  btn,
  timeAgo,
  fmtDate,
} from '../_ui';
import { colors, tint } from '@/components/ui/vuexy';

const dt: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.3,
  color: colors.muted,
  fontWeight: 600,
  marginBottom: 3,
};
const codeStyle: React.CSSProperties = {
  fontSize: 12,
  background: colors.headBg,
  padding: '0.1rem 0.35rem',
  borderRadius: 4,
  wordBreak: 'break-all',
};

/**
 * Provider rails: which MyCover environment we are pointed at, whether the
 * adapter is actually reaching it, and whether inbound webhooks can be trusted.
 *
 * The webhook block is deliberately pessimistic. A green "verified" tick next to
 * a webhook whose shared secret is unset is the worst possible render: it tells
 * an operator that provider-pushed policy and claim updates are authenticated
 * when in fact any unsigned caller would be indistinguishable from the provider.
 * So an unset secret is shown as a warning, and an UNKNOWN secret is shown as
 * unknown — never as a pass.
 */
export default function InsuranceProvidersPage() {
  const [data, setData] = useState<ProviderStatus[] | null>(null);
  const [failure, setFailure] = useState<EndpointFailure | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    try {
      setData(await getProviders());
    } catch (e) {
      setData(null);
      setFailure(toFailure(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Float severity across every rail: the worst one wins, because a healthy
  // second rail does not make an empty first rail sellable.
  const mycover = (data ?? []).find((p) => p.provider === 'mycover') ?? (data ?? [])[0] ?? null;
  const worstSeverity = loading
    ? 'ok'
    : (data ?? []).reduce<'unknown' | 'empty' | 'critical' | 'ok'>((worst, p) => {
        const s = floatSeverity(p.float);
        const rank = { empty: 3, critical: 2, unknown: 1, ok: 0 } as const;
        return rank[s] > rank[worst] ? s : worst;
      }, failure ? 'unknown' : 'ok');

  const anySecretMissing = (data ?? []).some((p) => p.webhook?.secret_configured === false);
  const anySecretUnknown = (data ?? []).some((p) => p.webhook && p.webhook.secret_configured === null);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Provider rails"
        subtitle="Adapter health, the MyCover environment we are actually pointed at, the last successful call, and whether inbound webhooks can be verified."
        action={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Link href="/admin/insurance/providers/webhooks" style={{ ...btn(), textDecoration: 'none' }}>Webhook deliveries</Link>
            <button onClick={load} style={btn()}>Refresh</button>
          </div>
        }
      />
      <InsuranceTabs active="providers" />

      <FloatAlarm
        severity={worstSeverity}
        balanceLabel={null}
        remaining={null}
        providerLabel={mycover?.display_name || 'MyCover'}
      />

      {(anySecretMissing || anySecretUnknown || failure) && (
        <WarningNote title="Webhook signature verification is not proven">
          {anySecretMissing ? (
            <>
              A rail below reports <strong>no webhook signing secret configured</strong>. Until one is set,
              signature verification cannot pass, so provider-pushed policy and claim updates either fail
              closed or are accepted unverified — neither is a state to run money on. This is shown as a
              warning, never as a green check.
            </>
          ) : (
            <>
              The signing-secret state could not be read from the API, so this console will not claim
              webhooks are verified. As of the last environment check{' '}
              <code style={{ fontSize: '0.75rem' }}>INSURANCE_MYCOVER_WEBHOOK_SECRET</code> was empty, which
              means signature verification cannot pass. Treat inbound webhooks as untrusted until the API
              reports a configured secret here.
            </>
          )}
        </WarningNote>
      )}

      <LiveState
        loading={loading}
        failure={failure}
        empty={!data || data.length === 0}
        emptyTitle="No provider rails reported"
        emptyNote="The endpoint answered but listed no providers. Nothing is inferred about MyCover's state from that silence."
        onRetry={load}
      >
        {(data ?? []).map((p) => (
          <ProviderCard key={p.provider} p={p} />
        ))}
      </LiveState>

      <SellabilityCard />
    </div>
  );
}

/**
 * Which purchase families we can actually transact against.
 *
 * MyCover exposes one purchase endpoint per product FAMILY, and two of them
 * refuse our credential outright. Those products cannot be sold even after the
 * float is funded — a funded wallet and a scoped-out key are separate blockers,
 * and an operator who fixes one will still be stuck on the other.
 *
 * This is a record of a live probe with its date, not a live reading, and it is
 * labelled that way. It is also NOT joined against the catalog by guessing: a
 * family path cannot be derived from a product's name or route_name (MyCover's
 * family names are their own namespace), so the mapping has to come from the
 * stored buy path per product. Inferring it here would produce a confident,
 * wrong answer about what is sellable.
 */
function SellabilityCard() {
  const blocked = FAMILY_PROBES.filter((f) => !f.sellable);
  return (
    <Card
      title="What we can actually sell"
      right={<span style={{ fontSize: '0.75rem', color: colors.muted }}>probed {FAMILY_PROBE_DATE}</span>}
    >
      {blocked.length > 0 ? (
        <WarningNote title={`${blocked.length} purchase families are scope-blocked for our API key`}>
          {blocked.map((f) => f.path).join(' and ')} return <strong>403 Forbidden</strong>. Every product in
          those families is unsellable regardless of the float balance — this needs a scope change on the
          MyCover account, not a top-up. Both are Life products, so the Life category is effectively closed
          to us today.
        </WarningNote>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
        <MetricTile label="Families reachable" value={String(FAMILY_PROBES.length - blocked.length)} accent={colors.success} />
        <MetricTile label="Scope-blocked" value={String(blocked.length)} accent={blocked.length ? colors.danger : undefined} sub="403 for our key" />
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th()}>Purchase family</th>
              <th style={th()}>Category</th>
              <th style={th()}>Result</th>
              <th style={th()}>Detail</th>
            </tr>
          </thead>
          <tbody>
            {FAMILY_PROBES.map((f) => (
              <tr key={f.path}>
                <td style={td()}><code style={{ fontSize: '0.76rem' }}>/products/{f.path}</code></td>
                <td style={td()}>{f.category}</td>
                <td style={td()}>
                  <Badge status={f.sellable ? 'active' : 'rejected'} label={f.sellable ? 'reachable' : 'scope-blocked'} />
                </td>
                <td style={{ ...td(), fontSize: '0.78rem', color: colors.muted }}>{f.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: '0.78rem', color: colors.muted, marginBottom: 0, marginTop: '0.85rem', lineHeight: 1.55 }}>
        These are the results of a direct probe on {FAMILY_PROBE_DATE}, not a live reading, and they are not
        joined to individual products here. A family path cannot be derived from a product&rsquo;s name or
        route — <code style={{ fontSize: '0.72rem' }}>/products/bastion/buy-medisure</code> is live although no
        catalog product is called &ldquo;MediSure&rdquo; — so per-product sellability only becomes reliable once the
        backend stores each product&rsquo;s buy path. Guessing the mapping here would be confidently wrong.
      </p>
    </Card>
  );
}

function ProviderCard({ p }: { p: ProviderStatus }) {
  const live = p.mode === 'live';
  const reachable = p.reachable;
  return (
    <Card
      title={p.display_name || p.provider}
      right={
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <TriBadge
            value={reachable}
            onLabel="Reachable"
            offLabel="Unreachable"
            unknownLabel="Reachability unknown"
          />
          <span
            style={{
              fontSize: '0.72rem',
              fontWeight: 700,
              borderRadius: 9999,
              padding: '0.1rem 0.55rem',
              color: live ? colors.danger : colors.info,
              background: tint(live ? colors.danger : colors.info, 0.12),
            }}
            title={live ? 'Real policies and real money.' : 'Sandbox credentials — nothing bought here is a real policy.'}
          >
            {p.mode === 'live' ? 'LIVE' : p.mode === 'test' ? 'TEST' : 'mode unknown'}
          </span>
        </div>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14, marginBottom: 16 }}>
        <Field label="Base URL">
          {p.base_url ? <code style={codeStyle}>{p.base_url}</code> : <NotReported />}
        </Field>
        <Field label="API key">
          {p.api_key_configured === false ? (
            <span style={{ color: colors.danger, fontWeight: 600 }}>not configured</span>
          ) : p.api_key_hint ? (
            <code style={codeStyle}>{p.api_key_hint}</code>
          ) : p.api_key_configured === true ? (
            <span style={{ color: colors.success }}>configured</span>
          ) : (
            <NotReported />
          )}
        </Field>
        <Field label="Last successful call">
          {p.last_success_at ? (
            <>
              {timeAgo(p.last_success_at)}
              <div style={{ fontSize: 11, color: colors.muted }}>{fmtDate(p.last_success_at)}</div>
            </>
          ) : (
            <NotReported hint="No successful provider call has been recorded." />
          )}
        </Field>
        <Field label="Last error">
          {p.last_error ? (
            <>
              <span style={{ color: colors.danger, fontSize: 12 }}>{p.last_error}</span>
              <div style={{ fontSize: 11, color: colors.muted }}>{p.last_error_at ? timeAgo(p.last_error_at) : ''}</div>
            </>
          ) : (
            <span style={{ color: colors.muted, fontSize: 12 }}>none reported</span>
          )}
        </Field>
        <Field label="Latency">
          {p.latency_ms === null || p.latency_ms === undefined ? <NotReported /> : `${p.latency_ms.toLocaleString('en-NG')} ms`}
        </Field>
        <Field label="Products synced">
          {p.products_synced === null || p.products_synced === undefined ? <NotReported /> : p.products_synced.toLocaleString('en-NG')}
        </Field>
      </div>

      <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 12, marginBottom: 16 }}>
        <div style={{ ...dt, marginBottom: 8 }}>Prefunded float</div>
        <FloatPanel
          float={p.float ?? null}
          severity={floatSeverity(p.float)}
          formatMoney={formatNaira}
          remaining={policiesRemaining(p.float)}
        />
      </div>

      <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 12 }}>
        <div style={{ ...dt, marginBottom: 8 }}>Webhooks</div>
        {p.webhook ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
            <Field label="Endpoint">
              {p.webhook.url ? <code style={codeStyle}>{p.webhook.url}</code> : <NotReported />}
            </Field>
            <Field label="Signing secret">
              {p.webhook.secret_configured === true ? (
                <Badge status="active" label="configured" />
              ) : p.webhook.secret_configured === false ? (
                <span style={{ color: colors.danger, fontWeight: 700 }}>
                  NOT SET — signatures cannot be verified
                </span>
              ) : (
                <NotReported hint="The API did not report whether a signing secret is configured. Absence of a report is not a pass." />
              )}
            </Field>
            <Field label="Scheme">{p.webhook.signature_scheme || <NotReported />}</Field>
            <Field label="Last received">
              {p.webhook.last_received_at ? timeAgo(p.webhook.last_received_at) : <span style={{ color: colors.muted, fontSize: 12 }}>never</span>}
            </Field>
            <Field label="Last verified">
              {p.webhook.last_verified_at ? (
                timeAgo(p.webhook.last_verified_at)
              ) : (
                <span style={{ color: colors.warning, fontSize: 12, fontWeight: 600 }}>no webhook has ever verified</span>
              )}
            </Field>
            <Field label="Last 24h">
              {p.webhook.received_24h === null || p.webhook.received_24h === undefined ? (
                <NotReported />
              ) : (
                <>
                  {p.webhook.received_24h.toLocaleString('en-NG')} received
                  {p.webhook.rejected_24h ? (
                    <span style={{ color: colors.danger }}> · {p.webhook.rejected_24h.toLocaleString('en-NG')} rejected</span>
                  ) : null}
                </>
              )}
            </Field>
          </div>
        ) : (
          <p style={{ color: colors.muted, fontSize: '0.85rem', margin: 0 }}>
            The API reported no webhook configuration for this rail. That is not evidence webhooks are
            healthy — it is an absence of information.
          </p>
        )}
      </div>
    </Card>
  );
}

/** Three-state indicator: true / false / genuinely unknown. Unknown is never green. */
function TriBadge({ value, onLabel, offLabel, unknownLabel }: { value: boolean | null | undefined; onLabel: string; offLabel: string; unknownLabel: string }) {
  if (value === true) return <Badge status="healthy" label={onLabel} />;
  if (value === false) return <Badge status="down" label={offLabel} />;
  return (
    <span style={{ fontSize: '0.72rem', fontWeight: 600, borderRadius: 9999, padding: '0.1rem 0.55rem', color: colors.muted, border: `1px dashed ${colors.border}` }}>
      {unknownLabel}
    </span>
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
