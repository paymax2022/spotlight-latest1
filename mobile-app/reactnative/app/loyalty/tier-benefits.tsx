import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, Crown } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useTiers, useLoyaltyAccount } from '@/features/loyalty/hooks';
import { LoyaltyColors, formatPoints } from '@/features/loyalty/constants/loyalty.constants';

export default function TierBenefits() {
  const tiers = useTiers();
  const account = useLoyaltyAccount();

  const loading = tiers.isLoading || account.isLoading;
  const errored = tiers.isError || account.isError;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Tiers & benefits" />
      {loading ? (
        <StateView kind="loading" message="Loading tiers…" />
      ) : errored || !tiers.data ? (
        <StateView kind="error" title="Couldn't load tiers" message="Please try again." actionLabel="Retry" onAction={() => { tiers.refetch(); account.refetch(); }} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.intro}>Earn points across Paymax to climb the ladder. Each tier unlocks better earn rates and perks.</Text>
          {tiers.data.map((t, idx) => {
            const current = t.id === account.data?.tierId;
            const reached = (account.data?.lifetimePoints ?? 0) >= t.minPoints;
            return (
              <View key={t.id} style={[styles.card, current && { borderColor: t.color, borderWidth: 2 }]}>
                <View style={styles.cardHead}>
                  <View style={[styles.tierIcon, { backgroundColor: t.color }]}>
                    <Crown size={20} color={Colors.white} strokeWidth={2.2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.titleRow}>
                      <Text style={styles.tierName}>{t.name}</Text>
                      {current ? <View style={styles.currentChip}><Text style={styles.currentText}>Current</Text></View> : null}
                    </View>
                    <Text style={styles.threshold}>
                      {t.minPoints === 0 ? 'Starting tier' : `${formatPoints(t.minPoints)} lifetime`}
                      {reached && !current ? ' · reached' : ''}
                    </Text>
                  </View>
                  <Text style={styles.step}>Tier {idx + 1}</Text>
                </View>
                <View style={styles.perks}>
                  {t.perks.map((p) => (
                    <View key={p} style={styles.perkRow}>
                      <Check size={15} color={t.color} strokeWidth={2.5} />
                      <Text style={styles.perkText}>{p}</Text>
                    </View>
                  ))}
                </View>
              </View>
            );
          })}
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.sm },
  intro: { ...Typography.bodyMd, color: LoyaltyColors.muted, lineHeight: 24 },
  card: { backgroundColor: LoyaltyColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.md, borderWidth: 1, borderColor: Colors.transparent, ...shadow1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  tierIcon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  tierName: { ...Typography.titleLg, color: Colors.onSurface },
  currentChip: { backgroundColor: LoyaltyColors.okBg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.full },
  currentText: { ...Typography.caption, color: LoyaltyColors.ok },
  threshold: { ...Typography.bodySm, color: LoyaltyColors.muted, marginTop: 2 },
  step: { ...Typography.labelSm, color: LoyaltyColors.muted },
  perks: { gap: Spacing.sm },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  perkText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
});
