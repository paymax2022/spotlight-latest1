import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CircleAlert, RotateCcw, Wallet } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { InsuranceColors, formatNaira } from '@/features/insurance/constants/insurance.constants';

/**
 * Bind failure / auto-refund notice (PRD §10.1 — the key invariant: a successful
 * premium debit must never leave the user without cover AND without a refund).
 */
export default function PayFailure() {
  const { reason, refund } = useLocalSearchParams<{ reason?: string; refund?: string }>();
  const refundKobo = Number(refund ?? 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.body}>
        <View style={styles.iconBox}><CircleAlert size={40} color={Colors.error} strokeWidth={2} /></View>
        <Text style={styles.title}>Cover couldn't be activated</Text>
        <Text style={styles.subtitle}>
          {reason ?? 'The policy could not be bound with the underwriter.'}
        </Text>

        {/* Auto-refund notice */}
        <View style={styles.refundCard}>
          <View style={styles.refundIcon}><RotateCcw size={20} color={InsuranceColors.ok} strokeWidth={2.2} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.refundTitle}>Premium refunded automatically</Text>
            <Text style={styles.refundText}>
              {refundKobo > 0
                ? `${formatNaira(refundKobo)} has been refunded to your wallet.`
                : 'Your premium has been refunded to your wallet.'}{' '}
              You were not left paying for cover you didn't get.
            </Text>
          </View>
        </View>

        <View style={styles.walletRow}>
          <Wallet size={15} color={InsuranceColors.muted} />
          <Text style={styles.walletText}>Refunds reflect in your wallet balance immediately.</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <PrimaryButton label="Try again" onPress={() => router.replace('/insurance/browse')} />
        <PrimaryButton label="Go to my policies" variant="secondary" onPress={() => router.replace('/insurance/policies')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { flex: 1, paddingHorizontal: Spacing.containerMargin, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  iconBox: { width: 80, height: 80, borderRadius: Radius.full, backgroundColor: Colors.errorContainer, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  subtitle: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  refundCard: { flexDirection: 'row', gap: Spacing.md, width: '100%', backgroundColor: InsuranceColors.okBg, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.sm },
  refundIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center' },
  refundTitle: { ...Typography.labelLg, color: Colors.onSurface },
  refundText: { ...Typography.bodySm, color: Colors.onSurface, marginTop: 2, lineHeight: 20 },
  walletRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  walletText: { ...Typography.labelSm, color: InsuranceColors.muted },
  footer: { padding: Spacing.containerMargin, gap: Spacing.sm },
});
