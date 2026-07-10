import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck, Wallet, CheckCircle2, XCircle, WifiOff } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import SocialShareSheet from '@/components/SocialShareSheet';
import { CASHBACK_DISCLOSURE, formatNaira, stageMeta } from '@/features/arena/constants';
import type { PlayAlongPerQuestion } from '@/features/arena/types';

/**
 * S3 — Play-Along results + Certified Safe Driver badge. Shows the score, the
 * badge on a pass (→ credential wallet), a small ledgered cashback (with the
 * NL5-style disclosure), a per-question explainer recap (the teaching moment),
 * and a share card. ENGAGEMENT, not Merit.
 */
export default function QuizResultsScreen() {
  const params = useLocalSearchParams<{
    competitionId?: string; stage?: string; score?: string; total?: string;
    passed?: string; hash?: string; cashback?: string; perQuestion?: string; offline?: string;
  }>();
  const competitionId = params.competitionId ?? '';
  const stage = Number(params.stage ?? 1);
  const score = Number(params.score ?? 0);
  const total = Number(params.total ?? 0);
  const passed = params.passed === '1';
  const hash = params.hash || null;
  const cashbackKobo = params.cashback ? Number(params.cashback) : null;
  const queuedOffline = params.offline === '1';

  const perQuestion = useMemo<PlayAlongPerQuestion[]>(() => {
    if (!params.perQuestion) return [];
    try {
      return JSON.parse(decodeURIComponent(params.perQuestion));
    } catch {
      return [];
    }
  }, [params.perQuestion]);

  const pct = total > 0 ? Math.round((score / total) * 100) : 0;
  const meta = stageMeta(stage);

  const [shareOpen, setShareOpen] = useState(false);
  const shareMessage =
    `I scored ${score}/${total} (${pct}%) on Stage ${stage} of the "Are You a Naija Driver?" quiz` +
    `${passed ? ' and earned my Certified Safe Driver badge! 🚗🛡️' : '! 🚗'} Test yourself on Paymax:`;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Your result" showBack={false} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Score card */}
        <View style={[styles.scoreCard, shadow1]}>
          <Text style={styles.scorePct}>{pct}%</Text>
          <Text style={styles.scoreSub}>{score} of {total} correct · {meta.short}</Text>
          <Text style={styles.scoreMark}>Pass mark {meta.passMarkPercent}%</Text>
        </View>

        {queuedOffline ? (
          <View style={styles.offlineCard}>
            <WifiOff size={16} color={Colors.onSurfaceVariant} />
            <Text style={styles.offlineText}>You’re offline — your attempt is queued and will sync when you reconnect.</Text>
          </View>
        ) : null}

        {/* Badge / try-again */}
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
            <Text style={styles.badgeBody}>You didn’t hit the {meta.passMarkPercent}% pass mark this time. Study the recap below and play again — there’s no limit.</Text>
            <PrimaryButton label="Play again" variant="secondary" onPress={() => router.replace({ pathname: '/arena/quiz', params: { competitionId, stage: String(stage) } })} />
          </View>
        )}

        {/* Cashback */}
        {cashbackKobo != null && cashbackKobo > 0 ? (
          <View style={styles.cashbackCard}>
            <View style={styles.cashRow}>
              <Wallet size={18} color={Colors.secondary} />
              <Text style={styles.cashTitle}>{formatNaira(cashbackKobo)} cashback credited</Text>
            </View>
            <Text style={styles.cashNote}>{CASHBACK_DISCLOSURE}</Text>
          </View>
        ) : null}

        {/* Per-question recap (the teaching moment) */}
        {perQuestion.length > 0 ? (
          <View style={styles.recap}>
            <Text style={styles.recapTitle}>Answer recap</Text>
            {perQuestion.map((p, i) => (
              <View key={p.questionId} style={styles.recapRow}>
                <View style={styles.recapHead}>
                  {p.correct ? (
                    <CheckCircle2 size={18} color="#16A34A" />
                  ) : (
                    <XCircle size={18} color={Colors.error} />
                  )}
                  <Text style={styles.recapQ}>Question {i + 1} · {p.correct ? 'Correct' : 'Missed'}</Text>
                </View>
                {p.explanation ? <Text style={styles.recapExplain}>{p.explanation}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}

        {/* CTAs */}
        <PrimaryButton
          label="Back a driver"
          onPress={() => router.push({ pathname: '/arena', params: { competitionId } })}
          style={{ marginTop: Spacing.sm }}
        />
        <View style={styles.shareRow}>
          <PrimaryButton label="Share result" variant="ghost" onPress={() => setShareOpen(true)} />
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
  scoreSub: { ...Typography.labelMd, color: Colors.inversePrimary, textAlign: 'center' },
  scoreMark: { ...Typography.caption, color: Colors.inversePrimary, marginTop: Spacing.xs },
  offlineCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  offlineText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 18 },
  badgeCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center', gap: Spacing.xs, borderWidth: 1.5, borderColor: Colors.teal },
  tryAgain: { borderColor: Colors.surfaceContainerHigh },
  badgeIcon: { width: 60, height: 60, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  badgeTitle: { ...Typography.titleLg, color: Colors.onSurface },
  badgeBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', marginBottom: Spacing.sm },
  cashbackCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs },
  cashRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  cashTitle: { ...Typography.labelLg, color: Colors.onSurface },
  cashNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 18 },
  recap: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  recapTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  recapRow: { gap: 4, paddingVertical: Spacing.xs, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow },
  recapHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  recapQ: { ...Typography.labelMd, color: Colors.onSurface },
  recapExplain: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 19, marginLeft: 26 },
  shareRow: { alignItems: 'center' },
});
