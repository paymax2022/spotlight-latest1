import React from 'react';
import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import { ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { MarketColors, formatNaira, fairPriceVerdict, FAIR_PRICE_LABEL } from '../constants';
import type { ListingSummary } from '../types';

interface Props {
  item: ListingSummary;
  onPress: (id: string) => void;
  width?: number | 'auto';
  horizontal?: boolean; // rail card (fixed width) vs grid card (flex)
}

/** Shared marketplace listing card — grid & rail. Shows escrow badge, boost
 *  badge, and a fair-price chip computed from the listing's band. */
export default function ListingCard({ item, onPress, horizontal }: Props) {
  const verdict = fairPriceVerdict(item.priceKobo, item.fairPriceBand);
  return (
    <Pressable
      style={[styles.card, horizontal ? styles.railCard : styles.gridCard]}
      onPress={() => onPress(item.id)}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${formatNaira(item.priceKobo)}`}
    >
      <View style={styles.image}>
        {item.thumbUrl ? <Image source={{ uri: item.thumbUrl }} style={StyleSheet.absoluteFill} /> : <View style={styles.imgPlaceholder} />}
        {item.boosted ? (
          <View style={styles.boostBadge}>
            <Text style={styles.boostBadgeText}>Boosted</Text>
          </View>
        ) : null}
        {item.escrowEligible ? (
          <View style={styles.escrowBadge}>
            <ShieldCheck size={12} color="#FFFFFF" />
          </View>
        ) : null}
      </View>
      <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
      <Text style={styles.price}>{formatNaira(item.priceKobo)}</Text>
      <View style={styles.metaRow}>
        <Text style={styles.meta} numberOfLines={1}>{item.lga ? `${item.lga}, ${item.state}` : item.state}</Text>
        {verdict !== 'unknown' && verdict !== 'above' ? (
          <View style={[styles.fairChip, verdict === 'below' && styles.fairChipBelow]}>
            <Text style={styles.fairChipText}>{FAIR_PRICE_LABEL[verdict]}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: MarketColors.surface, borderRadius: Radius.lg, padding: Spacing.sm, ...shadow1 },
  gridCard: { flex: 1 },
  railCard: { width: 160, marginRight: Spacing.sm },
  image: { height: 120, borderRadius: Radius.md, backgroundColor: MarketColors.surfaceAlt, overflow: 'hidden' },
  imgPlaceholder: { flex: 1, backgroundColor: MarketColors.surfaceAlt },
  boostBadge: { position: 'absolute', top: 6, left: 6, backgroundColor: MarketColors.warn, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  boostBadgeText: { fontSize: 10, fontWeight: '700', color: MarketColors.warnText },
  escrowBadge: { position: 'absolute', top: 6, right: 6, backgroundColor: MarketColors.ok, borderRadius: Radius.full, width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.labelLg, color: MarketColors.text, marginTop: Spacing.xs, minHeight: 34 },
  price: { ...Typography.titleMd, color: MarketColors.brand, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2, gap: 4 },
  meta: { ...Typography.labelSm, color: MarketColors.muted, flexShrink: 1 },
  fairChip: { backgroundColor: Colors.iconBgTeal, borderRadius: Radius.full, paddingHorizontal: 6, paddingVertical: 1 },
  fairChipBelow: { backgroundColor: Colors.iconBgGreen },
  fairChipText: { fontSize: 9, fontWeight: '700', color: Colors.teal },
});
