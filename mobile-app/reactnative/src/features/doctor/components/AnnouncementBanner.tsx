import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Megaphone, X, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

type Tone = 'info' | 'success' | 'warning';

interface Props {
  tone:        Tone;
  title:       string;
  body:        string;
  dismissible: boolean;
  ctaLabel?:   string;
  onPress?:    () => void;
  onDismiss?:  () => void;
}

// New component: a dismissible platform-announcement banner (Section D D19).
// Distinct from AlertCard — this is a full-width tinted banner with a dismiss
// affordance and a single platform-wide message, not a severity alert row.
const TONE: Record<Tone, { fg: string; bg: string }> = {
  info:    { fg: Colors.secondary, bg: Colors.iconBgBlue },
  success: { fg: Colors.teal,      bg: Colors.iconBgTeal },
  warning: { fg: Colors.primary,   bg: Colors.iconBgPurple },
};

export default function AnnouncementBanner({ tone, title, body, dismissible, ctaLabel, onPress, onDismiss }: Props) {
  const c = TONE[tone];
  return (
    <View style={[styles.banner, { backgroundColor: c.bg }]}>
      <View style={styles.iconBox}>
        <Megaphone size={18} color={c.fg} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: c.fg }]} numberOfLines={1}>{title}</Text>
        <Text style={styles.bodyText} numberOfLines={2}>{body}</Text>
        {!!ctaLabel && (
          <Pressable onPress={onPress} style={styles.ctaRow} accessibilityRole="button" accessibilityLabel={ctaLabel}>
            <Text style={[styles.ctaLabel, { color: c.fg }]}>{ctaLabel}</Text>
            <ChevronRight size={14} color={c.fg} strokeWidth={2.4} />
          </Pressable>
        )}
      </View>
      {dismissible && (
        <Pressable onPress={onDismiss} hitSlop={12} style={styles.dismiss} accessibilityRole="button" accessibilityLabel="Dismiss announcement">
          <X size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner:   { flexDirection: 'row', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg },
  iconBox:  { width: 32, height: 32, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLowest },
  body:     { flex: 1, gap: 2 },
  title:    { ...Typography.labelLg },
  bodyText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  ctaRow:   { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: Spacing.xs },
  ctaLabel: { ...Typography.labelMd },
  dismiss:  { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
});
