import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CheckSquare, Square } from 'lucide-react-native';
import TextInputField from '@/components/TextInputField';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';

const feeRate = 0;

export function formatNaira(value?: number) {
  return `₦${Number(value ?? 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function calculateBillReview(amount?: number, walletBalance?: number) {
  const serviceAmount = Number(amount ?? 0);
  const fee = Math.round(serviceAmount * feeRate * 100) / 100;
  const totalDebit = serviceAmount + fee;
  const balance = Number(walletBalance ?? 0);
  return {
    serviceAmount,
    fee,
    totalDebit,
    balanceBefore: balance,
    balanceAfter: balance - totalDebit,
    insufficient: balance < totalDebit,
  };
}

interface Props {
  amount?: number;
  walletBalance?: number;
  pin: string;
  onPinChange: (pin: string) => void;
  pinError?: string;
  providerRoute?: string;
  priceWarning?: string;
  saveBeneficiary?: boolean;
  onSaveBeneficiaryChange?: (value: boolean) => void;
}

export default function BillReviewSecurityPanel({
  amount,
  walletBalance,
  pin,
  onPinChange,
  pinError,
  providerRoute = 'Automatic provider failover enabled',
  priceWarning,
  saveBeneficiary,
  onSaveBeneficiaryChange,
}: Props) {
  const review = calculateBillReview(amount, walletBalance);

  return (
    <View style={styles.wrap}>
      <View style={styles.box}>
        <Text style={styles.boxTitle}>Wallet Review</Text>
        <Row label="Wallet balance" value={formatNaira(review.balanceBefore)} />
        <Row label="Service amount" value={formatNaira(review.serviceAmount)} />
        <Row label="Fee" value={formatNaira(review.fee)} />
        <Row label="Total debit" value={formatNaira(review.totalDebit)} strong />
        <Row label="Balance after" value={formatNaira(review.balanceAfter)} warn={review.insufficient} />
        {review.insufficient && (
          <Text style={styles.warning}>Insufficient wallet balance. Add money before confirming this payment.</Text>
        )}
      </View>

      <View style={styles.routeBox}>
        <Text style={styles.routeTitle}>Provider routing</Text>
        <Text style={styles.routeText}>{providerRoute}</Text>
        <Text style={styles.routeHint}>If the primary provider fails, the transaction remains idempotent while the backend retries or fails over.</Text>
      </View>

      {priceWarning ? <Text style={styles.warning}>{priceWarning}</Text> : null}

      {onSaveBeneficiaryChange && (
        <Pressable style={styles.checkRow} onPress={() => onSaveBeneficiaryChange(!saveBeneficiary)}>
          {saveBeneficiary ? <CheckSquare size={20} color={Colors.primary} /> : <Square size={20} color={Colors.outline} />}
          <Text style={styles.checkText}>Save as beneficiary</Text>
        </Pressable>
      )}

      <TextInputField
        label="Transaction PIN"
        placeholder="Enter 4-digit PIN"
        keyboardType="number-pad"
        maxLength={4}
        secure
        value={pin}
        onChangeText={(text) => onPinChange(text.replace(/\D/g, '').slice(0, 4))}
        error={pinError}
      />
    </View>
  );
}

function Row({ label, value, strong, warn }: { label: string; value: string; strong?: boolean; warn?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, strong && styles.strong, warn && styles.warn]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: Spacing.md, gap: Spacing.md },
  box: {
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  boxTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: 3 },
  label: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  value: { ...Typography.labelMd, color: Colors.onSurface, textAlign: 'right', flexShrink: 1 },
  strong: { color: Colors.primary, fontWeight: '800' },
  warn: { color: Colors.error },
  warning: { ...Typography.labelSm, color: Colors.error, lineHeight: 18 },
  routeBox: {
    borderWidth: 1,
    borderColor: Colors.primaryContainer,
    backgroundColor: Colors.primaryFixed,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  routeTitle: { ...Typography.labelMd, color: Colors.primary, fontWeight: '800' },
  routeText: { ...Typography.labelMd, color: Colors.onSurface, marginTop: 2 },
  routeHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 4 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs },
  checkText: { ...Typography.labelMd, color: Colors.onSurface },
});
