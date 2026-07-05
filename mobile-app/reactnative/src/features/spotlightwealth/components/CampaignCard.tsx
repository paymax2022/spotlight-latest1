import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Megaphone, ArrowRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import type { Campaign } from '../types/spotlight.types';

interface Props {
  campaign: Campaign;
  onPress?: () => void;
  variant?: 'carousel' | 'list';
}

/** Education / event campaign card — tinted glyph, title, CTA. */
export default function CampaignCard({ campaign, onPress, variant = 'list' }: Props) {
  const carousel = variant === 'carousel';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${campaign.title} campaign`}
      style={({ pressed }) => [styles.card, carousel ? styles.carousel : styles.list, shadow1, pressed && styles.pressed]}
    >
      <View style={[styles.iconTile, { backgroundColor: campaign.iconColor }]}>
        <Megaphone size={20} color={Colors.onPrimary} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>{campaign.title}</Text>
        <Text style={styles.desc} numberOfLines={carousel ? 3 : 2}>{campaign.description}</Text>
        <View style={styles.ctaRow}>
          <Text style={styles.cta}>{campaign.cta}</Text>
          <ArrowRight size={14} color={Colors.secondary} strokeWidth={2} />
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
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  carousel: { width: 250 },
  list: { width: '100%', flexDirection: 'row', alignItems: 'flex-start' },
  pressed: { opacity: 0.85 },
  iconTile: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: Spacing.xs },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  desc: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  ctaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  cta: { ...Typography.labelMd, color: Colors.secondary },
});
