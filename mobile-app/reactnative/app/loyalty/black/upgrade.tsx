import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { X, Crown, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useBlackStatus, useUpgradeToBlack, formatPoints, BLACK_BENEFITS, BLACK_THRESHOLD_POINTS } from '@/features/loyalty/black';
import { LoyaltyColors } from '@/features/loyalty/constants/loyalty.constants';

export default function BlackUpgrade() {
  const status = useBlackStatus();
  const upgrade = useUpgradeToBlack();
  const [done, setDone] = useState(false);

  const eligible = status.data?.eligibility === 'eligible';

  const onUpgrade = async () => {
    await upgrade.mutateAsync();
    setDone(true);
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}><Pressable onPress={() => router.replace('/loyalty/black')} hitSlop={10} style={styles.iconBtn}><X size={22} color={Colors.onSurface} /></Pressable><Text style={styles.headerTitle}>Welcome to Black</Text><View style={styles.iconBtn} /></View>
        <StateView kind="empty" icon="Crown" title="You're now Paymax Black" message="All Black perks are unlocked. Enjoy early tickets, the lounge, zero fees and partner offers." actionLabel="Explore Black" onAction={() => router.replace('/loyalty/black')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/loyalty/black')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Close"><X size={22} color={Colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Upgrade to Black</Text>
        <View style={styles.iconBtn} />
      </View>

      {status.isLoading ? (
        <StateView kind="loading" message="Loading…" />
      ) : status.isError || !status.data ? (
        <StateView kind="error" title="Couldn't load status" actionLabel="Retry" onAction={() => status.refetch()} />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <View style={styles.card}>
              <Crown size={36} color={Colors.gold} />
              <Text style={styles.title}>Paymax Black</Text>
              <Text style={styles.sub}>The top of the loyalty ladder — invite-by-merit, unlocked at {formatPoints(BLACK_THRESHOLD_POINTS)} lifetime.</Text>
              <Text style={styles.points}>You have {formatPoints(status.data.lifetimePoints)}</Text>
            </View>

            <Text style={styles.section}>What you unlock</Text>
            <View style={styles.benefits}>
              {BLACK_BENEFITS.map((b) => (
                <View key={b} style={styles.benefitRow}><Check size={16} color={LoyaltyColors.ok} /><Text style={styles.benefitText}>{b}</Text></View>
              ))}
            </View>

            {!eligible ? (
              <View style={styles.notEligible}><Text style={styles.notEligibleText}>You need {formatPoints(status.data.pointsToUnlock)} more lifetime points to upgrade. Keep earning across Paymax.</Text></View>
            ) : null}

            <View style={{ height: 120 }} />
          </ScrollView>

          <View style={styles.footer}>
            <PrimaryButton label={eligible ? 'Confirm upgrade to Black' : 'Not eligible yet'} onPress={onUpgrade} disabled={!eligible} loading={upgrade.isPending} />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface, flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  card: { backgroundColor: '#1A0050', borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center', gap: 6 },
  title: { ...Typography.headlineMd, color: '#FFFFFF' },
  sub: { ...Typography.bodyMd, color: '#D3BBFF', textAlign: 'center' },
  points: { ...Typography.titleMd, color: Colors.gold, marginTop: 4 },
  section: { ...Typography.titleMd, color: LoyaltyColors.text, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  benefits: { backgroundColor: LoyaltyColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.sm },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  benefitText: { ...Typography.bodyMd, color: LoyaltyColors.text, flex: 1 },
  notEligible: { backgroundColor: LoyaltyColors.surfaceAlt, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.md },
  notEligibleText: { ...Typography.labelSm, color: LoyaltyColors.muted },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
