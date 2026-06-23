import React from 'react';
import { View, Text, Pressable, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useNotifications, useMarkNotificationRead, useMarkAllRead } from '@/features/fx/hooks/useFxAccount';
import { relativeTime } from '@/features/fx/utils/fxFormatters';
import type { NotificationKind, AppNotification } from '@/features/fx/types/fx.types';

const KIND: Record<NotificationKind, { icon: string; color: string; bg: string }> = {
  rate_alert: { icon: 'TrendingUp', color: Colors.teal, bg: Colors.iconBgTeal },
  conversion: { icon: 'ArrowLeftRight', color: Colors.primary, bg: Colors.iconBgPurple },
  payout: { icon: 'Send', color: Colors.secondary, bg: Colors.iconBgBlue },
  collection: { icon: 'ArrowDownLeft', color: Colors.teal, bg: Colors.iconBgTeal },
  card: { icon: 'CreditCard', color: Colors.secondary, bg: Colors.iconBgBlue },
  approval: { icon: 'CheckCheck', color: Colors.primary, bg: Colors.iconBgPurple },
  verification: { icon: 'ShieldCheck', color: Colors.teal, bg: Colors.iconBgTeal },
  security: { icon: 'TriangleAlert', color: Colors.error, bg: Colors.errorContainer },
};

export default function NotificationsScreen() {
  const { data, isLoading, isError, refetch } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllRead();
  const unread = (data ?? []).filter((n) => !n.read).length;

  const open = (n: AppNotification) => {
    if (!n.read) markRead.mutate(n.id);
    if (n.deeplink) router.push(n.deeplink as never);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Notifications"
        subtitle={unread ? `${unread} unread` : 'All caught up'}
        rightSlot={unread ? <Pressable onPress={() => markAll.mutate()} hitSlop={8} accessibilityRole="button"><Text style={styles.markAll}>Mark all</Text></Pressable> : undefined}
      />
      {isLoading ? <StateView kind="loading" /> : isError ? <StateView kind="error" title="Couldn't load notifications" actionLabel="Retry" onAction={() => refetch()} /> : (data ?? []).length === 0 ? (
        <StateView kind="empty" icon="Bell" title="No notifications" message="Alerts about your money will appear here." />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(n) => n.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const k = KIND[item.kind];
            const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[k.icon] ?? Icons.Bell;
            return (
              <Pressable style={[styles.row, !item.read && styles.unread]} onPress={() => open(item)} accessibilityRole="button">
                <View style={[styles.icon, { backgroundColor: k.bg }]}><Icon size={18} color={k.color} strokeWidth={2} /></View>
                <View style={styles.mid}>
                  <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.body} numberOfLines={2}>{item.body}</Text>
                  <Text style={styles.time}>{relativeTime(item.createdAt)}</Text>
                </View>
                {!item.read ? <View style={styles.dot} /> : null}
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  markAll: { ...Typography.labelMd, color: Colors.secondary },
  list: { padding: Spacing.containerMargin, gap: Spacing.xs },
  row: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start', padding: Spacing.md, borderRadius: Radius.lg },
  unread: { backgroundColor: Colors.surfaceContainerLow },
  icon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  mid: { flex: 1 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  body: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 1 },
  time: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: Radius.full, backgroundColor: Colors.secondary, marginTop: 6 },
});
