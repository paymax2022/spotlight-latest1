'use client';

// Events authoring — MONEY PATH (fee_kobo).
//
// A paid event's fee is what the member's registration invoice is raised for
// (RegisterEvent returns paymentRequired + an invoice instead of a ticket), so
// the paid/fee pair is not cosmetic: a paid event with a zero fee issues free
// tickets, and a fee on a free event is money the platform will never collect.
// The backend refuses both. This page refuses them FIRST, inline, so the
// operator is told while the form is still in front of them.
//
// Fee is INTEGER KOBO on the wire. Naira exists only as the text in the box;
// nairaToKobo() converts once, on submit.

import { useState } from 'react';
import {
  listAdminEvents, createEvent, updateEvent, deleteEvent,
  localInputToRfc3339, rfc3339ToLocalInput, nairaToKobo, koboToNairaInput, formatNaira, eventFeeError,
  type EventRow, type EventInput,
} from '@/services/associationAdminService';
import { useSelectedOrg, fmtDate } from '../../_ui';
import {
  ContentScaffold, StateBlock, useContentRows, Field, Check, NotifyCheck, MetaLine,
  useAssociationPermissions, ASSOCIATION_PERMS,
  formGrid, textareaStyle,
} from '../_content';
import { Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

type Draft = {
  title: string; description: string; startsAt: string; endsAt: string; location: string;
  paid: boolean; fee: string; capacity: string; organiser: string; coverUrl: string; notify: boolean;
};
const EMPTY: Draft = {
  title: '', description: '', startsAt: '', endsAt: '', location: '',
  paid: false, fee: '0', capacity: '', organiser: '', coverUrl: '', notify: false,
};

/**
 * Parse the fee box without throwing, so the inline warning can render on every
 * keystroke rather than only on submit. Returns null when the text is not yet a
 * valid amount at all (which is its own message).
 */
function parseFeeKobo(text: string): number | null {
  try { return nairaToKobo(text || '0'); } catch { return null; }
}

export default function AssociationEventsPage() {
  const orgId = useSelectedOrg();
  const { can } = useAssociationPermissions();
  const canManage = can(ASSOCIATION_PERMS.manage);

  const { rows, loading, error, reload, setError } = useContentRows<EventRow>(
    orgId, (id) => listAdminEvents(id, { limit: 100 }),
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const feeKobo = parseFeeKobo(draft.fee);
  const feeProblem = feeKobo === null
    ? 'Enter the fee in naira, e.g. 5000 or 5000.50.'
    : eventFeeError(draft.paid, feeKobo);

  function beginAdd() { setEditingId('new'); setDraft(EMPTY); setMsg(null); setError(null); }
  function beginEdit(r: EventRow) {
    setEditingId(r.id); setMsg(null); setError(null);
    setDraft({
      title: r.title,
      description: r.meta.description ?? '',
      startsAt: rfc3339ToLocalInput(r.meta.startsAt ?? r.at),
      endsAt: rfc3339ToLocalInput(r.meta.endsAt),
      location: r.meta.location ?? '',
      paid: !!r.meta.paid,
      fee: koboToNairaInput(Number(r.meta.feeKobo ?? 0)),
      capacity: r.meta.capacity != null ? String(r.meta.capacity) : '',
      organiser: r.meta.organiser ?? '',
      coverUrl: r.meta.coverUrl ?? '',
      notify: false,
    });
  }

  async function save() {
    if (!orgId) return;
    const isNew = editingId === 'new';
    setBusy(true); setError(null); setMsg(null);
    try {
      const title = draft.title.trim();
      if (!title) throw new Error('A title is required.');
      if (!draft.startsAt.trim()) throw new Error('A start date and time is required.');
      // nairaToKobo throws on anything that is not a clean 2-decimal amount
      // rather than silently truncating it.
      const kobo = nairaToKobo(draft.fee || '0');
      const bad = eventFeeError(draft.paid, kobo);
      if (bad) throw new Error(bad);

      const startsAt = localInputToRfc3339(draft.startsAt);
      const endsAt = localInputToRfc3339(draft.endsAt);
      if (startsAt && endsAt && new Date(endsAt) < new Date(startsAt)) {
        throw new Error('The end time is before the start time.');
      }
      let capacity: number | null = null;
      if (draft.capacity.trim()) {
        capacity = Number(draft.capacity.trim());
        if (!Number.isInteger(capacity) || capacity < 0) throw new Error('Capacity must be a whole number, 0 or more.');
      }

      const input: EventInput = {
        title,
        description: draft.description.trim() || null,
        startsAt: startsAt!,
        endsAt,
        location: draft.location.trim() || null,
        paid: draft.paid,
        feeKobo: kobo,
        capacity,
        organiser: draft.organiser.trim() || null,
        coverUrl: draft.coverUrl.trim() || null,
        ...(isNew ? { notify: draft.notify } : {}),
      };
      if (isNew) await createEvent(orgId, input);
      else await updateEvent(editingId!, input);
      setMsg(
        `${isNew ? 'Created' : 'Updated'} "${title}"`
        + (draft.paid ? ` at ${formatNaira(kobo)} per member.` : ' as a free event.')
        + (isNew && draft.notify ? ' Every active member was notified in-app.' : '')
        + ' Recorded to the audit log (NL-12).',
      );
      setEditingId(null); setDraft(EMPTY);
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function remove(r: EventRow) {
    // The backend REFUSES the delete once paid registrations exist and says so;
    // the refusal is surfaced verbatim rather than as a bare status code.
    const paidNote = (r.meta.awaitingPayment ?? 0) > 0 || ((r.meta.paid) && (r.meta.registeredCount ?? 0) > 0)
      ? ' This event has registrations attached to invoices — the backend will refuse the delete and ask you to cancel it instead.'
      : '';
    if (!window.confirm(`Delete "${r.title}"?${paidNote} This cannot be undone.`)) return;
    setBusy(true); setError(null); setMsg(null);
    try {
      await deleteEvent(r.id);
      setMsg(`Deleted "${r.title}". Recorded to the audit log (NL-12).`);
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const editing = editingId !== null;

  return (
    <ContentScaffold
      tab="events"
      title="Events"
      subtitle="Create member events, set capacity, and price paid ones — the fee is what each member's registration invoice is raised for."
      disclosure={<>
        Writes go to <code>/api/finance/associations/admin/organisations/:id/events</code>. Fees are stored as integer{' '}
        <strong>kobo</strong>; the naira you type is converted once, on submit. A <strong>paid</strong> event must have a
        fee above ₦0.00 and a free one must have no fee — otherwise members get free tickets or an uncollectable charge.
        An event with paid registrations cannot be deleted; cancel it instead. Recorded to the immutable audit log (NL-12).
      </>}
      orgId={orgId} loading={loading} error={error} msg={msg} canManage={canManage} onRefresh={() => void reload()}
    >
      <Card title={editing ? (editingId === 'new' ? 'New event' : 'Edit event') : 'Events'}>
        {!canManage ? <p style={{ fontSize: '0.85rem', color: colors.muted, marginTop: 12 }}>Read-only.</p> : !editing ? (
          <div style={{ marginTop: 12 }}><Button variant="primary" onClick={beginAdd}>New event</Button></div>
        ) : (
          <>
            <div style={formGrid}>
              <Field label="Title" wide>
                <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Annual gala night" />
              </Field>
              <Field label="Description" wide>
                <textarea style={{ ...textareaStyle, minHeight: 72 }} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </Field>
              <Field label="Starts at">
                <Input type="datetime-local" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} />
              </Field>
              <Field label="Ends at (optional)">
                <Input type="datetime-local" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} />
              </Field>
              <Field label="Location"><Input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} placeholder="e.g. Eko Hotel, Lagos" /></Field>
              <Field label="Organiser"><Input value={draft.organiser} onChange={(e) => setDraft({ ...draft, organiser: e.target.value })} placeholder="e.g. Social Committee" /></Field>
              <Field label="Capacity (blank = unlimited)"><Input value={draft.capacity} onChange={(e) => setDraft({ ...draft, capacity: e.target.value })} placeholder="e.g. 400" /></Field>
              <Field label="Cover image URL"><Input value={draft.coverUrl} onChange={(e) => setDraft({ ...draft, coverUrl: e.target.value })} placeholder="https://…" /></Field>

              <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 8 }}>
                <Check
                  label="Paid event (members are invoiced to register)"
                  checked={draft.paid}
                  // Ticking "paid" while the fee is still 0 is the illegal pair,
                  // so clear a stale fee when it is unticked rather than leaving
                  // the operator to notice.
                  onChange={(v) => setDraft({ ...draft, paid: v, fee: v ? draft.fee : '0' })}
                />
                <Field label={`Fee per member (naira)${feeKobo !== null ? ` — ${formatNaira(feeKobo)}` : ''}`}>
                  <Input value={draft.fee} disabled={!draft.paid} onChange={(e) => setDraft({ ...draft, fee: e.target.value })} placeholder="e.g. 15000" />
                </Field>
                {feeProblem && (
                  <p style={{ margin: 0, color: colors.danger, fontSize: '0.8rem' }}>{feeProblem}</p>
                )}
              </div>

              {editingId === 'new' && (
                <NotifyCheck what="event" checked={draft.notify} onChange={(v) => setDraft({ ...draft, notify: v })} />
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <Button variant="primary" disabled={busy || !!feeProblem} onClick={() => void save()}>{busy ? 'Saving…' : editingId === 'new' ? 'Create event' : 'Save changes'}</Button>
              <Button variant="outline" disabled={busy} onClick={() => { setEditingId(null); setDraft(EMPTY); }}>Cancel</Button>
            </div>
          </>
        )}
      </Card>

      <Card title={`Events (${rows.length})`}>
        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No events created for this organisation yet.">
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
            <thead><tr>
              <th style={thCell}>Event</th><th style={thCell}>When</th><th style={thCell}>Status</th>
              <th style={thCell}>Fee</th><th style={thCell}>Registered</th><th style={thCell}>Awaiting payment</th>
              <th style={thCell}>Capacity</th><th style={thCell}></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdCell}>
                    <div style={{ fontWeight: 600 }}>{r.title}</div>
                    <MetaLine parts={[r.meta.location, r.meta.organiser]} />
                  </td>
                  <td style={tdCell}>{fmtDate(r.meta.startsAt ?? r.at)}</td>
                  <td style={tdCell}><Badge text={r.status} color={r.status === 'UPCOMING' ? colors.primary : colors.muted} /></td>
                  <td style={tdCell}>
                    {r.meta.paid
                      ? <strong>{formatNaira(Number(r.meta.feeKobo ?? 0))}</strong>
                      : <span style={{ color: colors.muted }}>Free</span>}
                  </td>
                  <td style={tdCell}>{(r.meta.registeredCount ?? 0).toLocaleString('en-NG')}</td>
                  <td style={tdCell}>
                    {(r.meta.awaitingPayment ?? 0) > 0
                      ? <Badge text={`${r.meta.awaitingPayment}`} color={colors.warning} />
                      : <span style={{ color: colors.muted }}>0</span>}
                  </td>
                  <td style={tdCell}>{r.meta.capacity != null ? r.meta.capacity.toLocaleString('en-NG') : '—'}</td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button sm variant="outline" disabled={!canManage || busy} onClick={() => beginEdit(r)}>Edit</Button>
                      <Button sm variant="danger" disabled={!canManage || busy} onClick={() => void remove(r)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </ContentScaffold>
  );
}
