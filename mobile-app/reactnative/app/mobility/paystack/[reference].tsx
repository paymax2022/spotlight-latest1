import React from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Clock, XCircle, RefreshCw } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { getRidePaystackStatus } from '@/features/mobility/api/mobility.api';

// Resolver screen for a Paystack-funded (no-wallet, no-KYC-tier-gate) ride
// booking. Mirrors app/food/paystack/[reference].tsx exactly — see that
// screen's comment for the full account: a
// transport_ride_paystack_intents row is confirmed asynchronously by the
// Paystack webhook, or self-healed by this screen's own polling read (see
// transport/paystackcheckout.Service.CheckStatus, since Paystack cannot
// webhook localhost in dev). Once confirmed, hand off to the normal
// searching-for-driver screen; on any other terminal status, the charge has
// already been reversed server-side (RequestRidePaystackFunded's
// refund-on-failure path) — the rider was not left out of pocket.

const TERMINAL = new Set(['confirmed', 'amount_mismatch', 'order_failed', 'refunded']);

export default function RidePaystackIntentScreen() {
  const { reference } = useLocalSearchParams<{ reference: string }>();

  const { data, isError, refetch } = useQuery({
    queryKey: ['mobility', 'paystack-intent', reference],
    queryFn: () => getRidePaystackStatus(reference ?? ''),
    enabled: !!reference,
    refetchInterval: (query) => (TERMINAL.has(query.state.data?.status ?? '') ? false : 3000),
  });

  React.useEffect(() => {
    if (data?.status === 'confirmed' && data.tripId) {
      router.replace(`/mobility/searching?tripId=${data.tripId}` as never);
    }
  }, [data?.status, data?.tripId]);

  const failed = data?.status === 'amount_mismatch' || data?.status === 'order_failed' || data?.status === 'refunded';

  const failureMessage = (() => {
    switch (data?.status) {
      case 'refunded':
        return "This payment couldn't be turned into a ride booking, and has been refunded to your card/account. No money was kept.";
      case 'amount_mismatch':
      case 'order_failed':
        return 'This payment could not be turned into a ride (the fare may have changed). Any charge is being reversed and will not be kept.';
      default:
        return undefined;
    }
  })();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.replace('/mobility' as never)} style={styles.iconBtn}>
          <ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.topTitle}>Payment Status</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Pressable onPress={() => refetch()} style={styles.iconBtn}>
            <RefreshCw size={20} color={Colors.primary} strokeWidth={2} />
          </Pressable>
        </View>
      </View>

      <View style={styles.content}>
        <View style={[styles.card, shadow1]}>
          {failed ? (
            <>
              <View style={[styles.statusIcon, { backgroundColor: `${Colors.error}18` }]}>
                <XCircle size={34} color={Colors.error} strokeWidth={1.8} />
              </View>
              <Text style={[styles.status, { color: Colors.error }]}>
                {data?.status === 'refunded' ? 'REFUNDED' : 'FAILED'}
              </Text>
              <Text style={styles.summary}>{failureMessage}</Text>
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
                <Text style={styles.summary}>Confirming your payment and finding your ride. This may take a few moments.</Text>
              </View>
            </>
          )}

          <Text style={styles.ref}>{data?.reference ?? reference}</Text>
        </View>

        <View style={styles.actions}>
          {failed ? (
            <>
              <PrimaryButton label="Try Again" onPress={() => router.replace('/mobility' as never)} />
              <PrimaryButton
                label="Go Home"
                variant="secondary"
                onPress={() => router.replace('/mobility' as never)}
              />
            </>
          ) : (
            <PrimaryButton
              label="Go Home"
              variant="secondary"
              onPress={() => router.replace('/mobility' as never)}
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
