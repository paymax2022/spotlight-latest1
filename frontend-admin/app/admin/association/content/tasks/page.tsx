'use client';

// Task assignment.
//
// assigneeId, committeeId and meetingId are all foreign keys the backend
// verifies belong to THIS organisation before it will write the row
// (assertBelongsToOrg — a foreign one is a 403). So all three are pickers
// loaded from the selected organisation, never free-text ids: a typed id can
// only ever be a 403 or, worse, a valid id in someone else's association.

import { useCallback, useEffect, useState } from 'react';
import {
  listAdminTasks, createTask, updateTask, deleteTask,
  listAdminMeetings, getAdminOrganisation, listMembers,
  dateInputToRfc3339, rfc3339ToDateInput,
  TASK_STATUSES, TASK_PRIORITIES,
  type TaskRow, type TaskInput, type TaskStatus, type TaskPriority,
  type MeetingRow, type OrgCommittee, type MemberSummary,
} from '@/services/associationAdminService';
import { useSelectedOrg, fmtDate } from '../../_ui';
import {
  ContentScaffold, StateBlock, useContentRows, Field, MetaLine, StringListEditor, NotifyCheck,
  useAssociationPermissions, ASSOCIATION_PERMS,
  formGrid, selectStyle, textareaStyle,
} from '../_content';
import { Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

type Draft = {
  title: string; description: string; status: TaskStatus; priority: TaskPriority;
  dueDate: string; assigneeId: string; committeeId: string; meetingId: string;
  checklist: string[]; notify: boolean;
};
const EMPTY: Draft = {
  title: '', description: '', status: 'ASSIGNED', priority: 'MEDIUM',
  dueDate: '', assigneeId: '', committeeId: '', meetingId: '', checklist: [], notify: false,
};

function priorityColor(p: string) {
  if (p === 'HIGH') return colors.danger;
  if (p === 'LOW') return colors.muted;
  return colors.warning;
}
function statusColor(s: string) {
  if (s === 'COMPLETED') return colors.success;
  if (s === 'BLOCKED' || s === 'REJECTED' || s === 'OVERDUE') return colors.danger;
  if (s === 'CANCELLED' || s === 'DRAFT') return colors.muted;
  return colors.primary;
}

export default function AssociationTasksPage() {
  const orgId = useSelectedOrg();
  const { can } = useAssociationPermissions();
  const canManage = can(ASSOCIATION_PERMS.manage);

  const { rows, loading, error, reload, setError } = useContentRows<TaskRow>(
    orgId, (id) => listAdminTasks(id, { limit: 100 }),
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  // ── Pickers ──
  // Loaded once per organisation, not per keystroke, and only when the editor
  // is actually opened would be nicer still — but the assignee name is also
  // wanted for the table when the listing's LEFT JOIN finds no profile row.
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [committees, setCommittees] = useState<OrgCommittee[]>([]);
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [pickerError, setPickerError] = useState<string | null>(null);

  const loadPickers = useCallback(async () => {
    if (!orgId) { setMembers([]); setCommittees([]); setMeetings([]); return; }
    setPickerError(null);
    // Settled individually: a failing meetings list must not also empty the
    // assignee picker, which would silently make every task unassignable.
    const [m, o, mt] = await Promise.allSettled([
      listMembers(), getAdminOrganisation(orgId), listAdminMeetings(orgId, { limit: 100 }),
    ]);
    setMembers(m.status === 'fulfilled' ? m.value : []);
    setCommittees(o.status === 'fulfilled' ? o.value.committees : []);
    setMeetings(mt.status === 'fulfilled' ? mt.value : []);
    const failed = [
      m.status === 'rejected' ? 'members' : null,
      o.status === 'rejected' ? 'committees' : null,
      mt.status === 'rejected' ? 'meetings' : null,
    ].filter(Boolean);
    if (failed.length) setPickerError(`Could not load the ${failed.join(' / ')} picker — those fields will be empty.`);
  }, [orgId]);
  useEffect(() => { void loadPickers(); }, [loadPickers]);

  function beginAdd() { setEditingId('new'); setDraft(EMPTY); setMsg(null); setError(null); }
  function beginEdit(r: TaskRow) {
    setEditingId(r.id); setMsg(null); setError(null);
    setDraft({
      title: r.title,
      description: r.meta.description ?? '',
      status: (TASK_STATUSES.includes(r.status as TaskStatus) ? r.status : 'ASSIGNED') as TaskStatus,
      priority: (TASK_PRIORITIES.includes(r.meta.priority as TaskPriority) ? r.meta.priority : 'MEDIUM') as TaskPriority,
      dueDate: rfc3339ToDateInput(r.meta.dueDate ?? r.at),
      assigneeId: r.meta.assigneeId ?? '',
      committeeId: r.meta.committeeId ?? '',
      meetingId: r.meta.meetingId ?? '',
      checklist: Array.isArray(r.meta.checklist) ? [...r.meta.checklist] : [],
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
      if (draft.notify && !draft.assigneeId) {
        throw new Error('Notify sends the task to its assignee — pick an assignee, or untick notify.');
      }
      const input: TaskInput = {
        title,
        description: draft.description.trim() || null,
        status: draft.status,
        priority: draft.priority,
        dueDate: dateInputToRfc3339(draft.dueDate),
        assigneeId: draft.assigneeId || null,
        committeeId: draft.committeeId || null,
        meetingId: draft.meetingId || null,
        checklist: draft.checklist.map((c) => c.trim()).filter(Boolean),
        ...(isNew ? { notify: draft.notify } : {}),
      };
      if (isNew) await createTask(orgId, input);
      else await updateTask(editingId!, input);
      const who = members.find((m) => m.id === draft.assigneeId)?.fullName;
      setMsg(
        `${isNew ? 'Created' : 'Updated'} "${title}"${who ? ` for ${who}` : ' (unassigned)'}.`
        + (isNew && draft.notify ? ' The assignee was notified in-app.' : '')
        + ' Recorded to the audit log (NL-12).',
      );
      setEditingId(null); setDraft(EMPTY);
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function remove(r: TaskRow) {
    if (!window.confirm(`Delete "${r.title}"? This cannot be undone.`)) return;
    setBusy(true); setError(null); setMsg(null);
    try {
      await deleteTask(r.id);
      setMsg(`Deleted "${r.title}". Recorded to the audit log (NL-12).`);
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const editing = editingId !== null;

  return (
    <ContentScaffold
      tab="tasks"
      title="Tasks"
      subtitle="Assign work to a member, a committee or a meeting, with a due date, a priority and a checklist."
      disclosure={<>
        Writes go to <code>/api/finance/associations/admin/organisations/:id/tasks</code>. Assignee, committee and
        meeting are pickers because the backend verifies each one belongs to <em>this</em> organisation and refuses a
        foreign id with a 403. <strong>Notify</strong> messages the assignee only — not the whole organisation — and is
        honoured on create only. Recorded to the immutable audit log (NL-12).
      </>}
      orgId={orgId} loading={loading} error={error} msg={msg} canManage={canManage} onRefresh={() => { void reload(); void loadPickers(); }}
    >
      {pickerError && <p style={{ color: colors.warning, fontSize: '0.8rem' }}>{pickerError}</p>}

      <Card title={editing ? (editingId === 'new' ? 'New task' : 'Edit task') : 'Tasks'}>
        {!canManage ? <p style={{ fontSize: '0.85rem', color: colors.muted, marginTop: 12 }}>Read-only.</p> : !editing ? (
          <div style={{ marginTop: 12 }}><Button variant="primary" onClick={beginAdd}>New task</Button></div>
        ) : (
          <>
            <div style={formGrid}>
              <Field label="Title" wide>
                <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Reconcile chapter remittances" />
              </Field>
              <Field label="Description" wide>
                <textarea style={{ ...textareaStyle, minHeight: 72 }} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </Field>
              <Field label="Status">
                <select style={selectStyle} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as TaskStatus })}>
                  {TASK_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                </select>
              </Field>
              <Field label="Priority">
                <select style={selectStyle} value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as TaskPriority })}>
                  {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Due date">
                <Input type="date" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} />
              </Field>
              <Field label={`Assignee (${members.length} member(s) in this organisation)`}>
                <select style={selectStyle} value={draft.assigneeId} onChange={(e) => setDraft({ ...draft, assigneeId: e.target.value })}>
                  <option value="">— Unassigned —</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.fullName} · {m.memberId}{m.status !== 'ACTIVE' && m.status !== 'active' ? ` (${m.status})` : ''}</option>
                  ))}
                </select>
              </Field>
              <Field label="Committee">
                <select style={selectStyle} value={draft.committeeId} onChange={(e) => setDraft({ ...draft, committeeId: e.target.value })}>
                  <option value="">— None —</option>
                  {committees.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Arising from meeting">
                <select style={selectStyle} value={draft.meetingId} onChange={(e) => setDraft({ ...draft, meetingId: e.target.value })}>
                  <option value="">— None —</option>
                  {meetings.map((m) => <option key={m.id} value={m.id}>{m.title} · {fmtDate(m.meta.startsAt ?? m.at)}</option>)}
                </select>
              </Field>
              <Field label="Checklist" wide>
                <StringListEditor
                  items={draft.checklist} onChange={(checklist) => setDraft({ ...draft, checklist })}
                  placeholder="e.g. Pull chapter statements" addLabel="+ Add checklist item"
                />
              </Field>
              {editingId === 'new' && (
                <NotifyCheck what="task" checked={draft.notify} onChange={(v) => setDraft({ ...draft, notify: v })} />
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : editingId === 'new' ? 'Create task' : 'Save changes'}</Button>
              <Button variant="outline" disabled={busy} onClick={() => { setEditingId(null); setDraft(EMPTY); }}>Cancel</Button>
            </div>
          </>
        )}
      </Card>

      <Card title={`Tasks (${rows.length})`}>
        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No tasks assigned in this organisation yet.">
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
            <thead><tr>
              <th style={thCell}>Task</th><th style={thCell}>Assignee</th><th style={thCell}>Priority</th>
              <th style={thCell}>Status</th><th style={thCell}>Due</th><th style={thCell}>Checklist</th><th style={thCell}></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const checklist = Array.isArray(r.meta.checklist) ? r.meta.checklist : [];
                const committee = committees.find((c) => c.id === r.meta.committeeId)?.name;
                const meeting = meetings.find((m) => m.id === r.meta.meetingId)?.title;
                return (
                  <tr key={r.id}>
                    <td style={tdCell}>
                      <div style={{ fontWeight: 600 }}>{r.title}</div>
                      <MetaLine parts={[committee && `Committee: ${committee}`, meeting && `From: ${meeting}`, r.meta.description]} />
                    </td>
                    <td style={tdCell}>
                      {r.meta.assigneeName || r.subtitle
                        || (r.meta.assigneeId
                          ? members.find((m) => m.id === r.meta.assigneeId)?.fullName ?? <code style={{ fontSize: '0.75rem' }}>{r.meta.assigneeId}</code>
                          : <span style={{ color: colors.muted }}>Unassigned</span>)}
                    </td>
                    <td style={tdCell}><Badge text={r.meta.priority || 'MEDIUM'} color={priorityColor(r.meta.priority)} /></td>
                    <td style={tdCell}><Badge text={r.status.replace(/_/g, ' ')} color={statusColor(r.status)} /></td>
                    <td style={tdCell}>{fmtDate(r.meta.dueDate ?? r.at)}</td>
                    <td style={tdCell}>{checklist.length > 0 ? `${checklist.length} item(s)` : '—'}</td>
                    <td style={tdCell}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Button sm variant="outline" disabled={!canManage || busy} onClick={() => beginEdit(r)}>Edit</Button>
                        <Button sm variant="danger" disabled={!canManage || busy} onClick={() => void remove(r)}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </ContentScaffold>
  );
}
