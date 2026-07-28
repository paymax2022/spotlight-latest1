import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { XCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';

export default function VoteFailedScreen() {
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const isPending = !!reason;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.center}>
          <View style={styles.iconWrap}>
            <XCircle size={52} color={Colors.error} strokeWidth={1.5} />
          </View>
          <Text style={styles.title}>{isPending ? 'Payment Pending' : 'Vote Not Completed'}</Text>
          <Text style={styles.sub}>
            {isPending
              ? 'We could not confirm your payment in time.'
              : 'Your vote was not completed due to a payment or network error.\nYou have not been charged.'}
          </Text>

          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>What happened?</Text>
            <Text style={styles.infoText}>
              {reason ??
                'This could be due to an insufficient wallet balance, network timeout, or a temporary issue with the payment processor. Please try again or contact support if the issue persists.'}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          {isPending ? (
            <PrimaryButton
              label="View My Votes"
              onPress={() => router.replace('/voting/my-votes')}
            />
          ) : (
            <PrimaryButton
              label="Try Again"
              onPress={() => router.back()}
            />
          )}
          <PrimaryButton
            label="Contact Support"
            onPress={() => router.push('/voting/support')}
            variant="secondary"
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: Colors.background },
  content:  { flex: 1, padding: Spacing.containerMargin, justifyContent: 'space-between' },
  center:   { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.lg },
  iconWrap: { width: 88, height: 88, borderRadius: 44, backgroundColor: Colors.errorContainer, alignItems: 'center', justifyContent: 'center' },
  title:    { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  sub:      { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 26 },
  infoCard: { backgroundColor: Colors.errorContainer, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.sm, width: '100%' },
  infoTitle: { ...Typography.labelMd, color: Colors.error },
  infoText:  { ...Typography.bodySm, color: Colors.onSurface, lineHeight: 20 },
  actions:  { gap: Spacing.sm, paddingBottom: Platform.OS === 'ios' ? 8 : 0 },
});
