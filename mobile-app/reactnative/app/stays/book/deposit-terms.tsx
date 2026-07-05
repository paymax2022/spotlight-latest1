import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check, Building2, Banknote } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useStaysStore } from '@/features/stays/store';
import { usePreviewBreakdown } from '@/features/stays/hooks';
import { formatNaira, StaysColors } from '@/features/stays/constants/stays.constants';

export default function DepositTermsScreen() {
  const { draft, addOnKeys, promoCode, useLoyalty, paymentMethod } = useStaysStore();
  const preview = usePreviewBreakdown(
    draft ? { draft, addOnKeys, promoCode, useLoyalty } : ({} as any),
    !!draft,
  );
  const [agree, setAgree] = useState(false);

  const total = preview.data?.totalKobo ?? 0;
  const isDeposit = paymentMethod === 'deposit';
  const depositNow = Math.round(total * 0.3);
  const balance = total - depositNow;
  const guarantee = Math.round(total * 0.15);

  const Icon = isDeposit ? Banknote : Building2;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={isDeposit ? 'Deposit terms' : 'Pay-at-property terms'} subtitle="Step 5 of 5" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {!draft ? (
          <StateView kind="empty" icon="Building2" title="No booking" message="Start a booking first." />
        ) : preview.isLoading ? (
          <StateView kind="loading" message="Loading terms…" />
        ) : (
          <>
            <View style={styles.head}>
              <View style={styles.headIcon}><Icon size={24} color={StaysColors.brand} strokeWidth={2} /></View>
              <Text style={styles.headTitle}>
                {isDeposit ? 'Pay a deposit now, the rest at check-in' : 'Confirm now, pay at the hotel'}
              </Text>
            </View>

            <View style={styles.card}>
              {isDeposit ? (
                <>
                  <Line label="Deposit now (30%)" value={formatNaira(depositNow)} bold />
                  <Line label="Balance at check-in (70%)" value={formatNaira(balance)} />
                </>
              ) : (
                <>
                  <Line label="Refundable guarantee hold (15%)" value={formatNaira(guarantee)} bold />
                  <Line label="Pay at the hotel" value={formatNaira(total)} />
                </>
              )}
              <View style={styles.divider} />
              <Line label="Total stay value" value={formatNaira(total)} />
            </View>

            <View style={styles.terms}>
              <Bullet text={isDeposit
                ? 'The deposit is charged from your wallet now and applied to your bill.'
                : 'A small refundable hold guarantees your room; nothing is charged unless you no-show.'} />
              <Bullet text="If the hotel cannot confirm, the hold/deposit is released or refunded — no loss." />
              <Bullet text="The cancellation policy snapshot applies as shown on your rate plan." />
            </View>

            <Pressable style={styles.agreeRow} onPress={() => setAgree((a) => !a)}>
              <View style={[styles.checkbox, agree && styles.checkboxOn]}>
                {agree ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}
              </View>
              <Text style={styles.agreeText}>I understand and accept the {isDeposit ? 'deposit' : 'pay-at-property'} terms.</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Continue" onPress={() => router.push('/stays/book/confirm')} disabled={!agree} />
      </View>
    </SafeAreaView>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, bold && styles.lineBold]}>{label}</Text>
      <Text style={[styles.lineValue, bold && styles.lineBold]}>{value}</Text>
    </View>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bullet}>
      <View style={styles.dot} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headIcon: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  headTitle: { ...Typography.titleLg, color: Colors.onSurface, flex: 1 },
  card: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  line: { flexDirection: 'row', justifyContent: 'space-between' },
  lineLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  lineValue: { ...Typography.bodyMd, color: Colors.onSurface },
  lineBold: { fontWeight: '800' as const, color: Colors.onSurface },
  divider: { height: 1, backgroundColor: Colors.outlineVariant },
  terms: { gap: Spacing.sm },
  bullet: { flexDirection: 'row', gap: Spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.primary, marginTop: 7 },
  bulletText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  agreeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  checkbox: { width: 26, height: 26, borderRadius: Radius.DEFAULT, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  agreeText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
