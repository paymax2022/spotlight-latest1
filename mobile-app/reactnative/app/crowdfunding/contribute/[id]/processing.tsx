import React, { useEffect, useRef } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Animated, Easing } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useVerifyContribution } from '@/features/crowdfunding/hooks/useCrowdfunding';

export default function ProcessingScreen() {
  const { id, reference, status } = useLocalSearchParams<{ id: string; reference: string; status?: string }>();
  const verify = useVerifyContribution();
  const pulse = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.6, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    ).start();
  }, [pulse]);

  useEffect(() => {
    // Bank transfer / USSD stay pending; card & wallet verify to a result.
    if (status === 'PENDING') {
      const t = setTimeout(() => router.replace(`/crowdfunding/contribute/${id}/receipt?reference=${reference}&pending=1`), 1500);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      verify.mutate(reference as string, {
        onSuccess: (res) => {
          if (res.status === 'SUCCESSFUL') router.replace(`/crowdfunding/contribute/${id}/success?reference=${res.reference}`);
          else router.replace(`/crowdfunding/contribute/${id}/failed?reason=declined`);
        },
        onError: () => router.replace(`/crowdfunding/contribute/${id}/failed?reason=network`),
      });
    }, 1400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference, status]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <Animated.View style={[styles.ring, { opacity: pulse }]}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </Animated.View>
        <Text style={styles.title}>Processing your contribution…</Text>
        <Text style={styles.sub}>Please don't close this screen.</Text>
        <View style={styles.secureRow}>
          <ShieldCheck size={14} color={Colors.tertiaryContainer} strokeWidth={2} />
          <Text style={styles.secureText}>Secured · {reference}</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  ring: { width: 96, height: 96, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.md },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  secureRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.md },
  secureText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
