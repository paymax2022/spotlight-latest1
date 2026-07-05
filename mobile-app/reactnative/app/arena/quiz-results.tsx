import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck, HandCoins, Wallet } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import SocialShareSheet from '@/components/SocialShareSheet';
import { CASHBACK_DISCLOSURE, formatNaira } from '@/features/arena/constants';

/**
 * S3 — Quiz results + Certified Safe Driver badge. Shows the score, the badge if
 * passed (with a verify hash → credential wallet), a small ledgered cashback note
 * with disclosure, and share + Back-a-Driver CTAs. Engagement, not Merit.
 */
export default function QuizResultsScreen() {
  const params = useLocalSearchParams<{
    competitionId?: string; score?: string; total?: string; passed?: string;
    hash?: string; cashback?: string; points?: string; bestStreak?: string;
  }>();
  const competitionId = params.competitionId ?? '';
  const score = Number(params.score ?? 0);
  const total = Number(params.total ?? 0);
  const passed = params.passed === '1';
  const hash = params.hash || null;
  const cashbackKobo = params.cashback ? Number(params.cashback) : null;
  const points = params.points ? Number(params.points) : null;

  const pct = total > 0 ? Math.round((score / total) * 100) : 0;

  const [shareOpen, setShareOpen] = useState(false);
  const shareMessage =
    `I scored ${score}/${total} (${pct}%)${points ? ` · ${points} pts` : ''} on the "Are You a Naija Driver?" quiz` +
    `${passed ? ' and earned my Certified Safe Driver badge! 🚗🛡️' : '! 🚗'} Play on Paymax:`;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Your result" showBack={false} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={[styles.scoreCard, shadow1]}>
          <Text style={styles.scorePct}>{pct}%</Text>
          <Text style={styles.scoreSub}>{score} of {total} correct</Text>
        </View>

        {passed ? (
          <View style={[styles.badgeCard, shadow1]}>
            <View style={styles.badgeIcon}><ShieldCheck size={30} color={Colors.teal} /></View>
            <Text style={styles.badgeTitle}>Certified Safe Driver</Text>
            <Text style={styles.badgeBody}>You passed! This verifiable badge is now in your credential wallet.</Text>
            {hash ? (
              <PrimaryButton
                label="Open credential wallet"
                variant="secondary"
                onPress={() => router.push({ pathname: '/arena/credentials', params: { competitionId, safeDriverHash: hash } })}
              />
            ) : null}
          </View>
        ) : (
          <View style={[styles.badgeCard, styles.tryAgain]}>
            <Text style={styles.badgeTitle}>So close!</Text>
            <Text style={styles.badgeBody}>You didn’t hit the pass mark this time. Study up and play again — there’s no limit.</Text>
            <PrimaryButton label="Play again" variant="secondary" onPress={() => router.replace({ pathname: '/arena/quiz', params: { competitionId } })} />
          </View>
        )}

        {cashbackKobo != null && cashbackKobo > 0 ? (
          <View style={styles.cashbackCard}>
            <View style={styles.cashRow}>
              <Wallet size={18} color={Colors.secondary} />
              <Text style={styles.cashTitle}>{formatNaira(cashbackKobo)} cashback credited</Text>
            </View>
            <Text style={styles.cashNote}>{CASHBACK_DISCLOSURE}</Text>
          </View>
        ) : null}

        <PrimaryButton
          label="Back a driver"
          onPress={() => router.push({ pathname: '/arena', params: { competitionId } })}
          style={{ marginTop: Spacing.sm }}
        />
        <View style={styles.shareRow}>
          <PrimaryButton label="Share result" variant="ghost" onPress={() => setShareOpen(true)} />
        </View>

        <View style={styles.miniRow}>
          <HandCoins size={14} color={Colors.onSurfaceVariant} />
        </View>
      </ScrollView>

      <SocialShareSheet
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        title="Share your result"
        message={shareMessage}
        url="https://paymax.ng"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md },
  scoreCard: { backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.xl, alignItems: 'center' },
  scorePct: { ...Typography.displayLg, color: Colors.onPrimary },
  scoreSub: { ...Typography.labelMd, color: Colors.inversePrimary },
  badgeCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center', gap: Spacing.xs, borderWidth: 1.5, borderColor: Colors.teal },
  tryAgain: { borderColor: Colors.surfaceContainerHigh },
  badgeIcon: { width: 60, height: 60, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  badgeTitle: { ...Typography.titleLg, color: Colors.onSurface },
  badgeBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', marginBottom: Spacing.sm },
  cashbackCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs },
  cashRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  cashTitle: { ...Typography.labelLg, color: Colors.onSurface },
  cashNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 18 },
  shareRow: { alignItems: 'center' },
  miniRow: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.md, opacity: 0 },
});
