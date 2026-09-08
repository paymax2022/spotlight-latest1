import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useAdminAccess } from '@/features/association/hooks/useAdminMembers';
import { createEvent } from '@/features/association/api/authoring.api';
import { alertAsync } from '@/lib/confirm';

function toIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) return null;
  if (!/^\d{2}:\d{2}$/.test(time.trim())) return null;
  const d = new Date(`${date.trim()}T${time.trim()}:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export default function NewEventScreen() {
  const access = useAdminAccess();
  const orgId = access.data?.isAdmin ? access.data.organisationId ?? undefined : undefined;

  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [paid, setPaid] = useState(false);
  const [fee, setFee] = useState('');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const startsAt = toIso(date, time);
  const titleError = title.trim().length < 3 ? 'Give the event a title' : undefined;
  const whenError = !date.trim() || !time.trim()
    ? 'Set a date and time'
    : !startsAt
      ? 'Use YYYY-MM-DD and HH:mm'
      : new Date(startsAt) <= new Date()
        ? 'Pick a time in the future'
        : undefined;
  // The server refuses paid-with-no-fee and free-with-a-fee; catching it here
  // avoids a round trip to be told something the form already knows.
  const feeKobo = Math.round(Number(fee.replace(/[^0-9.]/g, '') || '0') * 100);
  const feeError = paid && feeKobo <= 0 ? 'Set a ticket price' : undefined;
  const valid = !titleError && !whenError && !feeError;

  const submit = async () => {
    setTouched(true);
    if (!valid || !orgId || !startsAt || saving) return;
    setSaving(true);
    try {
      await createEvent(orgId, {
        title: title.trim(),
        description: description.trim() || null,
        startsAt,
        location: location.trim() || null,
        paid,
        feeKobo: paid ? feeKobo : 0,
        notify: true,
      });
      await alertAsync({ title: 'Event created', message: 'Members have been notified. You can invite people from the event.' });
      router.back();
    } catch {
      await alertAsync({ title: "Couldn't create the event", message: 'Please check the details and try again.' });
    } finally {
      setSaving(false);
    }
  };

  if (access.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="New event" />
        <StateView kind="loading" message="Checking your access…" />
      </SafeAreaView>
    );
  }
  if (!orgId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="New event" />
        <StateView kind="empty" icon="ShieldAlert" title="Admins only" message="Only an organisation admin can create events." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="New event" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TextInputField label="Title" placeholder="e.g. Annual general meeting" value={title} onChangeText={setTitle} error={touched ? titleError : undefined} />
        <View style={styles.row}>
          <View style={styles.rowItem}>
            <TextInputField label="Date" placeholder="2026-10-02" value={date} onChangeText={setDate} keyboardType="numbers-and-punctuation" />
          </View>
          <View style={styles.rowItem}>
            <TextInputField label="Time" placeholder="16:00" value={time} onChangeText={setTime} keyboardType="numbers-and-punctuation" />
          </View>
        </View>
        {touched && whenError ? <Text style={styles.error}>{whenError}</Text> : null}

        <TextInputField label="Location (optional)" placeholder="e.g. Civic Centre, Victoria Island" value={location} onChangeText={setLocation} />
        <TextInputField label="Details (optional)" placeholder="What is happening, who should come" value={description} onChangeText={setDescription} multiline numberOfLines={3} />

        <Text style={styles.label}>Tickets</Text>
        <View style={styles.row}>
          {[{ v: false, l: 'Free' }, { v: true, l: 'Paid' }].map(({ v, l }) => {
            const active = paid === v;
            return (
              <Pressable key={l} onPress={() => setPaid(v)} style={[styles.chip, active && styles.chipActive]} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{l}</Text>
              </Pressable>
            );
          })}
        </View>
        {paid ? (
          <TextInputField label="Ticket price (₦)" placeholder="5000" value={fee} onChangeText={setFee} keyboardType="decimal-pad" error={touched ? feeError : undefined} />
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label={saving ? 'Creating…' : 'Create event'} onPress={submit} disabled={saving || (touched && !valid)} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.sm, paddingTop: Spacing.sm },
  label: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  error: { ...Typography.labelSm, color: Colors.error },
  row: { flexDirection: 'row', gap: Spacing.sm },
  rowItem: { flex: 1 },
  chip: {
    flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: Radius.lg,
    borderWidth: 1.5, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest,
  },
  chipActive: { borderColor: Colors.primary },
  chipText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipTextActive: { color: Colors.primary },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
