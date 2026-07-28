import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useCatalog, useLoyaltyAccount, useRedeem } from '@/features/loyalty/hooks';
import { LoyaltyColors, formatPoints, formatNaira, REDEEM_DISCLOSURE } from '@/features/loyalty/constants/loyalty.constants';

export default function Redeem() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const catalog = useCatalog();
  const account = useLoyaltyAccount();
  const redeem = useRedeem();
  const [done, setDone] = useState<{ ref: string; newBalance: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loading = catalog.isLoading || account.isLoading;
  const item = catalog.data?.find((c) => c.id === itemId);

  if (loading) return <Shell><StateView kind="loading" message="Loading reward…" /></Shell>;
  if (catalog.isError || account.isError) return <Shell><StateView kind="error" title="Couldn't load reward" message="Please try again." actionLabel="Retry" onAction={() => { catalog.refetch(); account.refetch(); }} /></Shell>;
  if (!item || !account.data) return <Shell><StateView kind="error" title="Reward unavailable" message="This reward could not be found." actionLabel="Back" onAction={() => router.back()} /></Shell>;

  const balance = account.data.balancePoints;
  const afford = balance >= item.costPoints;

  const confirm = async () => {
    setErr(null);
    try {
      const res = await redeem.mutateAsync({ itemId: item.id });
      setDone({ ref: res.reference, newBalance: res.newBalancePoints });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Redemption failed.');
    }
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScreenHeader title="Redeemed" showBack={false} />
        <View style={styles.successWrap}>
          <CheckCircle2 size={64} color={LoyaltyColors.ok} />
          <Text style={styles.successTitle}>{item.title} redeemed</Text>
          <Text style={styles.successSub}>
            {item.kind === 'airtime' ? 'Your airtime is being delivered.'
              : item.kind === 'bill' ? 'Your bill credit has been applied.'
              : item.kind === 'discount' ? 'Your discount is now active at checkout.'
              : 'Your perk is now unlocked.'}
          </Text>
          <Text style={styles.ref}>Ref: {done.ref}</Text>
          <Text style={styles.newBal}>New balance: {formatPoints(done.newBalance)}</Text>
        </View>
        <View style={styles.footer}>
          <PrimaryButton label="Back to catalog" onPress={() => router.replace('/loyalty/catalog')} />
          <PrimaryButton label="Done" variant="ghost" onPress={() => router.replace('/loyalty')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Confirm redemption" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.itemCard}>
          <View style={styles.iconBox}><Text style={styles.emoji}>{item.emoji}</Text></View>
          <Text style={styles.itemTitle}>{item.title}</Text>
          <Text style={styles.itemDesc}>{item.description}</Text>
          {item.valueKobo ? <Text style={styles.value}>Worth {formatNaira(item.valueKobo)}</Text> : null}
        </View>

        <View style={styles.card}>
          <Row label="Cost" value={formatPoints(item.costPoints)} />
          <Row label="Your balance" value={formatPoints(balance)} />
          <View style={styles.divider} />
          <Row label="Balance after" value={formatPoints(Math.max(0, balance - item.costPoints))} bold />
        </View>

        <View style={styles.disclosure}>
          <Text style={styles.disclosureText}>{REDEEM_DISCLOSURE}</Text>
        </View>

        {!afford ? <Text style={styles.warn}>You need {formatPoints(item.costPoints - balance)} more to redeem this reward.</Text> : null}
        {err ? <Text style={styles.warn}>{err}</Text> : null}
        <View style={{ height: 120 }} />
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label={afford ? `Redeem for ${formatPoints(item.costPoints)}` : 'Not enough points'} disabled={!afford} loading={redeem.isPending} onPress={confirm} />
      </View>
    </SafeAreaView>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, bold && styles.bold]}>{label}</Text>
      <Text style={[styles.rowValue, bold && styles.bold]}>{value}</Text>
    </View>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Confirm redemption" />{children}</SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.sm },
  itemCard: { backgroundColor: LoyaltyColors.surface, borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center', gap: Spacing.xs, ...shadow1 },
  iconBox: { width: 72, height: 72, borderRadius: Radius.lg, backgroundColor: LoyaltyColors.brandBg, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  emoji: { fontSize: 38 },
  itemTitle: { ...Typography.titleLg, color: Colors.onSurface },
  itemDesc: { ...Typography.bodyMd, color: LoyaltyColors.muted, textAlign: 'center' },
  value: { ...Typography.labelMd, color: LoyaltyColors.brandText, marginTop: 4 },
  card: { backgroundColor: LoyaltyColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.sm, ...shadow1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { ...Typography.bodyMd, color: LoyaltyColors.muted },
  rowValue: { ...Typography.bodyMd, color: Colors.onSurface },
  bold: { ...Typography.labelLg, color: Colors.onSurface },
  divider: { height: 1, backgroundColor: LoyaltyColors.border, marginVertical: 4 },
  disclosure: { backgroundColor: LoyaltyColors.brandBg, borderRadius: Radius.md, padding: Spacing.md },
  disclosureText: { ...Typography.bodySm, color: LoyaltyColors.brandText },
  warn: { ...Typography.bodySm, color: LoyaltyColors.danger, textAlign: 'center' },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.sm },
  successTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  successSub: { ...Typography.bodyMd, color: LoyaltyColors.muted, textAlign: 'center' },
  ref: { ...Typography.labelMd, color: LoyaltyColors.muted, marginTop: Spacing.sm },
  newBal: { ...Typography.labelLg, color: LoyaltyColors.accent },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, gap: Spacing.xs },
});
