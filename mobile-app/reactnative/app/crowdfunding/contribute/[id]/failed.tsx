import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CircleX } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';

const REASONS: Record<string, string> = {
  declined: 'Your payment was declined. No money has left your account.',
  network: "We couldn't confirm your payment due to a network issue. If you were charged, it will be reversed automatically.",
  init: 'We couldn’t start this payment. Please try again.',
};

export default function FailedScreen() {
  const { id, reason } = useLocalSearchParams<{ id: string; reason?: string }>();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <View style={styles.iconBox}><CircleX size={56} color={Colors.error} strokeWidth={2} /></View>
        <Text style={styles.title}>Payment failed</Text>
        <Text style={styles.sub}>{REASONS[reason ?? ''] ?? 'Something went wrong with your payment.'}</Text>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Try again" onPress={() => router.replace(`/crowdfunding/contribute/${id}`)} />
        <PrimaryButton label="Back to campaign" variant="ghost" onPress={() => router.dismissTo(`/crowdfunding/campaign/${id}`)} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  iconBox: { width: 104, height: 104, borderRadius: Radius.full, backgroundColor: Colors.errorContainer, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.xs, paddingBottom: Spacing.md },
});
