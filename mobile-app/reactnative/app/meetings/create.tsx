import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { MEETING_MODE_META } from '@/features/meetings/constants/meetings.constants';
import { useCreateMeeting } from '@/features/meetings/hooks/useMeetings';
import { formatMeetingWhen } from '@/features/meetings/utils/meetingsFormatters';
import type { MeetingMode } from '@/features/meetings/types/meetings.types';

const MODES: MeetingMode[] = ['physical', 'virtual', 'hybrid'];

const START_PRESETS: { key: string; label: string }[] = [
  { key: 'today6', label: 'Today 6pm' },
  { key: 'tom10', label: 'Tomorrow 10am' },
  { key: 'in3d6', label: 'In 3 days 6pm' },
];
const DURATIONS = [
  { label: '1 hr', hours: 1 },
  { label: '2 hrs', hours: 2 },
  { label: '3 hrs', hours: 3 },
];

function startISO(key: string): string {
  const d = new Date();
  if (key === 'today6') { d.setHours(18, 0, 0, 0); if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1); }
  if (key === 'tom10') { d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); }
  if (key === 'in3d6') { d.setDate(d.getDate() + 3); d.setHours(18, 0, 0, 0); }
  return d.toISOString();
}

export default function CreateMeetingScreen() {
  const create = useCreateMeeting();
  const [title, setTitle] = useState('');
  const [agenda, setAgenda] = useState('');
  const [mode, setMode] = useState<MeetingMode>('physical');
  const [location, setLocation] = useState('');
  const [startKey, setStartKey] = useState('tom10');
  const [durationHours, setDurationHours] = useState(2);
  const [error, setError] = useState('');

  const startsAt = startISO(startKey);
  const endsAt = new Date(+new Date(startsAt) + durationHours * 3_600_000).toISOString();

  const submit = () => {
    setError('');
    if (!title.trim()) { setError('Enter a meeting title.'); return; }
    create.mutate(
      { title: title.trim(), agenda: agenda.trim() || undefined, mode, location: location.trim() || undefined, startsAt, endsAt },
      { onSuccess: (m) => router.replace(`/meetings/${m.id}`), onError: (e) => setError(e instanceof Error ? e.message : 'Could not create the meeting.') },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Schedule meeting" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <TextInputField label="Title" placeholder="e.g. Q3 General Meeting" value={title} onChangeText={setTitle} autoCapitalize="words" />
          <TextInputField label="Agenda (optional)" placeholder="What will be discussed?" value={agenda} onChangeText={setAgenda} multiline numberOfLines={3} style={styles.multiline} />

          <Text style={styles.label}>Format</Text>
          <View style={styles.modeRow}>
            {MODES.map((m) => {
              const selected = m === mode;
              const meta = MEETING_MODE_META[m];
              const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.Users;
              return (
                <Pressable key={m} onPress={() => setMode(m)} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.mode, selected && styles.modeSelected]}>
                  <Icon size={18} color={selected ? Colors.onPrimary : Colors.secondary} strokeWidth={1.8} />
                  <Text style={[styles.modeText, selected && { color: Colors.onPrimary }]}>{meta.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <TextInputField label="Location / link (optional)" placeholder={mode === 'virtual' ? 'Zoom / Meet link' : 'e.g. Clubhouse'} value={location} onChangeText={setLocation} />

          <Text style={styles.label}>Starts</Text>
          <View style={styles.chipRow}>
            {START_PRESETS.map((p) => {
              const selected = p.key === startKey;
              return (
                <Pressable key={p.key} onPress={() => setStartKey(p.key)} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.chip, selected && styles.chipSelected]}>
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{p.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Duration</Text>
          <View style={styles.chipRow}>
            {DURATIONS.map((d) => {
              const selected = d.hours === durationHours;
              return (
                <Pressable key={d.label} onPress={() => setDurationHours(d.hours)} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.chip, selected && styles.chipSelected]}>
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{d.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.summary}>
            <Clock size={16} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
            <Text style={styles.summaryText}>{formatMeetingWhen(startsAt)} · {durationHours} hr{durationHours > 1 ? 's' : ''}</Text>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label="Schedule meeting" onPress={submit} loading={create.isPending} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.sm },
  multiline: { minHeight: 76, textAlignVertical: 'top', paddingTop: Spacing.sm },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginTop: Spacing.sm },
  modeRow: { flexDirection: 'row', gap: Spacing.sm },
  mode: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: Spacing.sm, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerLow, backgroundColor: Colors.surfaceContainerLowest, minHeight: 44 },
  modeSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  modeText: { ...Typography.labelMd, color: Colors.onSurface },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.transparent },
  chipSelected: { backgroundColor: Colors.surfaceContainerLowest, borderColor: Colors.secondary },
  chipText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipTextSelected: { color: Colors.secondary },
  summary: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.sm },
  summaryText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  error: { ...Typography.labelMd, color: Colors.error, marginTop: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow },
});
