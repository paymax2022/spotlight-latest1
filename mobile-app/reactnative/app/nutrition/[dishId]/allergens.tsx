import React, { useMemo, useState } from 'react';
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
import { useDishNutrition, useAttestAllergen } from '@/features/nutrition/hooks';
import { ALLERGEN_VOCAB } from '@/features/nutrition/types';
import type { AllergenDeclarationType } from '@/features/nutrition/types';

type Choice = AllergenDeclarationType | null;

const OPTIONS: { value: AllergenDeclarationType; label: string }[] = [
  { value: 'CONTAINS', label: 'Contains' },
  { value: 'MAY_CONTAIN', label: 'May contain' },
  { value: 'FREE_FROM', label: 'Free from' },
];

/**
 * REQUIRED allergen attestation — a separate step from nutrition. The vendor
 * declares each allergen as Contains / May contain / Free from. CLIENT-SIDE
 * RULE: any "Free from" selection requires a cross-contamination acknowledgement
 * before it can be submitted (mirrors the server's fail-closed enforcement).
 */
export default function AllergenAttestScreen() {
  const { dishId } = useLocalSearchParams<{ dishId: string }>();
  const { data, isLoading, isError, refetch } = useDishNutrition(dishId);
  const attest = useAttestAllergen();

  // Selection + per-allergen cross-contamination ack.
  const [choice, setChoice] = useState<Record<string, Choice>>({});
  const [ack, setAck] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);

  const select = (allergen: string, value: AllergenDeclarationType) => {
    setChoice((c) => ({ ...c, [allergen]: c[allergen] === value ? null : value }));
    if (value !== 'FREE_FROM') setAck((a) => ({ ...a, [allergen]: false }));
  };

  const declared = useMemo(
    () => Object.entries(choice).filter(([, v]) => v != null) as [string, AllergenDeclarationType][],
    [choice],
  );

  // Client-side enforcement: every FREE_FROM must carry a ticked ack.
  const freeFromMissingAck = declared.some(([a, v]) => v === 'FREE_FROM' && !ack[a]);
  const canSubmit = declared.length > 0 && !freeFromMissingAck && !submitting;

  const onSubmit = async () => {
    if (!dishId || !canSubmit) return;
    setSubmitting(true);
    try {
      // Persist each declaration. (Backend also enforces ack fail-closed.)
      for (const [allergen, declaration_type] of declared) {
        await attest.mutateAsync({
          dishId,
          req: {
            allergen,
            declaration_type,
            cross_contamination_ack: declaration_type === 'FREE_FROM' ? Boolean(ack[allergen]) : false,
          },
        });
      }
      router.replace(`/nutrition/${dishId}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScreenHeader title="Attest allergens" subtitle="Required · vendor declaration" showBack={false} />
      {isLoading ? (
        <StateView kind="loading" message="Loading dish…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load this dish" actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
            <View style={[s.banner, shadow1]}>
              <Icons.ShieldAlert size={18} color={Colors.error} strokeWidth={2.2} />
              <Text style={s.bannerText}>
                Allergen accuracy is your legal responsibility. Mark every allergen below. Selecting
                &quot;Free from&quot; requires you to acknowledge there&apos;s no cross-contamination.
              </Text>
            </View>

            {ALLERGEN_VOCAB.map((allergen) => {
              const current = choice[allergen] ?? null;
              const needsAck = current === 'FREE_FROM';
              return (
                <View key={allergen} style={[s.card, shadow1]}>
                  <Text style={s.allergenName}>{allergen}</Text>
                  <View style={s.optRow}>
                    {OPTIONS.map((opt) => {
                      const active = current === opt.value;
                      return (
                        <Pressable
                          key={opt.value}
                          onPress={() => select(allergen, opt.value)}
                          style={[
                            s.opt,
                            active && opt.value === 'CONTAINS' && s.optContains,
                            active && opt.value === 'MAY_CONTAIN' && s.optMaybe,
                            active && opt.value === 'FREE_FROM' && s.optFree,
                          ]}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: active }}
                        >
                          <Text
                            style={[
                              s.optText,
                              active && opt.value === 'CONTAINS' && { color: Colors.error },
                              active && opt.value === 'MAY_CONTAIN' && { color: Colors.onWarning },
                              active && opt.value === 'FREE_FROM' && { color: Colors.tertiaryContainer },
                            ]}
                          >
                            {opt.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {needsAck ? (
                    <Pressable
                      onPress={() => setAck((a) => ({ ...a, [allergen]: !a[allergen] }))}
                      style={s.ackRow}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: Boolean(ack[allergen]) }}
                    >
                      <View style={[s.checkbox, ack[allergen] && s.checkboxOn]}>
                        {ack[allergen] ? <Icons.Check size={14} color={Colors.white} strokeWidth={3} /> : null}
                      </View>
                      <Text style={s.ackText}>
                        I confirm there is no cross-contamination risk for {allergen}.
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>

          <View style={s.footer}>
            {freeFromMissingAck ? (
              <Text style={s.blockNote}>
                Tick the cross-contamination acknowledgement for every &quot;Free from&quot; allergen to
                continue.
              </Text>
            ) : null}
            <PrimaryButton
              label={`Submit ${declared.length || ''} declaration${declared.length === 1 ? '' : 's'}`.trim()}
              onPress={onSubmit}
              loading={submitting}
              disabled={!canSubmit}
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  banner: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: Colors.errorContainer,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.error,
    padding: Spacing.md,
  },
  bannerText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  allergenName: { ...Typography.labelLg, color: Colors.onSurface },
  optRow: { flexDirection: 'row', gap: 6 },
  opt: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  optContains: { backgroundColor: Colors.errorContainer, borderColor: Colors.error },
  optMaybe: { backgroundColor: Colors.iconBgGold, borderColor: Colors.gold },
  optFree: { backgroundColor: Colors.iconBgTeal, borderColor: Colors.tertiaryContainer },
  optText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  ackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    padding: Spacing.sm,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    borderColor: Colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerLowest,
  },
  checkboxOn: { backgroundColor: Colors.tertiaryContainer, borderColor: Colors.tertiaryContainer },
  ackText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  footer: {
    padding: Spacing.containerMargin,
    paddingBottom: Platform.OS === 'ios' ? Spacing.lg : Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceContainerHigh,
    backgroundColor: Colors.surfaceContainerLowest,
    gap: Spacing.sm,
  },
  blockNote: { ...Typography.bodySm, color: Colors.error, textAlign: 'center' },
});
