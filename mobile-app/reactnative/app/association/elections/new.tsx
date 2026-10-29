import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, Trash2 } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import DatePickerField from '@/components/DatePickerField';
import TimePickerField from '@/components/TimePickerField';
import { useAdminAccess, useCreateElection } from '@/features/association/hooks';
import type { ElectionPositionInput } from '@/features/association/api/authoring.api';
import { alertAsync } from '@/lib/confirm';

type HandoverRole = NonNullable<ElectionPositionInput['role']> | '';

const HANDOVER_OPTIONS: Array<{ value: HandoverRole; label: string }> = [
  { value: '', label: 'No role' },
  { value: 'NATIONAL_ADMIN', label: 'National admin' },
  { value: 'CHAPTER_ADMIN', label: 'Chapter admin' },
  { value: 'FINANCE_ADMIN', label: 'Finance admin' },
  { value: 'SECRETARY', label: 'Secretary' },
];

interface PositionDraft { key: number; title: string; seats: string; role: HandoverRole }

function toIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${date}T${time}:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export default function NewElectionScreen() {
  const access = useAdminAccess();
  const create = useCreateElection();
  const isAdmin = Boolean(access.data?.isAdmin);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [opensDate, setOpensDate] = useState('');
  const [opensTime, setOpensTime] = useState('');
  const [closesDate, setClosesDate] = useState('');
  const [closesTime, setClosesTime] = useState('');
  const [goodStanding, setGoodStanding] = useState(true);
  const [positions, setPositions] = useState<PositionDraft[]>([{ key: 1, title: '', seats: '1', role: '' }]);
  const [nextKey, setNextKey] = useState(2);
  const [touched, setTouched] = useState(false);

  const opensAt = toIso(opensDate, opensTime);
  const closesAt = toIso(closesDate, closesTime);

  const titleError = title.trim().length < 3 ? 'Give the election a title' : undefined;
  const filled = positions.filter((p) => p.title.trim());
  const positionsError = filled.length === 0 ? 'Add at least one position to elect' : undefined;
  const windowError = !opensAt || !closesAt
    ? 'Set when voting opens and closes'
    : new Date(closesAt) <= new Date(opensAt)
      ? 'Voting must close after it opens'
      : new Date(closesAt) <= new Date()
        ? 'The closing time must be in the future'
        : undefined;
  const valid = !titleError && !positionsError && !windowError;

  const patchPosition = (key: number, patch: Partial<PositionDraft>) =>
    setPositions((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const submit = async () => {
    setTouched(true);
    if (!valid || !opensAt || !closesAt || create.isPending) return;
    try {
      const res = await create.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
        votingOpensAt: opensAt,
        votingClosesAt: closesAt,
        requireGoodStanding: goodStanding,
        positions: filled.map((p) => ({
          title: p.title.trim(),
          seats: Math.max(1, Math.floor(Number(p.seats) || 1)),
          ...(p.role ? { role: p.role } : {}),
        })),
      });
      // Straight to the election so candidates can be added and voting opened.
      router.replace(`/association/elections/${res.id}` as never);
    } catch {
      await alertAsync({ title: "Couldn't create the election", message: 'Please check the details and try again.' });
    }
  };

  if (access.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Set up election" />
        <StateView kind="loading" message="Checking your access…" />
      </SafeAreaView>
    );
  }
  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Set up election" />
        <StateView kind="empty" icon="ShieldAlert" title="Admins only" message="Only an organisation admin can set up an election." />
      </SafeAreaView>
    );
  }

  const year = new Date().getFullYear();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Set up election" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TextInputField label="Title" placeholder="e.g. 2027 Executive Election" value={title} onChangeText={setTitle} error={touched ? titleError : undefined} />
        <TextInputField label="Description (optional)" placeholder="What members are voting on" value={description} onChangeText={setDescription} multiline numberOfLines={3} />

        <Text style={styles.label}>Voting opens</Text>
        <View style={styles.row}>
          <View style={styles.rowItem}><DatePickerField value={opensDate} onChange={setOpensDate} minYear={year} maxYear={year + 3} /></View>
          <View style={styles.rowItem}><TimePickerField value={opensTime} onChange={setOpensTime} /></View>
        </View>
        <Text style={styles.label}>Voting closes</Text>
        <View style={styles.row}>
          <View style={styles.rowItem}><DatePickerField value={closesDate} onChange={setClosesDate} minYear={year} maxYear={year + 3} /></View>
          <View style={styles.rowItem}><TimePickerField value={closesTime} onChange={setClosesTime} /></View>
        </View>
        {touched && windowError ? <Text style={styles.error}>{windowError}</Text> : null}

        <View style={[styles.switchRow, shadow1]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchTitle}>Good standing required</Text>
            <Text style={styles.help}>Members with overdue dues cannot vote or stand.</Text>
          </View>
          <Switch value={goodStanding} onValueChange={setGoodStanding} trackColor={{ true: Colors.primary }} accessibilityLabel="Require good standing" />
        </View>

        <Text style={styles.label}>Positions</Text>
        <Text style={styles.help}>Each position is a separate ballot. You add the candidates next.</Text>
        {positions.map((p, i) => (
          <View key={p.key} style={[styles.posCard, shadow1]}>
            <View style={styles.posHead}>
              <Text style={styles.posIndex}>Position {i + 1}</Text>
              {positions.length > 1 ? (
                <Pressable onPress={() => setPositions((ps) => ps.filter((x) => x.key !== p.key))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove position ${i + 1}`}>
                  <Trash2 size={16} color={Colors.error} strokeWidth={2} />
                </Pressable>
              ) : null}
            </View>
            <TextInputField label="Title" placeholder="e.g. President" value={p.title} onChangeText={(t) => patchPosition(p.key, { title: t })} />
            <TextInputField label="Seats" placeholder="1" value={p.seats} onChangeText={(t) => patchPosition(p.key, { seats: t.replace(/[^0-9]/g, '') })} keyboardType="number-pad" />
            <Text style={styles.subLabel}>Winner is given</Text>
            <View style={styles.chips}>
              {HANDOVER_OPTIONS.map((o) => {
                const active = p.role === o.value;
                return (
                  <Pressable key={o.label} onPress={() => patchPosition(p.key, { role: o.value })} style={[styles.chip, active && styles.chipActive]} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
        {touched && positionsError ? <Text style={styles.error}>{positionsError}</Text> : null}
        <Pressable
          onPress={() => { setPositions((ps) => [...ps, { key: nextKey, title: '', seats: '1', role: '' }]); setNextKey((k) => k + 1); }}
          style={styles.addPos}
          accessibilityRole="button"
          accessibilityLabel="Add another position"
        >
          <Plus size={16} color={Colors.primary} strokeWidth={2.4} />
          <Text style={styles.addPosText}>Add another position</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label={create.isPending ? 'Creating…' : 'Create election'} onPress={submit} disabled={create.isPending || (touched && !valid)} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.sm, paddingTop: Spacing.sm },
  label: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  subLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  help: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  error: { ...Typography.labelSm, color: Colors.error },
  row: { flexDirection: 'row', gap: Spacing.sm },
  rowItem: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  switchTitle: { ...Typography.labelLg, color: Colors.onSurface },
  posCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm },
  posHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  posIndex: { ...Typography.labelMd, color: Colors.primary, fontWeight: '700' as const },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip: { paddingHorizontal: Spacing.sm, paddingVertical: 6, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
  chipActive: { borderColor: Colors.primary, backgroundColor: Colors.iconBgPurple },
  chipText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  chipTextActive: { color: Colors.primary, fontWeight: '700' as const },
  addPos: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: Spacing.sm },
  addPosText: { ...Typography.labelMd, color: Colors.primary },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
