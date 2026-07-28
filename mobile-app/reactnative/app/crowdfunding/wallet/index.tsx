import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Snowflake, ArrowDownToLine, ReceiptText, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useCampaignWallet, useLedger } from '@/features/crowdfunding/hooks/useExtras';
import { formatNaira, formatNairaCompact, relativeTime } from '@/features/crowdfunding/utils/crowdfundingFormatters';
import type { LedgerEntryType } from '@/features/crowdfunding/types/crowdfunding.types';

const SIGN_COLOR = (amt: number) => (amt >= 0 ? Colors.teal : Colors.onSurface);
const TYPE_LABEL: Record<LedgerEntryType, string> = {
  CONTRIBUTION: 'Contribution', WITHDRAWAL: 'Withdrawal', PLATFORM_FEE: 'Fee',
  REFUND: 'Refund', REVERSAL: 'Reversal', MILESTONE_RELEASE: 'Milestone release',
};

export default function CampaignWalletScreen() {
  const wallet = useCampaignWallet();
  const ledger = useLedger();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Campaign wallet" />
      {wallet.isLoading ? (
        <StateView kind="loading" />
      ) : wallet.isError || !wallet.data ? (
        <StateView kind="error" title="Couldn't load wallet" actionLabel="Retry" onAction={() => wallet.refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          <Text style={styles.campaign}>{wallet.data.campaignTitle}</Text>

          {wallet.data.frozen && (
            <View style={styles.frozen}>
              <Snowflake size={18} color={Colors.error} strokeWidth={2} />
              <Text style={styles.frozenText}>This wallet is frozen pending review. Withdrawals are paused.</Text>
            </View>
          )}

          {/* Balance card */}
          <View style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>Available balance</Text>
            <Text style={styles.balanceValue}>{formatNaira(wallet.data.availableKobo)}</Text>
            <View style={styles.balRow}>
              <Bal label="Pending" value={formatNairaCompact(wallet.data.pendingKobo)} />
              <View style={styles.balDivider} />
              <Bal label="Escrow" value={formatNairaCompact(wallet.data.escrowKobo)} />
              <View style={styles.balDivider} />
              <Bal label="Withdrawn" value={formatNairaCompact(wallet.data.totalWithdrawnKobo)} />
            </View>
          </View>

          <View style={styles.actions}>
            <View style={{ flex: 1 }}>
              <PrimaryButton
                label="Withdraw"
                onPress={() => router.push('/crowdfunding/wallet/withdraw')}
                disabled={wallet.data.frozen || wallet.data.availableKobo <= 0}
              />
            </View>
            <Pressable style={styles.ledgerBtn} onPress={() => router.push('/crowdfunding/wallet/ledger')} accessibilityRole="button">
              <ReceiptText size={18} color={Colors.secondary} strokeWidth={2} />
              <Text style={styles.ledgerBtnText}>Ledger</Text>
            </Pressable>
          </View>

          {/* Recent ledger preview */}
          <View style={styles.recentHead}>
            <Text style={styles.recentTitle}>Recent activity</Text>
            <Pressable onPress={() => router.push('/crowdfunding/wallet/ledger')} hitSlop={8}><Text style={styles.seeAll}>See all</Text></Pressable>
          </View>
          <View style={styles.recentCard}>
            {ledger.isLoading ? (
              <StateView kind="loading" compact />
            ) : (ledger.data ?? []).slice(0, 5).map((e, i, arr) => (
              <Pressable key={e.id} style={[styles.row, i < arr.length - 1 && styles.rowBorder]} onPress={() => router.push(`/crowdfunding/wallet/transaction/${e.id}`)} accessibilityRole="button">
                <View style={styles.rowIcon}><ArrowDownToLine size={16} color={SIGN_COLOR(e.amountKobo)} strokeWidth={2} /></View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowDesc} numberOfLines={1}>{e.description}</Text>
                  <Text style={styles.rowMeta}>{TYPE_LABEL[e.type]} · {relativeTime(e.createdAt)}</Text>
                </View>
                <Text style={[styles.rowAmount, { color: SIGN_COLOR(e.amountKobo) }]}>{e.amountKobo >= 0 ? '+' : ''}{formatNaira(e.amountKobo)}</Text>
                <ChevronRight size={16} color={Colors.outline} strokeWidth={2} />
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Bal({ label, value }: { label: string; value: string }) {
  return (<View style={styles.bal}><Text style={styles.balLabel}>{label}</Text><Text style={styles.balValue}>{value}</Text></View>);
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60 },
  campaign: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  frozen: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.errorContainer, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md },
  frozenText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  balanceCard: { backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg },
  balanceLabel: { ...Typography.labelMd, color: Colors.inversePrimary },
  balanceValue: { ...Typography.headlineLg, color: Colors.onPrimary, marginTop: 2 },
  balRow: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.md },
  bal: { flex: 1 },
  balLabel: { ...Typography.caption, color: Colors.inversePrimary },
  balValue: { ...Typography.labelLg, color: Colors.onPrimary, marginTop: 2 },
  balDivider: { width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.2)' },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  ledgerBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: Spacing.lg, height: 56, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.secondary },
  ledgerBtnText: { ...Typography.labelLg, color: Colors.secondary },
  recentHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.lg, marginBottom: Spacing.sm },
  recentTitle: { ...Typography.titleMd, color: Colors.onSurface },
  seeAll: { ...Typography.labelMd, color: Colors.secondary },
  recentCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  rowIcon: { width: 34, height: 34, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1 },
  rowDesc: { ...Typography.labelMd, color: Colors.onSurface },
  rowMeta: { ...Typography.caption, color: Colors.onSurfaceVariant },
  rowAmount: { ...Typography.labelMd },
});
