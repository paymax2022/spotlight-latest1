import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { ReferralColors } from '../constants/referral.constants';

type Tone = 'info' | 'compliant' | 'warn' | 'danger';

interface Props {
  title?: string;
  body?: string;
  /** Optional bullet points (e.g. responsible-earning list). */
  points?: string[];
  icon?: string;            // lucide name; defaults per tone
  tone?: Tone;
  children?: React.ReactNode;
  style?: ViewStyle;
}

const TONE_STYLES: Record<Tone, { bg: string; fg: string; defaultIcon: string }> = {
  info:      { bg: Colors.surfaceContainerLow, fg: Colors.secondary,          defaultIcon: 'Info' },
  compliant: { bg: ReferralColors.okBg,        fg: Colors.tertiaryContainer,  defaultIcon: 'ShieldCheck' },
  warn:      { bg: ReferralColors.warnBg,      fg: Colors.onWarning,          defaultIcon: 'TriangleAlert' },
  danger:    { bg: Colors.errorContainer,      fg: Colors.error,              defaultIcon: 'CircleAlert' },
};

/**
 * Disclosure / explainer card used by onboarding, terms, responsible-earning and
 * the compliant "earnings tie to real activity" callout. The `compliant` tone is
 * the load-bearing pyramid-line message (PRD theme 1).
 */
export default function DisclosureCard({ title, body, points, icon, tone = 'info', children, style }: Props) {
  const t = TONE_STYLES[tone];
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[icon ?? t.defaultIcon] ?? Icons.Info;
  return (
    <View style={[styles.card, { backgroundColor: t.bg }, style]}>
      <View style={styles.row}>
        <View style={styles.iconBox}><Icon size={18} color={t.fg} strokeWidth={2} /></View>
        <View style={styles.body}>
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {body ? <Text style={styles.text}>{body}</Text> : null}
          {points?.map((p, i) => (
            <View key={i} style={styles.bullet}>
              <View style={[styles.dot, { backgroundColor: t.fg }]} />
              <Text style={styles.bulletText}>{p}</Text>
            </View>
          ))}
          {children}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.lg, padding: Spacing.md },
  row: { flexDirection: 'row', gap: Spacing.sm },
  iconBox: { paddingTop: 1 },
  body: { flex: 1, gap: 6 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  text: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  bullet: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', marginTop: 2 },
  dot: { width: 6, height: 6, borderRadius: Radius.full, marginTop: 7 },
  bulletText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
});
