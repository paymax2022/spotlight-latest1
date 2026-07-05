import React, { useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { AlertCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useVerifyRegistrationPayment } from '@/features/registration/hooks/useRegistration';

// Bounded backoff — Paystack usually settles within seconds but can take longer.
const POLL_DELAYS_MS = [2_000, 3_000, 5_000, 8_000, 12_000];

export default function RegistrationPaymentProcessingScreen() {
  const { id, transactionId, reference } =
    useLocalSearchParams<{ id: string; transactionId: string; reference: string }>();
  const appId = id ?? '';

  const verify      = useVerifyRegistrationPayment(appId);
  const pulse       = useRef(new Animated.Value(1)).current;
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settledRef  = useRef(false);

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
    // Payment confirmed — send to review/submit screen.
    router.replace(`/registration/${appId}/submit` as never);
  }, [appId]);

  const goFailed = useCallback((reason?: string) => {
    settledRef.current = true;
    router.replace(`/registration/${appId}/payment-failed?reason=${encodeURIComponent(reason ?? '')}` as never);
  }, [appId]);

  const verifyOnce = useCallback(async (): Promise<boolean> => {
    try {
      const result = await verify.mutateAsync({
        transactionId: transactionId ?? '',
        reference:     reference ?? '',
      });
      if (result.status === 'SUCCESSFUL') { goSuccess(); return true; }
      if (result.status === 'FAILED')     { goFailed(); return true; }
      return false;
    } catch {
      return false; // network hiccup — keep polling
    }
  }, [verify, transactionId, reference, goSuccess, goFailed]);

  useEffect(() => {
    let attempt = 0;

    const tick = async () => {
      if (settledRef.current) return;
      const terminal = await verifyOnce();
      if (terminal || settledRef.current) return;

      if (attempt >= POLL_DELAYS_MS.length) {
        goFailed('Your payment is still being processed. Check your application status shortly.');
        return;
      }
      timerRef.current = setTimeout(tick, POLL_DELAYS_MS[attempt]);
      attempt += 1;
    };

    timerRef.current = setTimeout(tick, POLL_DELAYS_MS[attempt]);
    attempt += 1;

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCheckNow = useCallback(async () => {
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

        <Text style={styles.title}>Confirming Payment</Text>
        <Text style={styles.sub}>
          Please wait while we verify your registration fee payment with Paystack.
        </Text>

        <View style={styles.refCard}>
          <Text style={styles.refLabel}>Transaction Reference</Text>
          <Text style={styles.refValue}>{reference ?? '—'}</Text>
        </View>

        <View style={styles.warningRow}>
          <AlertCircle size={16} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
          <Text style={styles.warningText}>
            Do not close this screen while your payment is being confirmed.
          </Text>
        </View>

        <Pressable
          onPress={handleCheckNow}
          disabled={verify.isPending}
          style={styles.checkBtn}
        >
          <Text style={styles.checkBtnText}>
            {verify.isPending ? 'Checking…' : 'Check Now'}
          </Text>
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
  warningRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.lg, padding: Spacing.md, width: '100%' },
  warningText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 18 },
  checkBtn:    { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.lg },
  checkBtnText: { ...Typography.labelMd, color: Colors.primary },
});
