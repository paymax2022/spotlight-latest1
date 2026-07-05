import React from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, Gift, Banknote, Receipt, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TierLimitBar from '@/features/connect/components/TierLimitBar';
import MoneyAmount from '@/features/connect/components/wallet-MoneyAmount';
import WalletEntryRow from '@/features/connect/components/wallet-WalletEntryRow';
import { useWalletSummary, useWalletHistory } from '@/features/connect/wallet/hooks';

// WL-01 — Connect wallet home: balance (kobo projection of the ledger), quick
// actions, tier+limit+remaining bar, recent ledger.
export default function WalletHome() {
  const summary = useWalletSummary();
  const history = useWalletHistory();

  if (summary.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Connect Wallet" />
        <StateView kind="loading" message="Loading your wallet…" />
      </SafeAreaView>
    );
  }
  if (summary.error || !summary.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Connect Wallet" />
        <StateView kind="error" title="Couldn't load wallet" message="Check your connection and try again."
          actionLabel="Retry" onAction={() => summary.refetch()} />
      </SafeAreaView>
    );
  }

  const { balanceKobo, tier } = summary.data;
  const recent = (history.data?.entries ?? []).slice(0, 5);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Connect Wallet" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Wallet balance</Text>
          <MoneyAmount kobo={balanceKobo} size="xl" style={styles.balanceValue} />
          <Text style={styles.balanceHint}>Real Naira · funded from your Paymax wallet</Text>
        </View>

        <View style={styles.actions}>
          <Action icon={<Plus size={20} color={Colors.onPrimary} />} label="Fund" onPress={() => router.push('/connect/wallet/fund')} primary />
          <Action icon={<Gift size={20} color={Colors.primary} />} label="Gift" onPress={() => router.push('/connect/wallet/gifting/catalog')} />
          <Action icon={<Banknote size={20} color={Colors.primary} />} label="Payout" onPress={() => router.push('/connect/wallet/payouts/intro')} />
          <Action icon={<Receipt size={20} color={Colors.primary} />} label="History" onPress={() => router.push('/connect/wallet/history')} />
        </View>

        <TierLimitBar tier={tier} />

        <Pressable style={styles.tierLink} onPress={() => router.push('/connect/wallet/tier/status')}>
          <Text style={styles.tierLinkText}>Manage tier & verification</Text>
          <ChevronRight size={16} color={Colors.primary} />
        </Pressable>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent activity</Text>
          <Pressable onPress={() => router.push('/connect/wallet/history')} hitSlop={8}>
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        </View>

        {history.isLoading ? (
          <StateView kind="loading" compact message="Loading activity…" />
        ) : recent.length === 0 ? (
          <StateView kind="empty" compact icon="Receipt" title="No activity yet"
            message="Fund your wallet or send a gift to get started." />
        ) : (
          <View style={styles.list}>
            {recent.map((e) => (
              <WalletEntryRow key={e.id} entry={e}
                onPress={() => router.push({ pathname: '/connect/wallet/transaction-detail', params: { id: e.id } })} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Action({ icon, label, onPress, primary }: { icon: React.ReactNode; label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable onPress={onPress} style={styles.actionItem}>
      <View style={[styles.actionIcon, primary ? styles.actionIconPrimary : styles.actionIconGhost]}>{icon}</View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  balanceCard: {
    backgroundColor: Colors.primaryContainer,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    marginTop: Spacing.sm,
  },
  balanceLabel: { ...Typography.labelMd, color: Colors.onPrimaryContainer },
  balanceValue: { color: Colors.onPrimaryContainer, marginTop: Spacing.xs },
  balanceHint: { ...Typography.labelSm, color: Colors.onPrimaryContainer, marginTop: Spacing.xs, opacity: 0.8 },
  actions: { flexDirection: 'row', justifyContent: 'space-between' },
  actionItem: { alignItems: 'center', gap: Spacing.xs, flex: 1 },
  actionIcon: { width: 52, height: 52, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  actionIconPrimary: { backgroundColor: Colors.primary },
  actionIconGhost: { backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  actionLabel: { ...Typography.labelSm, color: Colors.onSurface },
  tierLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: Spacing.xs },
  tierLinkText: { ...Typography.labelMd, color: Colors.primary },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  seeAll: { ...Typography.labelMd, color: Colors.primary },
  list: { gap: 2 },
});
