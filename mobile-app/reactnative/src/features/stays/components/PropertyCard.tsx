import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { MapPin, Star, Heart, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ReviewScore from './ReviewScore';
import SoldOutBadge from './SoldOutBadge';
import {
  formatMoney,
  formatNairaCompact,
  usdCentsToNgnKobo,
  StaysColors,
} from '../constants/stays.constants';
import type { PropertyCard as StaysProperty } from '../types';

interface Props {
  property: StaysProperty;
  onPress: () => void;
  variant?: 'feed' | 'rail';
  saved?: boolean;
  onToggleSave?: () => void;
}

/**
 * The Stays property card — the most-reused discovery surface (home rails,
 * search results, saved, deals). Currency is ALWAYS shown; USD supply also shows
 * an indicative ₦ equivalent (FX never silent). Reused by SM2.
 */
export default function PropertyCard({ property: p, onPress, variant = 'feed', saved, onToggleSave }: Props) {
  const rail = variant === 'rail';
  const price = formatMoney(p.leadPriceMinor, p.currency);
  const ngnNote = p.currency === 'USD' ? `≈ ${formatNairaCompact(usdCentsToNgnKobo(p.leadPriceMinor))}` : null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${p.name}, ${price} per night`}
      style={({ pressed }) => [styles.card, rail && styles.cardRail, pressed && styles.pressed]}
    >
      <View>
        <Image source={{ uri: p.coverUrl }} style={[styles.image, rail && styles.imageRail]} />
        <View style={styles.topRow}>
          <View style={styles.starChip}>
            <Star size={11} color={StaysColors.loyalty} fill={StaysColors.loyalty} strokeWidth={1} />
            <Text style={styles.starText}>{p.star}</Text>
          </View>
          {onToggleSave ? (
            <Pressable
              onPress={onToggleSave}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={saved ? 'Remove from saved' : 'Save property'}
              style={styles.saveBtn}
            >
              <Heart size={18} color={saved ? Colors.gold : Colors.white} fill={saved ? Colors.gold : 'transparent'} strokeWidth={2} />
            </Pressable>
          ) : null}
        </View>
        {p.soldOut ? (
          <View style={styles.soldOut}>
            <SoldOutBadge compact />
          </View>
        ) : p.loyaltyDeal ? (
          <View style={styles.dealChip}>
            <Text style={styles.dealText}>Loyalty deal</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={rail ? 1 : 2}>{p.name}</Text>

        <View style={styles.locationRow}>
          <MapPin size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.location} numberOfLines={1}>
            {p.area}, {p.city}{p.distanceKm != null ? ` · ${p.distanceKm} km` : ''}
          </Text>
        </View>

        <ReviewScore score={p.reviewScore} reviewCount={rail ? undefined : p.reviewCount} size="sm" />

        <View style={styles.bottomRow}>
          <View style={styles.priceWrap}>
            {p.wasPriceMinor ? (
              <Text style={styles.was}>{formatMoney(p.wasPriceMinor, p.currency, { compact: true })}</Text>
            ) : null}
            <Text style={styles.price}>{price}</Text>
            <Text style={styles.perNight}>per night</Text>
            {ngnNote ? <Text style={styles.fxNote}>{ngnNote}</Text> : null}
          </View>
          {p.freeCancellation ? (
            <View style={styles.freeCancel}>
              <ShieldCheck size={12} color={StaysColors.ok} strokeWidth={2.2} />
              <Text style={styles.freeCancelText}>Free cancel</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    overflow: 'hidden',
    ...shadow1,
  },
  cardRail: { width: 260 },
  pressed: { opacity: 0.92 },
  image: { width: '100%', height: 170, backgroundColor: Colors.surfaceContainerHigh },
  imageRail: { height: 140 },
  topRow: {
    position: 'absolute',
    top: Spacing.sm,
    left: Spacing.sm,
    right: Spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  starChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(11,28,48,0.55)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  starText: { ...Typography.labelSm, color: Colors.white, fontWeight: '700' as const },
  saveBtn: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(11,28,48,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  soldOut: { position: 'absolute', bottom: Spacing.sm, left: Spacing.sm },
  dealChip: {
    position: 'absolute',
    bottom: Spacing.sm,
    left: Spacing.sm,
    backgroundColor: Colors.gold,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  dealText: { ...Typography.labelSm, color: Colors.onWarning, fontWeight: '800' as const },
  body: { padding: Spacing.md, gap: 6 },
  name: { ...Typography.titleMd, color: Colors.onSurface },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  location: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  bottomRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 4 },
  priceWrap: { flex: 1 },
  was: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textDecorationLine: 'line-through' },
  price: { ...Typography.titleLg, color: Colors.onSurface },
  perNight: { ...Typography.caption, color: Colors.onSurfaceVariant },
  fxNote: { ...Typography.caption, color: StaysColors.accent, marginTop: 1 },
  freeCancel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.iconBgTeal,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  freeCancelText: { ...Typography.labelSm, color: StaysColors.ok, fontWeight: '700' as const },
});
