import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { StaysColors } from '@/features/stays/constants/stays.constants';

interface Notif {
  id: string;
  icon: string;
  tone: 'ok' | 'info' | 'warn';
  title: string;
  body: string;
  time: string;
  unread: boolean;
  route?: string;
}

const SEED: Notif[] = [
  { id: 'n1', icon: 'CircleCheckBig', tone: 'ok', title: 'Booking confirmed', body: 'Eko Signature Hotel — PMX-EKO4Q1 is confirmed.', time: '2h ago', unread: true, route: '/stays/trips' },
  { id: 'n2', icon: 'Wallet', tone: 'ok', title: 'Refund credited', body: '₦96,000 was credited to your wallet for PMX-KAN5WD.', time: '1d ago', unread: true, route: '/stays/profile/wallet-overview' },
  { id: 'n3', icon: 'MessageSquare', tone: 'info', title: 'New message', body: 'The George Lagos replied to your chat.', time: '2d ago', unread: false, route: '/stays/support/help' },
  { id: 'n4', icon: 'Star', tone: 'info', title: 'Review unlocked', body: 'Your stay at Hotel Presidential PH is now reviewable.', time: '3d ago', unread: false, route: '/stays/reviews/mine' },
  { id: 'n5', icon: 'BadgePercent', tone: 'warn', title: 'Loyalty progress', body: 'One more stay to reach Paymax Stays Level 2.', time: '5d ago', unread: false, route: '/stays/loyalty' },
];

const TONE: Record<string, string> = {
  ok: Colors.iconBgTeal,
  info: Colors.iconBgBlue,
  warn: Colors.iconBgGold,
};
const TONE_FG: Record<string, string> = {
  ok: StaysColors.ok,
  info: StaysColors.accent,
  warn: Colors.onWarning,
};

export default function NotificationsScreen() {
  const [items, setItems] = useState<Notif[]>(SEED);

  function open(n: Notif) {
    setItems((list) => list.map((x) => (x.id === n.id ? { ...x, unread: false } : x)));
    if (n.route) router.push(n.route as never);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Notifications" subtitle="Stays updates" />
      {items.length === 0 ? (
        <StateView kind="empty" icon="BellOff" title="No notifications" message="You're all caught up." />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          renderItem={({ item }) => {
            const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[item.icon] ?? Icons.Bell;
            return (
              <View style={[styles.row, item.unread && styles.rowUnread]} onTouchEnd={() => open(item)}>
                <View style={[styles.iconBox, { backgroundColor: TONE[item.tone] }]}>
                  <Icon size={20} color={TONE_FG[item.tone]} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.titleRow}>
                    <Text style={styles.title}>{item.title}</Text>
                    {item.unread ? <View style={styles.dot} /> : null}
                  </View>
                  <Text style={styles.body}>{item.body}</Text>
                  <Text style={styles.time}>{item.time}</Text>
                </View>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  row: { flexDirection: 'row', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  rowUnread: { backgroundColor: Colors.surfaceContainerLow },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' as const, flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.secondary },
  body: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 1 },
  time: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 4 },
});
