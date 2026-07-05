import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Target, CheckCircle2, Circle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useMeritLeaderboard, useSubmitPredictions } from '@/features/arena/hooks';
import type { PredictionPick } from '@/features/arena/types';

const SLOTS = [
  { key: 'champion', label: 'Champion (crown)' },
  { key: 'runner_up', label: 'Runner-up' },
  { key: 'peoples_champion', label: 'People’s Champion' },
];

/**
 * S7 — Predict-the-Champion. Pick a driver for each slot from the current field.
 * A light-touch engagement feature; results resolve after each event.
 */
export default function PredictScreen() {
  const { competitionId: raw } = useLocalSearchParams<{ competitionId?: string }>();
  const competitionId = raw ?? '';
  const board = useMeritLeaderboard(competitionId);
  const submit = useSubmitPredictions();

  const [picks, setPicks] = useState<Record<string, string>>({});
  const [activeSlot, setActiveSlot] = useState(SLOTS[0].key);
  const [done, setDone] = useState(false);

  const drivers = board.data ?? [];

  const setPick = (contestantId: string) => setPicks((p) => ({ ...p, [activeSlot]: contestantId }));

  const onSubmit = () => {
    const payload: PredictionPick[] = Object.entries(picks).map(([slot, contestantId]) => ({ slot, contestantId }));
    submit.mutate({ competitionId, picks: payload }, { onSuccess: () => setDone(true) });
  };

  const allPicked = SLOTS.every((s) => picks[s.key]);

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Predictions" showBack={false} />
        <StateView kind="empty" icon="Target" title="Predictions locked in" message="We’ll let you know how your picks do after each event." actionLabel="Back to Arena" onAction={() => router.replace({ pathname: '/arena', params: { competitionId } })} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Predict the Champion" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.introRow}><Target size={18} color={Colors.primary} /><Text style={styles.intro}>Pick a driver for each slot from the current Merit field.</Text></View>

        <View style={styles.slotRow}>
          {SLOTS.map((s) => (
            <Pressable key={s.key} style={[styles.slot, activeSlot === s.key && styles.slotActive]} onPress={() => setActiveSlot(s.key)}>
              <Text style={[styles.slotLabel, activeSlot === s.key && styles.slotLabelActive]} numberOfLines={2}>{s.label}</Text>
              {picks[s.key] ? <View style={styles.slotDot} /> : null}
            </Pressable>
          ))}
        </View>

        {board.isLoading ? (
          <StateView kind="loading" />
        ) : board.isError ? (
          <StateView kind="error" title="Couldn’t load drivers" actionLabel="Retry" onAction={() => board.refetch()} />
        ) : drivers.length === 0 ? (
          <StateView kind="empty" title="No drivers to pick yet" />
        ) : (
          <View style={[styles.card, shadow1]}>
            {drivers.map((d) => {
              const sel = picks[activeSlot] === d.contestantId;
              return (
                <Pressable key={d.contestantId} style={styles.driverRow} onPress={() => setPick(d.contestantId)}>
                  {sel ? <CheckCircle2 size={20} color={Colors.primary} /> : <Circle size={20} color={Colors.outline} />}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.driverName}>{d.displayName}</Text>
                    <Text style={styles.driverMeta}>{d.homeState} · {d.meritPoints} Merit</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label={submit.isPending ? 'Saving…' : 'Lock in predictions'} onPress={onSubmit} loading={submit.isPending} disabled={!allPicked || submit.isPending} />
        {!allPicked ? <Text style={styles.hint}>Pick a driver for all {SLOTS.length} slots.</Text> : null}
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md },
  introRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  intro: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, flex: 1 },
  slotRow: { flexDirection: 'row', gap: Spacing.sm },
  slot: { flex: 1, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.sm, borderWidth: 1.5, borderColor: Colors.outlineVariant, minHeight: 56, justifyContent: 'center' },
  slotActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  slotLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  slotLabelActive: { color: Colors.primary, fontWeight: '700' as const },
  slotDot: { position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: Radius.full, backgroundColor: Colors.teal },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.sm },
  driverName: { ...Typography.labelLg, color: Colors.onSurface },
  driverMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.xs },
});
