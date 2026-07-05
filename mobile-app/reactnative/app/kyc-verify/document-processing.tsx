import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CheckCircle2, XCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { useDocumentCheck } from '@/features/kycverify/hooks';
import { kycVerifyDraft, markPassed } from '@/features/kycverify/draft';
import { nextStepRoute } from '@/features/kycverify/flow';

/**
 * K9 — Document processing. Runs POST /checks/document (OCR + authenticity +
 * face-match) with an Idempotency-Key, then routes on the terminal status.
 */
export default function KycDocumentProcessingScreen() {
  const draft = kycVerifyDraft.current;
  const run = useDocumentCheck();
  const fired = useRef(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (fired.current || !draft.sessionId || !draft.docFrontB64) return;
    fired.current = true;
    run.mutate(
      {
        sessionId: draft.sessionId,
        docType: draft.docType,
        frontB64: draft.docFrontB64,
        backB64: draft.docBackB64 ?? undefined,
      },
      {
        onSuccess: (check) => {
          if (check.status === 'PASSED') {
            markPassed('document');
            setDone(true);
          } else if (check.status === 'PENDING' || check.status === 'REVIEW') {
            router.replace('/kyc-verify/pending');
          } else {
            router.replace({ pathname: '/kyc-verify/failed', params: { reason: check.reason ?? '', check: 'document' } });
          }
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = run.isPending || (!done && !run.isError);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.center}>
        {pending ? (
          <>
            <View style={styles.ring}><ActivityIndicator size="large" color={Colors.primary} /></View>
            <Text style={styles.title}>Checking your document…</Text>
            <Text style={styles.sub}>Reading the details, confirming it's genuine, and matching it to you.</Text>
          </>
        ) : run.isError ? (
          <>
            <View style={[styles.ring, styles.ringError]}><XCircle size={56} color={Colors.error} strokeWidth={1.8} /></View>
            <Text style={styles.title}>Couldn't process the document</Text>
            <Text style={styles.sub}>Something went wrong. Please try again.</Text>
          </>
        ) : (
          <>
            <View style={[styles.ring, styles.ringDone]}><CheckCircle2 size={56} color={Colors.tertiaryContainer} strokeWidth={1.8} /></View>
            <Text style={styles.title}>Document verified</Text>
            <Text style={styles.sub}>Your ID document passed our checks.</Text>
          </>
        )}
      </View>

      {!pending ? (
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          {run.isError ? (
            <PrimaryButton label="Back" onPress={() => router.back()} />
          ) : (
            <PrimaryButton label="Continue" onPress={() => router.replace(nextStepRoute(kycVerifyDraft.current))} />
          )}
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
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
