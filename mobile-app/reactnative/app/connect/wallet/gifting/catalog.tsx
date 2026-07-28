import React from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Lock, Send } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TierLimitBar from '@/features/connect/components/TierLimitBar';
import SolicitationGuard from '@/features/connect/components/wallet-SolicitationGuard';
import { formatKobo } from '@/features/connect/constants/format';
import type { GiftProduct } from '@/features/connect/wallet/types';
import { useGiftCatalog, useTierStatus } from '@/features/connect/wallet/hooks';

// WL-05 — Gift catalog (priced in kobo). Gifts above the user's tier are locked.
export default function GiftCatalog() {
  const catalog = useGiftCatalog();
  const tierQ = useTierStatus();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Send a gift" rightSlot={
        <Pressable onPress={() => router.push('/connect/wallet/gifting/sent')} hitSlop={8}>
          <Send size={20} color={Colors.primary} />
        </Pressable>
      } />
      {catalog.isLoading || tierQ.isLoading ? (
        <StateView kind="loading" message="Loading gifts…" />
      ) : catalog.error || !catalog.data || !tierQ.data ? (
        <StateView kind="error" title="Couldn't load gifts" actionLabel="Retry" onAction={() => catalog.refetch()} />
      ) : catalog.data.length === 0 ? (
        <StateView kind="empty" icon="Gift" title="No gifts available" message="Check back soon." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          <TierLimitBar tier={tierQ.data} compact />
          <SolicitationGuard />
          <View style={styles.grid}>
            {catalog.data.map((g) => (
              <GiftCard key={g.id} gift={g} locked={g.tierMin > tierQ.data!.tier}
                onPress={() => router.push({ pathname: '/connect/wallet/gifting/send', params: { productId: g.id } })} />
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function GiftCard({ gift, locked, onPress }: { gift: GiftProduct; locked: boolean; onPress: () => void }) {
  return (
    <Pressable
      disabled={locked}
      onPress={onPress}
      style={({ pressed }) => [styles.card, locked && styles.cardLocked, pressed && styles.pressed]}
    >
      {locked ? <View style={styles.lockBadge}><Lock size={12} color={Colors.onSurfaceVariant} /></View> : null}
      <Text style={styles.emoji}>{gift.emoji}</Text>
      <Text style={styles.name}>{gift.name}</Text>
      <Text style={styles.price}>{formatKobo(gift.priceKobo)}</Text>
      <Text style={styles.desc} numberOfLines={1}>{locked ? `Tier ${gift.tierMin} required` : gift.description}</Text>
    </Pressable>
  );
}

const GAP = Spacing.sm;
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: GAP },
  card: {
    width: '48%',
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
    alignItems: 'center', gap: 2,
  },
  cardLocked: { opacity: 0.55 },
  pressed: { opacity: 0.7 },
  lockBadge: { position: 'absolute', top: Spacing.sm, right: Spacing.sm },
  emoji: { fontSize: 34 },
  name: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.xs },
  price: { ...Typography.titleMd, color: Colors.primary },
  desc: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
