'use client';

// Announcements authoring.
//
// assoc_announcements had a member-facing READ endpoint and no writer anywhere
// in the repo, so the table was permanently empty and the members' announcement
// screen rendered an empty state forever. This page is the writer.
//
// The listing is the ADMIN one (GET /admin/organisations/:id/announcements):
// the member read joins through the caller's own memberships and returns
// nothing for a platform admin, so authoring here and reading there would have
// shown an operator their own post vanishing.

import { useState } from 'react';
import {
  listAdminAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement,
  type AnnouncementRow, type AnnouncementInput,
} from '@/services/associationAdminService';
import { useSelectedOrg, fmtDate } from '../../_ui';
import {
  ContentScaffold, StateBlock, useContentRows, Field, Check, NotifyCheck, MetaLine,
  useAssociationPermissions, ASSOCIATION_PERMS,
  formGrid, selectStyle, textareaStyle,
} from '../_content';
import { Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

// assoc_announcements.audience is free text on the backend; these are the
// values the member app filters on, offered as a list so an operator cannot
// invent a fourth that nothing reads.
const AUDIENCES = ['ALL', 'CHAPTER', 'COMMITTEE', 'EXECUTIVES'];

type Draft = {
  title: string; body: string; audience: string;
  urgent: boolean; requiresAck: boolean; notify: boolean;
};
const EMPTY: Draft = { title: '', body: '', audience: 'ALL', urgent: false, requiresAck: false, notify: false };

export default function AssociationAnnouncementsPage() {
  const orgId = useSelectedOrg();
  const { can } = useAssociationPermissions();
  const canManage = can(ASSOCIATION_PERMS.manage);

  const { rows, loading, error, reload, setError } = useContentRows<AnnouncementRow>(
    orgId, (id) => listAdminAnnouncements(id, { limit: 100 }),
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  function beginAdd() {
    setEditingId('new'); setDraft(EMPTY); setMsg(null); setError(null);
  }
  function beginEdit(r: AnnouncementRow) {
    setEditingId(r.id); setMsg(null); setError(null);
    setDraft({
      title: r.title, body: r.meta.body ?? '', audience: r.meta.audience || 'ALL',
      urgent: !!r.meta.urgent, requiresAck: !!r.meta.requiresAck,
      // notify is create-only on the backend; an edit can never re-notify.
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
      const input: AnnouncementInput = {
        title,
        body: draft.body.trim() || null,
        audience: draft.audience || null,
        urgent: draft.urgent,
        requiresAck: draft.requiresAck,
        ...(isNew ? { notify: draft.notify } : {}),
      };
      if (isNew) await createAnnouncement(orgId, input);
      else await updateAnnouncement(editingId!, input);
      setMsg(
        `${isNew ? 'Posted' : 'Updated'} "${title}".`
        + (isNew && draft.notify ? ' Every active member was notified in-app.' : '')
        + ' Recorded to the audit log (NL-12).',
      );
      setEditingId(null); setDraft(EMPTY);
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function remove(r: AnnouncementRow) {
    if (!window.confirm(`Delete "${r.title}"? Its read and acknowledgement records go with it. This cannot be undone.`)) return;
    setBusy(true); setError(null); setMsg(null);
    try {
      await deleteAnnouncement(r.id);
      setMsg(`Deleted "${r.title}". Recorded to the audit log (NL-12).`);
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const editing = editingId !== null;

  return (
    <ContentScaffold
      tab="announcements"
      title="Announcements"
      subtitle="Post notices to the members of the selected organisation, and see how many have read and acknowledged them."
      disclosure={<>
        Writes go to <code>/api/finance/associations/admin/organisations/:id/announcements</code>; the list is the
        admin-scoped read (the member-facing one returns nothing for a platform admin). Every create, edit and delete is
        recorded to the immutable audit log (NL-12). <strong>Notify</strong> is honoured on create only and sends one
        in-app notification per ACTIVE member.
      </>}
      orgId={orgId} loading={loading} error={error} msg={msg} canManage={canManage} onRefresh={() => void reload()}
    >
      <Card title={editing ? (editingId === 'new' ? 'New announcement' : 'Edit announcement') : 'Author'}>
        {!canManage ? <p style={{ fontSize: '0.85rem', color: colors.muted, marginTop: 12 }}>Read-only.</p> : !editing ? (
          <div style={{ marginTop: 12 }}><Button variant="primary" onClick={beginAdd}>New announcement</Button></div>
        ) : (
          <>
            <div style={formGrid}>
              <Field label="Title" wide>
                <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Annual general meeting notice" />
              </Field>
              <Field label="Body" wide>
                <textarea style={{ ...textareaStyle, minHeight: 96 }} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="What members need to know…" />
              </Field>
              <Field label="Audience">
                <select style={selectStyle} value={draft.audience} onChange={(e) => setDraft({ ...draft, audience: e.target.value })}>
                  {AUDIENCES.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </Field>
              <div style={{ display: 'grid', gap: 8, alignContent: 'end' }}>
                <Check label="Urgent" checked={draft.urgent} onChange={(v) => setDraft({ ...draft, urgent: v })} />
                <Check label="Requires acknowledgement" checked={draft.requiresAck} onChange={(v) => setDraft({ ...draft, requiresAck: v })} />
              </div>
              {editingId === 'new' && (
                <NotifyCheck what="announcement" checked={draft.notify} onChange={(v) => setDraft({ ...draft, notify: v })} />
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : editingId === 'new' ? 'Post announcement' : 'Save changes'}</Button>
              <Button variant="outline" disabled={busy} onClick={() => { setEditingId(null); setDraft(EMPTY); }}>Cancel</Button>
            </div>
          </>
        )}
      </Card>

      <Card title={`Posted (${rows.length})`}>
        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No announcements posted for this organisation yet.">
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
            <thead><tr>
              <th style={thCell}>Announcement</th><th style={thCell}>Audience</th><th style={thCell}>Flags</th>
              <th style={thCell}>Read</th><th style={thCell}>Acknowledged</th><th style={thCell}>Posted</th><th style={thCell}></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdCell}>
                    <div style={{ fontWeight: 600 }}>{r.title}</div>
                    <MetaLine parts={[r.meta.author, r.meta.body ? `${r.meta.body.slice(0, 80)}${r.meta.body.length > 80 ? '…' : ''}` : null]} />
                  </td>
                  <td style={tdCell}>{r.meta.audience || '—'}</td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {r.meta.urgent && <Badge text="Urgent" color={colors.danger} />}
                      {r.meta.requiresAck && <Badge text="Ack required" color={colors.warning} />}
                      {!r.meta.urgent && !r.meta.requiresAck && <span style={{ color: colors.muted }}>—</span>}
                    </div>
                  </td>
                  <td style={tdCell}>{(r.meta.readCount ?? 0).toLocaleString('en-NG')}</td>
                  <td style={tdCell}>{r.meta.requiresAck ? (r.meta.ackCount ?? 0).toLocaleString('en-NG') : '—'}</td>
                  <td style={tdCell}>{fmtDate(r.at)}</td>
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
