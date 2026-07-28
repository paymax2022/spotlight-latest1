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
import { useDishNutrition, useApprove } from '@/features/nutrition/hooks';
import NutritionCard from '@/features/nutrition/components/NutritionCard';
import AllergenNotice from '@/features/nutrition/components/AllergenNotice';

/**
 * Vendor per-dish review (v2, onboarding-first). The estimate is ALREADY live —
 * this is optional cleanup, never a gate. The vendor can:
 *   • Approve  → RESTAURANT_CONFIRMED (still an estimate, earns the badge), then
 *                on to the SEPARATE required allergen attestation.
 *   • Edit     → lightweight portion + macro nudge (NO ingredients).
 * There is no "skip to publish" — estimates auto-publish at upload.
 */
export default function VendorDishReviewScreen() {
  const { dishId } = useLocalSearchParams<{ dishId: string }>();
  const { data, isLoading, isError, refetch } = useDishNutrition(dishId);
  const approve = useApprove();

  const onApprove = async () => {
    if (!dishId || approve.isPending) return;
    await approve.mutateAsync(dishId);
    // Approve earns the badge, then push to the required allergen step.
    router.replace(`/nutrition/${dishId}/allergens`);
  };

  const hasVendorAllergens = (data?.allergens ?? []).some((a) => a.source === 'VENDOR');
  const confirmed = data?.status === 'RESTAURANT_CONFIRMED' || data?.status === 'EXACT';
  const isLabel = data?.status === 'EXACT';

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScreenHeader title="Review nutrition" subtitle="Optional · already live" />
      {isLoading ? (
        <StateView kind="loading" message="Loading the estimate…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load this dish" actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
            <View style={[s.banner, shadow1]}>
              <Icons.Sparkles size={18} color={Colors.secondary} strokeWidth={2.2} />
              <Text style={s.bannerText}>
                {data.status === 'AI_ESTIMATE'
                  ? 'This AI estimate is already live for buyers. Approve it to raise trust (it stays labelled an estimate), or tweak the portion/macros.'
                  : isLabel
                  ? 'This dish has an exact figure from its packaged label. No action needed.'
                  : 'You’ve confirmed this dish — buyers see it as a restaurant-confirmed estimate. You can re-edit or update allergens anytime.'}
              </Text>
            </View>

            <NutritionCard profile={data} />

            <View style={s.sep} />
            <Text style={s.stepLabel}>Allergens (required, separate step)</Text>
            <AllergenNotice allergens={data.allergens} />
            {!hasVendorAllergens ? (
              <Text style={s.warnNote}>
                You haven&apos;t attested allergens yet. Until you do, this dish shows &quot;may contain
                allergens.&quot; Approving takes you to the allergen checklist.
              </Text>
            ) : null}
          </ScrollView>

          <View style={s.footer}>
            {!isLabel ? (
              <PrimaryButton
                label={confirmed ? 'Re-approve & review allergens' : 'Approve estimate'}
                onPress={onApprove}
                loading={approve.isPending}
              />
            ) : (
              <PrimaryButton
                label="Review allergens"
                onPress={() => router.replace(`/nutrition/${dishId}/allergens`)}
              />
            )}
            <View style={s.secondaryRow}>
              {!isLabel ? (
                <Pressable
                  style={s.secondaryBtn}
                  onPress={() => router.push(`/nutrition/${dishId}/edit`)}
                  accessibilityRole="button"
                >
                  <Icons.Pencil size={16} color={Colors.secondary} strokeWidth={2.2} />
                  <Text style={s.secondaryText}>Edit portion &amp; macros</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={s.secondaryBtn}
                onPress={() => router.push(`/nutrition/${dishId}/allergens`)}
                accessibilityRole="button"
              >
                <Icons.ShieldAlert size={16} color={Colors.onSurfaceVariant} strokeWidth={2.2} />
                <Text style={[s.secondaryText, { color: Colors.onSurfaceVariant }]}>Allergens</Text>
              </Pressable>
            </View>
          </View>
        </>
      )}
    </SafeAreaView>
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
  sep: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: Spacing.xs },
  stepLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  warnNote: { ...Typography.bodySm, color: Colors.onWarning },
  footer: {
    padding: Spacing.containerMargin,
    paddingBottom: Platform.OS === 'ios' ? Spacing.lg : Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceContainerHigh,
    backgroundColor: Colors.surfaceContainerLowest,
    gap: Spacing.sm,
  },
  secondaryRow: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.lg },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  secondaryText: { ...Typography.labelMd, color: Colors.secondary },
});
