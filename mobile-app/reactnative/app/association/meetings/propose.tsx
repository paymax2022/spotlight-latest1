import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MapPin, Video, Users } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { useProposeMeeting } from '@/features/association/hooks/useEngagement';
import { alertAsync } from '@/lib/confirm';
import type { MeetingMode } from '@/features/association/types/engagement.types';

const MODES: { value: MeetingMode; label: string; Icon: typeof MapPin }[] = [
  { value: 'PHYSICAL', label: 'In person', Icon: MapPin },
  { value: 'VIRTUAL', label: 'Online', Icon: Video },
  { value: 'HYBRID', label: 'Both', Icon: Users },
];

/** Local `YYYY-MM-DD HH:mm` → ISO, or null when it is not a complete instant. */
function toIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) return null;
  if (!/^\d{2}:\d{2}$/.test(time.trim())) return null;
  const d = new Date(`${date.trim()}T${time.trim()}:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export default function ProposeMeetingScreen() {
  const propose = useProposeMeeting();
  const [touched, setTouched] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [mode, setMode] = useState<MeetingMode>('PHYSICAL');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');

  const startsAt = toIso(date, time);
  const titleError = title.trim().length < 3 ? 'Give the meeting a title' : undefined;
  const whenError = !date.trim() || !time.trim()
    ? 'Set a date and time'
    : !startsAt
      ? 'Use YYYY-MM-DD and HH:mm'
      // Refused server-side too; saying so here avoids a round trip to be told.
      : new Date(startsAt) <= new Date()
        ? 'Pick a time in the future'
        : undefined;

  const valid = !titleError && !whenError;

  const submit = () => {
    setTouched(true);
    if (!valid || !startsAt || propose.isPending) return;
    propose.mutate(
      {
        title: title.trim(),
        description: description.trim() || null,
        mode,
        startsAt,
        location: location.trim() || null,
      },
      {
        onSuccess: async (res) => {
          // The SERVER decides whether this was scheduled or queued — an admin's
          // proposal is approved on insert. Report what actually happened rather
          // than guessing from the caller's role.
          await alertAsync(
            res.approvalStatus === 'APPROVED'
              ? { title: 'Meeting scheduled', message: 'It is on the calendar and members have been notified.' }
              : { title: 'Sent for approval', message: 'An admin will review it. You can see it in your own list until then.' },
          );
          router.back();
        },
        onError: async () => {
          await alertAsync({ title: "Couldn't submit", message: 'Please check the details and try again.' });
        },
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Propose a meeting" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.help}>
          Anyone can put a meeting forward. If you are an admin it goes straight on the calendar; otherwise an admin reviews it first.
        </Text>

        <TextInputField label="Title" placeholder="e.g. Q1 planning meeting" value={title} onChangeText={setTitle} error={touched ? titleError : undefined} />

        <View style={styles.row}>
          <View style={styles.rowItem}>
            <TextInputField label="Date" placeholder="2026-09-15" value={date} onChangeText={setDate} keyboardType="numbers-and-punctuation" />
          </View>
          <View style={styles.rowItem}>
            <TextInputField label="Time" placeholder="18:30" value={time} onChangeText={setTime} keyboardType="numbers-and-punctuation" />
          </View>
        </View>
        {touched && whenError ? <Text style={styles.error}>{whenError}</Text> : null}

        <Text style={styles.label}>How will it be held?</Text>
        <View style={styles.modes}>
          {MODES.map(({ value, label, Icon }) => {
            const active = mode === value;
            return (
              <Pressable
                key={value}
                onPress={() => setMode(value)}
                style={[styles.mode, active && styles.modeActive]}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
              >
                <Icon size={16} color={active ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2} />
                <Text style={[styles.modeLabel, active && styles.modeLabelActive]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        <TextInputField
          label={mode === 'VIRTUAL' ? 'Join link (optional)' : 'Location (optional)'}
          placeholder={mode === 'VIRTUAL' ? 'https://…' : 'e.g. Community Hall, Ikeja'}
          value={location}
          onChangeText={setLocation}
          autoCapitalize={mode === 'VIRTUAL' ? 'none' : 'sentences'}
        />
        <TextInputField label="What is it about? (optional)" placeholder="Agenda, purpose, who should attend" value={description} onChangeText={setDescription} multiline numberOfLines={4} />
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={propose.isPending ? 'Submitting…' : 'Submit'}
          onPress={submit}
          disabled={propose.isPending || (touched && !valid)}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.md, paddingTop: Spacing.sm },
  help: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  label: { ...Typography.titleMd, color: Colors.onSurface },
  error: { ...Typography.labelSm, color: Colors.error },
  row: { flexDirection: 'row', gap: Spacing.sm },
  rowItem: { flex: 1 },
  modes: { flexDirection: 'row', gap: Spacing.sm },
  mode: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: Spacing.sm, borderRadius: Radius.lg, borderWidth: 1.5,
    borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest,
  },
  modeActive: { borderColor: Colors.primary },
  modeLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  modeLabelActive: { color: Colors.primary },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
