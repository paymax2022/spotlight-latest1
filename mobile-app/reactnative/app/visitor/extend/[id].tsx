import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Clock, ArrowRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useAccessCode, useExtendAccessCode } from '@/features/visitor/hooks/useVisitor';
import { formatDateTime, isActive } from '@/features/visitor/utils/visitorFormatters';

const EXTEND_PRESETS: { label: string; hours: number }[] = [
  { label: '+1 hour', hours: 1 },
  { label: '+3 hours', hours: 3 },
  { label: '+6 hours', hours: 6 },
  { label: '+1 day', hours: 24 },
  { label: '+3 days', hours: 72 },
];

export default function ExtendCodeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: code, isLoading, isError, refetch } = useAccessCode(id ?? '');
  const extend = useExtendAccessCode();
  const [addHours, setAddHours] = useState(3);

  const newEndIso = useMemo(() => {
    if (!code) return '';
    const base = Math.max(Date.now(), new Date(code.validityEnd).getTime());
    return new Date(base + addHours * 3_600_000).toISOString();
  }, [code, addHours]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Extend code" />
        <StateView kind="loading" message="Loading code…" />
      </SafeAreaView>
    );
  }
  if (isError || !code) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Extend code" />
        <StateView kind="error" title="Code unavailable" message="We couldn't load this code." actionLabel="Retry" onAction={() => refetch()} />
      </SafeAreaView>
    );
  }

  // VM-143: only active codes can be extended.
  if (!isActive(code)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Extend code" />
        <StateView
          kind="error"
          icon="CalendarX"
          title="Can't extend this code"
          message="Only active codes can be extended. Create a new code instead."
          actionLabel="Create new code"
          onAction={() => router.replace('/visitor/create')}
        />
      </SafeAreaView>
    );
  }

  const submit = () => {
    extend.mutate({ id: code.id, validityEnd: newEndIso }, { onSuccess: () => router.replace(`/visitor/code/${code.id}`) });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Extend validity" subtitle={code.visitor.name} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Before / after */}
        <View style={styles.compareCard}>
          <View style={styles.compareCol}>
            <Text style={styles.compareLabel}>Current</Text>
            <Text style={styles.compareValue}>{formatDateTime(code.validityEnd)}</Text>
          </View>
          <ArrowRight size={18} color={Colors.outline} strokeWidth={2} />
          <View style={styles.compareCol}>
            <Text style={styles.compareLabel}>New</Text>
            <Text style={[styles.compareValue, { color: Colors.secondary }]}>{formatDateTime(newEndIso)}</Text>
          </View>
        </View>

        <Text style={styles.label}>Add time</Text>
        <View style={styles.presetRow}>
          {EXTEND_PRESETS.map((p) => {
            const selected = p.hours === addHours;
            return (
              <Pressable key={p.label} onPress={() => setAddHours(p.hours)} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.preset, selected && styles.presetSelected]}>
                <Text style={[styles.presetText, selected && styles.presetTextSelected]}>{p.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.note}>
          <Clock size={16} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
          <Text style={styles.noteText}>The code value and QR stay the same — only the expiry moves.</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Extend code" onPress={submit} loading={extend.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.md },
  compareCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md,
  },
  compareCol: { flex: 1, gap: 2 },
  compareLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  compareValue: { ...Typography.labelMd, color: Colors.onSurface },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginTop: Spacing.sm },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  preset: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.transparent },
  presetSelected: { backgroundColor: Colors.surfaceContainerLowest, borderColor: Colors.secondary },
  presetText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  presetTextSelected: { color: Colors.secondary },
  note: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.sm },
  noteText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow },
});
