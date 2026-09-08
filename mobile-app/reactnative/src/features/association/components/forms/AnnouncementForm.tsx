// ── Association — Announcement authoring form (create + edit) ─────────────────

import React, { useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Typography } from '@/constants/typography';
import { Colors } from '@/constants/colors';
import TextInputField from '@/components/TextInputField';
import { alertAsync, confirmAsync } from '@/lib/confirm';
import AdminFormScreen from '../AdminFormScreen';
import { CONTENT_CAPABILITY } from '../../utils/authoringAccess';
import { FormCard, ToggleRow, NotifyToggle, FormNotice } from '../AdminFormControls';
import {
  useCreateAnnouncement, useUpdateAnnouncement, useDeleteAnnouncement,
} from '../../hooks/useAuthoring';
import { str, bool } from '../../utils/metaFields';
import type { AdminContentRow, AnnouncementInput } from '../../types/authoring.types';

export default function AnnouncementForm({ row }: { row?: AdminContentRow | null }) {
  const editing = Boolean(row);
  const meta = row?.meta ?? {};

  const [title, setTitle] = useState(row?.title ?? '');
  const [body, setBody] = useState(str(meta.body) ?? '');
  const [audience, setAudience] = useState(str(meta.audience) ?? '');
  const [urgent, setUrgent] = useState(bool(meta.urgent));
  const [requiresAck, setRequiresAck] = useState(bool(meta.requiresAck));
  const [notify, setNotify] = useState(false);

  const create = useCreateAnnouncement();
  const update = useUpdateAnnouncement();
  const remove = useDeleteAnnouncement();

  const titleInvalid = title.trim() === '';

  const buildInput = (): AnnouncementInput => ({
    title: title.trim(),
    body: body.trim() || null,
    audience: audience.trim() || null,
    urgent,
    requiresAck,
    // Only a create fans out; the server ignores it on a PATCH.
    ...(editing ? {} : { notify }),
  });

  const onSave = () => {
    if (titleInvalid) return;
    const input = buildInput();
    const onError = (e: unknown) =>
      alertAsync({ title: 'Could not save', message: (e as Error)?.message ?? 'Please try again.' });

    if (editing && row) {
      update.mutate({ id: row.id, input }, { onSuccess: () => router.back(), onError });
    } else {
      create.mutate(input, { onSuccess: () => router.back(), onError });
    }
  };

  const onDelete = async () => {
    if (!row) return;
    const ok = await confirmAsync({
      title: 'Delete announcement',
      message: `“${row.title}” will be removed for every member who can see it.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    remove.mutate(row.id, {
      onSuccess: () => router.back(),
      onError: (e) => alertAsync({ title: 'Could not delete', message: (e as Error)?.message ?? 'Please try again.' }),
    });
  };

  return (
    <AdminFormScreen
      title={editing ? 'Edit announcement' : 'New announcement'}
      capability={CONTENT_CAPABILITY}
      saveLabel={editing ? 'Save changes' : 'Post announcement'}
      saving={create.isPending || update.isPending}
      saveDisabled={titleInvalid}
      onSave={onSave}
      onDelete={editing ? onDelete : undefined}
      deleteLabel="Delete announcement"
      deleting={remove.isPending}
    >
      {() => (
        <>
          <FormCard>
            <TextInputField
              label="Title"
              placeholder="e.g. 2026 AGM date confirmed"
              value={title}
              onChangeText={setTitle}
              error={titleInvalid ? 'A title is required.' : undefined}
            />
            <TextInputField
              label="Body"
              placeholder="What do members need to know?"
              value={body}
              onChangeText={setBody}
              multiline
              numberOfLines={6}
              style={styles.multiline}
            />
            <TextInputField
              label="Audience label"
              placeholder="e.g. All members · Lagos Chapter"
              value={audience}
              onChangeText={setAudience}
            />
            <Text style={styles.hint}>
              The audience label is what members see under the title. It does not restrict who can read the post.
            </Text>
          </FormCard>

          <FormCard title="Delivery">
            <ToggleRow
              label="Mark urgent"
              help="Pins the announcement to the top of the member feed."
              value={urgent}
              onChange={setUrgent}
            />
            <ToggleRow
              label="Require acknowledgement"
              help="Members must tap “I acknowledge” before it leaves their feed."
              value={requiresAck}
              onChange={setRequiresAck}
            />
            <NotifyToggle value={notify} onChange={setNotify} disabled={editing} />
            {editing ? (
              <FormNotice tone="info" text="Notifications went out when this was first posted; editing does not re-notify." />
            ) : null}
          </FormCard>
        </>
      )}
    </AdminFormScreen>
  );
}

const styles = StyleSheet.create({
  multiline: { minHeight: 120, textAlignVertical: 'top' },
  hint: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
