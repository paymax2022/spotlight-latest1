import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Icons from 'lucide-react-native';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { showToast } from '@/store/toastStore';
import { DisclosureCard } from '@/features/referral/components';
import { useCurrencyOptions, useSetRewardCurrency } from '@/features/referral/earnings/hooks';
import type { RewardCurrency } from '@/features/referral/earnings/types';

// M-ERN-05 — Reward currency selector: cash / airtime-data / points / discount / charity.
export default function CurrencySelectorScreen() {
  const { data, isLoading, isError, refetch } = useCurrencyOptions();
  const setCurrency = useSetRewardCurrency();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Reward currency" />
      {isLoading ? (
        <StateView kind="loading" message="Loading options…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="Try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <DisclosureCard tone="info" body="Choose how you receive future rewards. You can change this any time; it does not affect rewards you have already earned." />
          {data.map((c) => {
            const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[c.icon] ?? Icons.Coins;
            return (
              <Pressable
                key={c.key}
                style={[styles.option, c.active && styles.optionActive]}
                onPress={() =>
                  setCurrency.mutate(c.key as RewardCurrency, {
                    onError: () =>
                      showToast({
                        variant: 'error',
                        title: 'Could not change your reward currency',
                        message: 'Please try again.',
                      }),
                  })
                }
                disabled={setCurrency.isPending}
                accessibilityRole="radio"
                accessibilityState={{ selected: c.active }}
              >
                <View style={[styles.iconWrap, c.active && styles.iconWrapActive]}>
                  <Icon size={20} color={c.active ? Colors.onPrimary : Colors.onSurfaceVariant} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>{c.label}</Text>
                  <Text style={styles.blurb}>{c.blurb}</Text>
                </View>
                {c.active && <Check size={20} color={Colors.primary} strokeWidth={2.4} />}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.sm },
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  optionActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryContainer },
  iconWrap: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  iconWrapActive: { backgroundColor: Colors.primary },
  label: { ...Typography.labelLg, color: Colors.onSurface },
  blurb: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
