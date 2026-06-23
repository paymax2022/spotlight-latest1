import React from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { CheckCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead } from '@/features/notifications/hooks';
import { CATEGORY_META } from '@/features/notifications/api';
import { relativeTime } from '@/features/visitor/utils/visitorFormatters';
import type { EstateNotification, NotificationCategory } from '@/features/notifications/api';

export default function EstateNotificationsScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const unread = (data ?? []).filter((n) => !n.readAt).length;

  const onPress = (n: EstateNotification) => {
    if (!n.readAt) markRead.mutate(n.id);
    if (n.deepLink) router.push(n.deepLink as never);
  };

  const renderItem = ({ item }: { item: EstateNotification }) => {
    const meta = CATEGORY_META[item.category as NotificationCategory] ?? CATEGORY_META.general;
    const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.Bell;
    const read = !!item.readAt;
    return (
      <Pressable onPress={() => onPress(item)} accessibilityRole="button" style={({ pressed }) => [styles.card, !read && styles.cardUnread, pressed && styles.pressed]}>
        <View style={[styles.iconBox, !read && styles.iconBoxUnread]}><Icon size={20} color={read ? Colors.onSurfaceVariant : Colors.primary} strokeWidth={1.8} /></View>
        <View style={styles.body}>
          <Text style={[styles.title, !read && styles.titleUnread]} numberOfLines={1}>{item.title}</Text>
          {item.body ? <Text style={styles.bodyText} numberOfLines={2}>{item.body}</Text> : null}
          <Text style={styles.meta}>{meta.label} · {relativeTime(item.createdAt)}</Text>
        </View>
        {!read ? <View style={styles.dot} /> : null}
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Notifications" subtitle={unread > 0 ? `${unread} unread` : undefined} rightSlot={
        unread > 0 ? (
          <Pressable onPress={() => markAll.mutate()} accessibilityRole="button" accessibilityLabel="Mark all read" hitSlop={8} style={styles.allBtn}><CheckCheck size={20} color={Colors.secondary} strokeWidth={1.8} /></Pressable>
        ) : undefined
      } />
      {isLoading ? <StateView kind="loading" message="Loading…" />
        : isError ? <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
        : (
          <FlatList data={data ?? []} keyExtractor={(n) => n.id} renderItem={renderItem} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} refreshing={isRefetching} onRefresh={refetch} ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
            ListEmptyComponent={<StateView kind="empty" icon="BellOff" title="No notifications" message="You're all caught up." />} />
        )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  allBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, flexGrow: 1 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, ...shadow1 },
  cardUnread: { borderColor: Colors.primary },
  pressed: { opacity: 0.85 },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  iconBoxUnread: { backgroundColor: Colors.iconBgPurple },
  body: { flex: 1, gap: 2 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  titleUnread: { fontWeight: '700' },
  bodyText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  meta: { ...Typography.labelSm, color: Colors.outline },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary },
});
