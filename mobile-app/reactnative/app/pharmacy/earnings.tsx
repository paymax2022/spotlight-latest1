import React from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Wallet, Clock } from 'lucide-react-native';

import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { usePharmacyEarnings } from '@/features/pharmacymerchant/hooks';

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The pharmacy's money view.
 *
 * A pharmacy is paid by escrow RELEASE the moment an order completes, straight
 * to the owner's wallet — there is no payout run to wait for, unlike a
 * restaurant. That made the money invisible as a BUSINESS figure: the owner saw
 * undifferentiated wallet credits with no attribution to their pharmacy.
 *
 * Two numbers, because they mean different things to a merchant: what has
 * arrived, and what is still held pending fulfilment. The second is actionable —
 * completing those orders is what releases it — so it says so.
 */
export default function PharmacyEarningsScreen() {
  const q = usePharmacyEarnings();

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScreenHeader title="Earnings" />

      {q.isLoading ? (
        <StateView kind="loading" title="Loading earnings" />
      ) : q.isError ? (
        <StateView
          kind="error"
          title="Couldn’t load your earnings"
          message="Check your connection and try again."
          actionLabel="Retry"
          onAction={() => q.refetch()}
        />
      ) : (
        <ScrollView
          contentContainerStyle={s.body}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}
        >
          <View style={[s.card, shadow1]}>
            <View style={s.head}>
              <Wallet size={16} color={Colors.primary} strokeWidth={2} />
              <Text style={s.label}>Paid to you</Text>
            </View>
            <Text style={s.big}>{naira(q.data?.released_kobo ?? 0)}</Text>
            <Text style={s.muted}>
              {q.data?.orders_paid
                ? `From ${q.data.orders_paid} completed order${q.data.orders_paid === 1 ? '' : 's'}. Paid into your wallet as each order completed.`
                : 'Money lands in your wallet as soon as an order is completed.'}
            </Text>
          </View>

          <View style={[s.card, shadow1]}>
            <View style={s.head}>
              <Clock size={16} color={Colors.secondary} strokeWidth={2} />
              <Text style={s.label}>Held for you</Text>
            </View>
            <Text style={s.big}>{naira(q.data?.held_kobo ?? 0)}</Text>
            <Text style={s.muted}>
              {q.data?.held_kobo
                ? 'Customers have paid this, and it’s held until you complete their orders. Dispense and hand over to release it.'
                : 'Nothing is waiting on you right now.'}
            </Text>
          </View>

          <Text style={s.footnote}>
            Figures come from the payments held against your orders, so they match what actually
            moved. Refunded orders are not counted.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { padding: Spacing.md, gap: Spacing.sm },
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: 6,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  big: { ...Typography.headlineMd, color: Colors.onSurface },
  muted: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  footnote: { ...Typography.caption, color: Colors.onSurfaceVariant, paddingHorizontal: Spacing.xs },
});
