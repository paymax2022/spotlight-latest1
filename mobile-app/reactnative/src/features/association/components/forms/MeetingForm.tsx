// ── Association — Meeting authoring form (create + edit) ──────────────────────

import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { alertAsync, confirmAsync } from '@/lib/confirm';
import AdminFormScreen from '../AdminFormScreen';
import { CONTENT_CAPABILITY } from '../../utils/authoringAccess';
import {
  FormCard, ChoiceRow, ToggleRow, NotifyToggle, StringListEditor, DateTimeField, FormNotice,
} from '../AdminFormControls';
import {
  useCreateMeeting, useUpdateMeeting, useDeleteMeeting, usePublishMinutes,
} from '../../hooks/useAuthoring';
import { str, bool, strList, oneOf } from '../../utils/metaFields';
import {
  MEETING_MODE_OPTIONS, MEETING_STATE_OPTIONS, type MeetingInput, type AdminContentRow,
} from '../../types/authoring.types';
import type { MeetingMode, MeetingState } from '../../types/engagement.types';

const MODES = MEETING_MODE_OPTIONS.map((o) => o.value);
const STATES = MEETING_STATE_OPTIONS.map((o) => o.value);

export default function MeetingForm({ row }: { row?: AdminContentRow | null }) {
  const editing = Boolean(row);
  const meta = row?.meta ?? {};

  const [title, setTitle] = useState(row?.title ?? '');
  const [description, setDescription] = useState(str(meta.description) ?? '');
  const [mode, setMode] = useState<MeetingMode>(oneOf(meta.mode, MODES, 'PHYSICAL'));
  const [state, setState] = useState<MeetingState>(oneOf(row?.status, STATES, 'UPCOMING'));
  const [startsAt, setStartsAt] = useState<string | null>(str(meta.startsAt) ?? row?.at ?? null);
  const [endsAt, setEndsAt] = useState<string | null>(str(meta.endsAt));
  const [location, setLocation] = useState(str(meta.location) ?? '');
  const [agenda, setAgenda] = useState<string[]>(strList(meta.agenda));
  const [generateCode, setGenerateCode] = useState(false);
  const [notify, setNotify] = useState(false);

  const create = useCreateMeeting();
  const update = useUpdateMeeting();
  const remove = useDeleteMeeting();
  const minutes = usePublishMinutes();

  const attendanceCode = str(meta.attendanceCode);
  const minutesPublished = bool(meta.minutesPublished);

  const titleInvalid = title.trim() === '';
  const startInvalid = !startsAt;
  const endBeforeStart = Boolean(startsAt && endsAt && new Date(endsAt) < new Date(startsAt));

  const buildInput = (): MeetingInput => ({
    title: title.trim(),
    description: description.trim() || null,
    mode,
    startsAt: startsAt as string,
    endsAt,
    location: location.trim() || null,
    state,
    agenda,
    ...(editing ? {} : { generateAttendanceCode: generateCode, notify }),
  });

  const onSave = () => {
    if (titleInvalid || startInvalid || endBeforeStart) return;
    const input = buildInput();
    const onError = (e: unknown) =>
      alertAsync({ title: 'Could not save', message: (e as Error)?.message ?? 'Please try again.' });
    if (editing && row) update.mutate({ id: row.id, input }, { onSuccess: () => router.back(), onError });
    else create.mutate(input, { onSuccess: () => router.back(), onError });
  };

  const onDelete = async () => {
    if (!row) return;
    const ok = await confirmAsync({
      title: 'Delete meeting',
      message: `“${row.title}” and its RSVPs will be removed.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    remove.mutate(row.id, {
      onSuccess: () => router.back(),
      onError: (e) => alertAsync({ title: 'Could not delete', message: (e as Error)?.message ?? 'Please try again.' }),
    });
  };

  const toggleMinutes = () => {
    if (!row) return;
    minutes.mutate({ id: row.id, published: !minutesPublished }, {
      onError: (e) => alertAsync({ title: 'Could not update minutes', message: (e as Error)?.message ?? 'Please try again.' }),
    });
  };

  return (
    <AdminFormScreen
      title={editing ? 'Edit meeting' : 'New meeting'}
      capability={CONTENT_CAPABILITY}
      saveLabel={editing ? 'Save changes' : 'Create meeting'}
      saving={create.isPending || update.isPending}
      saveDisabled={titleInvalid || startInvalid || endBeforeStart}
      onSave={onSave}
      onDelete={editing ? onDelete : undefined}
      deleteLabel="Delete meeting"
      deleting={remove.isPending}
    >
      {() => (
        <>
          <FormCard>
            <TextInputField
              label="Title"
              placeholder="e.g. September chapter meeting"
              value={title}
              onChangeText={setTitle}
              error={titleInvalid ? 'A title is required.' : undefined}
            />
            <TextInputField
              label="Description"
              placeholder="What is this meeting about?"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
              style={styles.multiline}
            />
            <ChoiceRow label="Mode" options={MEETING_MODE_OPTIONS} value={mode} onChange={setMode} />
            <TextInputField
              label={mode === 'VIRTUAL' ? 'Join link or label' : 'Location'}
              placeholder={mode === 'VIRTUAL' ? 'e.g. Zoom — link sent on RSVP' : 'e.g. NMA House, Ikeja'}
              value={location}
              onChangeText={setLocation}
            />
          </FormCard>

          <FormCard title="When">
            <DateTimeField label="Starts" value={startsAt} onChange={setStartsAt} />
            <DateTimeField label="Ends" value={endsAt} onChange={setEndsAt} optional />
            {endBeforeStart ? <FormNotice tone="error" text="The end time is before the start time." /> : null}
            <ChoiceRow label="State" options={MEETING_STATE_OPTIONS} value={state} onChange={setState} />
          </FormCard>

          <FormCard title="Agenda">
            <StringListEditor
              label="Agenda items"
              placeholder="Add an agenda item"
              items={agenda}
              onChange={setAgenda}
            />
          </FormCard>

          <FormCard title="Attendance & minutes">
            {editing ? (
              <>
                {attendanceCode ? (
                  <View style={styles.codeBox}>
                    <Text style={styles.codeLabel}>Attendance code</Text>
                    <Text style={styles.code}>{attendanceCode}</Text>
                    <Text style={styles.codeHint}>Members enter this to check in.</Text>
                  </View>
                ) : (
                  <FormNotice text="No attendance code was issued for this meeting." />
                )}
                <Text style={styles.minutesState}>
                  Minutes are currently {minutesPublished ? 'published' : 'unpublished'}.
                </Text>
                <PrimaryButton
                  label={minutesPublished ? 'Unpublish minutes' : 'Publish minutes'}
                  variant="secondary"
                  loading={minutes.isPending}
                  onPress={toggleMinutes}
                />
              </>
            ) : (
              <ToggleRow
                label="Issue an attendance code"
                help="Generates a short check-in code members enter at the meeting."
                value={generateCode}
                onChange={setGenerateCode}
              />
            )}
            <NotifyToggle value={notify} onChange={setNotify} disabled={editing} />
          </FormCard>
        </>
      )}
    </AdminFormScreen>
  );
}

const styles = StyleSheet.create({
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  codeBox: {
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md,
    padding: Spacing.md, gap: 2,
  },
  codeLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  code: { ...Typography.headlineMd, color: Colors.onSurface, letterSpacing: 2 },
  codeHint: { ...Typography.caption, color: Colors.outline },
  minutesState: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
