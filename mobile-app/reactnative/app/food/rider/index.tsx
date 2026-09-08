import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import * as Icons from 'lucide-react-native';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { useRiderOffers, useRiderActive, useAcceptOffer } from '@/features/food/hooks';
import { formatNaira, formatDistance, toFoodError } from '@/features/food/utils';
import type { RiderOffer } from '@/features/food/types';
import { HomeMenuButton } from '@/components/HomeMenu';

function OfferCard({ offer, onAccept, accepting }: { offer: RiderOffer; onAccept: () => void; accepting: boolean }) {
  return (
    <View style={[c.card, shadow1]}>
      <View style={c.head}>
        <View style={c.iconBox}>
          <Icons.UtensilsCrossed size={20} color={Colors.secondary} strokeWidth={1.8} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={c.name} numberOfLines={1}>
            {offer.restaurantName}
          </Text>
          <Text style={c.meta}>
            {offer.itemCount} item{offer.itemCount > 1 ? 's' : ''} · {formatDistance(offer.distanceMeters)}
          </Text>
        </View>
        <Text style={c.payout}>{formatNaira(offer.payoutKobo)}</Text>
      </View>
      <View style={c.routeRow}>
        <Icons.MapPin size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
        <Text style={c.route} numberOfLines={1}>
          To: {offer.deliveryAddress}
        </Text>
      </View>
      <PrimaryButton label="Accept delivery" onPress={onAccept} loading={accepting} />
    </View>
  );
}
const c = StyleSheet.create({
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm, marginBottom: Spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  payout: { ...Typography.titleMd, color: Colors.tertiaryContainer },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  route: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
});

export default function RiderOffersScreen() {
  const { data: offers, isLoading, isError, refetch } = useRiderOffers({ poll: true });
  const { data: active } = useRiderActive({ poll: true });
  const accept = useAcceptOffer();

  const onAccept = (orderId: string) => {
    accept.mutate(orderId, {
      onSuccess: (order) => router.push(`/food/rider/${order.id}`),
      onError: (e) => Alert.alert('Could not accept', toFoodError(e).message),
    });
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.topBar}>
        <Pressable onPress={() => goBack('/food')} style={s.iconButton} accessibilityLabel="Go back">
          <Icons.ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={s.topTitle}>Rider · Offers</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={s.iconButton} />
          <HomeMenuButton />
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        {active ? (
          <Pressable style={[s.activeBanner, shadow1]} onPress={() => router.push(`/food/rider/${active.id}`)} accessibilityRole="button">
            <Icons.Navigation size={18} color={Colors.white} strokeWidth={2} />
            <Text style={s.activeText}>You have an active delivery — tap to continue</Text>
            <Icons.ChevronRight size={18} color={Colors.white} strokeWidth={2} />
          </Pressable>
        ) : null}

        <Text style={s.sectionTitle}>Available offers</Text>

        {isLoading ? (
          <StateView kind="loading" message="Looking for delivery offers…" />
        ) : isError ? (
          <StateView kind="error" title="Couldn't load offers" actionLabel="Retry" onAction={() => refetch()} />
        ) : !offers || offers.length === 0 ? (
          <StateView kind="empty" icon="Bike" title="No offers right now" message="New delivery offers will appear here automatically." />
        ) : (
          offers.map((offer) => (
            <OfferCard key={offer.orderId} offer={offer} onAccept={() => onAccept(offer.orderId)} accepting={accept.isPending} />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topBar: {
    height: 64,
    paddingHorizontal: Spacing.containerMargin,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceContainerHigh,
    backgroundColor: 'rgba(248,249,255,0.92)',
  },
  iconButton: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  topTitle: { ...Typography.titleLg, color: Colors.primary },
  content: { padding: Spacing.containerMargin },
  activeBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.secondary, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.lg },
  activeText: { ...Typography.labelMd, color: Colors.white, flex: 1 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.md },
});
