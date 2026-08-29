import React from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Clock, XCircle, RefreshCw } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { getUtilityPaystackIntent } from '@/api/billing.api';

// Resolver screen for an in-app Paystack bill payment. A utility_paystack_intents
// row is confirmed asynchronously by the Paystack webhook, which sets its status
// and links the real utility_transactions row. We poll the intent by reference,
// then hand off to the existing transaction status screen once the webhook lands.

export default function PaystackIntentScreen() {
  const { reference } = useLocalSearchParams<{ reference: string }>();

  const { data, isError, refetch } = useQuery({
    queryKey: ['utility', 'paystack-intent', reference],
    queryFn: () => getUtilityPaystackIntent(reference ?? ''),
    enabled: !!reference,
    // Poll while the webhook hasn't resolved the intent yet.
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === 'completed' || s === 'failed' ? false : 3000;
    },
  });

  // Once the webhook links the real transaction, replace into its status screen.
  React.useEffect(() => {
    if (data?.status === 'completed' && data.transactionId) {
      router.replace(`/services/transactions/${data.transactionId}` as never);
    }
  }, [data?.status, data?.transactionId]);

  const failed = data?.status === 'failed';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.replace('/services/transactions/index' as never)} style={styles.iconBtn}>
          <ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.topTitle}>Payment Status</Text>
        <Pressable onPress={() => refetch()} style={styles.iconBtn}>
          <RefreshCw size={20} color={Colors.primary} strokeWidth={2} />
        </Pressable>
      </View>

      <View style={styles.content}>
        <View style={[styles.card, shadow1]}>
          {failed ? (
            <>
              <View style={[styles.statusIcon, { backgroundColor: `${Colors.error}18` }]}>
                <XCircle size={34} color={Colors.error} strokeWidth={1.8} />
              </View>
              <Text style={[styles.status, { color: Colors.error }]}>FAILED</Text>
              <Text style={styles.summary}>
                {data?.failureReason || 'This payment did not go through. You were not charged, or any charge will be reversed.'}
              </Text>
            </>
          ) : isError && !data ? (
            <>
              <View style={[styles.statusIcon, { backgroundColor: `${Colors.error}18` }]}>
                <XCircle size={34} color={Colors.error} strokeWidth={1.8} />
              </View>
              <Text style={[styles.status, { color: Colors.error }]}>UNAVAILABLE</Text>
              <Text style={styles.summary}>We could not load this payment. It may still be processing.</Text>
            </>
          ) : (
            <>
              <View style={[styles.statusIcon, { backgroundColor: `${Colors.secondary}18` }]}>
                <Clock size={34} color={Colors.secondary} strokeWidth={1.8} />
              </View>
              <Text style={[styles.status, { color: Colors.secondary }]}>PROCESSING</Text>
              <View style={styles.spinnerRow}>
                <ActivityIndicator size="small" color={Colors.secondary} />
                <Text style={styles.summary}>Confirming your payment. This may take a few moments.</Text>
              </View>
            </>
          )}

          <Text style={styles.ref}>{data?.reference ?? reference}</Text>
        </View>

        <View style={styles.actions}>
          {failed ? (
            <>
              <PrimaryButton label="Try Again" onPress={() => goBack('/services')} />
              <PrimaryButton
                label="View Transactions"
                variant="secondary"
                onPress={() => router.replace('/services/transactions/index' as never)}
              />
            </>
          ) : (
            <PrimaryButton
              label="View Transactions"
              variant="secondary"
              onPress={() => router.replace('/services/transactions/index' as never)}
            />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  topBar:      { height: 64, paddingHorizontal: Spacing.containerMargin, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(248,249,255,0.92)', borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  iconBtn:     { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  topTitle:    { ...Typography.titleLg, color: Colors.primary },
  content:     { flex: 1, paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.xl, paddingBottom: Platform.OS === 'ios' ? 120 : 96 },
  card:        { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.xl, alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  statusIcon:  { width: 64, height: 64, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  status:      { ...Typography.labelMd, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  spinnerRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md },
  summary:     { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center', flexShrink: 1 },
  ref:         { ...Typography.labelSm, color: Colors.outline, marginTop: Spacing.sm },
  actions:     { gap: Spacing.sm },
});
