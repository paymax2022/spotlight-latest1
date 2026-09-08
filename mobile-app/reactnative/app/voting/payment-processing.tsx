import React, { useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { AlertCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useVerifyPaidVote } from '@/features/voting/hooks/useVote';

// Bounded verification backoff. Paystack settlement is usually quick but can lag,
// so we poll a few times at widening intervals before giving up.
const POLL_DELAYS_MS = [2_000, 3_000, 5_000, 8_000, 12_000];

export default function PaymentProcessingScreen() {
  const { transactionId, reference, contestantId, contestId, votes } =
    useLocalSearchParams<{ transactionId: string; reference: string; contestantId: string; contestId: string; votes: string }>();
  const verify    = useVerifyPaidVote();
  const pulse     = useRef(new Animated.Value(1)).current;
  // Tracks the in-flight backoff timer and whether the screen is still mounted /
  // hasn't already routed away, so we never call router after navigation/unmount.
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.12, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.00, duration: 700, useNativeDriver: true }),
      ]),
    ).start();
  }, [pulse]);

  const goSuccess = useCallback(() => {
    settledRef.current = true;
    router.replace(`/voting/vote-success?contestantId=${contestantId}&contestId=${contestId}&votes=${votes}&voteType=PAID`);
  }, [contestantId, contestId, votes]);

  const goFailed = useCallback((reason?: string) => {
    settledRef.current = true;
    const q = reason ? `?reason=${encodeURIComponent(reason)}` : '';
    router.replace(`/voting/vote-failed${q}`);
  }, []);

  /**
   * Verify once. Returns true when a *terminal* status (SUCCESSFUL/FAILED) was
   * reached and we've navigated; false when still pending and the caller should
   * schedule another attempt.
   */
  const verifyOnce = useCallback(async (): Promise<boolean> => {
    try {
      const result = await verify.mutateAsync({
        transactionId: transactionId ?? '',
        reference: reference ?? '',
      });
      if (result.status === 'SUCCESSFUL') { goSuccess(); return true; }
      if (result.status === 'FAILED')     { goFailed(); return true; }
      return false; // PENDING / PROCESSING → keep polling
    } catch (err) {
      // A 4xx is the server's VERDICT, not a hiccup: "This payment was not
      // successful", a missing transactionId, an unknown reference. Treating
      // every thrown error as transient meant a definitively failed payment was
      // polled to exhaustion — the voter watched a spinner while the console
      // filled with 400s, and never reached the failure screen that explains it.
      // Only 5xx and genuine network faults deserve a retry.
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (typeof status === 'number' && status >= 400 && status < 500) {
        const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        goFailed(message);
        return true;
      }
      return false;
    }
  }, [verify, transactionId, reference, goSuccess, goFailed]);

  // Automatic bounded polling with increasing intervals.
  useEffect(() => {
    let attempt = 0;

    const tick = async () => {
      if (settledRef.current) return;
      const terminal = await verifyOnce();
      if (terminal || settledRef.current) return;

      if (attempt >= POLL_DELAYS_MS.length) {
        // Exhausted retries with no terminal status — payment may still settle.
        goFailed('Your payment is still pending. Check My Votes shortly to confirm.');
        return;
      }
      const delay = POLL_DELAYS_MS[attempt];
      attempt += 1;
      timerRef.current = setTimeout(tick, delay);
    };

    // First attempt after the initial (shortest) delay.
    timerRef.current = setTimeout(tick, POLL_DELAYS_MS[attempt]);
    attempt += 1;

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Manual "Check Status" — fires an immediate verify; only routes on a terminal
  // status so a still-pending payment leaves the user on this screen.
  const handleCheckStatus = useCallback(async () => {
    if (settledRef.current) return;
    await verifyOnce();
  }, [verifyOnce]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.center}>
        <Animated.View style={[styles.pulseRing, { transform: [{ scale: pulse }] }]}>
          <View style={styles.innerCircle}>
            <ActivityIndicator size="large" color={Colors.onPrimary} />
          </View>
        </Animated.View>

        <Text style={styles.title}>Processing Payment</Text>
        <Text style={styles.sub}>Please wait while we confirm your payment and allocate your votes.</Text>

        <View style={styles.refCard}>
          <Text style={styles.refLabel}>Transaction Reference</Text>
          <Text style={styles.refValue}>{reference ?? '—'}</Text>
        </View>

        <View style={styles.warningRow}>
          <AlertCircle size={16} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
          <Text style={styles.warningText}>Do not close this screen while your payment is being processed.</Text>
        </View>

        <Pressable
          onPress={handleCheckStatus}
          disabled={verify.isPending}
          style={styles.checkBtn}
        >
          <Text style={styles.checkBtnText}>{verify.isPending ? 'Checking…' : 'Check Status'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.lg },
  pulseRing:   { width: 100, height: 100, borderRadius: 50, backgroundColor: Colors.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  innerCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  title:       { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  sub:         { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 26 },
  refCard:     { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, alignItems: 'center', gap: 4, width: '100%' },
  refLabel:    { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  refValue:    { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' as const },
  warningRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.lg, padding: Spacing.md },
  warningText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 18 },
  checkBtn:    { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.lg },
  checkBtnText: { ...Typography.labelMd, color: Colors.primary },
});
