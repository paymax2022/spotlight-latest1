import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowUpRight } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Typography } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import { Stage } from './theme';

interface Props {
  title: string;
  description: string;
  count: number;
  icon: LucideIcon;
  /** Background and ink for the icon's tile — the Section D colour coding. */
  tint: string;
  ink: string;
  onPress: () => void;
}

/**
 * Section D's tile. The colour is the category's only non-typographic cue:
 * three tiles, three tints, each drawn from the Spotlight mark's spectrum. The
 * count is real (contests currently matching in the loaded list) — a section
 * with none says so and still opens its own told-you-so empty state.
 */
export default function CategoryTile({ title, description, count, icon: Icon, tint, ink, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, shadow1, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${title} contests, ${count} open`}
    >
      <View style={styles.topRow}>
        <View style={[styles.iconTile, { backgroundColor: tint }]}>
          <Icon size={18} color={ink} strokeWidth={2} />
        </View>
        <View style={styles.arrow}>
          <ArrowUpRight size={13} color={Stage.muted} strokeWidth={2.4} />
        </View>
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.description} numberOfLines={2}>
        {description}
      </Text>
      <Text style={styles.count}>
        {count > 0 ? `${count} ${count === 1 ? 'contest' : 'contests'}` : 'Coming soon'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minHeight: 136,
    backgroundColor: Stage.card,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Stage.hairline,
    padding: 13,
  },
  pressed: { opacity: 0.9 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  iconTile: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: {
    width: 22,
    height: 22,
    borderRadius: Radius.full,
    backgroundColor: Stage.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...Typography.labelMd,
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: '800' as const,
    letterSpacing: -0.1,
    color: Stage.ink,
    marginBottom: 3,
  },
  description: {
    ...Typography.caption,
    fontSize: 11,
    lineHeight: 15,
    color: Stage.muted,
    flex: 1,
  },
  count: {
    ...Typography.labelSm,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700' as const,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: Stage.goldText,
    marginTop: 8,
  },
});
