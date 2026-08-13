'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  listPromotions, getPromotion, registerStrategy, setReadiness,
  promoteStrategy, demoteStrategy, haltStrategy,
} from '@/services/tradingAdminService';
import type { StrategyPromotion, PromotionEvent, TradingStage } from '@/types/tradingAdmin';
import { nextStage, allowsRealCapital } from '@/types/tradingAdmin';
import {
  PageHeader, TradingTabs, Card, StateBlock, DisclosureNote, AuditNote, PermissionBanner,
  StageBadge, btn, btnPrimary, btnDanger, btnDisabled, th, td, input, label, textarea,
  fmtDate, timeAgo, TRADING_PERMS, useTradingPermission, useCurrentAdminId,
} from '../_ui';

export default function PromotionLadderPage() {
  const { allowed: canRead } = useTradingPermission(TRADING_PERMS.promoRead);
  const { allowed: canPropose } = useTradingPermission(TRADING_PERMS.promoPropose);
  const { allowed: canApprove } = useTradingPermission(TRADING_PERMS.promoApprove);
  const { allowed: canHalt } = useTradingPermission(TRADING_PERMS.promoHalt);
  const { allowed: canRisk } = useTradingPermission(TRADING_PERMS.promoRisk);

  const [rows, setRows] = useState<StrategyPromotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [newId, setNewId] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await listPromotions()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function doRegister() {
    if (!newId.trim()) { setError('Enter a strategy id.'); return; }
    setError(null); setMsg(null);
    try { await registerStrategy(newId.trim()); setMsg(`Strategy ${newId.trim()} registered at NOT PROMOTED.`); setNewId(''); await load(); }
    catch (e) { setError(String(e)); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="AI Trading — Promotion Ladder (§12)"
        subtitle="Governs how far a strategy config may act: Paper → Shadow → Canary → Live. Promotion is separation-of-duties (maker≠checker), with Risk + legal sign-off required for Live. The backend gate is authoritative — this console only proposes."
        action={<button onClick={() => void load()} style={btn()}>Refresh</button>}
      />
      <TradingTabs active="promotions" />
      <DisclosureNote>
        <strong>Nothing here executes a trade.</strong> Canary/Live are <em>eligibility</em> states; this build has no venue adapter,
        and <code>/trading/evaluate</code> returns <code>executed:false</code>. Real capital requires separate execution wiring + legal sign-off.
      </DisclosureNote>

      {!canRead && <PermissionBanner permission={TRADING_PERMS.promoRead} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {msg && <AuditNote>{msg}</AuditNote>}

      <Card title="Register a strategy" right={
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <input placeholder="strategy id (e.g. trend-btc-v2)" value={newId} onChange={(e) => setNewId(e.target.value)} style={{ ...input(), width: 260 }} />
          <button style={canPropose ? btnPrimary() : btnDisabled()} disabled={!canPropose} onClick={() => void doRegister()}>Register</button>
        </div>
      }>
        <p style={{ color: '#6b7280', fontSize: '0.8rem', margin: 0 }}>A new strategy enters at NOT PROMOTED. Requires <code>{TRADING_PERMS.promoPropose}</code>.</p>
      </Card>

      <Card title="Ladder">
        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No strategies registered.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Strategy</th><th style={th()}>Stage</th><th style={th()}>Verdict</th>
              <th style={th()}>Track record</th><th style={th()}>Circuit</th><th style={th()}>Eligibility</th>
              <th style={th()}>Updated</th><th style={th()}></th>
            </tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.StrategyID} style={selected === s.StrategyID ? { background: '#faf5ff' } : undefined}>
                  <td style={td()}><code style={{ fontSize: '0.8rem' }}>{s.StrategyID}</code></td>
                  <td style={td()}><StageBadge stage={s.Stage} /></td>
                  <td style={td()}>{s.ValidationPassed ? <span style={{ color: '#15803d' }}>✓ pass</span> : <span style={{ color: '#b91c1c' }}>✗ fail</span>}</td>
                  <td style={td()}>{s.TrackRecordDays}d</td>
                  <td style={td()}>{s.CircuitTripped ? <span style={{ color: '#b91c1c', fontWeight: 700 }}>TRIPPED</span> : '—'}</td>
                  <td style={td()}>{allowsRealCapital(s.Stage) ? <span style={{ color: '#b45309', fontSize: '0.78rem' }}>real-capital (stubbed)</span> : <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>paper</span>}</td>
                  <td style={td()}>{timeAgo(s.UpdatedAt)}</td>
                  <td style={td()}><button style={btn()} onClick={() => setSelected(selected === s.StrategyID ? null : s.StrategyID)}>{selected === s.StrategyID ? 'Close' : 'Manage'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>

      {selected && (
        <StrategyDetail
          key={selected}
          id={selected}
          perms={{ canApprove, canHalt, canRisk }}
          onChanged={() => { void load(); }}
          onNotice={(m) => setMsg(m)}
        />
      )}
    </div>
  );
}

function StrategyDetail({ id, perms, onChanged, onNotice }: {
  id: string;
  perms: { canApprove: boolean; canHalt: boolean; canRisk: boolean };
  onChanged: () => void;
  onNotice: (m: string) => void;
}) {
  const meId = useCurrentAdminId();
  const [strategy, setStrategy] = useState<StrategyPromotion | null>(null);
  const [events, setEvents] = useState<PromotionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Promote form
  const [makerId, setMakerId] = useState('');
  const [risk, setRisk] = useState(false);
  const [legal, setLegal] = useState(false);
  // Demote / halt
  const [reason, setReason] = useState('');
  // Readiness
  const [verdict, setVerdict] = useState(false);
  const [days, setDays] = useState(0);
  const [tripped, setTripped] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { strategy: s, events: ev } = await getPromotion(id);
      setStrategy(s); setEvents(ev);
      setVerdict(s.ValidationPassed); setDays(s.TrackRecordDays); setTripped(s.CircuitTripped);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<unknown>, note: string) {
    setBusy(true); setError(null);
    try { await fn(); onNotice(note); await load(); onChanged(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  if (loading) return <Card title={`Manage — ${id}`}><p style={{ color: '#6b7280' }}>Loading…</p></Card>;
  if (!strategy) return <Card title={`Manage — ${id}`}><p style={{ color: '#dc2626' }}>{error ?? 'Not found.'}</p></Card>;

  const next = nextStage(strategy.Stage);
  const toLive = next === 'live';
  const makerOk = makerId.trim() !== '' && makerId.trim() !== (meId ?? '');
  const promoteOk = perms.canApprove && !!next && makerOk && (!toLive || (risk && legal));
  // Step-down targets: the rungs strictly below the current stage.
  const rungOrder: TradingStage[] = ['paper', 'shadow', 'canary', 'live'];
  const curIdx = rungOrder.indexOf(strategy.Stage);
  const downTargets = curIdx > 0 ? rungOrder.slice(0, curIdx) : [];

  return (
    <Card title={`Manage — ${strategy.StrategyID}`} right={<StageBadge stage={strategy.Stage} />}>
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>

        {/* Readiness — Risk perm */}
        <div>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.5rem' }}>Readiness</h3>
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.82rem', marginBottom: '0.4rem' }}>
            <input type="checkbox" checked={verdict} onChange={(e) => setVerdict(e.target.checked)} /> Validation verdict passes
          </label>
          <label style={label()}>Track-record days</label>
          <input type="number" min={0} value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ ...input(), marginBottom: '0.4rem' }} />
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.82rem', marginBottom: '0.5rem' }}>
            <input type="checkbox" checked={tripped} onChange={(e) => setTripped(e.target.checked)} /> Circuit breaker tripped
          </label>
          <button
            style={perms.canRisk && !busy ? btnPrimary() : btnDisabled()}
            disabled={!perms.canRisk || busy}
            onClick={() => void run(() => setReadiness(id, { validation_passed: verdict, track_record_days: days, circuit_tripped: tripped }), `Readiness updated for ${id}.`)}
          >Save readiness</button>
          <p style={{ color: '#9ca3af', fontSize: '0.72rem', margin: '0.4rem 0 0' }}>Requires <code>{TRADING_PERMS.promoRisk}</code>. These are the inputs the promotion gate judges.</p>
        </div>

        {/* Promote — checker perm; maker≠checker; Risk+legal for Live */}
        <div>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.5rem' }}>Promote {next ? <>→ <StageBadge stage={next} /></> : '(at top / off-ladder)'}</h3>
          {next ? (
            <>
              <label style={label()}>Maker (proposing admin — must differ from you{meId ? ` = ${meId}` : ''})</label>
              <input placeholder="maker admin id" value={makerId} onChange={(e) => setMakerId(e.target.value)} style={{ ...input(), marginBottom: '0.4rem' }} />
              {!makerOk && makerId.trim() !== '' && <p style={{ color: '#b91c1c', fontSize: '0.72rem', margin: '0 0 0.4rem' }}>Maker must be a different admin (you are the checker).</p>}
              {toLive && (
                <div style={{ border: '1px solid #fca5a5', background: '#fff1f2', borderRadius: '0.375rem', padding: '0.5rem 0.6rem', marginBottom: '0.5rem' }}>
                  <p style={{ margin: '0 0 0.35rem', fontSize: '0.75rem', color: '#9f1239', fontWeight: 700 }}>Canary → Live requires both sign-offs:</p>
                  <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.8rem' }}><input type="checkbox" checked={risk} onChange={(e) => setRisk(e.target.checked)} /> Risk sign-off</label>
                  <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.8rem' }}><input type="checkbox" checked={legal} onChange={(e) => setLegal(e.target.checked)} /> Legal sign-off</label>
                </div>
              )}
              <button
                style={promoteOk && !busy ? btnPrimary('#340075') : btnDisabled()}
                disabled={!promoteOk || busy}
                onClick={() => void run(() => promoteStrategy(id, { to_stage: next, maker_id: makerId.trim(), risk_signed_off: risk, legal_signed_off: legal }), `Promoted ${id} → ${next}.`)}
              >Approve promotion → {next}</button>
              <p style={{ color: '#9ca3af', fontSize: '0.72rem', margin: '0.4rem 0 0' }}>You act as CHECKER (<code>{TRADING_PERMS.promoApprove}</code>). The gate also requires a passing verdict + track record.</p>
            </>
          ) : <p style={{ color: '#6b7280', fontSize: '0.82rem' }}>No forward rung available from {strategy.Stage.replace(/_/g, ' ')}.</p>}
        </div>

        {/* De-risk / Halt — halt perm */}
        <div>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.5rem' }}>De-risk / Halt</h3>
          <label style={label()}>Reason (required)</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. drawdown breach in shadow run" style={{ ...textarea(), marginBottom: '0.5rem' }} />
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {downTargets.map((t) => (
              <button key={t} style={perms.canHalt && reason.trim() && !busy ? btn() : btnDisabled()} disabled={!perms.canHalt || !reason.trim() || busy}
                onClick={() => void run(() => demoteStrategy(id, { to_stage: t, reason: reason.trim() }), `De-risked ${id} → ${t}.`)}>↓ {t}</button>
            ))}
            <button style={perms.canHalt && reason.trim() && !busy ? btnDanger() : btnDisabled()} disabled={!perms.canHalt || !reason.trim() || busy || strategy.Stage === 'halted' || strategy.Stage === 'not_promoted'}
              onClick={() => void run(() => haltStrategy(id, reason.trim()), `Halted ${id}.`)}>Halt</button>
          </div>
          <p style={{ color: '#9ca3af', fontSize: '0.72rem', margin: '0.4rem 0 0' }}>Requires <code>{TRADING_PERMS.promoHalt}</code>. De-risking is always permitted by the gate.</p>
        </div>
      </div>

      {/* Audit trail */}
      <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '1.25rem 0 0.5rem' }}>Audit trail</h3>
      {events.length === 0 ? <p style={{ color: '#6b7280', fontSize: '0.82rem' }}>No events recorded.</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th()}>Event</th><th style={th()}>Transition</th><th style={th()}>Maker</th><th style={th()}>Checker</th><th style={th()}>Sign-off</th><th style={th()}>When</th></tr></thead>
          <tbody>
            {events.map((e, i) => (
              <tr key={i}>
                <td style={td()}>{e.EventType}</td>
                <td style={td()}>{e.OldStage || '∅'} → {e.NewStage || '∅'}</td>
                <td style={td()}><code style={{ fontSize: '0.72rem' }}>{e.MakerID ?? '—'}</code></td>
                <td style={td()}><code style={{ fontSize: '0.72rem' }}>{e.CheckerID ?? '—'}</code></td>
                <td style={td()}>{e.RiskSignedOff ? 'risk ' : ''}{e.LegalSignedOff ? 'legal' : ''}{!e.RiskSignedOff && !e.LegalSignedOff ? '—' : ''}</td>
                <td style={td()}>{fmtDate(e.CreatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
