import React from 'react';
import { View, FlatList, StyleSheet, Pressable, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import NotificationItem from '@/features/visitor/components/NotificationItem';
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from '@/features/visitor/hooks/useVisitor';
import type { VisitorNotification } from '@/features/visitor/types/visitor.types';

export default function VisitorNotificationsScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const hasUnread = (data ?? []).some((n) => !n.read);

  const onPress = (n: VisitorNotification) => {
    if (!n.read) markRead.mutate(n.id);
    if (n.accessCodeId) router.push(`/visitor/code/${n.accessCodeId}`);
  };

  const renderItem = ({ item }: { item: VisitorNotification }) => (
    <NotificationItem item={item} onPress={() => onPress(item)} />
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Notifications"
        rightSlot={
          hasUnread ? (
            <Pressable onPress={() => markAll.mutate()} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.markAll}>Mark all</Text>
            </Pressable>
          ) : undefined
        }
      />

      {isLoading ? (
        <StateView kind="loading" message="Loading notifications…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(n) => n.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshing={isRefetching}
          onRefresh={refetch}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          ListEmptyComponent={
            <StateView kind="empty" icon="BellOff" title="No notifications" message="Visitor arrivals, check-ins and alerts will show here." />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, flexGrow: 1 },
  markAll: { ...Typography.labelMd, color: Colors.secondary },
});
