import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Siren } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow2 } from '@/constants/shadows';
import { t } from '../i18n';
import type { Language } from '../types';

/**
 * SC-8 — a persistent ONE-TAP emergency shortcut shown on EVERY triage screen.
 * Floats bottom-right; routes straight to the full-screen Emergency flow. Pass
 * the active session id so the emergency screen can attach context if present.
 */
export default function EmergencyFab({
  lang,
  sessionId,
}: {
  lang: Language;
  sessionId?: string;
}) {
  const s = t(lang);
  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: '/health/triage/emergency', params: sessionId ? { sessionId } : {} })
      }
      accessibilityRole="button"
      accessibilityLabel={s.emergencyShortcut}
      style={({ pressed }) => [styles.fab, shadow2, pressed && styles.pressed]}
    >
      <Siren size={18} color={Colors.onPrimary} strokeWidth={2.5} />
      <Text style={styles.label}>{s.emergencyShortcut}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: Spacing.md,
    bottom: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.error,
    borderRadius: Radius.full,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  pressed: { opacity: 0.9 },
  label: { ...Typography.labelMd, color: Colors.onPrimary },
});
