import { useCreateAnnouncement, useCreateDocument, useDeleteAnnouncement, useDeleteDocument, useUpdateAnnouncement, useUpdateDocument } from '../../hooks/useAuthoring';
import type { DocCategory } from '../../types';
import { DOC_CATEGORY_OPTIONS, DOC_KIND_OPTIONS } from '../../types/authoring.types';
import type { AdminContentRow, DocKind, DocumentInput, AnnouncementInput } from '../../types/authoring.types';
import { CONTENT_CAPABILITY, bool, oneOf, str } from '../../utils';
import { ChoiceRow, FormCard, FormNotice, NotifyToggle, ToggleRow } from '../AdminFormControls';
import { AdminFormScreen } from '../index';
import TextInputField from '@/components/TextInputField';
import { Colors, Typography } from '@/constants/tokens';
import { alertAsync, confirmAsync } from '@/lib/confirm';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text } from 'react-native';


export function AnnouncementForm({ row }: { row?: AdminContentRow | null }) {
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
              style={announcementFormStyles.multiline}
            />
            <TextInputField
              label="Audience label"
              placeholder="e.g. All members · Lagos Chapter"
              value={audience}
              onChangeText={setAudience}
            />
            <Text style={announcementFormStyles.hint}>
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

const announcementFormStyles = StyleSheet.create({
  multiline: { minHeight: 120, textAlignVertical: 'top' },
  hint: { ...Typography.caption, color: Colors.onSurfaceVariant },
});

const CATEGORIES = DOC_CATEGORY_OPTIONS.map((o) => o.value);
const KINDS = DOC_KIND_OPTIONS.map((o) => o.value);

export function DocumentForm({ row }: { row?: AdminContentRow | null }) {
  const editing = Boolean(row);
  const meta = row?.meta ?? {};

  const [title, setTitle] = useState(row?.title ?? '');
  const [category, setCategory] = useState<DocCategory>(oneOf(row?.subtitle, CATEGORIES, 'reports'));
  const [kind, setKind] = useState<DocKind>(oneOf(meta.kind, KINDS, 'pdf'));
  const [storageKey, setStorageKey] = useState(str(meta.storageKey) ?? '');
  const [sizeLabel, setSizeLabel] = useState(str(meta.sizeLabel) ?? '');
  const [version, setVersion] = useState(str(meta.version) ?? 'v1');
  const [restricted, setRestricted] = useState(bool(meta.restricted));
  const [requiresAck, setRequiresAck] = useState(bool(meta.requiresAck));
  const [aiSummary, setAiSummary] = useState(str(meta.aiSummary) ?? '');
  const [notify, setNotify] = useState(false);

  const create = useCreateDocument();
  const update = useUpdateDocument();
  const remove = useDeleteDocument();

  const titleInvalid = title.trim() === '';

  const buildInput = (): DocumentInput => ({
    title: title.trim(),
    category,
    kind,
    storageKey: storageKey.trim() || null,
    sizeLabel: sizeLabel.trim() || null,
    version: version.trim() || 'v1',
    restricted,
    requiresAck,
    aiSummary: aiSummary.trim() || null,
    ...(editing ? {} : { notify }),
  });

  const onSave = () => {
    if (titleInvalid) return;
    const input = buildInput();
    const onError = (e: unknown) =>
      alertAsync({ title: 'Could not save', message: (e as Error)?.message ?? 'Please try again.' });
    if (editing && row) update.mutate({ id: row.id, input }, { onSuccess: () => router.back(), onError });
    else create.mutate(input, { onSuccess: () => router.back(), onError });
  };

  const onDelete = async () => {
    if (!row) return;
    const ok = await confirmAsync({
      title: 'Delete document',
      message: `“${row.title}” will be removed from the vault for every member.`,
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
      title={editing ? 'Edit document' : 'New document'}
      capability={CONTENT_CAPABILITY}
      saveLabel={editing ? 'Save changes' : 'Add to vault'}
      saving={create.isPending || update.isPending}
      saveDisabled={titleInvalid}
      onSave={onSave}
      onDelete={editing ? onDelete : undefined}
      deleteLabel="Delete document"
      deleting={remove.isPending}
    >
      {() => (
        <>
          <FormCard>
            <TextInputField
              label="Title"
              placeholder="e.g. Constitution (2026 revision)"
              value={title}
              onChangeText={setTitle}
              error={titleInvalid ? 'A title is required.' : undefined}
            />
            <ChoiceRow label="Category" options={DOC_CATEGORY_OPTIONS} value={category} onChange={setCategory} />
            <ChoiceRow label="File type" options={DOC_KIND_OPTIONS} value={kind} onChange={setKind} />
            <TextInputField label="Version" placeholder="v1" value={version} onChangeText={setVersion} />
          </FormCard>

          <FormCard title="File">
            <FormNotice
              tone="info"
              text="This screen records the vault entry. Upload the file to storage first, then paste its object key here."
            />
            <TextInputField
              label="Storage key"
              placeholder="e.g. associations/nma/constitution-2026.pdf"
              value={storageKey}
              onChangeText={setStorageKey}
              autoCapitalize="none"
            />
            <TextInputField
              label="Size label"
              placeholder="e.g. 2.4 MB"
              value={sizeLabel}
              onChangeText={setSizeLabel}
            />
            <Text style={documentFormStyles.hint}>
              The size label is shown to members as-is; it is not measured from the file.
            </Text>
          </FormCard>

          <FormCard title="Access">
            <ToggleRow
              label="Restricted"
              help="Only members whose category or role grants access can open it."
              value={restricted}
              onChange={setRestricted}
            />
            <ToggleRow
              label="Require acknowledgement"
              help="Members must confirm they have read it."
              value={requiresAck}
              onChange={setRequiresAck}
            />
            <TextInputField
              label="Summary"
              placeholder="Optional plain-language summary shown above the document"
              value={aiSummary}
              onChangeText={setAiSummary}
              multiline
              numberOfLines={4}
              style={documentFormStyles.multiline}
            />
            <NotifyToggle value={notify} onChange={setNotify} disabled={editing} />
          </FormCard>
        </>
      )}
    </AdminFormScreen>
  );
}

const documentFormStyles = StyleSheet.create({
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  hint: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
