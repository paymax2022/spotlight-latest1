import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { BellRing, LogIn, LogOut, Ban, TimerOff, CreditCard, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { VisitorColors } from '../constants/visitor.constants';
import { relativeTime } from '../utils/visitorFormatters';
import type { VisitorNotification, VisitorNotificationType } from '../types/visitor.types';

const META: Record<VisitorNotificationType, { color: string; bg: string; Icon: typeof BellRing }> = {
  arrival:         { color: Colors.primary,        bg: Colors.iconBgPurple,     Icon: BellRing },
  checked_in:      { color: VisitorColors.success, bg: VisitorColors.successBg, Icon: LogIn },
  checked_out:     { color: Colors.secondary,      bg: Colors.iconBgBlue,       Icon: LogOut },
  overstayed:      { color: VisitorColors.warning, bg: VisitorColors.warningBg, Icon: TimerOff },
  denied:          { color: Colors.error,          bg: Colors.errorContainer,   Icon: Ban },
  restriction:     { color: Colors.error,          bg: Colors.errorContainer,   Icon: CreditCard },
  access_restored: { color: VisitorColors.success, bg: VisitorColors.successBg, Icon: CircleCheck },
};

export default function NotificationItem({ item, onPress }: { item: VisitorNotification; onPress?: () => void }) {
  const meta = META[item.type];
  const { Icon } = meta;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}${item.read ? '' : ', unread'}`}
      style={({ pressed }) => [styles.row, !item.read && styles.unread, pressed && styles.pressed]}
    >
      <View style={[styles.iconBox, { backgroundColor: meta.bg }]}>
        <Icon size={20} color={meta.color} strokeWidth={1.8} />
      </View>
      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.time}>{relativeTime(item.timestamp)}</Text>
        </View>
        <Text style={styles.message} numberOfLines={2}>{item.body}</Text>
      </View>
      {!item.read ? <View style={styles.dot} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: Spacing.sm + 2, paddingHorizontal: Spacing.md,
    borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest,
  },
  unread: { backgroundColor: Colors.surfaceContainerLow },
  pressed: { opacity: 0.85 },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  title: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  time: { ...Typography.labelSm, color: Colors.outline },
  message: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.secondary },
});
