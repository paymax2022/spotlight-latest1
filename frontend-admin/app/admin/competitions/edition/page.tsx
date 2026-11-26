'use client';

/**
 * Rising Star Edition Management — the three configuration tabs §6 requires:
 *   TAB 1 Prizes & Winning Positions, TAB 2 Rules & Regulations, TAB 3 Winner
 *   Declaration. One edition (a connect_contests row, named by ?id=) is the
 * central unit; every panel reads/writes through editionAdminService, which
 * reaches the Go connect-voting admin group behind the connect.contests.* RBAC
 * guards.
 *
 * The edition id is read from the query string in an effect (not useSearchParams)
 * so the page needs no Suspense boundary and works the same on a cold render.
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { Page, PageHeader, Card, Button, colors } from '@/components/ui/vuexy';
import {
  listPositions, listPrizes, listRulesVersions, listWinners,
  createPosition, deletePosition, createPrize, deletePrize,
  createRulesDraft, publishRules, declareWinner, setResultsStatus,
  DEFAULT_POSITIONS, WINNER_METHODOLOGIES, RESULTS_STATUSES,
  type WinningPosition, type EditionPrize, type EditionRules, type EditionWinner,
} from '@/services/editionAdminService';

type Tab = 'prizes' | 'rules' | 'winners';

const label: CSSProperties = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.muted, marginBottom: 4 };
const input: CSSProperties = { width: '100%', padding: '0.5rem 0.6rem', border: `1px solid ${colors.border}`, borderRadius: '0.4rem', background: colors.card, color: colors.text, fontSize: '0.875rem' };
const row: CSSProperties = { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' };

function useEditionId(): string {
  const [id, setId] = useState('');
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setId(q.get('id') ?? q.get('contestId') ?? '');
  }, []);
  return id;
}

export default function EditionManagerPage() {
  const editionId = useEditionId();
  const [tab, setTab] = useState<Tab>('prizes');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [positions, setPositions] = useState<WinningPosition[]>([]);
  const [prizes, setPrizes] = useState<EditionPrize[]>([]);
  const [rules, setRules] = useState<EditionRules[]>([]);
  const [winners, setWinners] = useState<EditionWinner[]>([]);
  const [methodology, setMethodology] = useState('administrative_selection');
  const [resultsStatus, setResultsStatus] = useState('not_declared');

  // Form draft state
  const [posTitle, setPosTitle] = useState('');
  const [posRank, setPosRank] = useState(1);
  const [posRecip, setPosRecip] = useState(1);
  const [rulesText, setRulesText] = useState('{\n  "eligibility": "",\n  "registration": "",\n  "selection": ""\n}');
  const [winContestant, setWinContestant] = useState('');
  const [winPosition, setWinPosition] = useState('');

  const reload = useCallback(async () => {
    if (!editionId) return;
    setError('');
    try {
      const [p, pr, r, w] = await Promise.all([
        listPositions(editionId), listPrizes(editionId), listRulesVersions(editionId), listWinners(editionId),
      ]);
      setPositions(p); setPrizes(pr); setRules(r); setWinners(w);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load edition');
    }
  }, [editionId]);

  useEffect(() => { void reload(); }, [reload]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await fn(); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusy(false); }
  }

  if (!editionId) {
    return (
      <Page>
        <PageHeader title="Rising Star Edition Management" />
        <Card>
          <p style={{ color: colors.muted, marginBottom: 12 }}>
            Open this screen for a specific edition — it needs an <code>?id=&lt;contestId&gt;</code>.
            Pick a Rising Star contest from the list first, then choose its “Edition” action.
          </p>
          <Link href="/admin/competitions/list"><Button variant="primary">Browse contests</Button></Link>
        </Card>
      </Page>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'prizes', label: 'Prizes & Winning Positions' },
    { id: 'rules', label: 'Rules & Regulations' },
    { id: 'winners', label: 'Winner Declaration' },
  ];

  return (
    <Page>
      <PageHeader title="Rising Star Edition Management" subtitle={`Edition ${editionId}`} />
      {error && <div style={{ padding: '0.75rem 1rem', background: '#fee2e2', border: `1px solid ${colors.danger}`, borderRadius: '0.5rem', color: colors.danger, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '0.5rem 0.9rem', borderRadius: '0.5rem', cursor: 'pointer', border: `1px solid ${colors.border}`, background: tab === t.id ? colors.primary : colors.card, color: tab === t.id ? '#fff' : colors.text, fontWeight: 600, fontSize: '0.85rem' }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'prizes' && (
        <>
          <Card>
            <h3 style={{ marginTop: 0 }}>Winning Positions</h3>
            <div style={row}>
              <Button variant="outline" disabled={busy} onClick={() => run(async () => {
                for (const d of DEFAULT_POSITIONS) await createPosition(editionId, { title: d.title, rank: d.rank });
              })}>Seed default ladder</Button>
            </div>
            <div style={{ ...row, marginTop: 12 }}>
              <div style={{ flex: '2 1 200px' }}><span style={label}>Position title</span><input style={input} value={posTitle} onChange={(e) => setPosTitle(e.target.value)} placeholder="1st Place — Overall Winner" /></div>
              <div style={{ flex: '0 1 90px' }}><span style={label}>Rank</span><input style={input} type="number" min={1} value={posRank} onChange={(e) => setPosRank(Number(e.target.value))} /></div>
              <div style={{ flex: '0 1 130px' }}><span style={label}>Recipients</span><input style={input} type="number" min={1} value={posRecip} onChange={(e) => setPosRecip(Number(e.target.value))} /></div>
              <Button variant="primary" disabled={busy || !posTitle.trim()} onClick={() => run(() => createPosition(editionId, { title: posTitle.trim(), rank: posRank, recipients_allowed: posRecip }))}>Add position</Button>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, marginTop: 12 }}>
              {positions.map((p) => (
                <li key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderTop: `1px solid ${colors.border}` }}>
                  <span>#{p.rank} — {p.title} {p.recipients_allowed > 1 && <em style={{ color: colors.muted }}>(up to {p.recipients_allowed} joint winners)</em>}</span>
                  <Button variant="outline" disabled={busy} onClick={() => run(() => deletePosition(editionId, p.id))}>Remove</Button>
                </li>
              ))}
              {positions.length === 0 && <li style={{ color: colors.muted, padding: '0.5rem 0' }}>No positions yet.</li>}
            </ul>
          </Card>

          <Card>
            <h3 style={{ marginTop: 0 }}>Prizes</h3>
            <PrizeForm positions={positions} busy={busy} onCreate={(body) => run(() => createPrize(editionId, body))} />
            <ul style={{ listStyle: 'none', padding: 0, marginTop: 12 }}>
              {prizes.map((pr) => (
                <li key={pr.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderTop: `1px solid ${colors.border}` }}>
                  <span>
                    <strong>{pr.title || pr.prize_type}</strong>{' '}
                    {pr.amount_kobo != null && <span>{(pr.amount_kobo / 100).toLocaleString()} {pr.currency}</span>}{' '}
                    {pr.description && <span style={{ color: colors.muted }}>— {pr.description}</span>}
                  </span>
                  <Button variant="outline" disabled={busy} onClick={() => run(() => deletePrize(editionId, pr.id))}>Remove</Button>
                </li>
              ))}
              {prizes.length === 0 && <li style={{ color: colors.muted, padding: '0.5rem 0' }}>No prizes yet.</li>}
            </ul>
          </Card>
        </>
      )}

      {tab === 'rules' && (
        <Card>
          <h3 style={{ marginTop: 0 }}>Rules & Regulations (versioned)</h3>
          <p style={{ color: colors.muted, fontSize: '0.85rem' }}>
            Edit the structured rule set as JSON (sections A–I of the requirements). Each save creates a new DRAFT version; publishing archives the prior version. Contestants keep the exact version they accepted.
          </p>
          <span style={label}>Rules content (JSON)</span>
          <textarea style={{ ...input, minHeight: 220, fontFamily: 'monospace' }} value={rulesText} onChange={(e) => setRulesText(e.target.value)} />
          <div style={{ ...row, marginTop: 12 }}>
            <Button variant="primary" disabled={busy} onClick={() => run(async () => {
              let content: Record<string, unknown>;
              try { content = JSON.parse(rulesText); }
              catch { setError('Rules content is not valid JSON'); return; }
              await createRulesDraft(editionId, { content });
            })}>Save new draft</Button>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, marginTop: 12 }}>
            {rules.map((r) => (
              <li key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderTop: `1px solid ${colors.border}` }}>
                <span>Version {r.version} — <strong style={{ color: r.status === 'published' ? colors.success : colors.muted }}>{r.status}</strong>{r.published_at && <em style={{ color: colors.muted }}> · published {new Date(r.published_at).toLocaleDateString()}</em>}</span>
                {r.status !== 'published' && <Button variant="outline" disabled={busy} onClick={() => run(() => publishRules(editionId, r.id))}>Publish</Button>}
              </li>
            ))}
            {rules.length === 0 && <li style={{ color: colors.muted, padding: '0.5rem 0' }}>No rules versions yet.</li>}
          </ul>
        </Card>
      )}

      {tab === 'winners' && (
        <>
          <Card>
            <h3 style={{ marginTop: 0 }}>Edition Lifecycle</h3>
            <div style={row}>
              <div style={{ flex: '1 1 220px' }}>
                <span style={label}>Winner selection methodology</span>
                <select style={input} value={methodology} onChange={(e) => setMethodology(e.target.value)}>
                  {WINNER_METHODOLOGIES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div style={{ flex: '1 1 220px' }}>
                <span style={label}>Results status</span>
                <select style={input} value={resultsStatus} onChange={(e) => setResultsStatus(e.target.value)}>
                  {RESULTS_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <Button variant="primary" disabled={busy} onClick={() => run(() => setResultsStatus2(editionId, methodology, resultsStatus))}>Update</Button>
            </div>
            <p style={{ color: colors.muted, fontSize: '0.8rem', marginTop: 8 }}>Status moves forward only. Winners appear on the public mobile app once status reaches “Results Published”.</p>
          </Card>

          <Card>
            <h3 style={{ marginTop: 0 }}>Declare a Winner</h3>
            <div style={row}>
              <div style={{ flex: '1 1 240px' }}><span style={label}>Contestant ID</span><input style={input} value={winContestant} onChange={(e) => setWinContestant(e.target.value)} placeholder="contestant uuid" /></div>
              <div style={{ flex: '1 1 240px' }}>
                <span style={label}>Winning position</span>
                <select style={input} value={winPosition} onChange={(e) => setWinPosition(e.target.value)}>
                  <option value="">— none —</option>
                  {positions.map((p) => <option key={p.id} value={p.id}>#{p.rank} {p.title}</option>)}
                </select>
              </div>
              <Button variant="primary" disabled={busy || !winContestant.trim()} onClick={() => run(() => declareWinner(editionId, { contestant_id: winContestant.trim(), position_id: winPosition || null, declaration_status: 'declared' }))}>Declare</Button>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, marginTop: 12 }}>
              {winners.map((w) => (
                <li key={w.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderTop: `1px solid ${colors.border}` }}>
                  <span>{w.contestant_name || w.contestant_id} {w.position_title && <strong>· {w.position_title}</strong>} <em style={{ color: colors.muted }}>({w.declaration_status})</em></span>
                  {w.declaration_status === 'declared' && <Button variant="outline" disabled={busy} onClick={() => run(() => declareWinner(editionId, { contestant_id: w.contestant_id, position_id: w.position_id ?? null, declaration_status: 'published' }))}>Publish</Button>}
                </li>
              ))}
              {winners.length === 0 && <li style={{ color: colors.muted, padding: '0.5rem 0' }}>No winners declared yet.</li>}
            </ul>
          </Card>
        </>
      )}
    </Page>
  );
}

// Wrapper so the button reads cleanly and the service call stays one place.
function setResultsStatus2(editionId: string, methodology: string, resultsStatus: string) {
  return setResultsStatus(editionId, { winner_methodology: methodology, results_status: resultsStatus });
}

function PrizeForm({ positions, busy, onCreate }: { positions: WinningPosition[]; busy: boolean; onCreate: (body: Partial<EditionPrize>) => void }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<EditionPrize['prize_type']>('cash');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('NGN');
  const [desc, setDesc] = useState('');
  const [conditions, setConditions] = useState('');
  const [timing, setTiming] = useState('');
  const [positionId, setPositionId] = useState('');
  return (
    <div>
      <div style={row}>
        <div style={{ flex: '1 1 200px' }}><span style={label}>Prize title</span><input style={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="₦10,000,000 + endorsement deal" /></div>
        <div style={{ flex: '0 1 130px' }}>
          <span style={label}>Type</span>
          <select style={input} value={type} onChange={(e) => setType(e.target.value as EditionPrize['prize_type'])}>
            <option value="cash">Cash</option><option value="non_cash">Non-cash</option><option value="package">Package</option>
          </select>
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <span style={label}>Position</span>
          <select style={input} value={positionId} onChange={(e) => setPositionId(e.target.value)}>
            <option value="">— none —</option>
            {positions.map((p) => <option key={p.id} value={p.id}>#{p.rank} {p.title}</option>)}
          </select>
        </div>
      </div>
      <div style={{ ...row, marginTop: 12 }}>
        <div style={{ flex: '0 1 160px' }}><span style={label}>Cash amount</span><input style={input} type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000000" /></div>
        <div style={{ flex: '0 1 110px' }}><span style={label}>Currency</span><input style={input} value={currency} onChange={(e) => setCurrency(e.target.value)} /></div>
        <div style={{ flex: '2 1 240px' }}><span style={label}>Description</span><input style={input} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
      </div>
      <div style={{ ...row, marginTop: 12 }}>
        <div style={{ flex: '1 1 240px' }}><span style={label}>Fulfilment conditions</span><input style={input} value={conditions} onChange={(e) => setConditions(e.target.value)} /></div>
        <div style={{ flex: '1 1 240px' }}><span style={label}>Presentation / delivery timing</span><input style={input} value={timing} onChange={(e) => setTiming(e.target.value)} /></div>
        <Button variant="primary" disabled={busy} onClick={() => onCreate({
          title: title.trim(), prize_type: type, position_id: positionId || null,
          amount_kobo: amount ? Math.round(Number(amount) * 100) : null, currency: currency.trim() || 'NGN',
          description: desc, fulfilment_conditions: conditions, presentation_timing: timing,
        })}>Add prize</Button>
      </div>
    </div>
  );
}
