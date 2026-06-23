import React from 'react';
import { FlatList, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useCreatorNotifications } from '@/features/crowdfunding/hooks/useCreator';
import { relativeTime } from '@/features/crowdfunding/utils/crowdfundingFormatters';
import type { CreatorNotificationType } from '@/features/crowdfunding/types/crowdfunding.types';

const META: Record<CreatorNotificationType, { icon: string; fg: string; bg: string }> = {
  CAMPAIGN_APPROVED: { icon: 'CircleCheck',  fg: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  CAMPAIGN_REJECTED: { icon: 'CircleX',      fg: Colors.error,             bg: Colors.iconBgRed },
  CHANGES_REQUESTED: { icon: 'PencilLine',   fg: '#B65A00',                bg: Colors.iconBgOrange },
  CONTRIBUTION:      { icon: 'HeartHandshake', fg: Colors.secondary,       bg: Colors.iconBgBlue },
  GOAL_MILESTONE:    { icon: 'PartyPopper',  fg: Colors.primary,           bg: Colors.iconBgPurple },
  WITHDRAWAL:        { icon: 'Wallet',       fg: Colors.secondary,         bg: Colors.iconBgBlue },
  FRAUD_REVIEW:      { icon: 'ShieldAlert',  fg: Colors.error,             bg: Colors.iconBgRed },
};

export default function CreatorNotificationsScreen() {
  const { data, isLoading, isError, refetch } = useCreatorNotifications();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Notifications" />
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
            return (
              <View style={[styles.row, !item.read && styles.rowUnread]}>
                <View style={[styles.iconBox, { backgroundColor: meta.bg }]}><Icon size={18} color={meta.fg} strokeWidth={2} /></View>
                <View style={styles.body}>
                  <Text style={styles.title}>{item.title}</Text>
                  <Text style={styles.text}>{item.body}</Text>
                  <Text style={styles.time}>{relativeTime(item.createdAt)}</Text>
                </View>
                {!item.read && <View style={styles.unreadDot} />}
              </View>
            );
          }}
          ListEmptyComponent={
            <StateView kind="empty" icon="BellOff" title="No notifications yet" message="Updates about your campaigns will appear here." />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: 60, flexGrow: 1 },
  row: { flexDirection: 'row', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  rowUnread: { backgroundColor: Colors.surfaceContainerLow, borderColor: Colors.surfaceContainerHighest },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  text: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  time: { ...Typography.caption, color: Colors.outline, marginTop: 2 },
  unreadDot: { width: 8, height: 8, borderRadius: Radius.full, backgroundColor: Colors.secondary, marginTop: 4 },
});
