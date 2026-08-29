// ── Association — Task authoring form (create + edit) ─────────────────────────

import React, { useMemo, useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import TextInputField from '@/components/TextInputField';
import { alertAsync, confirmAsync } from '@/lib/confirm';
import AdminFormScreen from '../AdminFormScreen';
import { CONTENT_CAPABILITY } from '../../utils/authoringAccess';
import {
  FormCard, ChoiceRow, OptionSelect, NotifyToggle, StringListEditor, DateTimeField, FormNotice,
} from '../AdminFormControls';
import {
  useCreateTask, useUpdateTask, useDeleteTask, useOrgMembers, useOrgPickerLists, useAdminContent,
} from '../../hooks/useAuthoring';
import { useAdminAccess } from '../../hooks/useAdminMembers';
import { str, strList, oneOf } from '../../utils/metaFields';
import {
  TASK_PRIORITY_OPTIONS, TASK_STATUS_OPTIONS,
  type AdminContentRow, type AdminTaskStatus, type TaskInput,
} from '../../types/authoring.types';
import type { TaskPriority } from '../../types/engagement.types';

const STATUSES = TASK_STATUS_OPTIONS.map((o) => o.value);
const PRIORITIES = TASK_PRIORITY_OPTIONS.map((o) => o.value);

export default function TaskForm({ row }: { row?: AdminContentRow | null }) {
  const editing = Boolean(row);
  const meta = row?.meta ?? {};

  const access = useAdminAccess();
  const orgId = access.data?.organisationId ?? null;

  const [title, setTitle] = useState(row?.title ?? '');
  const [description, setDescription] = useState(str(meta.description) ?? '');
  const [status, setStatus] = useState<AdminTaskStatus>(oneOf(row?.status, STATUSES, 'ASSIGNED'));
  const [priority, setPriority] = useState<TaskPriority>(oneOf(meta.priority, PRIORITIES, 'MEDIUM'));
  const [dueDate, setDueDate] = useState<string | null>(str(meta.dueDate) ?? row?.at ?? null);
  const [assigneeId, setAssigneeId] = useState<string | null>(str(meta.assigneeId));
  const [committeeId, setCommitteeId] = useState<string | null>(str(meta.committeeId));
  const [meetingId, setMeetingId] = useState<string | null>(str(meta.meetingId));
  const [checklist, setChecklist] = useState<string[]>(strList(meta.checklist));
  const [notify, setNotify] = useState(false);

  const members = useOrgMembers(orgId);
  const lists = useOrgPickerLists(orgId);
  const meetings = useAdminContent('meetings', orgId);

  const create = useCreateTask();
  const update = useUpdateTask();
  const remove = useDeleteTask();

  // `id` on the directory DTO IS the membership id — which is what the server
  // wants for `assigneeId`, and what it 403s on if it belongs to another org.
  const memberOptions = useMemo(
    () => (members.data ?? []).map((m) => ({ value: m.id, label: `${m.fullName} · ${m.memberId}` })),
    [members.data],
  );
  const committeeOptions = useMemo(
    () => (lists.data?.committees ?? []).map((c) => ({ value: c.id, label: c.name })),
    [lists.data],
  );
  const meetingOptions = useMemo(
    () => (meetings.data ?? []).map((m) => ({ value: m.id, label: m.title })),
    [meetings.data],
  );

  const titleInvalid = title.trim() === '';

  const buildInput = (): TaskInput => ({
    title: title.trim(),
    description: description.trim() || null,
    status,
    priority,
    dueDate,
    assigneeId,
    committeeId,
    meetingId,
    checklist,
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
      title: 'Delete task',
      message: `“${row.title}” will be removed, including its checklist and comments.`,
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
      title={editing ? 'Edit task' : 'New task'}
      capability={CONTENT_CAPABILITY}
      saveLabel={editing ? 'Save changes' : 'Create task'}
      saving={create.isPending || update.isPending}
      saveDisabled={titleInvalid}
      onSave={onSave}
      onDelete={editing ? onDelete : undefined}
      deleteLabel="Delete task"
      deleting={remove.isPending}
    >
      {() => (
        <>
          <FormCard>
            <TextInputField
              label="Title"
              placeholder="e.g. Prepare the Q3 welfare report"
              value={title}
              onChangeText={setTitle}
              error={titleInvalid ? 'A title is required.' : undefined}
            />
            <TextInputField
              label="Description"
              placeholder="What needs doing?"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
              style={styles.multiline}
            />
            <ChoiceRow label="Priority" options={TASK_PRIORITY_OPTIONS} value={priority} onChange={setPriority} />
            <ChoiceRow label="Status" options={TASK_STATUS_OPTIONS} value={status} onChange={setStatus} />
            <DateTimeField label="Due" value={dueDate} onChange={setDueDate} optional timeRequired={false} />
          </FormCard>

          <FormCard title="Assignment">
            <OptionSelect
              label="Assignee"
              placeholder={members.isLoading ? 'Loading members…' : 'Unassigned'}
              clearLabel="Unassigned"
              options={memberOptions}
              value={assigneeId}
              onChange={setAssigneeId}
              disabled={members.isLoading}
            />
            {members.isError ? (
              <FormNotice text="The member list could not be loaded, so the assignee picker is empty." />
            ) : null}
            <OptionSelect
              label="Committee"
              options={committeeOptions}
              value={committeeId}
              onChange={setCommitteeId}
              disabled={lists.isLoading}
            />
            <OptionSelect
              label="Linked meeting"
              options={meetingOptions}
              value={meetingId}
              onChange={setMeetingId}
              disabled={meetings.isLoading}
            />
            <Text style={styles.hint}>
              The assignee, committee and meeting must all belong to this organisation — the server refuses a
              cross-organisation reference.
            </Text>
          </FormCard>

          <FormCard title="Checklist">
            <StringListEditor
              label="Steps"
              placeholder="Add a checklist step"
              items={checklist}
              onChange={setChecklist}
            />
          </FormCard>

          <FormCard title="Delivery">
            <NotifyToggle
              value={notify}
              onChange={setNotify}
              audience="the assignee only (not the whole organisation)"
              disabled={editing}
            />
            {!editing && notify && !assigneeId ? (
              <FormNotice text="No assignee is selected, so no notification will be sent." />
            ) : null}
          </FormCard>
        </>
      )}
    </AdminFormScreen>
  );
}

const styles = StyleSheet.create({
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  hint: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
