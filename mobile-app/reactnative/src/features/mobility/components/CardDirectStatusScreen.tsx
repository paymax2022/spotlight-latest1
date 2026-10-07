import React from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, Clock, XCircle, RefreshCw } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors, Radius, Spacing, Typography, shadow1 } from '@/constants/tokens';
import {
  cardDirectFailureMessage,
  isCardDirectFailure,
  isCardDirectRefunding,
  isCardDirectTerminal,
  type CardDirectStatus,
} from '../utils/cardDirect';

// Shared resolver screen for the Mobility CARD-DIRECT rail (Paystack-funded,
// no wallet, no KYC-tier gate). Same behaviour as app/mobility/paystack/
// [reference].tsx (the ride resolver): the intent is confirmed asynchronously
// by the Paystack webhook, or self-healed by this screen's own polling read
// (the status endpoint drives confirmation; Paystack cannot webhook localhost).
// A service's route file is a ~15-line wrapper that supplies the fetcher, the
// noun for the copy, and where to go once confirmed — nothing else.

interface Props<S extends CardDirectStatus> {
  reference: string | undefined;
  queryKey: string;
  fetchStatus: (reference: string) => Promise<S>;
  /** Called once with the confirmed status; navigate to the booked entity. */
  onConfirmed: (status: S) => void;
  /** e.g. "parcel delivery" — used in the failure copy. */
  noun: string;
  processingText: string;
  homeRoute: string;
}

export default function CardDirectStatusScreen<S extends CardDirectStatus>({
  reference, queryKey, fetchStatus, onConfirmed, noun, processingText, homeRoute,
}: Props<S>) {
  const { data, isError, refetch } = useQuery({
    queryKey: ['mobility', 'card-direct', queryKey, reference],
    queryFn: () => fetchStatus(reference ?? ''),
    enabled: !!reference,
    refetchInterval: (query) => (isCardDirectTerminal(query.state.data?.status) ? false : 3000),
  });

  const confirmedRef = React.useRef(false);
  React.useEffect(() => {
    if (data?.status === 'confirmed' && !confirmedRef.current) {
      confirmedRef.current = true;
      onConfirmed(data);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.status]);

  const failed = isCardDirectFailure(data?.status);
  const refunding = isCardDirectRefunding(data?.status);
  const failureMessage = cardDirectFailureMessage(data?.status, noun);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.replace(homeRoute as never)} style={styles.iconBtn}>
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
          ) : refunding ? (
            <>
              <View style={[styles.statusIcon, { backgroundColor: `${Colors.secondary}18` }]}>
                <RefreshCw size={34} color={Colors.secondary} strokeWidth={1.8} />
              </View>
              <Text style={[styles.status, { color: Colors.secondary }]}>REFUNDING</Text>
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
                <Text style={styles.summary}>{processingText}</Text>
              </View>
            </>
          )}

          <Text style={styles.ref}>{data?.reference ?? reference}</Text>
        </View>

        <View style={styles.actions}>
          {failed ? (
            <>
              <PrimaryButton label="Try Again" onPress={() => router.replace(homeRoute as never)} />
              <PrimaryButton label="Go Home" variant="secondary" onPress={() => router.replace(homeRoute as never)} />
            </>
          ) : (
            <PrimaryButton label="Go Home" variant="secondary" onPress={() => router.replace(homeRoute as never)} />
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
