import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Users, ChevronRight } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { SocialColors, formatNaira } from '../constants/social.constants';
import type { GroupPool } from '../types';

export default function PoolCard({ pool, onPress }: { pool: GroupPool; onPress?: () => void }) {
  const pct = pool.goalKobo ? Math.min(100, Math.round((pool.raisedKobo / pool.goalKobo) * 100)) : null;
  const closed = pool.status === 'closed';
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
      <View style={styles.top}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{pool.title}</Text>
          {pool.description ? <Text style={styles.desc} numberOfLines={1}>{pool.description}</Text> : null}
        </View>
        <View style={[styles.badge, { backgroundColor: closed ? SocialColors.surfaceAlt : SocialColors.okBg }]}>
          <Text style={[styles.badgeText, { color: closed ? SocialColors.muted : SocialColors.ok }]}>{closed ? 'Closed' : 'Open'}</Text>
        </View>
      </View>

      <Text style={styles.amount}>{formatNaira(pool.raisedKobo)}{pool.goalKobo ? ` of ${formatNaira(pool.goalKobo)}` : ' raised'}</Text>
      {pct !== null ? <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View> : null}

      <View style={styles.footer}>
        <View style={styles.metaItem}>
          <Users size={14} color={SocialColors.muted} />
          <Text style={styles.metaText}>{pool.contributors.length} contributors</Text>
        </View>
        <ChevronRight size={16} color={SocialColors.muted} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: SocialColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.sm, ...shadow1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { ...Typography.titleMd, color: SocialColors.text },
  desc: { ...Typography.bodySm, color: SocialColors.muted },
  badge: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full },
  badgeText: { ...Typography.labelSm },
  amount: { ...Typography.labelLg, color: SocialColors.text },
  track: { height: 8, borderRadius: Radius.full, backgroundColor: SocialColors.surfaceAlt, overflow: 'hidden' },
  fill: { height: 8, borderRadius: Radius.full, backgroundColor: SocialColors.ok },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { ...Typography.labelSm, color: SocialColors.muted },
});
