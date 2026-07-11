import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2, XCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { AssessedBadgeCard } from '@/features/connect/networking/assessments/AssessedSkillBadge';

/**
 * SA-03 — Assessment result. On a PASS, we render the newly issued ASSESSED badge
 * (PN-5, visually distinct) showing the question-bank version (PN-12), now added
 * to the profile. On a FAIL, we route the user to SA-04 (cooldown) to retry later.
 */
export default function AssessmentResultScreen() {
  const params = useLocalSearchParams<{
    id: string; passed?: string; score?: string; threshold?: string; version?: string;
    badgeSkill?: string; badgeTitle?: string; badgeDomain?: string; cooldownUntil?: string;
  }>();

  const assessmentId = String(params.id ?? '');
  const passed = params.passed === '1';
  const score = Number(params.score ?? 0);
  const threshold = Number(params.threshold ?? 0);
  const version = String(params.version ?? '');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Result" showBack={false} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={[styles.hero, passed ? styles.heroPass : styles.heroFail]}>
          {passed ? (
            <CheckCircle2 size={48} color={Colors.teal} strokeWidth={2} />
          ) : (
            <XCircle size={48} color={Colors.error} strokeWidth={2} />
          )}
          <Text style={styles.heroTitle}>{passed ? 'Passed!' : 'Not this time'}</Text>
          <Text style={styles.heroScore}>{score}%</Text>
          <Text style={styles.heroSub}>Pass mark {threshold}%</Text>
        </View>

        {passed ? (
          <>
            <Text style={styles.sectionLabel}>Badge issued to your profile</Text>
            <AssessedBadgeCard
              skill={String(params.badgeSkill || 'Skill')}
              title={String(params.badgeTitle || 'Assessment')}
              domain={String(params.badgeDomain || '')}
              score={score}
              assessmentVersion={version}
              issuedAt={new Date().toISOString()}
            />
            <Text style={styles.note}>
              This is a verified, assessed badge — visibly distinct from self-reported skills. It
              permanently records the assessment version ({version}) it was earned against.
            </Text>
            <View style={{ height: Spacing.lg }} />
            <PrimaryButton label="Back to assessments" onPress={() => router.replace('/connect/networking/assessments')} />
          </>
        ) : (
          <>
            <Text style={styles.note}>
              You didn't reach the pass mark this time. There's a short cooldown before you can retry —
              use it to brush up and come back stronger.
            </Text>
            <View style={{ height: Spacing.lg }} />
            <PrimaryButton
              label="See retry cooldown"
              onPress={() =>
                router.replace(
                  `/connect/networking/assessments/${encodeURIComponent(assessmentId)}/cooldown?until=${encodeURIComponent(String(params.cooldownUntil ?? ''))}`,
                )
              }
            />
            <PrimaryButton label="Back to assessments" variant="ghost" onPress={() => router.replace('/connect/networking/assessments')} />
          </>
        )}
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin },
  hero: {
    alignItems: 'center', gap: Spacing.xs, borderRadius: Radius.lg,
    paddingVertical: Spacing.xl, marginBottom: Spacing.lg, borderWidth: 1.5,
  },
  heroPass: { backgroundColor: Colors.iconBgTeal, borderColor: Colors.teal },
  heroFail: { backgroundColor: Colors.errorContainer, borderColor: Colors.error },
  heroTitle: { ...Typography.headlineMd, color: Colors.onSurface, marginTop: Spacing.sm },
  heroScore: { ...Typography.headlineMd, color: Colors.onSurface, fontVariant: ['tabular-nums'], fontWeight: '800' },
  heroSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  sectionLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: Spacing.md, lineHeight: 19 },
});
