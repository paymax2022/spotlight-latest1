import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';
import { Gift, ChevronRight, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { CHALLENGE_KIND_META } from '../constants/spotlight.constants';
import { formatMoney, formatEndsIn } from '../utils/spotlightFormatters';
import type { Challenge } from '../types/spotlight.types';

interface Props {
  challenge: Challenge;
  onPress?: () => void;
}

/** Active-challenge card — kind chip, reward (as wallet credit), deadline. */
export default function ChallengeCard({ challenge, onPress }: Props) {
  const meta = CHALLENGE_KIND_META[challenge.kind];
  const KindIcon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.BookOpen;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${challenge.title}, ${meta.label} challenge`}
      style={({ pressed }) => [styles.card, shadow1, pressed && styles.pressed]}
    >
      <View style={styles.topRow}>
        <View style={[styles.kindIcon, { backgroundColor: meta.bg }]}>
          <KindIcon size={18} color={meta.fg} strokeWidth={2} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.title} numberOfLines={1}>{challenge.title}</Text>
          <View style={[styles.kindChip, { backgroundColor: meta.bg }]}>
            <Text style={[styles.kindText, { color: meta.fg }]}>{meta.label}</Text>
          </View>
        </View>
        {challenge.joined ? (
          <View style={styles.joinedPill}>
            <CheckCircle2 size={13} color={Colors.tertiaryContainer} strokeWidth={2} />
            <Text style={styles.joinedText}>Joined</Text>
          </View>
        ) : (
          <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
        )}
      </View>

      <Text style={styles.desc} numberOfLines={2}>{challenge.description}</Text>

      <View style={styles.footer}>
        <View style={styles.rewardRow}>
          <Gift size={14} color={Colors.gold} strokeWidth={2} />
          <Text style={styles.rewardText}>{formatMoney(challenge.reward)} wallet credit</Text>
        </View>
        <Text style={styles.endsText}>{formatEndsIn(challenge.endsAt)}</Text>
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
    gap: Spacing.sm,
  },
  pressed: { opacity: 0.85 },
  flex: { flex: 1, gap: 4 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  kindIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  kindChip: { alignSelf: 'flex-start', borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 2 },
  kindText: { ...Typography.labelSm },
  joinedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.iconBgTeal, borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 3,
  },
  joinedText: { ...Typography.labelSm, color: Colors.tertiaryContainer },
  desc: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.xs },
  rewardRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  rewardText: { ...Typography.labelMd, color: Colors.onSurface },
  endsText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
