import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Stage } from './theme';

interface Props {
  eyebrow: string;
  title: string;
  supporting?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * The one section header every shelf on the screen shares. Eyebrow, title and
 * the section's own promise are set as a stack rather than a row, so the eye
 * lands on the eyebrow's gold first and the title second. The action sits on
 * the title's baseline so it reads as a footnote to it, not a rival.
 */
export default function SectionLead({ eyebrow, title, supporting, actionLabel, onAction }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.topRow}>
        <View style={styles.textBlock}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Text style={styles.title}>{title}</Text>
        </View>
        {actionLabel ? (
          <Pressable onPress={onAction} hitSlop={10} style={styles.action}>
            <Text style={styles.actionText}>{actionLabel}</Text>
            <ChevronRight size={13} color={Stage.goldText} strokeWidth={2.6} />
          </Pressable>
        ) : null}
      </View>
      {supporting ? <Text style={styles.supporting}>{supporting}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: Spacing.containerMargin,
    marginTop: Spacing.sectionGap,
    marginBottom: 13,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  textBlock: { flex: 1 },
  eyebrow: {
    ...Typography.labelSm,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800' as const,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: Stage.goldText,
    marginBottom: 5,
  },
  title: {
    ...Typography.headlineMd,
    fontSize: 19,
    lineHeight: 24,
    letterSpacing: -0.4,
    textTransform: 'uppercase',
    color: Stage.ink,
  },
  supporting: {
    ...Typography.bodySm,
    fontSize: 12.5,
    lineHeight: 18,
    color: Stage.muted,
    marginTop: 6,
    maxWidth: 320,
  },
  action: { flexDirection: 'row', alignItems: 'center', gap: 1, paddingBottom: 3 },
  actionText: {
    ...Typography.labelSm,
    fontSize: 11.5,
    fontWeight: '700' as const,
    color: Stage.goldText,
  },
});
