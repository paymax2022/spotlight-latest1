import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Hourglass, Receipt, CheckCircle2 } from 'lucide-react-native';
import { Colors, Typography, Spacing, Radius } from '@/constants/tokens';
import PrimaryButton from '@/components/PrimaryButton';
import { useDeposits } from '@/features/crypto/hooks/useCrypto';
import { formatCrypto, formatDateTime } from '@/features/crypto/utils/cryptoFormatters';

/**
 * On-chain deposits are credited only after the network reaches the required confirmations and
 * the platform detects + journals the transfer — so this screen is a live watcher, not an instant
 * success. It polls the money-IN history (GET /crypto/deposits) for a credit to this address:
 * while none exists it says "watching"; once the backend has journaled the confirmation-cleared
 * credit it flips to a receipt. The credit is the backend's, never computed here.
 */
export default function DepositPendingScreen() {
  const p = useLocalSearchParams<{ symbol: string; networkName: string; confirmations: string; address?: string }>();
  const symbol = p.symbol ? String(p.symbol) : undefined;
  const address = p.address ? String(p.address) : undefined;

  const { data, isFetching, isError } = useDeposits(symbol, 10_000);
  const credit = useMemo(() => {
    const list = data ?? [];
    const forAddress = address ? list.filter((d) => d.address && d.address.toLowerCase() === address.toLowerCase()) : list;
    // Newest credited first.
    return forAddress[0];
  }, [data, address]);

  if (credit) {
    const decimals = credit.minorUnitScale > 1 ? Math.round(Math.log10(credit.minorUnitScale)) : 0;
    const whole = credit.units / (credit.minorUnitScale || 1);
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <View style={[styles.iconBox, { backgroundColor: Colors.iconBgGreen }]}>
            <CheckCircle2 size={50} color={Colors.teal} strokeWidth={2} />
          </View>
          <Text style={styles.title}>Deposit credited</Text>
          <Text style={styles.sub}>
            {formatCrypto(whole, credit.symbol, decimals)} credited to your crypto wallet.
          </Text>

          <View style={styles.receiptCard}>
            <ReceiptRow label="Confirmed" value={`${credit.confirmations}/${credit.requiredConfs}`} />
            <ReceiptRow label="Network" value={p.networkName ? String(p.networkName) : credit.network} />
            {credit.txHash ? <ReceiptRow label="Tx" value={shortHash(credit.txHash)} mono /> : null}
            <ReceiptRow label="Credited" value={formatDateTime(credit.creditedAt)} />
          </View>
        </View>

        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <Pressable style={styles.receiptBtn} onPress={() => router.replace('/crypto/transactions')} accessibilityRole="button">
            <Receipt size={18} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.receiptText}>View activity</Text>
          </Pressable>
          <PrimaryButton label="Done" onPress={() => router.dismissTo('/crypto')} />
        </SafeAreaView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <View style={styles.iconBox}>
          <Hourglass size={50} color={Colors.onPrimaryFixedVariant} strokeWidth={2} />
        </View>
        <Text style={styles.title}>Watching for your deposit</Text>
        <Text style={styles.sub}>
          Once your {symbol ?? 'crypto'} transfer reaches {p.confirmations ?? 'the required'} confirmations on {p.networkName}, it will be credited to your crypto wallet automatically. This can take a few minutes.
        </Text>

        {isError ? (
          <View style={styles.tipCard}><Text style={styles.tipText}>Couldn&apos;t reach the deposit feed. We&apos;ll keep trying.</Text></View>
        ) : (
          <View style={styles.checkingRow}>
            <ActivityIndicator size="small" color={Colors.secondary} />
            <Text style={styles.checkingText}>Checking for your incoming deposit…</Text>
          </View>
        )}

        <View style={styles.tipCard}>
          <Text style={styles.tipText}>You can safely leave this screen — the credit lands automatically once the network confirms, even after you go back.</Text>
        </View>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Pressable style={styles.receiptBtn} onPress={() => router.replace('/crypto/transactions')} accessibilityRole="button">
          <Receipt size={18} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.receiptText}>View activity</Text>
        </Pressable>
        <PrimaryButton label="Done" onPress={() => router.dismissTo('/crypto')} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

function ReceiptRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.receiptRow}>
      <Text style={styles.receiptLabel}>{label}</Text>
      <Text style={[styles.receiptValue, mono && styles.mono]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function shortHash(h: string): string {
  return h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  iconBox: { width: 104, height: 104, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.sm },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  tipCard: { alignSelf: 'stretch', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.sm },
  tipText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 18 },
  checkingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: Spacing.xs },
  checkingText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  receiptCard: { alignSelf: 'stretch', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.sm, gap: Spacing.xs },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  receiptLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  receiptValue: { ...Typography.labelMd, color: Colors.onSurface, flexShrink: 1 },
  mono: { fontVariant: ['tabular-nums'] },
  footer: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: Spacing.md },
  receiptBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.secondary },
  receiptText: { ...Typography.labelLg, color: Colors.secondary },
});
