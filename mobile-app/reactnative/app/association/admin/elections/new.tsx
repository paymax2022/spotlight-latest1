import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, X } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { useCreateElection } from '@/features/association/hooks';
import type { ElectionRoleGrant } from '@/features/association/api/association.api';

type DraftPosition = { title: string; seats: string; role: ElectionRoleGrant };

// Role a position's winner is granted at handover (EL-015). Empty = ceremonial.
const ROLE_OPTIONS: { value: ElectionRoleGrant; label: string }[] = [
  { value: '', label: 'Ceremonial' },
  { value: 'NATIONAL_ADMIN', label: 'National admin' },
  { value: 'CHAPTER_ADMIN', label: 'Chapter admin' },
  { value: 'FINANCE_ADMIN', label: 'Finance admin' },
  { value: 'SECRETARY', label: 'Secretary' },
];

const EMPTY_POSITION: DraftPosition = { title: '', seats: '1', role: '' };

export default function NewElection() {
  const create = useCreateElection();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [positions, setPositions] = useState<DraftPosition[]>([{ ...EMPTY_POSITION }]);
  const [error, setError] = useState<string | null>(null);

  const patchPosition = (i: number, patch: Partial<DraftPosition>) =>
    setPositions((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  const removePosition = (i: number) => setPositions((ps) => ps.filter((_, idx) => idx !== i));

  const submit = async () => {
    setError(null);
    const cleanTitle = title.trim();
    const cleanPositions = positions
      .map((p) => ({ title: p.title.trim(), seats: Math.max(1, Math.floor(Number(p.seats) || 1)), role: p.role }))
      .filter((p) => p.title.length > 0);
    if (!cleanTitle) return setError('Give the election a title.');
    if (cleanPositions.length === 0) return setError('Add at least one position on the ballot.');
    try {
      const res = await create.mutateAsync({
        title: cleanTitle,
        description: description.trim(),
        positions: cleanPositions,
      });
      router.replace(`/association/admin/elections/${res.id}`);
    } catch (e) {
      setError(messageOf(e));
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="New election" backFallback="/association/admin/elections" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.help}>Created as a draft. Add candidates, then open voting from the election’s page.</Text>

        <TextInputField label="Title" placeholder="e.g. 2027 National Executive Election" value={title} onChangeText={setTitle} maxLength={120} />
        <TextInputField label="Description" placeholder="What members are voting for" value={description} onChangeText={setDescription} multiline maxLength={1000} />

        <Text style={styles.sectionLabel}>Positions on the ballot</Text>
        {positions.map((p, i) => (
          <View key={i} style={styles.positionCard}>
            <View style={styles.positionHead}>
              <Text style={styles.positionIndex}>Position {i + 1}</Text>
              {positions.length > 1 ? (
                <Pressable onPress={() => removePosition(i)} hitSlop={10} accessibilityLabel={`Remove position ${i + 1}`}>
                  <X size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
                </Pressable>
              ) : null}
            </View>
            <TextInputField placeholder="e.g. President" value={p.title} onChangeText={(t) => patchPosition(i, { title: t })} maxLength={80} />
            <TextInputField placeholder="Seats" value={p.seats} onChangeText={(t) => patchPosition(i, { seats: t.replace(/[^0-9]/g, '') })} keyboardType="number-pad" maxLength={3} />

            <Text style={styles.roleLabel}>Role granted to the winner</Text>
            <View style={styles.chipRow}>
              {ROLE_OPTIONS.map((opt) => {
                const on = p.role === opt.value;
                return (
                  <Pressable
                    key={opt.label}
                    onPress={() => patchPosition(i, { role: opt.value })}
                    style={[styles.chip, on && styles.chipOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{opt.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}

        <Pressable onPress={() => setPositions((ps) => [...ps, { ...EMPTY_POSITION }])} style={styles.addPosition} accessibilityRole="button">
          <Plus size={18} color={Colors.primary} strokeWidth={2} />
          <Text style={styles.addPositionText}>Add position</Text>
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.submit}>
          <PrimaryButton label="Create election" onPress={submit} loading={create.isPending} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function messageOf(e: unknown): string {
  const data = (e as { response?: { data?: { error?: string } } })?.response?.data;
  if (data?.error) return data.error;
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.';
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  scroll: { padding: Spacing.md, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  help: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  sectionLabel: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.sm },
  positionCard: { gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
  positionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  positionIndex: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  roleLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip: { paddingHorizontal: Spacing.sm, paddingVertical: 6, borderRadius: Radius.full ?? 999, borderWidth: 1, borderColor: Colors.outlineVariant },
  chipOn: { borderColor: Colors.primary, backgroundColor: Colors.iconBgPurple },
  chipText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  chipTextOn: { color: Colors.primary },
  addPosition: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.sm },
  addPositionText: { ...Typography.labelLg, color: Colors.primary },
  error: { ...Typography.labelSm, color: Colors.error },
  submit: { marginTop: Spacing.md },
});
