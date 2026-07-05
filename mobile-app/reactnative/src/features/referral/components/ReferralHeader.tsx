import React from 'react';
import { View, Text, Pressable, StyleSheet, ViewStyle } from 'react-native';
import { ArrowLeft, Bell, CircleQuestionMark, RefreshCw } from 'lucide-react-native';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface Props {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  /** Earn-hub top bar (PRD §5): notifications, role switcher, help. */
  showNotifications?: boolean;
  showRoleSwitcher?: boolean;
  showHelp?: boolean;
  onRoleSwitcher?: () => void;
  style?: ViewStyle;
}

/**
 * Shared Referral/Earn-hub header. The Earn hub top bar carries notifications,
 * a role switcher and help (PRD §5); inner stack screens just use back + title.
 * Reused by other referral agents so the chrome stays consistent.
 */
export default function ReferralHeader({
  title,
  eyebrow,
  subtitle,
  showBack = true,
  onBack,
  showNotifications,
  showRoleSwitcher,
  showHelp,
  onRoleSwitcher,
  style,
}: Props) {
  return (
    <View style={[styles.container, style]}>
      {showBack ? (
        <Pressable onPress={onBack ?? (() => router.back())} hitSlop={10} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      ) : (
        <View style={styles.iconBtn} />
      )}

      <View style={styles.titleWrap}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>

      {showRoleSwitcher ? (
        <Pressable onPress={onRoleSwitcher ?? (() => router.push('/referral/onboarding/role-switcher'))} hitSlop={8} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Switch role">
          <RefreshCw size={19} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      ) : null}
      {showNotifications ? (
        <Pressable onPress={() => router.push('/referral/account/notifications')} hitSlop={8} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Notifications">
          <Bell size={19} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      ) : null}
      {showHelp ? (
        <Pressable onPress={() => router.push('/referral/account/help-support')} hitSlop={8} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Help and support">
          <CircleQuestionMark size={19} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    backgroundColor: Colors.background,
  },
  iconBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flex: 1 },
  eyebrow: { ...Typography.caption, color: Colors.primary, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { ...Typography.titleLg, color: Colors.onSurface },
  subtitle: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
