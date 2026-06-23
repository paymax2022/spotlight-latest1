import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { CalendarDays, MessageSquare, FlaskConical, Wallet, ShieldCheck, Bell } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import type { DoctorNotification, DoctorNotificationType } from '@/types/doctor';

interface Props {
  notification: DoctorNotification;
  onPress?:     () => void;
}

const ICONS: Record<DoctorNotificationType, { Icon: LucideIcon; color: string; bg: string }> = {
  appointment:  { Icon: CalendarDays,  color: Colors.secondary, bg: Colors.iconBgBlue },
  message:      { Icon: MessageSquare,  color: Colors.primary,   bg: Colors.iconBgPurple },
  lab_result:   { Icon: FlaskConical,   color: Colors.teal,      bg: Colors.iconBgTeal },
  payout:       { Icon: Wallet,         color: Colors.teal,      bg: Colors.iconBgTeal },
  verification: { Icon: ShieldCheck,    color: Colors.secondary, bg: Colors.iconBgBlue },
  system:       { Icon: Bell,           color: Colors.onSurfaceVariant, bg: Colors.surfaceContainerLow },
};

// New component: a notification list row with a typed icon + read indicator.
// RecentActivityCard is wallet-transaction shaped; this is a distinct
// notification row, so it is genuinely new.
export default function NotificationRow({ notification, onPress }: Props) {
  const cfg = ICONS[notification.type] ?? ICONS.system;
  const Icon = cfg.Icon;
  const time = new Date(notification.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, !notification.read && styles.rowUnread, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={notification.title}
    >
      <View style={[styles.iconBox, { backgroundColor: cfg.bg }]}>
        <Icon size={20} color={cfg.color} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>{notification.title}</Text>
        <Text style={styles.text} numberOfLines={2}>{notification.body}</Text>
      </View>
      <View style={styles.right}>
        <Text style={styles.time}>{time}</Text>
        {!notification.read && <View style={styles.dot} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  rowUnread:{ backgroundColor: Colors.surfaceContainerLow },
  pressed:  { opacity: 0.85 },
  iconBox:  { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  body:     { flex: 1, gap: 2 },
  title:    { ...Typography.labelLg, color: Colors.onSurface },
  text:     { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  right:    { alignItems: 'flex-end', gap: 6 },
  time:     { ...Typography.caption, color: Colors.onSurfaceVariant },
  dot:      { width: 8, height: 8, borderRadius: Radius.full, backgroundColor: Colors.secondary },
});
