'use client';

// Shared board for the support / safety / emergency queues: KPI strip, kind tabs,
// filters, paged list and a detail drawer with reply, status change and
// assignment. Everything is live data from telemedAdminSupportService.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { colors, tint } from '@/components/ui/vuexy';
import {
  Card, Kpi, StateBlock, FilterBar, btn, btnPrimary, th, td, input, label, select, timeAgo, fmtDate,
} from '../_ui';
import {
  KIND_META, TERMINAL_STATUSES, assignItem, getQueueItem, getSupportSummary, listQueue, openCount,
  replyToItem, setItemStatus,
  type QueueDetail, type QueueItem, type QueueKind, type Summary,
} from '@/services/telemedAdminSupportService';

const PAGE_SIZE = 25;
const SEVERITIES = ['low', 'medium', 'high', 'critical'];

const pretty = (s: string) => s.replace(/_/g, ' ');

// open = needs attention (amber), in flight = blue, done = green, rejected/cancelled = red, closed = grey.
function pillColors(status: string): { fg: string; bg: string } {
  switch (status) {
    case 'open': case 'initiated': return { fg: colors.warning, bg: tint(colors.warning, 0.14) };
    case 'in_progress': case 'under_review': case 'awaiting_response': case 'investigating': case 'notified':
      return { fg: colors.info, bg: tint(colors.info, 0.14) };
    case 'acknowledged': return { fg: colors.primary, bg: tint(colors.primary, 0.14) };
    case 'resolved': return { fg: colors.success, bg: tint(colors.success, 0.14) };
    case 'rejected': case 'cancelled': return { fg: colors.danger, bg: tint(colors.danger, 0.14) };
    default: return { fg: colors.muted, bg: colors.bg };
  }
}

function severityColors(sev: string): { fg: string; bg: string } {
  if (sev === 'critical' || sev === 'high') return { fg: colors.danger, bg: tint(colors.danger, 0.14) };
  if (sev === 'medium') return { fg: colors.warning, bg: tint(colors.warning, 0.14) };
  return { fg: colors.muted, bg: colors.bg };
}

export function Pill({ text, c }: { text: string; c: { fg: string; bg: string } }) {
  return (
    <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c.fg, background: c.bg, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
      {pretty(text)}
    </span>
  );
}

const shortId = (id: string | null) => (id ? `${id.slice(0, 8)}…` : '');

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ── Board ───────────────────────────────────────────────────────────────────

