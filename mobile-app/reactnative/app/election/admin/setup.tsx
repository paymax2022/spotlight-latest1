import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, Trash2, CalendarClock, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { useCreateElection } from '@/features/election/hooks/useElection';
import { formatDateTime } from '@/features/visitor/utils/visitorFormatters';

type PositionDraft = { title: string; candidatesText: string };

const START_OPTIONS = [
  { key: 'now', label: 'Now' },
  { key: 'in1h', label: 'In 1 hour' },
  { key: 'tomorrow9', label: 'Tomorrow 9am' },
] as const;
const DURATION_OPTIONS = [
  { key: 'h6', label: '6 hours', hours: 6 },
  { key: 'd1', label: '1 day', hours: 24 },
  { key: 'd3', label: '3 days', hours: 72 },
  { key: 'w1', label: '1 week', hours: 168 },
] as const;

function startISO(key: string): string {
  const d = new Date();
  if (key === 'in1h') d.setHours(d.getHours() + 1);
  if (key === 'tomorrow9') { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
  return d.toISOString();
}

export default function ElectionSetupScreen() {
  const create = useCreateElection();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startKey, setStartKey] = useState<string>('now');
  const [durationHours, setDurationHours] = useState(24);
  const [positions, setPositions] = useState<PositionDraft[]>([{ title: '', candidatesText: '' }]);
  const [error, setError] = useState('');

  const startsAt = startISO(startKey);
  const endsAt = new Date(+new Date(startsAt) + durationHours * 3_600_000).toISOString();

  const updatePosition = (i: number, patch: Partial<PositionDraft>) =>
    setPositions((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const addPosition = () => setPositions((ps) => [...ps, { title: '', candidatesText: '' }]);
  const removePosition = (i: number) => setPositions((ps) => ps.filter((_, idx) => idx !== i));

  const submit = () => {
    setError('');
    if (!title.trim()) { setError('Enter an election title.'); return; }
    const mapped = positions
      .map((p) => ({ title: p.title.trim(), seats: 1, candidateNames: p.candidatesText.split('\n').map((s) => s.trim()).filter(Boolean) }))
      .filter((p) => p.title && p.candidateNames.length >= 2);
    if (mapped.length === 0) { setError('Add at least one position with two or more candidates (one per line).'); return; }
    create.mutate(
      { title: title.trim(), description: description.trim() || undefined, startsAt, endsAt, positions: mapped },
      {
        onSuccess: (created) => router.replace(`/election?id=${created.id}`),
        onError: (e) => setError(e instanceof Error ? e.message : 'Could not create the election.'),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Create election" subtitle="Admin" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <TextInputField label="Election title" placeholder="e.g. 2026 Estate Exco Election" value={title} onChangeText={setTitle} autoCapitalize="words" />
          <TextInputField label="Description (optional)" placeholder="What is this election about?" value={description} onChangeText={setDescription} multiline numberOfLines={3} style={styles.multiline} />

          {/* Schedule */}
          <View style={styles.labelRow}>
            <CalendarClock size={14} color={Colors.onSurface} strokeWidth={1.8} />
            <Text style={styles.label}>Starts</Text>
          </View>
          <View style={styles.chipRow}>
            {START_OPTIONS.map((o) => {
              const selected = o.key === startKey;
              return (
                <Pressable key={o.key} onPress={() => setStartKey(o.key)} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.chip, selected && styles.chipSelected]}>
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.labelRow}>
            <Clock size={14} color={Colors.onSurface} strokeWidth={1.8} />
            <Text style={styles.label}>Duration</Text>
          </View>
          <View style={styles.chipRow}>
            {DURATION_OPTIONS.map((o) => {
              const selected = o.hours === durationHours;
              return (
                <Pressable key={o.key} onPress={() => setDurationHours(o.hours)} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.chip, selected && styles.chipSelected]}>
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.window}>Opens {formatDateTime(startsAt)} · closes {formatDateTime(endsAt)}</Text>

          {/* Positions */}
          <View style={styles.posHeader}>
            <Text style={styles.label}>Positions</Text>
            <Pressable onPress={addPosition} accessibilityRole="button" accessibilityLabel="Add position" hitSlop={8} style={styles.addBtn}>
              <Plus size={16} color={Colors.secondary} strokeWidth={2.4} />
              <Text style={styles.addText}>Add</Text>
            </Pressable>
          </View>

          {positions.map((p, i) => (
            <View key={i} style={styles.posCard}>
              <View style={styles.posCardHead}>
                <Text style={styles.posCardTitle}>Position {i + 1}</Text>
                {positions.length > 1 ? (
                  <Pressable onPress={() => removePosition(i)} accessibilityRole="button" accessibilityLabel="Remove position" hitSlop={8}>
                    <Trash2 size={16} color={Colors.error} strokeWidth={1.8} />
                  </Pressable>
                ) : null}
              </View>
              <TextInputField label="Title" placeholder="e.g. Chairperson" value={p.title} onChangeText={(v) => updatePosition(i, { title: v })} autoCapitalize="words" />
              <TextInputField label="Candidates (one per line, min 2)" placeholder={'Ngozi Okeke\nEmeka Eze'} value={p.candidatesText} onChangeText={(v) => updatePosition(i, { candidatesText: v })} multiline numberOfLines={3} style={styles.multiline} />
            </View>
          ))}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label="Create election" onPress={submit} loading={create.isPending} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.sm },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginTop: Spacing.sm },
  multiline: { minHeight: 76, textAlignVertical: 'top', paddingTop: Spacing.sm },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: Spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.transparent },
  chipSelected: { backgroundColor: Colors.surfaceContainerLowest, borderColor: Colors.secondary },
  chipText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipTextSelected: { color: Colors.secondary },
  window: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  posHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 },
  addText: { ...Typography.labelMd, color: Colors.secondary },
  posCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, gap: 2 },
  posCardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.xs },
  posCardTitle: { ...Typography.labelLg, color: Colors.onSurface },
  error: { ...Typography.labelMd, color: Colors.error, marginTop: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow },
});
