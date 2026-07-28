import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { BookOpen, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { LEVEL_STYLE } from '../constants/learn.constants';
import ProgressBar from './ProgressBar';
import type { LearnPath } from '../types/learn.types';

interface Props {
  path: LearnPath;
  onPress?: () => void;
}

/** Discovery card for a learning track: glyph · title · level chip · progress. */
export default function PathCard({ path, onPress }: Props) {
  const level = LEVEL_STYLE[path.level];
  const started = path.progressPct > 0;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${path.title}, ${path.progressPct}% complete`}
      style={({ pressed }) => [styles.card, shadow1, pressed && styles.pressed]}
    >
      <View style={styles.topRow}>
        <View style={[styles.glyph, { backgroundColor: level.bg }]}>
          <BookOpen size={20} color={path.iconColor} strokeWidth={2} />
        </View>
        <View style={styles.flex}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>{path.title}</Text>
            <View style={[styles.chip, { backgroundColor: level.bg }]}>
              <Text style={[styles.chipText, { color: level.tint }]}>{level.label}</Text>
            </View>
          </View>
          <Text style={styles.desc} numberOfLines={2}>{path.description}</Text>
        </View>
        <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
      </View>

      <View style={styles.progressRow}>
        <ProgressBar pct={path.progressPct} color={path.iconColor} style={styles.bar} />
        <Text style={styles.pct}>
          {started ? `${path.progressPct}%` : `${path.lessonIds.length} lessons`}
        </Text>
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
  pressed: { opacity: 0.85 },
  flex: { flex: 1 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  glyph: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { ...Typography.labelLg, color: Colors.onSurface, flexShrink: 1 },
  chip: { borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 2 },
  chipText: { ...Typography.caption, fontWeight: '700' },
  desc: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2, lineHeight: 16 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  bar: { flex: 1 },
  pct: { ...Typography.labelSm, color: Colors.onSurfaceVariant, minWidth: 56, textAlign: 'right' },
});
