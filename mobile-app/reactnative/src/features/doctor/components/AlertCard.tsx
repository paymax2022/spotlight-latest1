import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

type Tone = 'info' | 'warning' | 'critical';

interface Props {
  icon:     LucideIcon;
  tone:     Tone;
  title:    string;
  body:     string;
  count?:   number;       // optional badge count when the alert aggregates items
  ctaLabel?: string;      // when present, renders a tappable CTA row
  onPress?: () => void;
}

// New component: a severity-toned alert card for the Section D DashboardAlert
// union (urgent / compliance / licence / lab / HMO / refill / follow-up / late).
// StatusBadge + SectionCard do not compose a tinted icon + title + body + count
// badge + CTA affordance, so a single alert card is justified and reused for
// every alert kind.
const TONE: Record<Tone, { fg: string; bg: string }> = {
  info:     { fg: Colors.secondary, bg: Colors.iconBgBlue },
  warning:  { fg: Colors.primary,   bg: Colors.iconBgPurple },
  critical: { fg: Colors.error,     bg: Colors.errorContainer },
};

export default function AlertCard({ icon: Icon, tone, title, body, count, ctaLabel, onPress }: Props) {
  const c = TONE[tone];
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.card, tone === 'critical' && styles.cardCritical, pressed && !!onPress && styles.pressed]}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={title}
    >
      <View style={[styles.iconBox, { backgroundColor: c.bg }]}>
        <Icon size={20} color={c.fg} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {typeof count === 'number' && count > 0 && (
            <View style={[styles.countBadge, { backgroundColor: c.fg }]}>
              <Text style={styles.countText}>{count > 99 ? '99+' : count}</Text>
            </View>
          )}
        </View>
        <Text style={styles.bodyText} numberOfLines={2}>{body}</Text>
        {!!ctaLabel && (
          <View style={styles.ctaRow}>
            <Text style={[styles.ctaLabel, { color: c.fg }]}>{ctaLabel}</Text>
            <ChevronRight size={14} color={c.fg} strokeWidth={2.4} />
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card:         { flexDirection: 'row', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  cardCritical: { borderColor: Colors.error },
  pressed:      { opacity: 0.7 },
  iconBox:      { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  body:         { flex: 1, gap: 2 },
  titleRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title:        { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  countBadge:   { minWidth: 20, height: 20, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  countText:    { ...Typography.caption, color: Colors.onPrimary, fontWeight: '700' },
  bodyText:     { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  ctaRow:       { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: Spacing.xs },
  ctaLabel:     { ...Typography.labelMd },
});
