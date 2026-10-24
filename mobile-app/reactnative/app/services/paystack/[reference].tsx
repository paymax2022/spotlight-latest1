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
import { Colors } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import { getUtilityPaystackIntent, verifyUtilityPaystackIntent } from '@/api/billing.api';
import { HomeMenuButton } from '@/components/HomeMenu';

// Resolver screen for an in-app Paystack bill payment. A utility_paystack_intents
// row is settled server-side and links the real utility_transactions row. We
// drive that settlement ourselves (verifyUtilityPaystackIntent) AND poll the
// intent by reference, then hand off to the transaction status screen once it
// resolves. Relying on the Paystack webhook alone leaves the intent 'pending'
// forever on a local dev server (the webhook cannot reach localhost) and often
// in production too (the in-app checkout misses the callback redirect).

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

  // Actively settle the intent rather than waiting for the webhook. Verify is
  // idempotent server-side (it returns already_processed once settled and races
  // the webhook safely), so we fire it on mount and on a slow interval while the
  // intent is unresolved — ~12/min, under the endpoint's 20/min limit. It is
  // best-effort: the intent-row poll above stays the source of truth, so a verify
  // error (already settled, transient network) must never surface on screen.
  const unresolved = !data || (data.status !== 'completed' && data.status !== 'failed');
  React.useEffect(() => {
    if (!reference || !unresolved) return;
    let cancelled = false;
    const settle = async () => {
      try { await verifyUtilityPaystackIntent(reference); } catch { /* best-effort — poll owns the UI state */ }
      if (!cancelled) refetch();
    };
    settle(); // kick immediately so a missed webhook/callback resolves at once
    const id = setInterval(settle, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [reference, unresolved, refetch]);

  // Once the intent links the real transaction, replace into its status screen.
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Pressable onPress={() => refetch()} style={styles.iconBtn}>
            <RefreshCw size={20} color={Colors.primary} strokeWidth={2} />
          </Pressable>
          <HomeMenuButton />
        </View>
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
