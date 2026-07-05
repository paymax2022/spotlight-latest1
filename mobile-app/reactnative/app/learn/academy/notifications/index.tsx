import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { BookOpen, Gift, CalendarClock, Radio, BadgeCheck, Briefcase, Users, Megaphone, CheckCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead } from '@/features/academy/hooks';
import { formatDate } from '@/features/academy/constants';
import type { NotificationKind } from '@/features/academy/types';

const ICON: Record<NotificationKind, { Icon: typeof BookOpen; color: string; bg: string }> = {
  lesson:        { Icon: BookOpen,      color: Colors.primary,   bg: Colors.iconBgPurple },
  reward:        { Icon: Gift,          color: Colors.teal,      bg: Colors.iconBgTeal },
  exam_reminder: { Icon: CalendarClock, color: Colors.onWarning, bg: Colors.iconBgGold },
  live:          { Icon: Radio,         color: Colors.error,     bg: Colors.errorContainer },
  credential:    { Icon: BadgeCheck,    color: Colors.gold,      bg: Colors.iconBgGold },
  opportunity:   { Icon: Briefcase,     color: Colors.secondary, bg: Colors.iconBgBlue },
  parent_msg:    { Icon: Users,         color: Colors.primary,   bg: Colors.iconBgPurple },
  community:     { Icon: Megaphone,     color: Colors.secondary, bg: Colors.iconBgBlue },
};

/** C6 — Notifications center: lessons, rewards, exam reminders, live, parent msgs. */
export default function NotificationsScreen() {
  const notifs = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  if (notifs.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading notifications…" /></SafeAreaView>;

  const unread = notifs.data?.some((n) => !n.read);

  const open = (id: string, href?: string) => {
    markRead.mutate(id);
    if (href) router.push(href as never);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Notifications"
        rightSlot={unread ? <Pressable hitSlop={8} onPress={() => markAll.mutate()}><CheckCheck size={20} color={Colors.onSurface} /></Pressable> : undefined}
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        {notifs.data?.length ? notifs.data.map((n) => {
          const meta = ICON[n.kind];
          return (
            <Pressable key={n.id} style={[styles.card, shadow1, !n.read && styles.unread]} onPress={() => open(n.id, n.href)}>
              <View style={[styles.icon, { backgroundColor: meta.bg }]}><meta.Icon size={18} color={meta.color} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{n.title}</Text>
                <Text style={styles.body} numberOfLines={2}>{n.body}</Text>
                <Text style={styles.date}>{formatDate(n.ts)}</Text>
              </View>
              {!n.read ? <View style={styles.dot} /> : null}
            </Pressable>
          );
        }) : (
          <StateView kind="empty" icon="Bell" title="No notifications" message="You're all caught up." compact />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  unread: { borderLeftWidth: 3, borderLeftColor: Colors.primary },
  icon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  body: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  date: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary },
});
