import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { BadgeCheck, Users, ChevronRight } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { CreatorsColors, formatNairaCompact } from '../constants/creators.constants';
import type { Creator } from '../types';

export default function CreatorStorefrontCard({ creator, onPress }: { creator: Creator; onPress?: () => void }) {
  const initials = creator.displayName.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
      <View style={[styles.avatar, { backgroundColor: creator.avatarColor }]}>
        <Text style={styles.avatarText}>{initials}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{creator.displayName}</Text>
          {creator.verified ? <BadgeCheck size={15} color={CreatorsColors.accent} /> : null}
        </View>
        <Text style={styles.handle} numberOfLines={1}>{creator.handle} · {creator.category}</Text>
        <View style={styles.metaRow}>
          <Users size={13} color={CreatorsColors.muted} />
          <Text style={styles.meta}>{creator.subscriberCount.toLocaleString('en-NG')} subscribers</Text>
          {creator.fromPriceKobo ? (
            <Text style={styles.price}>from {formatNairaCompact(creator.fromPriceKobo)}/mo</Text>
          ) : null}
        </View>
      </View>
      <ChevronRight size={18} color={CreatorsColors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: CreatorsColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, ...shadow1,
  },
  avatar: { width: 52, height: 52, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...Typography.titleMd, color: '#FFFFFF' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { ...Typography.titleMd, color: CreatorsColors.text, flexShrink: 1 },
  handle: { ...Typography.bodySm, color: CreatorsColors.muted, marginTop: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6, flexWrap: 'wrap' },
  meta: { ...Typography.labelSm, color: CreatorsColors.muted },
  price: { ...Typography.labelSm, color: CreatorsColors.brand, marginLeft: 4 },
});
