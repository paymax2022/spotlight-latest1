// ── Association — Event authoring form (create + edit) ────────────────────────
//
// Money: the admin types NAIRA, the API carries INTEGER KOBO. The conversion is
// `nairaToKobo` (digit-wise, never `parseFloat * 100`), and the paid/fee rule
// the server enforces is enforced inline here so an admin sees why the form is
// blocked instead of meeting a 400 after pressing save.

import React, { useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import TextInputField from '@/components/TextInputField';
import { alertAsync, confirmAsync } from '@/lib/confirm';
import AdminFormScreen from '../AdminFormScreen';
import { CONTENT_CAPABILITY } from '../../utils/authoringAccess';
import { FormCard, ToggleRow, NotifyToggle, DateTimeField, FormNotice } from '../AdminFormControls';
import { useCreateEvent, useUpdateEvent, useDeleteEvent } from '../../hooks/useAuthoring';
import { str, bool, num, kobo } from '../../utils/metaFields';
import { formatNaira, nairaToKobo } from '../../utils/associationFormatters';
import type { AdminContentRow, EventInput } from '../../types/authoring.types';

/** kobo → the naira text the amount field starts with. Integer-safe. */
function koboToNairaText(value: number): string {
  if (value <= 0) return '';
  const whole = Math.trunc(value / 100);
  const frac = value % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0')}`;
}

export default function EventForm({ row }: { row?: AdminContentRow | null }) {
  const editing = Boolean(row);
  const meta = row?.meta ?? {};

  const [title, setTitle] = useState(row?.title ?? '');
  const [description, setDescription] = useState(str(meta.description) ?? '');
  const [startsAt, setStartsAt] = useState<string | null>(str(meta.startsAt) ?? row?.at ?? null);
  const [endsAt, setEndsAt] = useState<string | null>(str(meta.endsAt));
  const [location, setLocation] = useState(str(meta.location) ?? '');
  const [paid, setPaid] = useState(bool(meta.paid));
  const [feeText, setFeeText] = useState(koboToNairaText(kobo(meta.feeKobo)));
  const [capacityText, setCapacityText] = useState(() => {
    const c = num(meta.capacity);
    return c === null ? '' : String(c);
  });
  const [organiser, setOrganiser] = useState(str(meta.organiser) ?? '');
  const [coverUrl, setCoverUrl] = useState(str(meta.coverUrl) ?? '');
  const [notify, setNotify] = useState(false);

  const create = useCreateEvent();
  const update = useUpdateEvent();
  const remove = useDeleteEvent();

  const feeKobo = feeText.trim() === '' ? 0 : nairaToKobo(feeText);
  const feeMalformed = feeKobo === null;
  const capacity = capacityText.trim() === '' ? null : Number(capacityText.trim());
  const capacityInvalid = capacity !== null && (!Number.isInteger(capacity) || capacity < 0);

  const titleInvalid = title.trim() === '';
  const startInvalid = !startsAt;
  const endBeforeStart = Boolean(startsAt && endsAt && new Date(endsAt) < new Date(startsAt));

  // The server's rule, mirrored: paid REQUIRES a fee above zero, and a free
  // event REQUIRES a zero fee. Both are 400s, and a "paid" event that slipped
  // through with a zero fee would issue free tickets for a ticketed event.
  const paidWithoutFee = paid && (feeKobo ?? 0) <= 0;
  const feeWithoutPaid = !paid && (feeKobo ?? 0) > 0;

  const blocked = titleInvalid || startInvalid || endBeforeStart || feeMalformed
    || paidWithoutFee || feeWithoutPaid || capacityInvalid;

  const buildInput = (): EventInput => ({
    title: title.trim(),
    description: description.trim() || null,
    startsAt: startsAt as string,
    endsAt,
    location: location.trim() || null,
    paid,
    feeKobo: paid ? (feeKobo as number) : 0,
    capacity,
    organiser: organiser.trim() || null,
    coverUrl: coverUrl.trim() || null,
    ...(editing ? {} : { notify }),
  });

  const onSave = () => {
    if (blocked) return;
    const input = buildInput();
    const onError = (e: unknown) =>
      alertAsync({ title: 'Could not save', message: (e as Error)?.message ?? 'Please try again.' });
    if (editing && row) update.mutate({ id: row.id, input }, { onSuccess: () => router.back(), onError });
    else create.mutate(input, { onSuccess: () => router.back(), onError });
  };

  const onDelete = async () => {
    if (!row) return;
    const ok = await confirmAsync({
      title: 'Delete event',
      // Verified against the live endpoint: the server REFUSES to delete an
      // event that already carries a paid registration rather than orphaning
      // the money, so promising the deletion outright would be a promise it
      // does not keep.
      message: `“${row.title}” and its registrations will be removed. An event that already has a paid registration cannot be deleted — cancel it instead.`,
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
      title={editing ? 'Edit event' : 'New event'}
      capability={CONTENT_CAPABILITY}
      saveLabel={editing ? 'Save changes' : 'Create event'}
      saving={create.isPending || update.isPending}
      saveDisabled={blocked}
      onSave={onSave}
      onDelete={editing ? onDelete : undefined}
      deleteLabel="Delete event"
      deleting={remove.isPending}
    >
      {() => (
        <>
          <FormCard>
            <TextInputField
              label="Title"
              placeholder="e.g. Annual CPD seminar"
              value={title}
              onChangeText={setTitle}
              error={titleInvalid ? 'A title is required.' : undefined}
            />
            <TextInputField
              label="Description"
              placeholder="What is happening, and who is it for?"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
              style={styles.multiline}
            />
            <TextInputField label="Location" placeholder="e.g. Eko Hotel, Victoria Island" value={location} onChangeText={setLocation} />
            <TextInputField label="Organiser" placeholder="e.g. Events Committee" value={organiser} onChangeText={setOrganiser} />
          </FormCard>

          <FormCard title="When">
            <DateTimeField label="Starts" value={startsAt} onChange={setStartsAt} />
            <DateTimeField label="Ends" value={endsAt} onChange={setEndsAt} optional />
            {endBeforeStart ? <FormNotice tone="error" text="The end time is before the start time." /> : null}
          </FormCard>

          <FormCard title="Tickets">
            <ToggleRow
              label="Paid event"
              help="Registering raises an invoice; the ticket is issued once it is paid."
              value={paid}
              onChange={(v) => { setPaid(v); if (!v) setFeeText(''); }}
            />
            {paid ? (
              <>
                <TextInputField
                  label="Fee (₦)"
                  placeholder="5000"
                  value={feeText}
                  onChangeText={setFeeText}
                  keyboardType="decimal-pad"
                  error={feeMalformed ? 'Enter an amount like 5000 or 5000.50.' : undefined}
                />
                {!feeMalformed && (feeKobo ?? 0) > 0 ? (
                  <Text style={styles.hint}>
                    Members will be invoiced {formatNaira(feeKobo as number)} ({feeKobo} kobo).
                  </Text>
                ) : null}
                {paidWithoutFee ? <FormNotice tone="error" text="A paid event needs a fee greater than ₦0." /> : null}
              </>
            ) : (
              <Text style={styles.hint}>Free events register members immediately and issue a ticket on the spot.</Text>
            )}
            {feeWithoutPaid ? <FormNotice tone="error" text="Clear the fee, or mark the event paid." /> : null}
            <TextInputField
              label="Capacity"
              placeholder="Leave blank for unlimited"
              value={capacityText}
              onChangeText={setCapacityText}
              keyboardType="number-pad"
              error={capacityInvalid ? 'Capacity must be a whole number.' : undefined}
            />
          </FormCard>

          <FormCard title="Presentation">
            <TextInputField
              label="Cover image URL"
              placeholder="https://…"
              value={coverUrl}
              onChangeText={setCoverUrl}
              autoCapitalize="none"
            />
            <NotifyToggle value={notify} onChange={setNotify} disabled={editing} />
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
