import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MessageCircle, Phone, Video } from 'lucide-react-native';

import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import { formatNaira } from '@/utils/money';
import { CONSULT_MODE_LABEL, type ConsultMode, type ConsultOffer } from './types';

const MODE_ICON: Record<ConsultMode, typeof Video> = {
  video: Video,
  voice: Phone,
  chat: MessageCircle,
};

export interface PackagePickerProps {
  offers: ConsultOffer[];
  selectedId: string | null;
  onSelect: (offer: ConsultOffer) => void;
}

/**
 * The one price-point selector both modules use. It renders only amounts the
 * server sent in the package quote; it never adds a fee of its own.
 */
export default function PackagePicker({ offers, selectedId, onSelect }: PackagePickerProps) {
  if (offers.length === 0) return null;
  return (
    <View style={styles.grid}>
      {offers.map((offer) => {
        const Icon = MODE_ICON[offer.mode];
        const selected = offer.id === selectedId;
        return (
          <Pressable
            key={offer.id}
            onPress={() => onSelect(offer)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={[styles.card, selected && styles.cardSelected]}
          >
            <View style={styles.head}>
              <Icon size={18} color={selected ? Colors.secondary : Colors.onSurfaceVariant} strokeWidth={2} />
              <Text style={[styles.mode, selected && styles.modeSelected]}>{CONSULT_MODE_LABEL[offer.mode]}</Text>
            </View>
            <Text style={styles.duration}>{offer.durationMinutes} min</Text>
            <Text style={[styles.price, selected && styles.priceSelected]}>
              {formatNaira(offer.totalKobo, { decimals: false })}
            </Text>
            <Text style={styles.caption}>Payable now</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  card: {
    minWidth: 128,
    flexGrow: 1,
    gap: 2,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLow,
  },
  cardSelected: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLowest },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mode: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  modeSelected: { color: Colors.secondary },
  duration: { ...Typography.titleMd, color: Colors.onSurface },
  price: { ...Typography.bodyMd, color: Colors.onSurface },
  priceSelected: { color: Colors.primary, fontWeight: '800' },
  caption: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
