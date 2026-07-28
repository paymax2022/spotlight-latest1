import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Play, Download, CheckCircle2, Target, Dumbbell } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import OfflineBanner from '@/features/academy/components/OfflineBanner';
import Chip from '@/features/academy/components/Chip';
import ProgressBar from '@/features/academy/components/ProgressBar';
import { useTopic, useLessons, useObjectives } from '@/features/academy/hooks';
import { MASTERY_META, formatClock } from '@/features/academy/constants';

/** L5 — Topic/unit landing. Lessons + practice + mastery check. */
export default function TopicLanding() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const topic = useTopic(id);
  const lessons = useLessons(id);
  const objectives = useObjectives(id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={topic.data?.name ?? 'Topic'} subtitle="Lessons, practice & mastery" />
      <OfflineBanner />
      {lessons.isLoading || objectives.isLoading ? (
        <StateView kind="loading" message="Loading topic…" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Lessons (L6 entry) */}
          <Text style={styles.section}>Lessons</Text>
          {lessons.data?.length ? lessons.data.map((l) => (
            <Pressable key={l.id} style={[styles.row, shadow1]} onPress={() => router.push(`/learn/academy/lesson/${l.id}`)}>
              <View style={styles.playBox}><Play size={18} color={Colors.onPrimary} fill={Colors.onPrimary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={2}>{l.title}</Text>
                <Text style={styles.rowMeta}>{formatClock(l.durationSec)} · {Math.round(l.dataBudgetKb / 1024)}MB</Text>
              </View>
              {l.downloaded
                ? <CheckCircle2 size={18} color={Colors.teal} />
                : <Download size={18} color={Colors.onSurfaceVariant} />}
            </Pressable>
          )) : <StateView kind="empty" compact title="No lessons yet" />}

          {/* Objectives → practice (L9) */}
          <Text style={styles.section}>Practice by objective</Text>
          {objectives.data?.map((o) => {
            const meta = MASTERY_META[o.mastery];
            return (
              <Pressable key={o.id} style={[styles.row, shadow1]} onPress={() => router.push(`/learn/academy/practice/${o.id}`)}>
                <View style={styles.objIcon}><Dumbbell size={18} color={Colors.secondary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={2}>{o.statement}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <Chip label={meta.label} color={meta.color} bg={meta.bg} small />
                    <View style={{ flex: 1 }}><ProgressBar pct={o.masteryPct} height={6} /></View>
                  </View>
                </View>
              </Pressable>
            );
          })}

          {/* Mastery check (L12) */}
          <Pressable style={styles.masteryCta} onPress={() => router.push(`/learn/academy/mastery/${id}`)}>
            <Target size={18} color={Colors.onPrimary} />
            <Text style={styles.masteryCtaText}>Mastery check — unlock next unit</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.md, marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  playBox: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  objIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { ...Typography.titleMd, color: Colors.onSurface },
  rowMeta: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 2 },
  masteryCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, marginTop: Spacing.lg, height: 56, borderRadius: Radius.lg, backgroundColor: Colors.primary },
  masteryCtaText: { ...Typography.labelLg, color: Colors.onPrimary },
});
