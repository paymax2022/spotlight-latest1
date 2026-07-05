import React from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  MousePointerClick, UserPlus, ShieldCheck, UserCheck, Gift, Wallet, CircleAlert, Hourglass, ChevronRight,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { EarnStatePill } from '@/features/referral/components';
import { formatNaira, relativeTime } from '@/features/referral/constants/format';
import { useActivity } from '@/features/referral/home/hooks';
import type { ActivityItem, ActivityKind } from '@/features/referral/home/types';

// M-HOME-04 — Activity timeline: recent signups, activations, rewards.
const ICON: Record<ActivityKind, { Icon: typeof Gift; color: string }> = {
  click: { Icon: MousePointerClick, color: Colors.onSurfaceVariant },
  signup: { Icon: UserPlus, color: Colors.primary },
  kyc: { Icon: ShieldCheck, color: Colors.secondary },
  activation: { Icon: UserCheck, color: Colors.tertiaryContainer },
  reward: { Icon: Gift, color: Colors.secondary },
  vesting_unlock: { Icon: Hourglass, color: Colors.gold },
  payout: { Icon: Wallet, color: Colors.tertiaryContainer },
  clawback: { Icon: CircleAlert, color: Colors.error },
};

export default function ActivityTimelineScreen() {
  const { data, isLoading, isError, refetch } = useActivity();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Activity timeline" />
      {isLoading ? (
        <StateView kind="loading" message="Loading activity…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load" message="Try again." actionLabel="Retry" onAction={refetch} />
      ) : !data || data.length === 0 ? (
        <StateView kind="empty" icon="Activity" title="No activity yet" message="Signups, activations and rewards from people you invite will appear here." />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => <Item item={item} last={index === data.length - 1} />}
        />
      )}
    </SafeAreaView>
  );
}

function Item({ item, last }: { item: ActivityItem; last: boolean }) {
  const { Icon, color } = ICON[item.kind];
  const tappable = item.kind === 'reward' || item.kind === 'vesting_unlock' || item.kind === 'payout' || item.kind === 'clawback';
  const onPress = () => {
    if (item.kind === 'clawback') router.push('/referral/earnings/clawback-notice');
    else router.push('/referral/(tabs)/earnings');
  };

  const body = (
    <View style={styles.row}>
      <View style={styles.railWrap}>
        <View style={[styles.dot, { backgroundColor: color }]}>
          <Icon size={14} color={Colors.white} strokeWidth={2.2} />
        </View>
        {!last && <View style={styles.rail} />}
      </View>
      <View style={styles.body}>
        <View style={styles.headRow}>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.time}>{relativeTime(item.createdAt)}</Text>
        </View>
        <Text style={styles.detail}>{item.detail}</Text>
        {(item.amountKobo != null || item.state) && (
          <View style={styles.metaRow}>
            {item.amountKobo != null && <Text style={styles.amount}>{formatNaira(item.amountKobo)}</Text>}
            {item.state && <EarnStatePill state={item.state} />}
            {tappable && <ChevronRight size={16} color={Colors.outline} strokeWidth={2} style={{ marginLeft: 'auto' }} />}
          </View>
        )}
      </View>
    </View>
  );

  return tappable ? (
    <Pressable onPress={onPress} accessibilityRole="button">{body}</Pressable>
  ) : body;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, paddingTop: Spacing.sm },
  row: { flexDirection: 'row', gap: Spacing.sm },
  railWrap: { alignItems: 'center', width: 28 },
  dot: { width: 28, height: 28, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  rail: { flex: 1, width: 2, backgroundColor: Colors.surfaceContainerHigh, marginTop: 2 },
  body: { flex: 1, paddingBottom: Spacing.lg, gap: 2 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  time: { ...Typography.caption, color: Colors.onSurfaceVariant },
  detail: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 4 },
  amount: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' as const },
});
