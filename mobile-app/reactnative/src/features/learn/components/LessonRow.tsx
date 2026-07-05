import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { FileText, PlayCircle, CheckCircle2, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import type { Lesson } from '../types/learn.types';

interface Props {
  lesson: Lesson;
  /** 1-based position in the path, shown as a sequence number. */
  index?: number;
  completed?: boolean;
  onPress?: () => void;
}

/** Path-detail row: kind glyph · title/summary · duration · complete state. */
export default function LessonRow({ lesson, index, completed, onPress }: Props) {
  const Icon = lesson.kind === 'video' ? PlayCircle : FileText;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${lesson.title}, ${lesson.durationMins} minute ${lesson.kind}${completed ? ', completed' : ''}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={[styles.glyph, completed && styles.glyphDone]}>
        {completed
          ? <CheckCircle2 size={18} color={Colors.teal} strokeWidth={2} />
          : <Icon size={18} color={Colors.secondary} strokeWidth={2} />}
      </View>
      <View style={styles.mid}>
        <Text style={styles.title} numberOfLines={1}>
          {index ? `${index}. ` : ''}{lesson.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {lesson.kind === 'video' ? 'Video' : 'Article'} · {lesson.durationMins} min read
        </Text>
      </View>
      <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm + 2 },
  pressed: { opacity: 0.7 },
  glyph: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  glyphDone: { backgroundColor: Colors.iconBgTeal },
  mid: { flex: 1 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
});