export function QueueBoard({ kinds }: { kinds: QueueKind[] }) {
  const [kind, setKind] = useState<QueueKind>(kinds[0]);
  const meta = KIND_META[kind];

  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [items, setItems] = useState<QueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [assigned, setAssigned] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  // A late response from a previous filter must never overwrite a newer one.
  const seq = useRef(0);

  const loadSummary = useCallback(async () => {
    try { setSummary(await getSupportSummary()); setSummaryError(null); }
    catch (e) { setSummaryError(errText(e)); }
  }, []);

  const loadList = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true); setError(null);
    try {
      const r = await listQueue(kind, {
        status: status || undefined,
        severity: severity || undefined,
        assigned: assigned || undefined,
        q: q.trim() || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      if (mine !== seq.current) return;
      setItems(r.items); setTotal(r.total);
    } catch (e) {
      if (mine === seq.current) setError(errText(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [kind, status, severity, assigned, q, page]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  function switchKind(k: QueueKind) {
    setKind(k); setStatus(''); setSeverity(''); setAssigned(''); setQ(''); setPage(0); setOpenId(null);
  }

  const refreshAll = useCallback(() => { loadList(); loadSummary(); }, [loadList, loadSummary]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      {summaryError ? (
        <p style={{ color: colors.danger, fontSize: '0.85rem' }}>Could not load queue totals: {summaryError}</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          {kinds.map((k) => {
            const s = summary?.[k];
            const open = openCount(k, s);
            return (
              <Kpi
                key={k}
                label={KIND_META[k].label}
                value={summary ? open.toLocaleString('en-NG') : '…'}
                sub={summary ? `open of ${s?.total ?? 0} · ${s?.unassigned_open ?? 0} unassigned` : undefined}
                accent={summary && (s?.unassigned_open ?? 0) > 0 ? colors.warning : undefined}
              />
            );
          })}
        </div>
      )}

      {kinds.length > 1 && (
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {kinds.map((k) => (
            <button
              key={k}
              onClick={() => switchKind(k)}
              style={{ ...btn(), fontWeight: 600, ...(k === kind ? { background: colors.primary, color: '#fff', borderColor: colors.primary } : {}) }}
            >
              {KIND_META[k].label}
            </button>
          ))}
        </div>
      )}

      <FilterBar>
        <div style={{ minWidth: 220 }}>
          <label style={label()}>Search</label>
          <input
            style={input()} placeholder="Reference, subject or clinician…" value={q}
            onChange={(e) => { setQ(e.target.value); setPage(0); }}
          />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
            <option value="">All</option>
            {meta.statuses.map((s) => <option key={s} value={s}>{pretty(s)}</option>)}
          </select>
        </div>
        {kind === 'safety_issue' && (
          <div>
            <label style={label()}>Severity</label>
            <select style={select()} value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(0); }}>
              <option value="">All</option>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
        {meta.assign && (
          <div>
            <label style={label()}>Assignment</label>
            <select style={select()} value={assigned} onChange={(e) => { setAssigned(e.target.value); setPage(0); }}>
              <option value="">Anyone</option>
              <option value="unassigned">Unassigned</option>
              <option value="me">Assigned to me</option>
            </select>
          </div>
        )}
        <button style={btn()} onClick={refreshAll}>Refresh</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading && items.length === 0} error={error} empty={!loading && items.length === 0} emptyText={`No ${meta.label.toLowerCase()} match.`}>
          <div style={{ overflowX: 'auto', opacity: loading ? 0.6 : 1 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={th()}>Ref</th><th style={th()}>Subject</th><th style={th()}>Clinician</th>
                  <th style={th()}>Status</th>{kind === 'safety_issue' && <th style={th()}>Severity</th>}
                  {(kind === 'emergency_case' || kind === 'emergency_escalation') && <th style={th()}>Patient</th>}
                  {meta.assign && <th style={th()}>Owner</th>}<th style={th()}>Raised</th><th style={th()} />
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} style={{ background: it.id === openId ? tint(colors.primary, 0.05) : undefined }}>
                    <td style={td()}><code style={{ fontSize: '0.78rem' }}>{it.ref}</code></td>
                    <td style={{ ...td(), maxWidth: 280 }}>
                      <div style={{ fontWeight: 600 }}>{it.subject || '—'}</div>
                      {it.category && kind === 'ticket' ? <div style={{ color: colors.muted, fontSize: '0.75rem' }}>{it.category}</div> : null}
                    </td>
                    <td style={td()}>{it.doctor_name}</td>
                    <td style={td()}><Pill text={it.status} c={pillColors(it.status)} /></td>
                    {kind === 'safety_issue' && <td style={td()}><Pill text={it.severity || '—'} c={severityColors(it.severity)} /></td>}
                    {(kind === 'emergency_case' || kind === 'emergency_escalation') && <td style={td()}><code style={{ fontSize: '0.78rem' }}>{it.patient_ref || '—'}</code></td>}
                    {meta.assign && (
                      <td style={td()}>{it.assignee_id ? <code style={{ fontSize: '0.78rem' }}>{shortId(it.assignee_id)}</code> : <span style={{ color: colors.warning, fontWeight: 600 }}>Unassigned</span>}</td>
                    )}
                    <td style={td()} title={fmtDate(it.created_at)}>{timeAgo(it.created_at)}</td>
                    <td style={td()}><button style={btn()} onClick={() => setOpenId(it.id)}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', fontSize: '0.8rem', color: colors.muted }}>
            <span>{total.toLocaleString('en-NG')} total · page {page + 1} of {pages}</span>
            <span style={{ display: 'flex', gap: '0.4rem' }}>
              <button style={btn()} disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</button>
              <button style={btn()} disabled={page + 1 >= pages || loading} onClick={() => setPage((p) => p + 1)}>Next</button>
            </span>
          </div>
        </StateBlock>
      </Card>

      {openId && (
        <DetailDrawer
          key={`${kind}:${openId}`}
          kind={kind}
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={refreshAll}
        />
      )}
    </>
  );
}

// ── Drawer ──────────────────────────────────────────────────────────────────

function DetailDrawer({ kind, id, onClose, onChanged }: {
  kind: QueueKind; id: string; onClose: () => void; onChanged: () => void;
}) {
  const meta = KIND_META[kind];
  const [d, setD] = useState<QueueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [reply, setReply] = useState('');
  const [nextStatus, setNextStatus] = useState('');
  const [note, setNote] = useState('');
  // One key per distinct reply text: a retry after a failure re-sends the same
  // key (server de-duplicates); editing the text mints a new one.
  const replyKey = useRef<{ text: string; key: string } | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true); setError(null);
    getQueueItem(kind, id)
      .then((r) => { if (live) setD(r); })
      .catch((e) => { if (live) setError(errText(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [kind, id]);

  async function run(fn: () => Promise<QueueDetail>, after?: () => void) {
    setBusy(true); setActionError(null);
    try {
      const r = await fn();
      setD(r); after?.(); onChanged();
    } catch (e) {
      setActionError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  function sendReply() {
    const text = reply.trim();
    if (!text) return;
    if (!replyKey.current || replyKey.current.text !== text) {
      replyKey.current = { text, key: crypto.randomUUID() };
    }
    const key = replyKey.current.key;
    run(() => replyToItem(kind, id, text, key), () => { setReply(''); replyKey.current = null; });
  }

  function applyStatus() {
    if (!nextStatus) return;
    run(() => setItemStatus(kind, id, nextStatus, note), () => { setNextStatus(''); setNote(''); });
  }

  const terminal = d ? TERMINAL_STATUSES.has(d.status) && d.allowed_statuses.length === 0 : false;
  const canReply = meta.reply && d && !terminal;
  const detailEntries = useMemo(() => Object.entries(d?.detail ?? {}).filter(([k]) => k !== 'admin_resolution'), [d]);
  const resolution = (d?.detail?.admin_resolution ?? null) as { status?: string; note?: string; at?: string } | null;

  return (
    <div
      role="dialog" aria-label="Item detail"
      style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(520px, 100vw)', background: colors.card, borderLeft: `1px solid ${colors.border}`, boxShadow: '-8px 0 24px rgba(0,0,0,0.08)', zIndex: 60, display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ padding: '0.9rem 1rem', borderBottom: `1px solid ${colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
        <div>
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: colors.muted, fontWeight: 600 }}>{meta.label.replace(/s$/, '')}</div>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: colors.text }}>{d?.subject || d?.ref || 'Loading…'}</div>
          {d && (
            <div style={{ marginTop: '0.35rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <code style={{ fontSize: '0.78rem' }}>{d.ref}</code>
              <Pill text={d.status} c={pillColors(d.status)} />
              {d.severity ? <Pill text={d.severity} c={severityColors(d.severity)} /> : null}
            </div>
          )}
        </div>
        <button style={btn()} onClick={onClose} aria-label="Close">Close</button>
      </div>

      <div style={{ padding: '1rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <StateBlock loading={loading} error={error} empty={!d}>
          {d && (
            <>
              <Section title="Raised by">
                <Row k="Clinician" v={d.doctor_name} />
                {d.patient_ref ? <Row k="Patient" v={d.patient_ref} /> : null}
                {d.category && kind !== 'ticket' ? <Row k="Type" v={pretty(d.category)} /> : null}
                <Row k="Raised" v={fmtDate(d.created_at)} />
                <Row k="Updated" v={fmtDate(d.updated_at)} />
              </Section>

              {d.body ? (
                <Section title={kind === 'ticket' ? 'Latest message' : kind === 'call_dispute' ? 'Reason' : 'Summary'}>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.88rem' }}>{d.body}</p>
                </Section>
              ) : null}

              {detailEntries.length > 0 && (
                <Section title="Details">
                  {detailEntries.map(([k, v]) => <Row key={k} k={pretty(k)} v={typeof v === 'object' ? JSON.stringify(v) : String(v)} />)}
                </Section>
              )}

              {d.evidence && d.evidence.length > 0 && (
                <Section title={`Evidence (${d.evidence.length})`}>
                  {d.evidence.map((e, i) => (
                    <pre key={i} style={{ margin: 0, fontSize: '0.75rem', background: colors.bg, padding: '0.4rem', borderRadius: 6, overflowX: 'auto' }}>{JSON.stringify(e, null, 2)}</pre>
                  ))}
                </Section>
              )}

              {d.escalations && d.escalations.length > 0 && (
                <Section title="Escalations for this patient">
                  {d.escalations.map((e) => (
                    <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '0.2rem 0' }}>
                      <span>{pretty(e.category || e.subject)} · {timeAgo(e.created_at)}</span>
                      <Pill text={e.status} c={pillColors(e.status)} />
                    </div>
                  ))}
                </Section>
              )}

              {resolution?.note ? (
                <Section title="Resolution recorded">
                  <p style={{ margin: 0, fontSize: '0.88rem' }}>{resolution.note}</p>
                  <div style={{ color: colors.muted, fontSize: '0.75rem' }}>{resolution.status ? pretty(resolution.status) : ''} {resolution.at ? `· ${fmtDate(resolution.at)}` : ''}</div>
                </Section>
              ) : null}

              {meta.reply && (
                <Section title={`Conversation (${d.messages?.length ?? 0})`}>
                  {(d.messages ?? []).length === 0 ? <p style={{ margin: 0, color: colors.muted, fontSize: '0.85rem' }}>No messages yet.</p> : null}
                  {(d.messages ?? []).map((m) => (
                    <div key={m.id} style={{ alignSelf: m.author === 'agent' ? 'flex-end' : 'flex-start', background: m.author === 'agent' ? tint(colors.primary, 0.1) : colors.bg, borderRadius: 8, padding: '0.45rem 0.65rem', marginBottom: '0.4rem', maxWidth: '92%' }}>
                      <div style={{ fontSize: '0.7rem', color: colors.muted, fontWeight: 600, textTransform: 'uppercase' }}>{m.author === 'agent' ? 'Support' : m.author === 'doctor' ? 'Clinician' : m.author} · {timeAgo(m.created_at)}</div>
                      <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.88rem' }}>{m.body}</div>
                    </div>
                  ))}
                </Section>
              )}

              {meta.assign && (
                <Section title="Owner">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.88rem' }}>{d.assignee_id ? <code>{shortId(d.assignee_id)}</code> : 'Unassigned'}</span>
                    <button style={btn()} disabled={busy} onClick={() => run(() => assignItem(kind, id))}>Assign to me</button>
                    {d.assignee_id && <button style={btn()} disabled={busy} onClick={() => run(() => assignItem(kind, id, null))}>Unassign</button>}
                  </div>
                </Section>
              )}

              {canReply && (
                <Section title="Reply to clinician">
                  <textarea
                    style={{ ...input(), minHeight: 84, resize: 'vertical', fontFamily: 'inherit' }}
                    placeholder="Visible to the clinician in their app…" maxLength={4000}
                    value={reply} onChange={(e) => setReply(e.target.value)}
                  />
                  <div style={{ marginTop: '0.4rem' }}>
                    <button style={btnPrimary()} disabled={busy || !reply.trim()} onClick={sendReply}>{busy ? 'Sending…' : 'Send reply'}</button>
                  </div>
                </Section>
              )}

              <Section title="Change status">
                {d.allowed_statuses.length === 0 ? (
                  <p style={{ margin: 0, color: colors.muted, fontSize: '0.85rem' }}>This item is {pretty(d.status)} — no further transitions.</p>
                ) : (
                  <>
                    <select style={select()} value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>
                      <option value="">Move to…</option>
                      {d.allowed_statuses.map((s) => <option key={s} value={s}>{pretty(s)}</option>)}
                    </select>
                    <textarea
                      style={{ ...input(), minHeight: 60, resize: 'vertical', marginTop: '0.4rem', fontFamily: 'inherit' }}
                      placeholder={meta.reply ? 'Optional note — posted to the clinician’s thread' : 'Optional note — recorded as the resolution and sent to the clinician'}
                      maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)}
                    />
                    <div style={{ marginTop: '0.4rem' }}>
                      <button style={btnPrimary()} disabled={busy || !nextStatus} onClick={applyStatus}>{busy ? 'Saving…' : 'Update status'}</button>
                    </div>
                  </>
                )}
              </Section>

              <Section title="Admin history">
                {d.history.length === 0 ? <p style={{ margin: 0, color: colors.muted, fontSize: '0.85rem' }}>No admin activity yet.</p> : d.history.map((h, i) => (
                  <div key={i} style={{ fontSize: '0.82rem', padding: '0.2rem 0', borderTop: i ? `1px solid ${colors.border}` : undefined }}>
                    <strong>{historyLabel(h)}</strong>
                    <span style={{ color: colors.muted }}> · {h.admin_id && h.action !== 'admin.assign' ? `${shortId(h.admin_id)} · ` : ''}{timeAgo(h.created_at)}</span>
                  </div>
                ))}
              </Section>
            </>
          )}
        </StateBlock>
        {actionError && (
          <div role="alert" style={{ border: `1px solid ${colors.danger}`, color: colors.danger, background: tint(colors.danger, 0.06), borderRadius: 6, padding: '0.5rem 0.7rem', fontSize: '0.85rem' }}>{actionError}</div>
        )}
      </div>
    </div>
  );
}

function historyLabel(h: { action: string; admin_id?: string; from?: string; to?: string }): string {
  switch (h.action) {
    case 'admin.status': return `Status ${h.from ? pretty(h.from) : ''} → ${h.to ? pretty(h.to) : ''}`;
    case 'admin.reply': return h.to ? `Replied (moved to ${pretty(h.to)})` : 'Replied';
    case 'admin.assign': return h.to ? `Assigned to ${shortId(h.to)}` : 'Unassigned';
    default: return pretty(h.action.replace(/^admin\./, ''));
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 700, marginBottom: '0.35rem' }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.85rem', padding: '0.15rem 0' }}>
      <span style={{ color: colors.muted, textTransform: 'capitalize' }}>{k}</span>
      <span style={{ textAlign: 'right', wordBreak: 'break-word' }}>{v}</span>
    </div>
  );
}
