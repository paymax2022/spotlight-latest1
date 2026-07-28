import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { usePublicOffers } from '@/features/stocks/hooks/useStocks';
import { formatMoneyObj, relativeTime, formatDateTime } from '@/features/stocks/utils/stockFormatters';
import type { PublicOffer } from '@/features/stocks/types/stocks.types';

const KIND_LABEL: Record<PublicOffer['kind'], string> = {
  ipo: 'IPO',
  rights: 'Rights',
};

const STATUS_STYLE: Record<PublicOffer['status'], { label: string; fg: string; bg: string }> = {
  open: { label: 'Open', fg: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  upcoming: { label: 'Upcoming', fg: Colors.onPrimaryFixedVariant, bg: Colors.iconBgPurple },
  closed: { label: 'Closed', fg: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
};

export default function PublicOffersScreen() {
  const offers = usePublicOffers();
  const list = offers.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Public offers" subtitle="IPOs & rights issues" />

      {offers.isLoading ? (
        <StateView kind="loading" message="Loading offers…" />
      ) : offers.isError ? (
        <StateView kind="error" title="Couldn't load offers" message="Please check your connection and try again." actionLabel="Retry" onAction={() => offers.refetch()} />
      ) : list.length === 0 ? (
        <StateView kind="empty" icon="Megaphone" title="No offers right now" message="New IPOs and rights issues will appear here when they open." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {list.map((offer) => {
            const status = STATUS_STYLE[offer.status];
            const dateLine = offer.status === 'open'
              ? `Closes ${relativeTime(offer.closeDate)}`
              : offer.status === 'upcoming'
                ? `Opens ${formatDateTime(offer.openDate)}`
                : `Closed ${relativeTime(offer.closeDate)}`;
            return (
              <Pressable
                key={offer.id}
                onPress={() => router.push(`/stocks/offers/${offer.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`${offer.name} ${KIND_LABEL[offer.kind]}, ${status.label}`}
                style={({ pressed }) => [styles.card, shadow1, pressed && styles.pressed]}
              >
                <View style={styles.cardHead}>
                  <View style={styles.flex}>
                    <Text style={styles.name} numberOfLines={1}>{offer.name}</Text>
                    <Text style={styles.symbol} numberOfLines={1}>{offer.symbol}</Text>
                  </View>
                  <View style={styles.badges}>
                    <View style={styles.kindBadge}>
                      <Text style={styles.kindText}>{KIND_LABEL[offer.kind]}</Text>
                    </View>
                    <View style={[styles.statusChip, { backgroundColor: status.bg }]}>
                      <View style={[styles.statusDot, { backgroundColor: status.fg }]} />
                      <Text style={[styles.statusText, { color: status.fg }]}>{status.label}</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.divider} />

                <View style={styles.metaRow}>
                  <View>
                    <Text style={styles.metaLabel}>Price band</Text>
                    <Text style={styles.metaValue}>{formatMoneyObj(offer.priceLow)} – {formatMoneyObj(offer.priceHigh)}</Text>
                  </View>
                  <View style={styles.metaRight}>
                    <Text style={styles.metaLabel}>{offer.status === 'upcoming' ? 'Opens' : 'Closes'}</Text>
                    <Text style={styles.metaValue}>{dateLine}</Text>
                  </View>
                  <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  flex: { flex: 1 },
  pressed: { opacity: 0.85 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm,
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  name: { ...Typography.titleMd, color: Colors.onSurface },
  symbol: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  badges: { alignItems: 'flex-end', gap: 6 },
  kindBadge: { backgroundColor: Colors.iconBgPurple, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 3 },
  kindText: { ...Typography.caption, color: Colors.primary, fontWeight: '700' as const },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 3 },
  statusDot: { width: 6, height: 6, borderRadius: Radius.full },
  statusText: { ...Typography.caption, fontWeight: '600' as const },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerLow },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  metaRight: { flex: 1 },
  metaLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  metaValue: { ...Typography.labelMd, color: Colors.onSurface, marginTop: 1 },
});
