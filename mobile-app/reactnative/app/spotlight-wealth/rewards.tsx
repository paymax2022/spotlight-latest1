import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowUpRight, ArrowDownLeft } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SectionHeader from '@/components/SectionHeader';
import StateView from '@/components/StateView';
import RewardWalletCard from '@/features/spotlightwealth/components/RewardWalletCard';
import CreatorDisclaimer from '@/features/spotlightwealth/components/CreatorDisclaimer';
import { useRewardWallet } from '@/features/spotlightwealth/hooks/useSpotlight';
import { REWARD_DISCLAIMER } from '@/features/spotlightwealth/constants/spotlight.constants';
import { formatMoney, formatTimeAgo } from '@/features/spotlightwealth/utils/spotlightFormatters';

export default function RewardsScreen() {
  const wallet = useRewardWallet();
  const history = wallet.data?.history ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Reward wallet" subtitle="Credit earned from learning" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={wallet.isRefetching} onRefresh={() => wallet.refetch()} tintColor={Colors.primary} />}
      >
        {wallet.isLoading ? (
          <StateView kind="loading" message="Loading reward wallet…" />
        ) : wallet.isError ? (
          <StateView kind="error" title="Couldn't load reward wallet" message="Please check your connection and try again." actionLabel="Retry" onAction={() => wallet.refetch()} />
        ) : (
          <>
            <View style={styles.heroWrap}>
              <RewardWalletCard wallet={wallet.data!} />
            </View>

            <View style={styles.disclaimer}>
              <CreatorDisclaimer text={REWARD_DISCLAIMER} />
            </View>

            <View style={styles.section}>
              <SectionHeader title="History" />
              {history.length === 0 ? (
                <StateView kind="empty" icon="Receipt" title="No reward activity yet" message="Earned and redeemed credit will appear here." compact />
              ) : (
                <View style={[styles.card, shadow1]}>
                  {history.map((h, i, arr) => {
                    const credit = h.amount.amount >= 0;
                    return (
                      <View key={h.id}>
                        <View style={styles.histRow}>
                          <View style={[styles.histIcon, credit ? styles.histIconCredit : styles.histIconDebit]}>
                            {credit
                              ? <ArrowDownLeft size={16} color={Colors.tertiaryContainer} strokeWidth={2} />
                              : <ArrowUpRight size={16} color={Colors.secondary} strokeWidth={2} />}
                          </View>
                          <View style={styles.flex}>
                            <Text style={styles.histLabel} numberOfLines={1}>{h.label}</Text>
                            <Text style={styles.histTime}>{formatTimeAgo(h.at)}</Text>
                          </View>
                          <Text style={[styles.histAmount, credit ? styles.amountCredit : styles.amountDebit]}>
                            {formatMoney(h.amount, { signed: true })}
                          </Text>
                        </View>
                        {i < arr.length - 1 ? <View style={styles.divider} /> : null}
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl, paddingTop: Spacing.sm },
  flex: { flex: 1 },
  heroWrap: { marginHorizontal: Spacing.containerMargin },
  disclaimer: { marginHorizontal: Spacing.containerMargin, marginTop: Spacing.md },
  section: { marginTop: Spacing.lg },
  card: {
    marginHorizontal: Spacing.containerMargin,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm + 2 },
  histIcon: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  histIconCredit: { backgroundColor: Colors.iconBgTeal },
  histIconDebit: { backgroundColor: Colors.iconBgBlue },
  histLabel: { ...Typography.labelLg, color: Colors.onSurface },
  histTime: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  histAmount: { ...Typography.labelLg },
  amountCredit: { color: Colors.tertiaryContainer },
  amountDebit: { color: Colors.onSurface },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerLow },
});
