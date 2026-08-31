'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  getProviders,
  getCatalog,
  resetProviderFloat,
  floatSeverity,
  sellabilityOf,
  blockedReason,
} from '@/services/insuranceAdminService';
import type { InsuranceProduct, ProviderStatus, ProvidersReport } from '@/types/insuranceAdmin';
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
  EndpointErrorCard,
  th,
  td,
  input,
  label,
  toFailure,
  type EndpointFailure,
  btn,
  btnPrimary,
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
 * Provider rails: whether we can transact at all.
 *
 * Three independent things can each stop a sale, and the page keeps them
 * separate because they have different fixes:
 *   1. the prefunded float breaker → a treasury action at the provider,
 *   2. per-product purchasability → a provider-side misconfiguration to raise
 *      with MyCover support,
 *   3. webhook signature verification → a signing secret we do not have.
 *
 * The webhook block is deliberately pessimistic. A green "verified" tick next to
 * a webhook whose shared secret is unset would tell an operator that
 * provider-pushed policy and claim updates are authenticated when any unsigned
 * caller would be indistinguishable from the provider. Unset reads as a warning;
 * UNKNOWN reads as unknown — never as a pass.
 */
export default function InsuranceProvidersPage() {
  const [data, setData] = useState<ProvidersReport | null>(null);
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

  const adapters = data?.adapters ?? [];
  const mycover = adapters.find((p) => p.provider === 'mycover') ?? adapters[0] ?? null;
  const primaryFloat = mycover?.float ?? data?.floats?.[0] ?? null;

  // The backend's top-level binding_paused is the launch gate and wins over any
  // per-rail derivation — the console must not quietly disagree with it.
  const severity = loading
    ? 'ok'
    : failure
      ? 'unknown'
      : data?.binding_paused === true
        ? 'empty'
        : floatSeverity(primaryFloat);

  const anySecretMissing = adapters.some((p) => p.webhook?.secret_configured === false);
  const anySecretUnknown = adapters.some((p) => !p.webhook || p.webhook.secret_configured === null);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Provider rails"
        subtitle="Whether we can transact: the prefunded float breaker, credential and environment, which products the provider can actually sell, and whether inbound webhooks can be verified."
        action={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Link href="/admin/insurance/providers/webhooks" style={{ ...btn(), textDecoration: 'none' }}>Webhook deliveries</Link>
            <button onClick={load} style={btn()}>Refresh</button>
          </div>
        }
      />
      <InsuranceTabs active="providers" />

      <FloatAlarm
        severity={severity}
        reason={data?.binding_paused_reason ?? null}
        failures={primaryFloat?.consecutive_failures ?? null}
        providerLabel={mycover?.display_name || mycover?.provider || 'MyCover'}
      />

      {(anySecretMissing || anySecretUnknown || failure) && (
        <WarningNote title="Webhook signature verification is not proven">
          {anySecretMissing ? (
            <>
              A rail below reports <strong>no webhook signing secret configured</strong>. Verification fails
              closed, so every inbound provider event is rejected — policy activations and claim decisions
              pushed by the provider are not reaching us at all. This needs a real signing secret from
              MyCover; it is shown as a warning, never as a green check.
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

      {data?.last_sync ? (
        <Card title="Last catalog sync" right={<Link href="/admin/insurance/catalog" style={{ fontSize: '0.8rem', color: colors.primary, textDecoration: 'none', fontWeight: 600 }}>Catalog →</Link>}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem' }}>
            <MetricTile label="Status" value={data.last_sync.status ?? null} accent={data.last_sync.status === 'ok' || data.last_sync.status === 'success' ? colors.success : colors.warning} />
            <MetricTile label="Seen" value={data.last_sync.products_seen?.toLocaleString('en-NG') ?? null} sub="At the provider" />
            <MetricTile label="Stored" value={data.last_sync.products_upserted?.toLocaleString('en-NG') ?? null} sub="Written to our DB" accent={colors.success} />
            <MetricTile label="Failed" value={data.last_sync.products_failed?.toLocaleString('en-NG') ?? null} accent={data.last_sync.products_failed ? colors.danger : undefined} />
            <MetricTile label="With form schema" value={data.last_sync.products_with_schema?.toLocaleString('en-NG') ?? null} sub="Sellable through the app" />
            <MetricTile label="Finished" value={data.last_sync.finished_at ? timeAgo(data.last_sync.finished_at) : null} sub={data.last_sync.finished_at ? fmtDate(data.last_sync.finished_at) : undefined} />
          </div>
          {data.last_sync.error_text ? (
            <p style={{ marginTop: '0.75rem', marginBottom: 0, fontSize: '0.8rem', color: colors.danger }}>
              Sync error: <code style={{ fontSize: '0.75rem' }}>{data.last_sync.error_text}</code>
            </p>
          ) : null}
        </Card>
      ) : null}

      <LiveState
        loading={loading}
        failure={failure}
        empty={adapters.length === 0}
        emptyTitle="No provider rails reported"
        emptyNote="The endpoint answered but listed no adapters. Nothing is inferred about MyCover's state from that silence."
        onRetry={load}
      >
        {adapters.map((p) => (
          <ProviderCard key={p.provider} p={p} onChanged={load} />
        ))}
      </LiveState>

      <SellabilityCard />
    </div>
  );
}

function ProviderCard({ p, onChanged }: { p: ProviderStatus; onChanged: () => void }) {
  const [resetting, setResetting] = useState(false);
  const [note, setNote] = useState('');
  const [showReset, setShowReset] = useState(false);
  const [resetFail, setResetFail] = useState<EndpointFailure | null>(null);
  const [resetOk, setResetOk] = useState(false);

  const live = p.mode === 'live';
  const severity = floatSeverity(p.float);

  /** Real POST to the reset endpoint. No optimistic flip — the card reloads from
   *  the server, so it can never show a breaker state the backend does not hold. */
  async function doReset() {
    setResetting(true);
    setResetFail(null);
    setResetOk(false);
    try {
      await resetProviderFloat(p.provider, note.trim());
      setResetOk(true);
      setShowReset(false);
      setNote('');
      onChanged();
    } catch (e) {
      setResetFail(toFailure(e));
    } finally {
      setResetting(false);
    }
  }

  return (
    <Card
      title={p.display_name || p.provider}
      right={
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <TriBadge value={p.reachable} onLabel="Reachable" offLabel="Unreachable" unknownLabel="Reachability unknown" />
          <span
            style={{
              fontSize: '0.72rem',
              fontWeight: 700,
              borderRadius: 9999,
              padding: '0.1rem 0.55rem',
              color: live ? colors.danger : p.mode === 'test' ? colors.info : colors.muted,
              background: tint(live ? colors.danger : colors.info, 0.12),
            }}
            title={
              live
                ? 'Real policies and real money.'
                : p.mode === 'test'
                  ? 'Sandbox credentials — nothing bought here is a real policy.'
                  : 'The API does not report the environment: it is determined by the API-key prefix, which is deliberately never exposed.'
            }
          >
            {p.mode === 'live' ? 'LIVE' : p.mode === 'test' ? 'TEST' : 'environment unknown'}
          </span>
        </div>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14, marginBottom: 16 }}>
        <Field label="Base URL">{p.base_url ? <code style={codeStyle}>{p.base_url}</code> : <NotReported />}</Field>
        <Field label="API key">
          {p.api_key_configured === false ? (
            <span style={{ color: colors.danger, fontWeight: 600 }}>not configured</span>
          ) : p.api_key_configured === true ? (
            <span style={{ color: colors.success }}>configured</span>
          ) : (
            <NotReported />
          )}
        </Field>
        <Field label="Environment">
          {p.mode ? (
            p.mode
          ) : (
            <NotReported hint="Not reported. The environment is carried in the API-key prefix, which the API never exposes — so it is shown as unknown rather than assumed to be test." />
          )}
        </Field>
        <Field label="Purchase families">
          {p.purchase_families === null || p.purchase_families === undefined ? <NotReported /> : `${p.purchase_families} routed`}
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
      </div>

      <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 12, marginBottom: 16 }}>
        <div style={{ ...dt, marginBottom: 8 }}>Prefunded float (circuit breaker)</div>
        {resetOk ? (
          <div style={{ border: `1px solid ${colors.success}`, background: '#f0fdf4', color: '#166534', borderRadius: '0.4rem', padding: '0.5rem 0.7rem', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
            Breaker reset. The next bind will attempt the provider again — if the wallet was not actually
            funded it will trip straight back, which is the safe failure.
          </div>
        ) : null}
        {resetFail ? (
          <div style={{ marginBottom: '0.75rem' }}>
            <EndpointErrorCard failure={resetFail} onRetry={doReset} />
          </div>
        ) : null}
        <FloatPanel float={p.float ?? null} severity={severity} onReset={p.float ? () => setShowReset((v) => !v) : undefined} />
        {showReset ? (
          <div style={{ marginTop: '0.8rem', border: `1px solid ${colors.border}`, borderRadius: '0.4rem', padding: '0.75rem' }}>
            <p style={{ fontSize: '0.8rem', color: colors.text, marginTop: 0, lineHeight: 1.55 }}>
              Only reset this <strong>after</strong> topping the wallet up at the provider. The note is a
              human record of what was funded — it is not an authority on the balance, and resetting without
              funding simply means the next bind trips the breaker again.
            </p>
            <label style={label()}>What did you fund? (recorded with the reset)</label>
            <input style={input()} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. ₦500,000 funded via MyCover dashboard, ref 12345" />
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
              <button onClick={doReset} disabled={resetting || !note.trim()} style={{ ...btnPrimary(), opacity: resetting || !note.trim() ? 0.5 : 1 }}>
                {resetting ? 'Resetting…' : 'Reset breaker'}
              </button>
              <button onClick={() => setShowReset(false)} style={btn()}>Cancel</button>
            </div>
          </div>
        ) : null}
      </div>

      <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 12 }}>
        <div style={{ ...dt, marginBottom: 8 }}>Webhooks</div>
        {p.webhook ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
            <Field label="Signing secret">
              {p.webhook.secret_configured === true ? (
                <Badge status="active" label="configured" />
              ) : p.webhook.secret_configured === false ? (
                <span style={{ color: colors.danger, fontWeight: 700 }}>NOT SET — signatures cannot be verified</span>
              ) : (
                <NotReported hint="The API did not report whether a signing secret is configured. Absence of a report is not a pass." />
              )}
            </Field>
            <Field label="Verification">
              {p.webhook.verification_enabled === true ? (
                <Badge status="active" label="enabled" />
              ) : p.webhook.verification_enabled === false ? (
                <span style={{ color: colors.danger, fontWeight: 700 }}>fails closed — every event rejected</span>
              ) : (
                <NotReported />
              )}
            </Field>
            <Field label="Endpoint">{p.webhook.url ? <code style={codeStyle}>{p.webhook.url}</code> : <NotReported />}</Field>
            <Field label="Last received">
              {p.webhook.last_received_at ? timeAgo(p.webhook.last_received_at) : <span style={{ color: colors.muted, fontSize: 12 }}>never, or not reported</span>}
            </Field>
          </div>
        ) : (
          <p style={{ color: colors.muted, fontSize: '0.85rem', margin: 0 }}>
            The API reported no webhook configuration for this rail. That is not evidence webhooks are
            healthy — it is an absence of information.
          </p>
        )}
        {p.webhook?.note ? (
          <p style={{ fontSize: '0.78rem', color: colors.muted, marginTop: '0.7rem', marginBottom: 0, lineHeight: 1.5 }}>{p.webhook.note}</p>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * Which products can actually be bought.
 *
 * Read LIVE from the catalog's provider-capability columns, not from a local
 * table. An earlier version of this card listed v1 "purchase family" paths and
 * their 403s; MyCover v2 exposes one shared buy endpoint plus a per-product
 * schema, so that model no longer describes the blocker. A console repeating a
 * superseded constraint is as misleading as one showing invented numbers, so
 * the table went rather than being kept as a fallback.
 *
 * `purchasable` is the PROVIDER's capability and is deliberately distinct from
 * `active`, our own decision to offer something. The dangerous combination —
 * active but not purchasable — is called out on its own.
 */
function SellabilityCard() {
  const [products, setProducts] = useState<InsuranceProduct[] | null>(null);
  const [failure, setFailure] = useState<EndpointFailure | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    try {
      setProducts((await getCatalog()).products);
    } catch (e) {
      setProducts(null);
      setFailure(toFailure(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const list = products ?? [];
  const blocked = list.filter((p) => sellabilityOf(p) === 'blocked');
  const sellable = list.filter((p) => sellabilityOf(p) === 'sellable');
  const unknown = list.filter((p) => sellabilityOf(p) === 'unknown');
  // Active but not purchasable: we are offering something the provider cannot
  // actually sell. That is the pairing that reaches a customer as a dead end.
  const offeredButBroken = list.filter((p) => p.active && sellabilityOf(p) !== 'sellable');

  return (
    <Card
      title="What we can actually sell"
      right={<button onClick={load} style={btn()}>Refresh</button>}
    >
      {failure ? (
        <EndpointErrorCard failure={failure} onRetry={load} />
      ) : loading ? (
        <p style={{ color: colors.muted, fontSize: '0.9rem' }}>Loading from the live API…</p>
      ) : (
        <>
          {offeredButBroken.length > 0 ? (
            <WarningNote title={`${offeredButBroken.length} product${offeredButBroken.length === 1 ? ' is' : 's are'} offered but not purchasable`}>
              These are switched on in our catalog while the provider cannot sell them. A customer who picks
              one reaches a dead end. Either deactivate them here, or raise the provider-side
              misconfiguration with MyCover support.
            </WarningNote>
          ) : null}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
            <MetricTile label="Purchasable" value={sellable.length.toLocaleString('en-NG')} sub="Provider can sell these" accent={colors.success} />
            <MetricTile label="Blocked at the provider" value={blocked.length.toLocaleString('en-NG')} sub="Misconfigured on their side" accent={blocked.length ? colors.danger : undefined} />
            <MetricTile label="Not yet verified" value={unknown.length.toLocaleString('en-NG')} sub="Never synced — no verdict either way" accent={unknown.length ? colors.warning : undefined} />
            <MetricTile label="Offered but broken" value={offeredButBroken.length.toLocaleString('en-NG')} sub="Active here, unsellable there" accent={offeredButBroken.length ? colors.danger : undefined} />
          </div>

          {blocked.length === 0 && unknown.length === 0 ? (
            <p style={{ color: colors.success, fontSize: '0.85rem', margin: 0 }}>
              Every product in the catalog is reported purchasable by the provider.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th()}>Product</th>
                    <th style={th()}>Underwriter</th>
                    <th style={th()}>Offered by us</th>
                    <th style={th()}>Provider status</th>
                    <th style={th()}>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {[...blocked, ...unknown].map((p) => (
                    <tr key={p.code}>
                      <td style={td()}>
                        <Link href={`/admin/insurance/catalog/${encodeURIComponent(p.code)}`} style={{ color: colors.primary, fontWeight: 600, textDecoration: 'none' }}>
                          {p.name || p.code}
                        </Link>
                        <div style={{ fontSize: '0.68rem', color: colors.muted }}><code>{p.code}</code></div>
                      </td>
                      <td style={td()}>{p.underwriter || <NotReported />}</td>
                      <td style={td()}>
                        <Badge status={p.active ? 'active' : 'inactive'} label={p.active ? 'Active' : 'Inactive'} />
                      </td>
                      <td style={td()}>
                        <Badge
                          status={sellabilityOf(p) === 'blocked' ? 'rejected' : 'pending'}
                          label={p.provider_config_status || 'unknown'}
                        />
                      </td>
                      <td style={{ ...td(), fontSize: '0.78rem', color: colors.muted, maxWidth: 360 }}>{blockedReason(p)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p style={{ fontSize: '0.78rem', color: colors.muted, marginBottom: 0, marginTop: '0.85rem', lineHeight: 1.55 }}>
            <strong>Purchasable</strong> is the provider&rsquo;s capability, recorded per product by the catalog
            sync; <strong>active</strong> is our own decision to offer it. They are tracked separately on
            purpose, and a sync may overwrite the first but never the second. Products that have never been
            synced carry no verdict and are counted as unverified rather than as broken.
          </p>
        </>
      )}
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
