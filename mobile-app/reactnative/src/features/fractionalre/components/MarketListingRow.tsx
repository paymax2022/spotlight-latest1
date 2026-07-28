import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { KIND_LABEL } from '../constants';
import { formatNaira, relativeDate } from '../utils';
import type { MarketListing } from '../types';

interface Props {
  listing: MarketListing;
  onPress?: () => void;
}

/** Secondary-market listing row with NAV-anchored price + premium/discount tag. */
export default function MarketListingRow({ listing, onPress }: Props) {
  const deltaBps = listing.navPerUnitKobo > 0
    ? Math.round(((listing.pricePerUnitKobo - listing.navPerUnitKobo) / listing.navPerUnitKobo) * 10_000)
    : 0;
  const premium = deltaBps > 0;
  const deltaLabel = `${premium ? '+' : ''}${(deltaBps / 100).toFixed(1)}% vs NAV`;
  const deltaColor = premium ? Colors.onWarning : Colors.teal;

  return (
    <Pressable style={styles.row} onPress={onPress} disabled={!onPress}>
      <View style={styles.left}>
        <Text style={styles.title} numberOfLines={1}>{listing.offeringTitle}</Text>
        <Text style={styles.sub}>{KIND_LABEL[listing.kind]} · {listing.units} units · {listing.sellerMasked}</Text>
        <Text style={styles.listed}>Listed {relativeDate(listing.listedAt)}</Text>
      </View>
      <View style={styles.right}>
        <Text style={styles.price}>{formatNaira(listing.pricePerUnitKobo)}</Text>
        <Text style={styles.perUnit}>per unit</Text>
        <Text style={[styles.delta, { color: deltaColor }]}>{deltaLabel}</Text>
      </View>
      {onPress ? <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  left: { flex: 1, gap: 2 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  listed: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  right: { alignItems: 'flex-end' },
  price: { ...Typography.labelLg, color: Colors.onSurface },
  perUnit: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  delta: { ...Typography.labelSm, fontWeight: '600', marginTop: 2 },
});
