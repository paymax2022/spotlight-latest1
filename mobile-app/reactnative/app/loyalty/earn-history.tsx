import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Wallet, ReceiptText, Ticket, PiggyBank, Users, Gift, Star } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { usePointsLedger } from '@/features/loyalty/hooks';
import { LoyaltyColors, formatPoints } from '@/features/loyalty/constants/loyalty.constants';
import type { EarnSource } from '@/features/loyalty/types';

const SOURCE_META: Record<EarnSource, { Icon: typeof Wallet; color: string }> = {
  wallet:   { Icon: Wallet,      color: LoyaltyColors.accent },
  bills:    { Icon: ReceiptText, color: LoyaltyColors.accent },
  events:   { Icon: Ticket,      color: '#A855F7' },
  savings:  { Icon: PiggyBank,   color: LoyaltyColors.ok },
  referral: { Icon: Users,       color: LoyaltyColors.ok },
  signup:   { Icon: Star,        color: LoyaltyColors.brand },
  redeem:   { Icon: Gift,        color: LoyaltyColors.muted },
};

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function EarnHistory() {
  const { data, isLoading, isError, refetch } = usePointsLedger();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Points history" />
      {isLoading ? (
        <StateView kind="loading" message="Loading history…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load history" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : (data?.length ?? 0) === 0 ? (
        <StateView kind="empty" title="No points yet" message="Use Paymax services to start earning points." icon="Sparkles" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.note}><Text style={styles.noteText}>Points are promotional and not cash.</Text></View>
          <View style={styles.list}>
            {data!.map((e) => {
              const meta = SOURCE_META[e.source];
              const earned = e.points >= 0;
              return (
                <View key={e.id} style={styles.row}>
                  <View style={[styles.icon, { backgroundColor: LoyaltyColors.surfaceAlt }]}>
                    <meta.Icon size={18} color={meta.color} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label} numberOfLines={1}>{e.label}</Text>
                    <Text style={styles.date}>{dateLabel(e.atISO)}</Text>
                  </View>
                  <Text style={[styles.points, { color: earned ? LoyaltyColors.ok : LoyaltyColors.muted }]}>
                    {earned ? '+' : ''}{formatPoints(e.points)}
                  </Text>
                </View>
              );
            })}
          </View>
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.sm },
  note: { backgroundColor: LoyaltyColors.brandBg, borderRadius: Radius.md, padding: Spacing.sm, alignItems: 'center' },
  noteText: { ...Typography.caption, color: LoyaltyColors.brandText },
  list: { backgroundColor: LoyaltyColors.surface, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, ...shadow1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: LoyaltyColors.border },
  icon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  label: { ...Typography.labelMd, color: LoyaltyColors.text },
  date: { ...Typography.caption, color: LoyaltyColors.muted, marginTop: 2 },
  points: { ...Typography.labelLg },
});
