import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { FileCheck2, Clock, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { NDC1_MERIT_NOTE } from '@/features/arena/constants';

/**
 * C7 — Exam submitted / result pending. Reflects contestant state THEORY_TAKEN:
 * the answers are in and the Merit score is now pending proctor sign-off. No
 * score is shown here (Merit is signed server-side, never computed on device).
 */
export default function ExamResultScreen() {
  const { competitionId: raw } = useLocalSearchParams<{ competitionId?: string }>();
  const competitionId = raw ?? '';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Exam submitted" showBack={false} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={[styles.hero, shadow1]}>
          <View style={styles.heroIcon}><FileCheck2 size={34} color={Colors.teal} /></View>
          <Text style={styles.heroTitle}>Your exam is in</Text>
          <Text style={styles.heroBody}>
            Thanks for completing the proctored theory exam. Your answers have been submitted securely.
          </Text>
        </View>

        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <Clock size={18} color={Colors.secondary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.statusTitle}>Result pending</Text>
              <Text style={styles.statusBody}>
                Your Merit score is being reviewed and signed by proctors. We’ll update your standing in Compete as
                soon as it’s resolved.
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.note}>
          <ShieldCheck size={16} color={Colors.onSurfaceVariant} />
          <Text style={styles.noteText}>{NDC1_MERIT_NOTE}</Text>
        </View>

        <PrimaryButton
          label="Back to Compete"
          onPress={() => router.replace({ pathname: '/arena/compete', params: { competitionId } })}
        />
        <View style={{ height: Spacing.sm }} />
        <PrimaryButton
          label="View public leaderboard"
          variant="secondary"
          onPress={() => router.replace({ pathname: '/arena', params: { competitionId } })}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md },
  hero: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center', gap: Spacing.xs, borderWidth: 1.5, borderColor: Colors.teal },
  heroIcon: { width: 64, height: 64, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  heroTitle: { ...Typography.titleLg, color: Colors.onSurface },
  heroBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  statusCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  statusRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  statusTitle: { ...Typography.labelLg, color: Colors.onSurface, marginBottom: 2 },
  statusBody: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 19 },
  note: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  noteText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 18, flex: 1 },
});
