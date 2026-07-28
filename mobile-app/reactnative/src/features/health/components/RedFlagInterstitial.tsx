import React from 'react';
import { View, Text, StyleSheet, Linking, Platform } from 'react-native';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { RED_FLAG_ROUTING_META } from '../constants/health.constants';
import type { RedFlagResult } from '../types';

/**
 * M13 — Red-flag interstitial. Surfaced when submit returns a red flag (PRD §5).
 * It is a product-safety gate, NOT a diagnosis: it surfaces guidance and routes
 * the patient to help. It must NEVER block the patient from getting help and
 * must NOT ask further assessment questions. For CRISIS routing the copy is
 * supportive and resource-oriented.
 */
export default function RedFlagInterstitial({
  result,
  onContinue,
  onDismiss,
}: {
  result: RedFlagResult;
  /** Continue to the routine consult anyway (never blocked). */
  onContinue: () => void;
  /** Go back / close (e.g. patient is seeking help). */
  onDismiss?: () => void;
}) {
  const meta = RED_FLAG_ROUTING_META[result.routing];
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.TriangleAlert;
  const isCrisis = result.routing === 'CRISIS';

  const callEmergency = () => {
    // Nigeria national emergency number.
    Linking.openURL(Platform.select({ ios: 'tel:112', android: 'tel:112', default: 'tel:112' }) as string).catch(
      () => {},
    );
  };
  const callCrisis = () => {
    const num = (result.guidance.crisis_line ?? '').replace(/[^+\d]/g, '');
    if (num) Linking.openURL(`tel:${num}`).catch(() => {});
  };

  return (
    <View style={styles.wrap} accessibilityRole="alert">
      <View style={[styles.iconBox, { backgroundColor: meta.bg }]}>
        <Icon size={30} color={meta.color} strokeWidth={2} />
      </View>

      <Text style={styles.title}>{result.guidance.title}</Text>
      <Text style={styles.body}>{result.guidance.body}</Text>

      {isCrisis && result.guidance.crisis_line ? (
        <View style={styles.crisisCard}>
          <Text style={styles.crisisLabel}>Talk to someone now</Text>
          <Text style={styles.crisisLine}>{result.guidance.crisis_line}</Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        {isCrisis && result.guidance.crisis_line ? (
          <PrimaryButton label="Call the support line" onPress={callCrisis} />
        ) : null}
        {result.guidance.show_emergency_number ? (
          <PrimaryButton
            label="Call emergency services (112)"
            variant={isCrisis ? 'secondary' : 'danger'}
            onPress={callEmergency}
          />
        ) : null}

        {/* Help is never blocked — the patient may still continue to their consult. */}
        <PrimaryButton label="Continue to my consult" variant="ghost" onPress={onContinue} />
        {onDismiss ? <PrimaryButton label="Go back" variant="ghost" onPress={onDismiss} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: Spacing.lg, gap: Spacing.md, alignItems: 'center' },
  iconBox: { width: 64, height: 64, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  body: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 22 },
  crisisCard: {
    width: '100%', backgroundColor: Colors.iconBgPurple, borderRadius: Radius.lg,
    padding: Spacing.md, alignItems: 'center', gap: 4,
  },
  crisisLabel: { ...Typography.labelSm, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.4 },
  crisisLine: { ...Typography.titleMd, color: Colors.primary, textAlign: 'center' },
  actions: { width: '100%', gap: Spacing.sm, marginTop: Spacing.sm },
});
