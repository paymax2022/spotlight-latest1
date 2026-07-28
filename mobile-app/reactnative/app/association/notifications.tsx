import React, { useEffect } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useNotifications, useMarkNotificationsRead } from '@/features/association/hooks/useEngagement';
import { relativeTime } from '@/features/association/utils/associationFormatters';
import { NOTIFICATION_ICON } from '@/features/association/constants/engagement.constants';

export default function NotificationsCenter() {
  const notifs = useNotifications();
  const markRead = useMarkNotificationsRead();

  // Mark all read on open (once data loaded).
  useEffect(() => {
    if (notifs.data && notifs.data.some((n) => !n.read)) markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifs.data]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Notifications" />
      {notifs.isLoading ? (
        <StateView kind="loading" message="Loading notifications…" />
      ) : notifs.isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => notifs.refetch()} />
      ) : (notifs.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="Bell" title="You're all caught up" message="New notifications will appear here." />
      ) : (
        <FlatList
          data={notifs.data ?? []}
          keyExtractor={(n) => n.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          renderItem={({ item }) => {
            const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[NOTIFICATION_ICON[item.kind]] ?? Icons.Bell;
            return (
              <Pressable
                onPress={() => item.route && router.push(item.route as never)}
                disabled={!item.route}
                accessibilityRole="button"
                accessibilityLabel={item.title}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <View style={[styles.iconBox, !item.read && styles.iconBoxUnread]}>
                  <Icon size={18} color={item.read ? Colors.onSurfaceVariant : Colors.primary} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
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
  list: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 120 },
  sep: { height: 1, backgroundColor: Colors.outlineVariant, opacity: 0.5 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, paddingVertical: Spacing.md },
  pressed: { opacity: 0.7 },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  iconBoxUnread: { backgroundColor: Colors.iconBgPurple },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  body: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 1 },
  time: { ...Typography.caption, color: Colors.outline, marginTop: 3 },
  dot: { width: 8, height: 8, borderRadius: Radius.full, backgroundColor: Colors.secondary, marginTop: 6 },
});
