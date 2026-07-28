import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, Clock, Calculator, Download, Timer } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import OfflineBanner from '@/features/academy/components/OfflineBanner';
import Chip from '@/features/academy/components/Chip';
import { useBlueprints, useStartAttempt } from '@/features/academy/hooks';

/** X6 — Mock setup. Full / single-subject / timed; pick a blueprint then start. */
export default function MockSetup() {
  const { arenaId } = useLocalSearchParams<{ arenaId: string }>();
  const blueprints = useBlueprints(arenaId);
  const start = useStartAttempt();
  const [picked, setPicked] = useState<string | null>(null);

  const begin = () => {
    if (!picked) return;
    start.mutate(picked, {
      onSuccess: (attempt) => router.push(`/learn/academy/exam/cbt/${attempt.id}`),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Mock setup" subtitle="Pick a blueprint" />
      <OfflineBanner />
      {blueprints.isLoading ? (
        <StateView kind="loading" message="Loading blueprints…" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {blueprints.data?.map((bp) => {
            const active = picked === bp.id;
            return (
              <Pressable key={bp.id} style={[styles.card, shadow1, active && styles.cardActive]} onPress={() => setPicked(bp.id)}>
                <View style={styles.cardHead}>
                  <Text style={styles.cardTitle}>{bp.label}</Text>
                  {active ? <Check size={20} color={Colors.primary} strokeWidth={2.5} /> : <View style={styles.radio} />}
                </View>
                <View style={styles.metaRow}>
                  <View style={styles.metaItem}><Clock size={14} color={Colors.onSurfaceVariant} /><Text style={styles.metaText}>{bp.durationMin} min</Text></View>
                  <View style={styles.metaItem}><Timer size={14} color={Colors.onSurfaceVariant} /><Text style={styles.metaText}>{bp.totalQuestions} questions</Text></View>
                  {bp.calculatorAllowed ? <View style={styles.metaItem}><Calculator size={14} color={Colors.onSurfaceVariant} /><Text style={styles.metaText}>Calculator</Text></View> : null}
                </View>
                <View style={styles.subjRow}>
                  {bp.subjects.map((s) => <Chip key={s.subjectId} label={`${s.subjectName} ×${s.questionCount}`} color={Colors.secondary} bg={Colors.iconBgBlue} small />)}
                </View>
                <View style={styles.offlineRow}>
                  <Download size={14} color={Colors.teal} />
                  <Text style={styles.offlineText}>{bp.offlineItemCount} items bundled · works offline</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      <View style={styles.footer}>
        <PrimaryButton label="Start mock" onPress={begin} disabled={!picked} loading={start.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, borderWidth: 1.5, borderColor: Colors.transparent, gap: Spacing.sm },
  cardActive: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: Colors.outlineVariant },
  metaRow: { flexDirection: 'row', gap: Spacing.md, flexWrap: 'wrap' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  subjRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  offlineRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  offlineText: { ...Typography.caption, color: Colors.teal },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
