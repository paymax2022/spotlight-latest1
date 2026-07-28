import React from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Award } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, QualityFactorRow } from '@/features/doctor/components';
import { useQualityScore } from '@/features/doctor/hooks';
import { QUALITY_SCORE_GRADE_LABELS, QUALITY_SCORE_GRADE_TONES, METRIC_LABELS } from '@/features/doctor/constants';

// Z.10: composite quality score (score + grade + weighted factors).
export default function QualityScoreScreen() {
  const { data: quality, isLoading, isError, refetch } = useQualityScore();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Quality Score" />

      {isLoading && !quality ? (
        <StateView variant="loading" label="Loading quality score" />
      ) : isError || !quality ? (
        <StateView variant="error" message="We could not load your quality score." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={[styles.hero, { borderColor: QUALITY_SCORE_GRADE_TONES[quality.grade] }]}>
            <Award size={28} color={QUALITY_SCORE_GRADE_TONES[quality.grade]} strokeWidth={2} />
            <Text style={[styles.score, { color: QUALITY_SCORE_GRADE_TONES[quality.grade] }]}>{quality.scorePct}<Text style={styles.scoreSuffix}>/100</Text></Text>
            <Text style={styles.grade}>{QUALITY_SCORE_GRADE_LABELS[quality.grade]}</Text>
            <Text style={styles.updated}>Updated {new Date(quality.updatedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}</Text>
          </View>

          {quality.factors.length === 0 ? (
            <StateView variant="empty" icon={Award} title="No factors" message="Score factors will appear here." />
          ) : (
            <SectionCard title="Contributing factors" style={styles.card}>
              {quality.factors.map((f, i) => (
                <QualityFactorRow
                  key={f.key}
                  label={METRIC_LABELS[f.key] ?? f.label}
                  scorePct={f.scorePct}
                  weightPct={f.weightPct}
                  border={i > 0}
                />
              ))}
            </SectionCard>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24, gap: Spacing.md, flexGrow: 1 },
  hero:        { alignItems: 'center', gap: Spacing.xs, padding: Spacing.cardPadding, borderRadius: Radius.xl, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1 },
  score:       { ...Typography.displayLg, fontSize: 52, lineHeight: 56 },
  scoreSuffix: { ...Typography.titleMd, color: Colors.onSurfaceVariant },
  grade:       { ...Typography.titleMd, color: Colors.onSurface },
  updated:     { ...Typography.caption, color: Colors.onSurfaceVariant },
  card:        { marginBottom: 0 },
});
