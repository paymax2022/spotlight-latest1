import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, BadgeCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import { useSubscriptions, useCancelSubscription } from '@/features/creators/hooks';
import { CreatorsColors, formatNaira, SUB_STATUS_LABEL } from '@/features/creators/constants/creators.constants';
import type { Subscription } from '@/features/creators/types';

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  ACTIVE:    { bg: CreatorsColors.okBg, fg: CreatorsColors.ok },
  PAST_DUE:  { bg: CreatorsColors.warnBg, fg: CreatorsColors.warnText },
  CANCELLED: { bg: CreatorsColors.surfaceAlt, fg: CreatorsColors.muted },
};

export default function MySubscriptions() {
  const subs = useSubscriptions();
  const cancel = useCancelSubscription();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back"><ArrowLeft size={22} color={Colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>My subscriptions</Text>
        <View style={styles.iconBtn} />
      </View>

      {subs.isLoading ? (
        <StateView kind="loading" message="Loading subscriptions…" />
      ) : subs.isError ? (
        <StateView kind="error" title="Couldn't load subscriptions" actionLabel="Retry" onAction={() => subs.refetch()} />
      ) : (subs.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" title="No subscriptions yet" message="Subscribe to creators to support them and unlock content." icon="BookOpen" actionLabel="Discover creators" onAction={() => router.replace('/creators')} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {subs.data!.map((s) => (
            <SubRow key={s.id} sub={s} onCancel={() => cancel.mutate(s.id)} cancelling={cancel.isPending} onOpen={() => router.push(`/creators/storefront/${s.creatorId}`)} />
          ))}
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function SubRow({ sub, onCancel, cancelling, onOpen }: { sub: Subscription; onCancel: () => void; cancelling: boolean; onOpen: () => void }) {
  const st = STATUS_STYLE[sub.status];
  const initials = sub.creatorName.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <View style={styles.card}>
      <Pressable onPress={onOpen} style={styles.cardTop}>
        <View style={[styles.avatar, { backgroundColor: sub.avatarColor }]}><Text style={styles.avatarText}>{initials}</Text></View>
        <View style={{ flex: 1 }}>
          <View style={styles.nameRow}><Text style={styles.name}>{sub.creatorName}</Text><BadgeCheck size={14} color={CreatorsColors.accent} /></View>
          <Text style={styles.handle}>{sub.creatorHandle} · {sub.tierName}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: st.bg }]}><Text style={[styles.badgeText, { color: st.fg }]}>{SUB_STATUS_LABEL[sub.status]}</Text></View>
      </Pressable>
      <View style={styles.cardFooter}>
        <Text style={styles.price}>{formatNaira(sub.priceKobo)}/mo</Text>
        {sub.status === 'CANCELLED' ? (
          <Text style={styles.renews}>Ended</Text>
        ) : sub.renewsAtISO ? (
          <Text style={styles.renews}>{sub.status === 'PAST_DUE' ? 'Retry on ' : 'Renews '}{new Date(sub.renewsAtISO).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}</Text>
        ) : null}
        {sub.status !== 'CANCELLED' ? (
          <Pressable onPress={onCancel} disabled={cancelling}><Text style={styles.cancel}>Cancel</Text></Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface, flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, gap: Spacing.md },
  card: { backgroundColor: CreatorsColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.sm, ...shadow1 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  avatar: { width: 48, height: 48, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...Typography.titleMd, color: '#FFFFFF' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { ...Typography.titleMd, color: CreatorsColors.text },
  handle: { ...Typography.bodySm, color: CreatorsColors.muted },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  badgeText: { ...Typography.labelSm },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: CreatorsColors.border, paddingTop: Spacing.sm },
  price: { ...Typography.labelLg, color: CreatorsColors.text },
  renews: { ...Typography.labelSm, color: CreatorsColors.muted, flex: 1 },
  cancel: { ...Typography.labelMd, color: CreatorsColors.danger },
});
