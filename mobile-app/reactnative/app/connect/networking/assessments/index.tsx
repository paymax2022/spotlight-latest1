import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { GraduationCap, ChevronRight, Clock, Award, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useAssessments, useAssessmentBadges } from '@/features/connect/networking/assessments/hooks';
import { ASSESSMENT_DOMAINS } from '@/features/connect/networking/assessments/api';
import { AssessedBadgeCard } from '@/features/connect/networking/assessments/AssessedSkillBadge';
import type { SkillAssessment } from '@/features/connect/networking/assessments/types';

/**
 * SA-01 — Skill assessment catalogue. Browse assessments grouped/filtered by
 * domain. Passing an assessment issues an ASSESSED badge (PN-5) that carries the
 * question-bank version (PN-12); the "My badges" rail reflects issuance to profile.
 */
export default function AssessmentCatalogueScreen() {
  const [domain, setDomain] = useState<string | null>(null);

  const list = useAssessments(domain ?? undefined);
  const badges = useAssessmentBadges();
  const items = list.data ?? [];

  const grouped = useMemo(() => {
    const map: Record<string, SkillAssessment[]> = {};
    for (const a of items) (map[a.domain] ??= []).push(a);
    return Object.entries(map);
  }, [items]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Skill assessments" subtitle="Prove a skill, earn a verified badge" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Domain filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          <FilterChip label="All" active={domain === null} onPress={() => setDomain(null)} />
          {ASSESSMENT_DOMAINS.map((d) => (
            <FilterChip key={d} label={d} active={domain === d} onPress={() => setDomain(d)} />
          ))}
        </ScrollView>

        {/* My earned badges (issued to profile) */}
        {(badges.data?.length ?? 0) > 0 ? (
          <View style={styles.badgesBlock}>
            <View style={styles.sectionHead}>
              <Award size={16} color={Colors.onWarning} strokeWidth={2.2} />
              <Text style={styles.sectionTitle}>My verified badges</Text>
            </View>
            <View style={{ gap: Spacing.sm }}>
              {badges.data!.map((b) => (
                <AssessedBadgeCard
                  key={b.id}
                  skill={b.skill}
                  title={b.title}
                  domain={b.domain}
                  score={b.score}
                  assessmentVersion={b.assessmentVersion}
                  issuedAt={b.issuedAt}
                />
              ))}
            </View>
          </View>
        ) : null}

        {/* Catalogue */}
        {list.isLoading ? (
          <StateView kind="loading" message="Loading assessments…" />
        ) : list.isError ? (
          <StateView kind="error" title="Couldn't load assessments" message="Check your connection and try again." actionLabel="Retry" onAction={() => list.refetch()} />
        ) : items.length === 0 ? (
          <StateView kind="empty" icon="GraduationCap" title="No assessments" message="Nothing in this domain yet." />
        ) : (
          grouped.map(([dom, list2]) => (
            <View key={dom} style={styles.group}>
              <Text style={styles.groupTitle}>{dom}</Text>
              {list2.map((a) => (
                <AssessmentCard key={a.id} assessment={a} />
              ))}
            </View>
          ))
        )}
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.filterChip, active && styles.filterChipActive]}
    >
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function AssessmentCard({ assessment: a }: { assessment: SkillAssessment }) {
  const cooling = !!a.cooldownUntil && new Date(a.cooldownUntil).getTime() > Date.now();

  function open() {
    if (a.earned) return; // already certified
    if (cooling) {
      router.push(`/connect/networking/assessments/${encodeURIComponent(a.id)}/cooldown?until=${encodeURIComponent(a.cooldownUntil!)}`);
      return;
    }
    router.push(`/connect/networking/assessments/${encodeURIComponent(a.id)}/run`);
  }

  return (
    <Pressable style={styles.card} onPress={open} accessibilityRole="button">
      <View style={styles.cardIcon}>
        <GraduationCap size={20} color={ConnectColors.brand} strokeWidth={2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle} numberOfLines={1}>{a.title}</Text>
        {a.description ? <Text style={styles.cardDesc} numberOfLines={2}>{a.description}</Text> : null}
        <View style={styles.metaRow}>
          <View style={styles.metaChip}><Text style={styles.metaChipText}>Pass {a.passThreshold}%</Text></View>
          <View style={styles.metaChip}><Clock size={11} color={Colors.onSurfaceVariant} /><Text style={styles.metaChipText}>{a.questionCount} Qs</Text></View>
          <View style={styles.metaChip}><Text style={styles.metaChipText}>{a.assessmentVersion}</Text></View>
        </View>
      </View>
      {a.earned ? (
        <View style={styles.earnedPill}>
          <CheckCircle2 size={14} color={Colors.teal} strokeWidth={2.4} />
          <Text style={styles.earnedText}>Earned</Text>
        </View>
      ) : cooling ? (
        <View style={styles.coolPill}>
          <Clock size={13} color={Colors.onWarning} strokeWidth={2.2} />
          <Text style={styles.coolText}>Cooldown</Text>
        </View>
      ) : (
        <ChevronRight size={18} color={Colors.onSurfaceVariant} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.lg },
  filterRow: { gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md },
  filterChip: {
    paddingHorizontal: Spacing.md, paddingVertical: 7, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest,
  },
  filterChipActive: { backgroundColor: ConnectColors.brand, borderColor: ConnectColors.brand },
  filterChipText: { ...Typography.labelMd, color: Colors.onSurface },
  filterChipTextActive: { color: Colors.onPrimary, fontWeight: '700' },
  badgesBlock: { paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.sm },
  sectionTitle: { ...Typography.labelLg, color: Colors.onSurface },
  group: { paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.lg, gap: Spacing.sm },
  groupTitle: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md,
  },
  cardIcon: {
    width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.iconBgPurple,
  },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  cardDesc: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  metaRow: { flexDirection: 'row', gap: Spacing.xs, marginTop: Spacing.sm, flexWrap: 'wrap' },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 3,
  },
  metaChipText: { ...Typography.caption, color: Colors.onSurfaceVariant, fontVariant: ['tabular-nums'] },
  earnedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 5 },
  earnedText: { ...Typography.labelSm, color: Colors.teal, fontWeight: '700' },
  coolPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgGold, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 5 },
  coolText: { ...Typography.labelSm, color: Colors.onWarning, fontWeight: '700' },
});
