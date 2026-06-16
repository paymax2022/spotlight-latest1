import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { AlertCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useVerifyPaidVote } from '@/features/voting/hooks/useVote';

export default function PaymentProcessingScreen() {
  const { reference, contestantId, contestId, votes } =
    useLocalSearchParams<{ reference: string; contestantId: string; contestId: string; votes: string }>();
  const verify    = useVerifyPaidVote();
  const attemptRef = useRef(false);
  const pulse     = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.12, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.00, duration: 700, useNativeDriver: true }),
      ]),
    ).start();
  }, [pulse]);

  useEffect(() => {
    if (attemptRef.current) return;
    attemptRef.current = true;

    const timer = setTimeout(async () => {
      try {
        const result = await verify.mutateAsync(reference ?? '');
        if (result.status === 'SUCCESSFUL') {
          router.replace(`/voting/vote-success?contestantId=${contestantId}&contestId=${contestId}&votes=${votes}&voteType=PAID`);
        } else {
          router.replace('/voting/vote-failed');
        }
      } catch {
        router.replace('/voting/vote-failed');
      }
    }, 3_000);

    return () => clearTimeout(timer);
  }, []);

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
          onPress={async () => {
            try {
              const result = await verify.mutateAsync(reference ?? '');
              if (result.status === 'SUCCESSFUL') {
                router.replace(`/voting/vote-success?contestantId=${contestantId}&contestId=${contestId}&votes=${votes}&voteType=PAID`);
              } else {
                router.replace('/voting/vote-failed');
              }
            } catch {
              router.replace('/voting/vote-failed');
            }
          }}
          style={styles.checkBtn}
        >
          <Text style={styles.checkBtnText}>Check Status</Text>
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
