import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import * as Icons from 'lucide-react-native';
import StateView from '@/components/StateView';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { useMyPromotions } from '@/features/featured/hooks';
import { StatusBadge } from '@/features/featured/components';
import { formatNaira, countdownLabel, canRenew } from '@/features/featured/utils';
import type { Campaign } from '@/features/featured/types';
import { HomeMenuButton } from '@/components/HomeMenu';

function PromotionRow({ campaign, onPress, onRenew }: { campaign: Campaign; onPress: () => void; onRenew: () => void }) {
  const live = campaign.state === 'ACTIVE' || campaign.state === 'SCHEDULED' || campaign.state === 'PAUSED';
  const renewable = canRenew(campaign.state);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.card, shadow1, pressed && { opacity: 0.9 }]} accessibilityRole="button">
      <View style={s.body}>
        <View style={s.topRow}>
          <Text style={s.name} numberOfLines={1}>{campaign.subject_label ?? campaign.creative.headline}</Text>
          {campaign.quoted_price_kobo ? <Text style={s.price}>{formatNaira(campaign.quoted_price_kobo)}</Text> : null}
        </View>
        <Text style={s.meta} numberOfLines={1}>{campaign.zone_name ?? campaign.zone_code}</Text>
        <View style={s.bottomRow}>
          <StatusBadge state={campaign.state} />
          {live ? (
            <View style={s.timeRow}>
              <Icons.Clock size={11} color={Colors.onSurfaceVariant} strokeWidth={2} />
              <Text style={s.time}>{countdownLabel(campaign.window_end)}</Text>
            </View>
          ) : renewable ? (
            <Pressable onPress={onRenew} hitSlop={8} style={s.renewBtn}>
              <Icons.RotateCw size={13} color={Colors.secondary} strokeWidth={2.2} />
              <Text style={s.renewText}>Renew</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <Icons.ChevronRight size={16} color={Colors.outline} strokeWidth={2} />
    </Pressable>
  );
}

export default function MyPromotionsScreen() {
  const { data, isLoading, isError, refetch } = useMyPromotions({ poll: true });

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.topBar}>
        <Pressable onPress={() => goBack('/')} style={s.iconButton} accessibilityLabel="Go back">
          <Icons.ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={s.topTitle}>My promotions</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Pressable onPress={() => router.push('/featured/new')} style={s.iconButton} accessibilityLabel="New promotion">
            <Icons.Plus size={22} color={Colors.primary} strokeWidth={2.2} />
          </Pressable>
          <HomeMenuButton />
        </View>
      </View>

      {isLoading ? (
        <StateView kind="loading" message="Loading your promotions…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load promotions" actionLabel="Retry" onAction={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <StateView
          kind="empty"
          icon="Megaphone"
          title="No promotions yet"
          message="Promote a listing or product to feature it on the home screen."
          actionLabel="Promote an item"
          onAction={() => router.push('/featured/new')}
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
          {data.map((c) => (
            <PromotionRow
              key={c.id}
              campaign={c}
              onPress={() => router.push(`/featured/promotions/${c.id}`)}
              onRenew={() => router.push('/featured/new')}
            />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topBar: {
    height: 64, paddingHorizontal: Spacing.containerMargin, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between',
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh,
    backgroundColor: 'rgba(248,249,255,0.92)',
  },
  iconButton: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  topTitle: { ...Typography.titleLg, color: Colors.primary },
  content: { padding: Spacing.containerMargin },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginBottom: Spacing.md,
  },
  body: { flex: 1, gap: 4 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  name: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  price: { ...Typography.labelMd, color: Colors.primary },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  time: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  renewBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  renewText: { ...Typography.labelSm, color: Colors.secondary, fontWeight: '700' as const },
});
