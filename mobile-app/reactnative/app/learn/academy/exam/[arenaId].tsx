import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CalendarClock, BookCheck, ListChecks, Search } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1, shadow3 } from '@/constants/shadows';
import { LinearGradient } from 'expo-linear-gradient';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import OfflineBanner from '@/features/academy/components/OfflineBanner';
import ProgressBar from '@/features/academy/components/ProgressBar';
import { useArena, useUtmeCombinations } from '@/features/academy/hooks';
import { EXAM_META, daysUntil, formatDate } from '@/features/academy/constants';

/** X2 — Arena home. Readiness, syllabus coverage, countdown + start mock. */
export default function ArenaHome() {
  const { arenaId } = useLocalSearchParams<{ arenaId: string }>();
  const arena = useArena(arenaId);
  const [course, setCourse] = useState('');
  const isUtme = arena.data?.slug === 'utme';
  const combos = useUtmeCombinations(course);

  if (arena.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading arena…" /></SafeAreaView>;
  if (!arena.data) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Arena" /><StateView kind="error" title="Arena not found" /></SafeAreaView>;

  const meta = EXAM_META[arena.data.slug];
  const days = daysUntil(arena.data.nextSittingDate);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={arena.data.name} subtitle={meta.full} />
      <OfflineBanner />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Countdown + readiness */}
        <LinearGradient colors={Colors.gradientCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, shadow3]}>
          <View style={styles.heroRow}>
            <CalendarClock size={18} color={Colors.gold} />
            <Text style={styles.heroDate}>Next sitting: {formatDate(arena.data.nextSittingDate)} · {days} days</Text>
          </View>
          <Text style={styles.heroReadiness}>{arena.data.readinessPct}%</Text>
          <Text style={styles.heroLabel}>predicted readiness</Text>
          <ProgressBar pct={arena.data.readinessPct} color={Colors.gold} trackColor="rgba(255,255,255,0.18)" style={{ marginTop: 8 }} />
        </LinearGradient>

        <Text style={styles.desc}>{arena.data.description}</Text>

        {/* Coverage */}
        <View style={[styles.statCard, shadow1]}>
          <View style={styles.statRow}><BookCheck size={18} color={Colors.teal} /><Text style={styles.statLabel}>Syllabus coverage</Text><Text style={styles.statVal}>{arena.data.syllabusCoveragePct}%</Text></View>
          <ProgressBar pct={arena.data.syllabusCoveragePct} color={Colors.teal} style={{ marginTop: 6 }} />
          <View style={[styles.statRow, { marginTop: Spacing.md }]}><ListChecks size={18} color={Colors.secondary} /><Text style={styles.statLabel}>Subjects required</Text><Text style={styles.statVal}>{arena.data.subjectsRequired}</Text></View>
        </View>

        {/* UTME subject combinations (X3 lite) */}
        {isUtme ? (
          <View style={styles.comboBlock}>
            <Text style={styles.section}>Subject combinations by course</Text>
            <TextInputField placeholder="Search a course e.g. Medicine" value={course} onChangeText={setCourse} leftIcon={<Search size={18} color={Colors.outline} />} />
            {combos.data?.slice(0, 4).map((c) => (
              <View key={c.course} style={[styles.comboCard, shadow1]}>
                <Text style={styles.comboCourse}>{c.course}</Text>
                <Text style={styles.comboSubs}>{c.subjects.join(' · ')}</Text>
                <Text style={styles.comboNote}>{c.note}</Text>
              </View>
            ))}
            {combos.data && !combos.data.length ? <Text style={styles.comboNote}>No course matches “{course}”.</Text> : null}
          </View>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Set up a mock exam" onPress={() => router.push(`/learn/academy/exam/setup/${arenaId}`)} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  hero: { borderRadius: Radius.xl, padding: Spacing.lg },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroDate: { ...Typography.labelSm, color: Colors.inversePrimary },
  heroReadiness: { ...Typography.displayLg, color: Colors.onPrimary, fontSize: 48, lineHeight: 54, marginTop: Spacing.sm },
  heroLabel: { ...Typography.labelSm, color: Colors.inversePrimary },
  desc: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  statCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  statLabel: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  statVal: { ...Typography.titleMd, color: Colors.onSurface },
  comboBlock: { gap: Spacing.sm },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase' },
  comboCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  comboCourse: { ...Typography.titleMd, color: Colors.onSurface },
  comboSubs: { ...Typography.bodySm, color: Colors.secondary, marginTop: 2 },
  comboNote: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 4 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
