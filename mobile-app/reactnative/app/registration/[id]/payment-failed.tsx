import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { XCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import PrimaryButton from '@/components/PrimaryButton';

// Terminal screen for a failed/abandoned registration fee payment. Reached from
// payment-processing when verification returns FAILED or times out. No money has
// been captured (or any capture is reversed); the user can retry the payment.
export default function RegistrationPaymentFailedScreen() {
  const { id, reason } = useLocalSearchParams<{ id: string; reason?: string }>();
  const appId = id ?? '';

  const message =
    reason && reason.trim().length > 0
      ? reason
      : 'Your registration fee payment did not go through. You have not been charged, or any charge will be reversed.';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={[styles.card, shadow1]}>
          <View style={styles.iconWrap}>
            <XCircle size={40} color={Colors.error} strokeWidth={1.8} />
          </View>
          <Text style={styles.title}>Payment Failed</Text>
          <Text style={styles.sub}>{message}</Text>
        </View>

        <View style={styles.actions}>
          <PrimaryButton
            label="Try Again"
            onPress={() => router.replace(`/registration/${appId}/payment` as never)}
          />
          <PrimaryButton
            label="Back to Application"
            variant="secondary"
            onPress={() => router.replace(`/registration/${appId}/status` as never)}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: Colors.background },
  content:  { flex: 1, justifyContent: 'center', padding: Spacing.xl, gap: Spacing.xl, paddingBottom: Platform.OS === 'ios' ? 40 : Spacing.xl },
  card:     { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.xl, alignItems: 'center', gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  iconWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: `${Colors.error}18`, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  title:    { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  sub:      { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 24 },
  actions:  { gap: Spacing.sm },
});
