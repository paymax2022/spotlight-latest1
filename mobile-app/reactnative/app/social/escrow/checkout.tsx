import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, ShieldCheck, Package } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { PaymentSheet, usePurchasePayment } from '@/features/payments';
import { useListing, useCheckoutEscrow, formatNaira, ESCROW_DISCLOSURE } from '@/features/social/escrow';
import { SocialColors } from '@/features/social/constants/social.constants';
import { HomeMenuButton } from '@/components/HomeMenu';

export default function EscrowCheckout() {
  const { listingId } = useLocalSearchParams<{ listingId: string }>();
  const listing = useListing(listingId ?? '');
  const checkout = useCheckoutEscrow();
  const pay = usePurchasePayment();
  const [tradeId, setTradeId] = useState<string | null>(null);

  const onPay = () => {
    if (!listing.data) return;
    pay.start({
      amountKobo: listing.data.priceKobo,
      title: `Escrow — ${listing.data.title}`,
      charge: () => checkout.mutateAsync({ listingId: listing.data!.id, amountKobo: listing.data!.priceKobo }),
      onPaid: (trade) => setTradeId((trade as { id: string }).id),
    });
  };

  if (tradeId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}><Pressable onPress={() => router.replace('/social/listing/browse')} hitSlop={10} style={styles.iconBtn}><ArrowLeft size={22} color={Colors.onSurface} /></Pressable><Text style={styles.headerTitle}>Funds held</Text><View style={styles.iconBtn} /></View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <StateView kind="empty" icon="ShieldCheck" title="Payment held in escrow" message="Your money is safe. Confirm release once you receive the item, or raise a dispute if something's wrong." actionLabel="View escrow" onAction={() => router.replace(`/social/escrow/${tradeId}`)} />
          <HomeMenuButton />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/social')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back"><ArrowLeft size={22} color={Colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Escrow checkout</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={styles.iconBtn} />
          <HomeMenuButton />
        </View>
      </View>

      {listing.isLoading ? (
        <StateView kind="loading" message="Loading…" />
      ) : listing.isError || !listing.data ? (
        <StateView kind="error" title="Couldn't load item" actionLabel="Retry" onAction={() => listing.refetch()} />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <View style={styles.itemCard}>
              <View style={[styles.thumb, { backgroundColor: listing.data.thumbColor }]}><Package size={22} color="#FFFFFF" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle} numberOfLines={1}>{listing.data.title}</Text>
                <Text style={styles.itemSeller}>Seller {listing.data.sellerHandle}</Text>
              </View>
            </View>

            <View style={styles.summary}>
              <Row label="Item price" value={formatNaira(listing.data.priceKobo)} />
              <Row label="Escrow fee" value="Free" />
              <View style={styles.divider} />
              <Row label="Total held in escrow" value={formatNaira(listing.data.priceKobo)} bold />
            </View>

            <View style={styles.escrowBanner}>
              <ShieldCheck size={18} color={SocialColors.ok} />
              <Text style={styles.escrowText}>{ESCROW_DISCLOSURE}</Text>
            </View>
            <View style={{ height: 120 }} />
          </ScrollView>

          <View style={styles.footer}>
            <PrimaryButton label={`Pay ${formatNaira(listing.data.priceKobo)} into escrow`} onPress={onPay} />
          </View>
        </>
      )}

      <PaymentSheet controller={pay} />
    </SafeAreaView>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, bold && styles.rowBold]}>{label}</Text>
      <Text style={[styles.rowValue, bold && styles.rowBold]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface, flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  itemCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: SocialColors.surfaceAlt, borderRadius: Radius.lg, padding: Spacing.md },
  thumb: { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { ...Typography.titleMd, color: SocialColors.text },
  itemSeller: { ...Typography.bodySm, color: SocialColors.muted },
  summary: { backgroundColor: SocialColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, marginTop: Spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  rowLabel: { ...Typography.bodyMd, color: SocialColors.muted },
  rowValue: { ...Typography.bodyMd, color: SocialColors.text },
  rowBold: { ...Typography.titleMd, color: SocialColors.text },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: SocialColors.border, marginVertical: 6 },
  escrowBanner: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: SocialColors.okBg, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.md },
  escrowText: { ...Typography.labelSm, color: SocialColors.text, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
