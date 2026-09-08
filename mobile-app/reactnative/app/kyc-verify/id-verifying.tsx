import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { CheckCircle2, XCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { useIdNumberCheck } from '@/features/kycverify/hooks';
import { kycVerifyDraft, markPassed } from '@/features/kycverify/draft';
import { nextStepRoute } from '@/features/kycverify/flow';
import type { VerificationCheck } from '@/features/kycverify/types';

/**
 * K6 — ID verifying. Runs POST /checks/id-number (with Idempotency-Key), shows a
 * progress spinner, then:
 *   PASSED → show matched name/DOB, continue to next required step
 *   PENDING/REVIEW → K11 (pending review, polled)
 *   FAILED → K13 (failed, retry)
 */
export default function KycIdVerifyingScreen() {
  const draft = kycVerifyDraft.current;
  const run = useIdNumberCheck();
  const fired = useRef(false);
  const [result, setResult] = useState<VerificationCheck | null>(null);

  useEffect(() => {
    if (fired.current) return;
    // No session yet (e.g. deep-linked here) → go establish one instead of
    // spinning forever.
    if (!draft.sessionId) {
      router.replace('/kyc-verify/consent');
      return;
    }
    fired.current = true;
    run.mutate(
      {
        sessionId: draft.sessionId,
        idType: draft.idType,
        idNumber: draft.idNumber,
        firstName: draft.firstName || undefined,
        lastName: draft.lastName || undefined,
        dob: draft.dob || undefined,
      },
      {
        onSuccess: (check) => {
          setResult(check);
          if (check.status === 'PASSED') {
            markPassed('id-number');
          } else if (check.status === 'PENDING' || check.status === 'REVIEW') {
            router.replace('/kyc-verify/pending');
          } else if (check.status === 'FAILED') {
            router.replace({
              pathname: '/kyc-verify/failed',
              params: { reason: check.reason ?? '', check: 'id-number' },
            });
          }
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = run.isPending || (!result && !run.isError);
  const passed = result?.status === 'PASSED';

  const proceed = () => router.replace(nextStepRoute(kycVerifyDraft.current));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.center}>
        {pending ? (
          <>
            <View style={styles.ring}><ActivityIndicator size="large" color={Colors.primary} /></View>
            <Text style={styles.title}>Verifying your {draft.idType}…</Text>
            <Text style={styles.sub}>Matching your details against government records. This takes a few seconds.</Text>
          </>
        ) : run.isError ? (
          <>
            <View style={[styles.ring, styles.ringError]}><XCircle size={56} color={Colors.error} strokeWidth={1.8} /></View>
            <Text style={styles.title}>Couldn't run the check</Text>
            <Text style={styles.sub}>Something went wrong reaching the verification service. Please try again.</Text>
          </>
        ) : passed ? (
          <>
            <View style={[styles.ring, styles.ringDone]}><CheckCircle2 size={56} color={Colors.tertiaryContainer} strokeWidth={1.8} /></View>
            <Text style={styles.title}>Identity matched 🎉</Text>
            <Text style={styles.sub}>We confirmed your details against the records below.</Text>
            <View style={styles.matchCard}>
              {result?.matchedName ? (
                <View style={styles.matchRow}><Text style={styles.matchKey}>Name</Text><Text style={styles.matchVal}>{result.matchedName}</Text></View>
              ) : null}
              {result?.matchedDob ? (
                <View style={styles.matchRow}><Text style={styles.matchKey}>Date of birth</Text><Text style={styles.matchVal}>{result.matchedDob}</Text></View>
              ) : null}
              {!result?.matchedName && !result?.matchedDob ? (
                <Text style={styles.matchVal}>Details confirmed.</Text>
              ) : null}
            </View>
          </>
        ) : null}
      </View>

      {!pending ? (
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          {run.isError ? (
            <PrimaryButton label="Back" onPress={() => goBack('/kyc-verify')} />
          ) : passed ? (
            <PrimaryButton label="Continue" onPress={proceed} />
          ) : null}
        </SafeAreaView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  ring: { width: 104, height: 104, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  ringDone: { backgroundColor: Colors.iconBgTeal },
  ringError: { backgroundColor: Colors.errorContainer },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.sm },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  matchCard: {
    alignSelf: 'stretch', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg,
    padding: Spacing.md, gap: Spacing.sm, marginTop: Spacing.sm,
  },
  matchRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  matchKey: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  matchVal: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' as const, flexShrink: 1, textAlign: 'right' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
