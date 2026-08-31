'use client';

// Meetings authoring — agenda, mode/state, attendance code, minutes.
//
// assoc_meetings had reads and no writer, so RSVP and check-in had nothing to
// attach to. The attendance code is issued by the backend on create
// (generateAttendanceCode) and is what the member app checks in against; there
// is no separate "issue code later" route, which is why the toggle is only
// offered on the create form and shown read-only afterwards.

import { useState } from 'react';
import {
  listAdminMeetings, createMeeting, updateMeeting, deleteMeeting, publishMeetingMinutes,
  localInputToRfc3339, rfc3339ToLocalInput,
  MEETING_MODES, MEETING_STATES,
  type MeetingRow, type MeetingInput, type MeetingMode, type MeetingState,
} from '@/services/associationAdminService';
import { useSelectedOrg, fmtDate } from '../../_ui';
import {
  ContentScaffold, StateBlock, useContentRows, Field, Check, NotifyCheck, MetaLine, StringListEditor,
  useAssociationPermissions, ASSOCIATION_PERMS,
  formGrid, selectStyle, textareaStyle,
} from '../_content';
import { Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

type Draft = {
  title: string; description: string; mode: MeetingMode; state: MeetingState;
  startsAt: string; endsAt: string; location: string; agenda: string[];
  generateAttendanceCode: boolean; notify: boolean;
};
const EMPTY: Draft = {
  title: '', description: '', mode: 'PHYSICAL', state: 'UPCOMING',
  startsAt: '', endsAt: '', location: '', agenda: [],
  generateAttendanceCode: false, notify: false,
};

function stateColor(s: string) {
  if (s === 'LIVE') return colors.success;
  if (s === 'CANCELLED') return colors.danger;
  if (s === 'PAST') return colors.muted;
  return colors.primary;
}

export default function AssociationMeetingsPage() {
  const orgId = useSelectedOrg();
  const { can } = useAssociationPermissions();
  const canManage = can(ASSOCIATION_PERMS.manage);

  const { rows, loading, error, reload, setError } = useContentRows<MeetingRow>(
    orgId, (id) => listAdminMeetings(id, { limit: 100 }),
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  function beginAdd() { setEditingId('new'); setDraft(EMPTY); setMsg(null); setError(null); }
  function beginEdit(r: MeetingRow) {
    setEditingId(r.id); setMsg(null); setError(null);
    setDraft({
      title: r.title,
      description: r.meta.description ?? '',
      mode: (MEETING_MODES.includes(r.meta.mode as MeetingMode) ? r.meta.mode : 'PHYSICAL') as MeetingMode,
      state: (MEETING_STATES.includes(r.status as MeetingState) ? r.status : 'UPCOMING') as MeetingState,
      startsAt: rfc3339ToLocalInput(r.meta.startsAt ?? r.at),
      endsAt: rfc3339ToLocalInput(r.meta.endsAt),
      location: r.meta.location ?? '',
      agenda: Array.isArray(r.meta.agenda) ? [...r.meta.agenda] : [],
      // Create-only on the backend — a meeting that already has a code keeps it.
      generateAttendanceCode: false,
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
      const startsAt = localInputToRfc3339(draft.startsAt);
      const endsAt = localInputToRfc3339(draft.endsAt);
      // Checked here as well as on the server so the operator is told before a
      // round-trip discards the form.
      if (startsAt && endsAt && new Date(endsAt) < new Date(startsAt)) {
        throw new Error('The end time is before the start time.');
      }
      const input: MeetingInput = {
        title,
        description: draft.description.trim() || null,
        mode: draft.mode,
        startsAt: startsAt!,
        endsAt,
        location: draft.location.trim() || null,
        state: draft.state,
        // Blank rows would become empty agenda items nobody can see.
        agenda: draft.agenda.map((a) => a.trim()).filter(Boolean),
        ...(isNew ? { generateAttendanceCode: draft.generateAttendanceCode, notify: draft.notify } : {}),
      };
      if (isNew) await createMeeting(orgId, input);
      else await updateMeeting(editingId!, input);
      setMsg(
        `${isNew ? 'Scheduled' : 'Updated'} "${title}".`
        + (isNew && draft.generateAttendanceCode ? ' An attendance code was issued for check-in.' : '')
        + (isNew && draft.notify ? ' Every active member was notified in-app.' : '')
        + ' Recorded to the audit log (NL-12).',
      );
      setEditingId(null); setDraft(EMPTY);
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function remove(r: MeetingRow) {
    if (!window.confirm(`Delete "${r.title}"? RSVPs and check-ins for it go too. This cannot be undone.`)) return;
    setBusy(true); setError(null); setMsg(null);
    try {
      await deleteMeeting(r.id);
      setMsg(`Deleted "${r.title}". Recorded to the audit log (NL-12).`);
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function toggleMinutes(r: MeetingRow) {
    const next = !r.meta.minutesPublished;
    setBusy(true); setError(null); setMsg(null);
    try {
      await publishMeetingMinutes(r.id, next);
      setMsg(`Minutes for "${r.title}" ${next ? 'published — members can now read them' : 'retracted — members can no longer read them'}. Recorded to the audit log (NL-12).`);
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const editing = editingId !== null;

  return (
    <ContentScaffold
      tab="meetings"
      title="Meetings"
      subtitle="Schedule meetings, set the agenda, issue an attendance code and publish minutes."
      disclosure={<>
        Writes go to <code>/api/finance/associations/admin/organisations/:id/meetings</code>. Start and end times are
        sent as RFC3339 — the local date/time you pick is converted on submit. The attendance code is issued once, on
        create. Publishing minutes is what makes them visible to members. All of it is recorded to the immutable audit
        log (NL-12).
      </>}
      orgId={orgId} loading={loading} error={error} msg={msg} canManage={canManage} onRefresh={() => void reload()}
    >
      <Card title={editing ? (editingId === 'new' ? 'New meeting' : 'Edit meeting') : 'Schedule'}>
        {!canManage ? <p style={{ fontSize: '0.85rem', color: colors.muted, marginTop: 12 }}>Read-only.</p> : !editing ? (
          <div style={{ marginTop: 12 }}><Button variant="primary" onClick={beginAdd}>New meeting</Button></div>
        ) : (
          <>
            <div style={formGrid}>
              <Field label="Title" wide>
                <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Executive council sitting" />
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
              <Field label="Mode">
                <select style={selectStyle} value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value as MeetingMode })}>
                  {MEETING_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
              <Field label="State">
                <select style={selectStyle} value={draft.state} onChange={(e) => setDraft({ ...draft, state: e.target.value as MeetingState })}>
                  {MEETING_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label={draft.mode === 'VIRTUAL' ? 'Joining link / location' : 'Location'} wide>
                <Input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} placeholder={draft.mode === 'VIRTUAL' ? 'https://…' : 'e.g. National Secretariat, Lagos'} />
              </Field>
              <Field label="Agenda" wide>
                <StringListEditor
                  items={draft.agenda} onChange={(agenda) => setDraft({ ...draft, agenda })}
                  placeholder="e.g. Treasurer's report" addLabel="+ Add agenda item"
                />
              </Field>
              {editingId === 'new' && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <Check
                    label="Issue an attendance code (members check in with it)"
                    checked={draft.generateAttendanceCode}
                    onChange={(v) => setDraft({ ...draft, generateAttendanceCode: v })}
                  />
                </div>
              )}
              {editingId === 'new' && (
                <NotifyCheck what="meeting" checked={draft.notify} onChange={(v) => setDraft({ ...draft, notify: v })} />
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : editingId === 'new' ? 'Schedule meeting' : 'Save changes'}</Button>
              <Button variant="outline" disabled={busy} onClick={() => { setEditingId(null); setDraft(EMPTY); }}>Cancel</Button>
            </div>
          </>
        )}
      </Card>

      <Card title={`Meetings (${rows.length})`}>
        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No meetings scheduled for this organisation yet.">
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
            <thead><tr>
              <th style={thCell}>Meeting</th><th style={thCell}>When</th><th style={thCell}>Mode</th>
              <th style={thCell}>State</th><th style={thCell}>RSVP / checked in</th>
              <th style={thCell}>Code</th><th style={thCell}>Minutes</th><th style={thCell}></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdCell}>
                    <div style={{ fontWeight: 600 }}>{r.title}</div>
                    <MetaLine parts={[
                      r.meta.location,
                      Array.isArray(r.meta.agenda) && r.meta.agenda.length > 0 ? `${r.meta.agenda.length} agenda item(s)` : 'no agenda',
                    ]} />
                  </td>
                  <td style={tdCell}>{fmtDate(r.meta.startsAt ?? r.at)}</td>
                  <td style={tdCell}>{r.meta.mode}</td>
                  <td style={tdCell}><Badge text={r.status} color={stateColor(r.status)} /></td>
                  <td style={tdCell}>{(r.meta.rsvpCount ?? 0).toLocaleString('en-NG')} / {(r.meta.checkedInCount ?? 0).toLocaleString('en-NG')}</td>
                  <td style={tdCell}>{r.meta.attendanceCode ? <code style={{ fontSize: '0.78rem' }}>{r.meta.attendanceCode}</code> : <span style={{ color: colors.muted }}>none</span>}</td>
                  <td style={tdCell}>
                    <Badge text={r.meta.minutesPublished ? 'Published' : 'Unpublished'} color={r.meta.minutesPublished ? colors.success : colors.muted} />
                  </td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <Button sm variant="outline" disabled={!canManage || busy} onClick={() => beginEdit(r)}>Edit</Button>
                      <Button sm variant={r.meta.minutesPublished ? 'secondary' : 'primary'} disabled={!canManage || busy} onClick={() => void toggleMinutes(r)}>
                        {r.meta.minutesPublished ? 'Unpublish minutes' : 'Publish minutes'}
                      </Button>
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
