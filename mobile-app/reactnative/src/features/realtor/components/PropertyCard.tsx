import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { BedDouble, Bath, MapPin, ShieldCheck, Heart, TrendingDown } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import VerificationBadge from './VerificationBadge';
import { MODE_LABEL } from '../constants/realtor.constants';
import { priceLabel, formatNairaCompact } from '../utils/realtorFormatters';
import type { ListingCard } from '../types/realtor.types';

interface Props {
  listing: ListingCard;
  onPress: () => void;
  variant?: 'feed' | 'rail';      // feed = full-width list card; rail = compact horizontal
  saved?: boolean;
  onToggleSave?: () => void;
}

/**
 * The marketplace listing card — the most-reused realtor surface (home rails,
 * search results, similar listings, saved). Trust signals (verification +
 * escrow) are deliberately prominent per the product thesis.
 */
export default function PropertyCard({ listing, onPress, variant = 'feed', saved, onToggleSave }: Props) {
  const rail = variant === 'rail';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${listing.title}, ${priceLabel(listing)}`}
      style={({ pressed }) => [styles.card, rail && styles.cardRail, pressed && styles.pressed]}
    >
      <View>
        <Image source={{ uri: listing.coverUrl }} style={[styles.image, rail && styles.imageRail]} />

        <View style={styles.topRow}>
          <View style={styles.modeChip}>
            <Text style={styles.modeText}>{MODE_LABEL[listing.mode]}</Text>
          </View>
          {onToggleSave ? (
            <Pressable
              onPress={onToggleSave}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={saved ? 'Remove from saved' : 'Save listing'}
              style={styles.saveBtn}
            >
              <Heart
                size={18}
                color={saved ? Colors.gold : Colors.white}
                fill={saved ? Colors.gold : 'transparent'}
                strokeWidth={2}
              />
            </Pressable>
          ) : null}
        </View>

        {listing.priceDropFrom ? (
          <View style={styles.dropChip}>
            <TrendingDown size={12} color={Colors.white} strokeWidth={2.4} />
            <Text style={styles.dropText}>Price drop</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        <Text style={styles.price}>{priceLabel(listing)}</Text>
        {listing.priceDropFrom ? (
          <Text style={styles.priceWas}>{formatNairaCompact(listing.priceDropFrom)}</Text>
        ) : null}

        <Text style={styles.title} numberOfLines={rail ? 1 : 2}>{listing.title}</Text>

        <View style={styles.locationRow}>
          <MapPin size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.location} numberOfLines={1}>{listing.area}, {listing.city}</Text>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <BedDouble size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.metaText}>{listing.bedrooms > 0 ? listing.bedrooms : 'Studio'}</Text>
          </View>
          <View style={styles.metaItem}>
            <Bath size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.metaText}>{listing.bathrooms}</Text>
          </View>
        </View>

        <View style={styles.trustRow}>
          <VerificationBadge level={listing.verification} />
          {listing.escrowProtected ? (
            <View style={styles.escrow}>
              <ShieldCheck size={12} color={Colors.tertiaryContainer} strokeWidth={2.2} />
              <Text style={styles.escrowText}>Escrow</Text>
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
  pressed: { opacity: 0.9 },
  image: { width: '100%', height: 180, backgroundColor: Colors.surfaceContainerHigh },
  imageRail: { height: 150 },
  topRow: {
    position: 'absolute',
    top: Spacing.sm,
    left: Spacing.sm,
    right: Spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modeChip: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  modeText: { ...Typography.labelSm, color: Colors.onPrimary, fontWeight: '700' as const },
  saveBtn: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(11,28,48,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropChip: {
    position: 'absolute',
    bottom: Spacing.sm,
    left: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.error,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  dropText: { ...Typography.labelSm, color: Colors.white, fontWeight: '700' as const },
  body: { padding: Spacing.md, gap: 6 },
  price: { ...Typography.titleLg, color: Colors.onSurface },
  priceWas: {
    ...Typography.labelSm,
    color: Colors.onSurfaceVariant,
    textDecorationLine: 'line-through',
    marginTop: -4,
  },
  title: { ...Typography.bodyMd, color: Colors.onSurface, fontWeight: '600' as const },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  location: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  metaRow: { flexDirection: 'row', gap: Spacing.md, marginTop: 2 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  trustRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs, flexWrap: 'wrap' },
  escrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.iconBgTeal,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  escrowText: { ...Typography.labelSm, color: Colors.tertiaryContainer, fontWeight: '700' as const },
});
