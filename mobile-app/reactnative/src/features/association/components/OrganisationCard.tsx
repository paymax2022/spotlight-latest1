import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { Users, GitBranch, BadgeCheck, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { shadow1 } from '@/constants/shadows';
import { formatCount, initials } from '../utils/associationFormatters';
import { GROUP_TYPE_LABEL } from '../constants/association.constants';
import type { OrganisationSummary } from '../types/association.types';

interface Props {
  organisation: OrganisationSummary;
  onPress: () => void;
  variant?: 'full' | 'compact';
}

export default function OrganisationCard({ organisation: o, onPress, variant = 'full' }: Props) {
  const compact = variant === 'compact';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${o.name}, ${formatCount(o.memberCount, 'members')}`}
      style={({ pressed }) => [styles.card, compact && styles.cardCompact, shadow1, pressed && styles.pressed]}
    >
      <View style={styles.logoRow}>
        <View style={styles.logo}>
          {o.logoUrl ? (
            <Image source={{ uri: o.logoUrl }} style={styles.logoImg} />
          ) : (
            <Text style={styles.logoText}>{o.acronym ?? initials(o.name)}</Text>
          )}
        </View>
        <View style={styles.titleWrap}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{o.name}</Text>
            {o.verified && <BadgeCheck size={15} color={Colors.secondary} strokeWidth={2.2} />}
          </View>
          <Text style={styles.category} numberOfLines={1}>{o.category}</Text>
        </View>
      </View>

      {!compact && o.tagline ? (
        <Text style={styles.tagline} numberOfLines={2}>{o.tagline}</Text>
      ) : null}

      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <Users size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.metaText}>{formatCount(o.memberCount, 'members')}</Text>
        </View>
        <View style={styles.metaItem}>
          <GitBranch size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.metaText}>{formatCount(o.chapterCount, 'chapters')}</Text>
        </View>
      </View>

      <View style={styles.typePill}>
        <ShieldCheck size={12} color={Colors.primary} strokeWidth={2} />
        <Text style={styles.typeText} numberOfLines={1}>{GROUP_TYPE_LABEL[o.groupType]}</Text>
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
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  cardCompact: { width: 260 },
  pressed: { opacity: 0.9 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  logo: {
    width: 48, height: 48, borderRadius: Radius.md,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  logoImg: { width: '100%', height: '100%' },
  logoText: { ...Typography.labelMd, color: Colors.primary, fontWeight: '800' as const },
  titleWrap: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { ...Typography.titleMd, color: Colors.onSurface, flexShrink: 1 },
  category: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  tagline: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', gap: Spacing.md },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  typePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: Colors.iconBgPurple,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 5,
  },
  typeText: { ...Typography.caption, color: Colors.primary, fontWeight: '600' as const },
});
