import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Clock, Receipt } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { useAssets } from '@/features/crypto/hooks/useCrypto';
import { formatCrypto } from '@/features/crypto/utils/cryptoFormatters';

function maskAddress(value: string): string {
  const v = value.replace(/\s/g, '');
  return v.length <= 16 ? v : `${v.slice(0, 10)}…${v.slice(-6)}`;
}

/**
 * Terminal state for an MVP crypto withdrawal: submitted and awaiting compliance
 * review (never broadcast straight away). This is the "success-equivalent" — the
 * request is accepted, funds are locked, and the user is told what happens next.
 */
export default function WithdrawPendingScreen() {
  const p = useLocalSearchParams<{ reference: string; symbol: string; amount: string; address: string; networkName: string; mins: string }>();
  const assets = useAssets();
  const decimals = assets.data?.find((a) => a.symbol === p.symbol)?.decimals ?? 8;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <View style={styles.iconBox}>
          <Clock size={52} color={Colors.onPrimaryFixedVariant} strokeWidth={2} />
        </View>
        <Text style={styles.title}>Withdrawal submitted</Text>
        <Text style={styles.sub}>
          {formatCrypto(Number(p.amount), p.symbol, decimals)} is pending compliance review. We'll broadcast it to {p.networkName} once approved — usually within {p.mins ?? 30} minutes.
        </Text>

        <View style={styles.detailCard}>
          <Detail label="To" value={maskAddress(p.address ?? '')} />
          <Detail label="Network" value={p.networkName} />
          <Detail label="Reference" value={p.reference} />
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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  iconBox: { width: 104, height: 104, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.sm },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  detailCard: { alignSelf: 'stretch', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, marginTop: Spacing.sm },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  detailLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  detailValue: { ...Typography.labelMd, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },
  footer: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: Spacing.md },
  receiptBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.secondary },
  receiptText: { ...Typography.labelLg, color: Colors.secondary },
});
