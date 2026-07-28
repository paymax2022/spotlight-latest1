import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { useMenuNutrition, useApproveAll } from '@/features/nutrition/hooks';
import NutritionCard from '@/features/nutrition/components/NutritionCard';
import type { DishNutritionProfile } from '@/features/nutrition/types';

/**
 * "Review your menu's nutrition" — OPTIONAL cleanup, never a gate. Estimates are
 * already auto-published; this screen lets the vendor batch-approve or tidy up
 * at leisure. One-tap "Approve all" + per-item Approve / Edit.
 */
export default function MenuReviewScreen() {
  const { menuId } = useLocalSearchParams<{ menuId: string }>();
  const { data, isLoading, isError, refetch } = useMenuNutrition(menuId);
  const approveAll = useApproveAll();

  const dishes = data ?? [];
  const pending = dishes.filter((d) => d.status === 'AI_ESTIMATE');

  const onApproveAll = async () => {
    if (!menuId || approveAll.isPending || pending.length === 0) return;
    await approveAll.mutateAsync(menuId);
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScreenHeader title="Review your nutrition" subtitle="Optional · your menu is already live" />
      {isLoading ? (
        <StateView kind="loading" message="Loading your menu…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load your menu" actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
            <View style={[s.banner, shadow1]}>
              <Icons.Sparkles size={18} color={Colors.secondary} strokeWidth={2.2} />
              <Text style={s.bannerText}>
                We&apos;ve already estimated and published nutrition for your whole menu — buyers can
                see it now. Approving raises trust and earns the Nutrition-Verified badge, but it&apos;s
                entirely optional.
              </Text>
            </View>

            {dishes.map((d) => (
              <DishRow key={d.dish_id} dish={d} />
            ))}
          </ScrollView>

          <View style={s.footer}>
            {pending.length > 0 ? (
              <Text style={s.pendingNote}>
                {pending.length} dish{pending.length === 1 ? '' : 'es'} still showing as an AI estimate.
              </Text>
            ) : (
              <Text style={s.doneNote}>Every dish is restaurant-confirmed. Nice.</Text>
            )}
            <PrimaryButton
              label={pending.length > 0 ? `Approve all (${pending.length})` : 'All approved'}
              onPress={onApproveAll}
              loading={approveAll.isPending}
              disabled={pending.length === 0}
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function DishRow({ dish }: { dish: DishNutritionProfile }) {
  const confirmed = dish.status === 'RESTAURANT_CONFIRMED' || dish.status === 'EXACT';
  return (
    <View style={[s.row, shadow1]}>
      <NutritionCard profile={dish} compact />
      <View style={s.rowActions}>
        {confirmed ? (
          <View style={s.confirmedPill}>
            <Icons.Check size={13} color={Colors.tertiaryContainer} strokeWidth={2.6} />
            <Text style={s.confirmedText}>Confirmed</Text>
          </View>
        ) : (
          <Pressable
            style={s.approveBtn}
            onPress={() => router.push(`/nutrition/${dish.dish_id}`)}
            accessibilityRole="button"
          >
            <Icons.BadgeCheck size={14} color={Colors.primary} strokeWidth={2.4} />
            <Text style={s.approveText}>Approve</Text>
          </Pressable>
        )}
        <Pressable
          style={s.editBtn}
          onPress={() => router.push(`/nutrition/${dish.dish_id}/edit`)}
          accessibilityRole="button"
        >
          <Icons.Pencil size={14} color={Colors.secondary} strokeWidth={2.2} />
          <Text style={s.editText}>Edit</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  banner: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
  },
  bannerText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  row: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  rowActions: { flexDirection: 'row', gap: Spacing.sm, justifyContent: 'flex-end' },
  approveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: Spacing.md, paddingVertical: 8,
    borderRadius: Radius.full, backgroundColor: Colors.primaryFixed, borderWidth: 1, borderColor: Colors.primary,
  },
  approveText: { ...Typography.labelSm, color: Colors.primary },
  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: Spacing.md, paddingVertical: 8,
    borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  editText: { ...Typography.labelSm, color: Colors.secondary },
  confirmedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: Spacing.md, paddingVertical: 8,
    borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal,
  },
  confirmedText: { ...Typography.labelSm, color: Colors.tertiaryContainer },
  footer: {
    padding: Spacing.containerMargin,
    paddingBottom: Platform.OS === 'ios' ? Spacing.lg : Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceContainerHigh,
    backgroundColor: Colors.surfaceContainerLowest,
    gap: Spacing.sm,
  },
  pendingNote: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  doneNote: { ...Typography.bodySm, color: Colors.tertiaryContainer, textAlign: 'center' },
});
