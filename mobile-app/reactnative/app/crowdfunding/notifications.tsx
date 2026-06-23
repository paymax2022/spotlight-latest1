import React from 'react';
import { FlatList, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useNotifications, useMarkNotificationsRead } from '@/features/crowdfunding/hooks/useExtras';
import { relativeTime } from '@/features/crowdfunding/utils/crowdfundingFormatters';
import type { AppNotificationType } from '@/features/crowdfunding/types/crowdfunding.types';

const META: Record<AppNotificationType, { icon: string; fg: string; bg: string }> = {
  CONTRIBUTION_RECEIVED: { icon: 'HeartHandshake', fg: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  GOAL_MILESTONE: { icon: 'PartyPopper', fg: Colors.primary, bg: Colors.iconBgPurple },
  CAMPAIGN_UPDATE: { icon: 'Megaphone', fg: Colors.secondary, bg: Colors.iconBgBlue },
  WITHDRAWAL_STATUS: { icon: 'Wallet', fg: Colors.secondary, bg: Colors.iconBgBlue },
  REFUND_STATUS: { icon: 'Undo2', fg: '#B65A00', bg: Colors.iconBgOrange },
  REWARD_UPDATE: { icon: 'Gift', fg: '#B65A00', bg: Colors.iconBgOrange },
  CAMPAIGN_APPROVED: { icon: 'CircleCheck', fg: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  SUPPORT_REPLY: { icon: 'MessageCircle', fg: Colors.secondary, bg: Colors.iconBgBlue },
};

export default function NotificationCenter() {
  const { data, isLoading, isError, refetch } = useNotifications();
  const markRead = useMarkNotificationsRead();
  const unread = (data ?? []).filter((n) => !n.read).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Notifications"
        rightSlot={unread > 0 ? (
          <Pressable onPress={() => markRead.mutate()} hitSlop={8} accessibilityRole="button"><Text style={styles.markRead}>Mark read</Text></Pressable>
        ) : undefined}
      />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load notifications" actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(n) => n.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const meta = META[item.type];
            const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.Bell;
            const onPress = () => {
              if (item.type === 'SUPPORT_REPLY') router.push('/crowdfunding/support/tickets');
              else if (item.campaignId) router.push(`/crowdfunding/campaign/${item.campaignId}`);
            };
            return (
              <Pressable style={[styles.row, !item.read && styles.rowUnread]} onPress={onPress} accessibilityRole="button">
                <View style={[styles.iconBox, { backgroundColor: meta.bg }]}><Icon size={18} color={meta.fg} strokeWidth={2} /></View>
                <View style={styles.body}>
                  <Text style={styles.title}>{item.title}</Text>
                  <Text style={styles.text}>{item.body}</Text>
                  <Text style={styles.time}>{relativeTime(item.createdAt)}</Text>
                </View>
                {!item.read && <View style={styles.dot} />}
              </Pressable>
            );
          }}
          ListEmptyComponent={<StateView kind="empty" icon="BellOff" title="No notifications yet" message="Updates about your campaigns and contributions appear here." />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  markRead: { ...Typography.labelMd, color: Colors.secondary },
  list: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: 60, flexGrow: 1 },
  row: { flexDirection: 'row', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  rowUnread: { backgroundColor: Colors.surfaceContainerLow, borderColor: Colors.surfaceContainerHighest },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  text: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  time: { ...Typography.caption, color: Colors.outline, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: Radius.full, backgroundColor: Colors.secondary, marginTop: 4 },
});
