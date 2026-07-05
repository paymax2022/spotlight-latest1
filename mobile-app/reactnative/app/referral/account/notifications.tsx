import React from 'react';
import { FlatList, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { ReferralHeader } from '@/features/referral/components';
import { useReferralNotifications, useMarkNotificationsRead } from '@/features/referral/foundation/hooks';
import { relativeTime, formatNaira } from '@/features/referral/constants/format';
import type { ReferralNotificationType } from '@/features/referral/foundation/types';

// M-NOT-01 — Notifications center. Signup, activation, reward, vesting unlock,
// payout, clawback, rank-up.
const META: Record<ReferralNotificationType, { icon: string; fg: string; bg: string }> = {
  signup:         { icon: 'UserRoundPlus', fg: Colors.secondary,         bg: Colors.iconBgBlue },
  activation:     { icon: 'Zap',           fg: Colors.primary,           bg: Colors.iconBgPurple },
  reward:         { icon: 'Gift',          fg: '#B65A00',                bg: Colors.iconBgOrange },
  vesting_unlock: { icon: 'LockOpen',      fg: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  payout:         { icon: 'Wallet',        fg: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  clawback:       { icon: 'Undo2',         fg: Colors.error,             bg: Colors.iconBgRed },
  rank_up:        { icon: 'TrendingUp',    fg: Colors.primary,           bg: Colors.iconBgPurple },
};

export default function ReferralNotifications() {
  const { data, isLoading, isError, refetch } = useReferralNotifications();
  const markRead = useMarkNotificationsRead();
  const unread = (data ?? []).filter((n) => !n.read).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ReferralHeader title="Notifications" />
      {unread > 0 && (
        <View style={styles.markBar}>
          <Text style={styles.unreadText}>{unread} unread</Text>
          <Pressable onPress={() => markRead.mutate()} hitSlop={8} accessibilityRole="button">
            <Text style={styles.markRead}>Mark all read</Text>
          </Pressable>
        </View>
      )}
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
              if (item.type === 'clawback') router.push('/referral/account/verification-fraud-status');
              else if (item.type === 'payout' || item.type === 'reward' || item.type === 'vesting_unlock') router.push('/referral/(tabs)/earnings');
            };
            return (
              <Pressable style={[styles.row, !item.read && styles.rowUnread]} onPress={onPress} accessibilityRole="button">
                <View style={[styles.iconBox, { backgroundColor: meta.bg }]}><Icon size={18} color={meta.fg} strokeWidth={2} /></View>
                <View style={styles.body}>
                  <Text style={styles.title}>{item.title}</Text>
                  <Text style={styles.text}>{item.body}</Text>
                  <Text style={styles.time}>
                    {relativeTime(item.createdAt)}
                    {item.amountKobo != null ? ` · ${formatNaira(item.amountKobo)}` : ''}
                  </Text>
                </View>
                {!item.read && <View style={styles.dot} />}
              </Pressable>
            );
          }}
          ListEmptyComponent={<StateView kind="empty" icon="BellOff" title="No notifications yet" message="Signups, rewards, vesting unlocks and payouts appear here." />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  markBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.sm },
  unreadText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
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
