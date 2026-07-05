import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { ShieldCheck, BadgeCheck, Clock, Star } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { MarketColors } from '../constants';
import type { SellerSummary, SellerProfile } from '../types';

interface Props {
  seller: SellerSummary | SellerProfile;
  onPress?: () => void;
}

/** Seller trust card — badges are PERMANENT (never boost-gated). Response stats
 *  + tenure. Used on Listing Detail and (expanded) Seller Profile. */
export default function SellerTrustCard({ seller, onPress }: Props) {
  const response = seller.responseTimeMinutes;
  return (
    <Pressable style={styles.card} onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{seller.name?.[0]?.toUpperCase() ?? '?'}</Text>
      </View>
      <View style={styles.body}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{seller.name}</Text>
          {seller.verifiedIdBadge ? <ShieldCheck size={15} color={MarketColors.ok} /> : null}
          {seller.verifiedBusinessBadge ? <BadgeCheck size={15} color={MarketColors.brand} /> : null}
        </View>
        <Text style={styles.tenure}>{seller.tenureLabel}</Text>
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Star size={12} color={MarketColors.warn} fill={MarketColors.warn} />
            <Text style={styles.statText}>{(seller.trustScore * 5).toFixed(1)}</Text>
          </View>
          {response != null ? (
            <View style={styles.stat}>
              <Clock size={12} color={MarketColors.muted} />
              <Text style={styles.statText}>~{response} min reply</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: MarketColors.surface, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: MarketColors.border },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...Typography.titleMd, color: Colors.onPrimaryContainer },
  body: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { ...Typography.titleMd, color: MarketColors.text, flexShrink: 1 },
  tenure: { ...Typography.labelSm, color: MarketColors.muted },
  statsRow: { flexDirection: 'row', gap: Spacing.md, marginTop: 4 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText: { ...Typography.labelSm, color: MarketColors.text },
});
