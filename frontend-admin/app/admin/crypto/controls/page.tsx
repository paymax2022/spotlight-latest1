'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ControlsConflictError, getControls, normaliseControlsUpdate, updateControls, validateControlsUpdate } from '@/services/cryptoOpsService';
import type { CryptoBanner, CryptoBannerSeverity, CryptoControlsResponse, CryptoControlsUpdate, CryptoControlsVersion } from '@/types/cryptoAdmin';
import {
  CryptoTabs, StateBlock, DisclosureNote, AuditNote, PermissionBanner,
  fmtDate, label as lbl, textarea, input as inputStyle, CRYPTO_PERMS, useCryptoPermission,
} from '../_ui';
import { Page, PageHeader, Card, Button, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

// Operational controls: the circuit breakers ops reach for in an incident (workplan
// QDX-ADM-004/005/007/017). Every change is a new audited version with a reason, reviewed as a
// before/after list first; a stale page reloads instead of overwriting someone else's change.

const naira = (kobo: number) => `₦${Math.round(kobo / 100).toLocaleString('en-NG')}`;

function toDraft(v: CryptoControlsVersion, ceiling: number): CryptoControlsUpdate {
  return {
    expected_version: v.version,
    trading_paused: v.trading_paused,
    withdrawals_paused: v.withdrawals_paused,
    disabled_assets: [...v.disabled_assets],
    max_quote_kobo: v.max_quote_kobo >= ceiling ? 0 : v.max_quote_kobo,
    banner: v.banner ? { ...v.banner } : null,
    reason: '',
  };
}

const limitText = (v: CryptoControlsVersion, ceiling: number) => (v.max_quote_kobo >= ceiling ? '' : String(v.max_quote_kobo / 100));

const SEVERITY_STYLE: Record<CryptoBannerSeverity, { fg: string; bg: string; label: string }> = {
  info: { fg: colors.info, bg: tint(colors.info, 0.1), label: 'Information' },
  warning: { fg: colors.warning, bg: tint(colors.warning, 0.12), label: 'Warning' },
  critical: { fg: colors.danger, bg: tint(colors.danger, 0.1), label: 'Critical' },
};

/** The banner as customers see it at the top of the app's crypto screens. */
function BannerPreview({ banner }: { banner: CryptoBanner }) {
  const s = SEVERITY_STYLE[banner.severity];
  return (
    <div data-testid="banner-preview" style={{ borderLeft: `4px solid ${s.fg}`, background: s.bg, color: s.fg, borderRadius: '0.375rem', padding: '0.6rem 0.8rem', fontSize: '0.85rem', fontWeight: 600 }}>
      {banner.message || 'Your message appears here.'}
    </div>
  );
}

function Breaker({ id, title, halted, liveText, haltedText, actionHalt, actionResume, onToggle, disabled, pending }: {
  id: string; title: string; halted: boolean; liveText: string; haltedText: string;
  actionHalt: string; actionResume: string; onToggle: () => void; disabled: boolean; pending: boolean;
}) {
  const fg = halted ? colors.danger : colors.success;
  return (
    <div data-testid={`breaker-${id}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '1rem', alignItems: 'center', padding: '1rem 1.1rem', borderRadius: '0.5rem', border: `1px solid ${tint(fg, 0.35)}`, background: tint(fg, 0.06) }}>
      <div>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: colors.muted }}>{title}</div>
        <div style={{ fontSize: '1.6rem', fontWeight: 800, color: fg, lineHeight: 1.2 }} aria-live="polite">{halted ? 'Halted' : 'Live'}{pending ? ' (unsaved)' : ''}</div>
        <div style={{ fontSize: '0.82rem', color: colors.text, marginTop: '0.15rem' }}>{halted ? haltedText : liveText}</div>
      </div>
      <Button variant={halted ? 'primary' : 'danger'} disabled={disabled} onClick={onToggle}>{halted ? actionResume : actionHalt}</Button>
    </div>
  );
}

export default function CryptoControlsPage() {
  const { allowed: canAdmin } = useCryptoPermission(CRYPTO_PERMS.admin);
  const [data, setData] = useState<CryptoControlsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState<CryptoControlsUpdate | null>(null);
  const [marketInput, setMarketInput] = useState('');
  const [limitInput, setLimitInput] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await getControls();
      setData(r);
      if (r) {
        setDraft(toDraft(r.current, r.ceiling_kobo));
        setLimitInput(limitText(r.current, r.ceiling_kobo));
      }
      setReviewing(false);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const cur = data?.current;
  const ceiling = data?.ceiling_kobo ?? 0;
  const base = useMemo(() => (cur ? normaliseControlsUpdate(toDraft(cur, ceiling)) : null), [cur, ceiling]);
  const norm = useMemo(() => (draft ? normaliseControlsUpdate(draft) : null), [draft]);

  const diff = useMemo(() => {
    if (!base || !norm) return [] as string[];
    const out: string[] = [];
    if (base.trading_paused !== norm.trading_paused) out.push(norm.trading_paused ? 'Halt all crypto trading (both rails)' : 'Resume crypto trading');
    if (base.withdrawals_paused !== norm.withdrawals_paused) out.push(norm.withdrawals_paused ? 'Turn on the withdrawal kill switch (no new withdrawals or approvals)' : 'Turn off the withdrawal kill switch');
    const off = norm.disabled_assets.filter((a) => !base.disabled_assets.includes(a));
    const on = base.disabled_assets.filter((a) => !norm.disabled_assets.includes(a));
    if (off.length) out.push(`Switch off markets: ${off.join(', ')}`);
    if (on.length) out.push(`Switch on markets: ${on.join(', ')}`);
    if (base.max_quote_kobo !== norm.max_quote_kobo) {
      const show = (k: number) => (k === 0 ? `no extra limit (${naira(ceiling)} ceiling)` : Number.isFinite(k) ? naira(k) : 'invalid');
      out.push(`Per-trade limit: ${show(base.max_quote_kobo)} → ${show(norm.max_quote_kobo)}`);
    }
    if (JSON.stringify(base.banner) !== JSON.stringify(norm.banner)) {
      out.push(norm.banner ? `Show a ${norm.banner.severity} banner: “${norm.banner.message}”` : 'Remove the customer banner');
    }
    return out;
  }, [base, norm, ceiling]);

  const problem = useMemo(() => (draft ? validateControlsUpdate({ ...draft, reason: draft.reason || 'x' }, ceiling) : null), [draft, ceiling]);
  const canReview = canAdmin && diff.length > 0 && !problem && Boolean(draft?.reason.trim()) && !busy;

  const patch = (p: Partial<CryptoControlsUpdate>) => { setDraft((d) => (d ? { ...d, ...p } : d)); setReviewing(false); };
  const toggle = (k: 'trading_paused' | 'withdrawals_paused') => {
    if (!draft) return;
    patch({ [k]: !draft[k] } as Partial<CryptoControlsUpdate>);
    setTimeout(() => reasonRef.current?.focus(), 0); // the reason is the next thing they must give
  };
  const addMarket = () => {
    const a = marketInput.trim().toUpperCase();
    if (!a || !draft) return;
    patch({ disabled_assets: Array.from(new Set([...draft.disabled_assets, a])) });
    setMarketInput('');
  };
  const setLimit = (v: string) => {
    setLimitInput(v);
    const t = v.replace(/[,\s₦]/g, '');
    patch({ max_quote_kobo: t === '' ? 0 : /^\d+$/.test(t) ? Number(t) * 100 : Number.NaN });
  };
  const discard = () => {
    if (!cur) return;
    setDraft(toDraft(cur, ceiling));
    setLimitInput(limitText(cur, ceiling));
    setReviewing(false);
  };

  async function apply() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await updateControls(draft, ceiling);
      await load();
      setMsg(r.created
        ? `Saved as version ${r.current.version}. It applies to new requests immediately, on both trading rails.`
        : `This change was already saved as version ${r.current.version}.`);
    } catch (e) {
      if (e instanceof ControlsConflictError) {
        await load(); // load() clears errors, so the explanation goes up after it
        setError('Someone changed the controls since you loaded them. They have been reloaded: check the current state and make your change again.');
      } else {
        setError(String(e instanceof Error ? e.message : e));
        setReviewing(false);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Crypto — Controls"
        subtitle="Circuit breakers for incidents: pause trading or withdrawals, switch markets off, cap a single trade and tell customers what is happening."
        actions={<Button variant="outline" onClick={() => void load()}>Refresh</Button>}
      />
      <CryptoTabs active="controls" />
      <DisclosureNote>
        Backed by <code>GET/PUT /api/v1/admin/crypto/controls</code> (RBAC <code>crypto.admin</code>). Enforced on the server for
        both the Quidax rail and the legacy book, and fail-closed: if the controls can&apos;t be read, nothing trades or pays out.
        A trading pause stops new quotes and confirms before any money is held. The withdrawal kill switch stops new withdrawals
        and approvals; rejections, which return the customer&apos;s crypto, stay allowed. Every change is a new audited version.
      </DisclosureNote>
      {!canAdmin && <PermissionBanner permission={CRYPTO_PERMS.admin} />}
      {error && <p role="alert" style={{ color: colors.danger }}>{error}</p>}
      {msg && <AuditNote>{msg}</AuditNote>}

      <StateBlock loading={loading && !data} error={null} empty={!loading && !data && !error} emptyText="Controls are unavailable: crypto is not enabled on this environment.">
        {data && cur && draft && base && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Breaker
                id="trading" title="Trading" halted={draft.trading_paused} pending={draft.trading_paused !== base.trading_paused}
                liveText="Customers can buy and sell on both rails." haltedText="No new quotes or confirms. Orders already placed settle normally."
                actionHalt="Halt trading" actionResume="Resume trading" onToggle={() => toggle('trading_paused')} disabled={!canAdmin || busy}
              />
              <Breaker
                id="withdrawals" title="Withdrawals" halted={draft.withdrawals_paused} pending={draft.withdrawals_paused !== base.withdrawals_paused}
                liveText="Customers can withdraw and approved payouts go out." haltedText="No new withdrawals and no approvals. Queued requests wait."
                actionHalt="Turn on kill switch" actionResume="Turn off kill switch" onToggle={() => toggle('withdrawals_paused')} disabled={!canAdmin || busy}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '0 1rem' }}>
              <Card title="Markets switched off">
                <p style={{ fontSize: '0.8rem', color: colors.muted, marginTop: 0 }}>Customers can&apos;t start a buy, sell or swap in these assets. Holdings are untouched.</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.6rem' }} data-testid="disabled-markets">
                  {draft.disabled_assets.length === 0 && <span style={{ fontSize: '0.85rem', color: colors.muted }}>All markets are on.</span>}
                  {draft.disabled_assets.map((a) => (
                    <span key={a} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.2rem 0.3rem 0.2rem 0.6rem', borderRadius: 9999, background: tint(colors.danger, 0.1), color: colors.danger, fontWeight: 700, fontSize: '0.8rem' }}>
                      {a}
                      <button type="button" aria-label={`Switch ${a} back on`} disabled={!canAdmin || busy} onClick={() => patch({ disabled_assets: draft.disabled_assets.filter((x) => x !== a) })}
                        style={{ border: 'none', background: 'transparent', color: colors.danger, cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem', lineHeight: 1 }}>×</button>
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', maxWidth: 360 }}>
                  <input aria-label="Asset to switch off" placeholder="Asset code, e.g. DOGE" style={inputStyle()} disabled={!canAdmin || busy} value={marketInput}
                    onChange={(e) => setMarketInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMarket(); } }} />
                  <Button variant="outline" disabled={!canAdmin || busy || !marketInput.trim()} onClick={addMarket}>Switch off</Button>
                </div>
              </Card>

              <Card title="Per-trade limit">
                <p style={{ fontSize: '0.8rem', color: colors.muted, marginTop: 0 }}>
                  The most a single buy or sell may be worth. Leave it empty for no extra limit; the {naira(ceiling)} ceiling in code still applies.
                </p>
                <label style={lbl()} htmlFor="ctl-limit">Limit in naira</label>
                <input id="ctl-limit" inputMode="numeric" placeholder="No extra limit" style={{ ...inputStyle(), maxWidth: 240 }}
                  disabled={!canAdmin || busy} value={limitInput} onChange={(e) => setLimit(e.target.value)} />
              </Card>
            </div>

            <Card title="Customer banner">
              <p style={{ fontSize: '0.8rem', color: colors.muted, marginTop: 0 }}>Shown at the top of the app&apos;s crypto screens. Say what is affected and when it will be back.</p>
              {draft.banner ? (
                <div style={{ display: 'grid', gap: '0.6rem', maxWidth: 680 }}>
                  <div>
                    <label style={lbl()} htmlFor="ctl-banner">Message ({[...draft.banner.message].length}/280)</label>
                    <textarea id="ctl-banner" maxLength={280} style={textarea()} disabled={!canAdmin || busy} value={draft.banner.message}
                      onChange={(e) => patch({ banner: { ...draft.banner!, message: e.target.value } })} />
                  </div>
                  <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    <legend style={{ ...lbl(), marginBottom: '0.35rem' }}>Severity</legend>
                    {(Object.keys(SEVERITY_STYLE) as CryptoBannerSeverity[]).map((s) => (
                      <label key={s} style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.85rem', cursor: 'pointer' }}>
                        <input type="radio" name="ctl-severity" value={s} checked={draft.banner!.severity === s} disabled={!canAdmin || busy}
                          onChange={() => patch({ banner: { ...draft.banner!, severity: s } })} />
                        {SEVERITY_STYLE[s].label}
                      </label>
                    ))}
                  </fieldset>
                  <BannerPreview banner={{ ...draft.banner, message: draft.banner.message.trim() }} />
                  <div><Button variant="outline" disabled={!canAdmin || busy} onClick={() => patch({ banner: null })}>Remove banner</Button></div>
                </div>
              ) : (
                <Button variant="outline" disabled={!canAdmin || busy} onClick={() => patch({ banner: { message: '', severity: 'warning' } })}>Add a banner</Button>
              )}
            </Card>

            <Card title={diff.length ? `Review ${diff.length} change${diff.length > 1 ? 's' : ''}` : 'No unsaved changes'}>
              {diff.length > 0 && (
                <ul data-testid="controls-diff" style={{ fontSize: '0.88rem', lineHeight: 1.7, paddingLeft: '1.1rem', marginTop: 0 }}>
                  {diff.map((d) => <li key={d}>{d}</li>)}
                </ul>
              )}
              <label style={lbl()} htmlFor="ctl-reason">Reason (required, recorded in the audit log)</label>
              <textarea id="ctl-reason" ref={reasonRef} maxLength={500} style={textarea()} disabled={!canAdmin || busy}
                placeholder="e.g. Quidax incident INC-212: TRC20 withdrawals failing" value={draft.reason}
                onChange={(e) => setDraft((d) => (d ? { ...d, reason: e.target.value } : d))} />
              {diff.length > 0 && problem && <p role="alert" style={{ color: colors.danger, fontSize: '0.8rem' }}>{problem}</p>}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                {reviewing ? (
                  <>
                    <Button variant="primary" disabled={!canReview} onClick={() => void apply()}>{busy ? 'Saving…' : 'Confirm and apply now'}</Button>
                    <Button variant="outline" disabled={busy} onClick={() => setReviewing(false)}>Back</Button>
                  </>
                ) : (
                  <Button variant="primary" disabled={!canReview} onClick={() => setReviewing(true)}>Review change</Button>
                )}
                {diff.length > 0 && !busy && <Button variant="outline" onClick={discard}>Discard changes</Button>}
              </div>
              {reviewing && <p style={{ fontSize: '0.8rem', color: colors.muted }}>Applies immediately to every new request. Version {cur.version} becomes {cur.version + 1}.</p>}
            </Card>

            <Card title="History">
              <StateBlock loading={false} error={null} empty={data.history.length === 0} emptyText="No changes saved yet: everything is open.">
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                    <thead><tr>
                      <th style={thCell}>Version</th><th style={thCell}>Trading</th><th style={thCell}>Withdrawals</th><th style={thCell}>Markets off</th>
                      <th style={thCell}>Limit</th><th style={thCell}>Banner</th><th style={thCell}>By</th><th style={thCell}>When</th><th style={thCell}>Reason</th>
                    </tr></thead>
                    <tbody>
                      {data.history.map((h) => (
                        <tr key={h.version}>
                          <td style={tdCell}>{h.version}</td>
                          <td style={{ ...tdCell, color: h.trading_paused ? colors.danger : colors.success, fontWeight: 600 }}>{h.trading_paused ? 'Halted' : 'Live'}</td>
                          <td style={{ ...tdCell, color: h.withdrawals_paused ? colors.danger : colors.success, fontWeight: 600 }}>{h.withdrawals_paused ? 'Halted' : 'Live'}</td>
                          <td style={tdCell}>{h.disabled_assets.join(', ') || '—'}</td>
                          <td style={tdCell}>{h.max_quote_kobo >= ceiling ? '—' : naira(h.max_quote_kobo)}</td>
                          <td style={tdCell}>{h.banner ? `${h.banner.severity}: ${h.banner.message}` : '—'}</td>
                          <td style={tdCell}>{h.created_by}</td>
                          <td style={tdCell}>{fmtDate(h.created_at)}</td>
                          <td style={tdCell}>{h.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </StateBlock>
            </Card>
          </>
        )}
      </StateBlock>
    </Page>
  );
}
