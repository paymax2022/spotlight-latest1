import React from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2, Download } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useReceipt } from '@/features/association/hooks/useAssociation';
import { formatNaira, formatDateTime } from '@/features/association/utils/associationFormatters';

export default function ReceiptScreen() {
  const { receiptId } = useLocalSearchParams<{ receiptId: string }>();
  const receipt = useReceipt(receiptId);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Receipt" showBack onBack={() => router.replace('/association/dues')} />
      {receipt.isLoading ? (
        <StateView kind="loading" message="Loading receipt…" />
      ) : receipt.isError || !receipt.data ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => receipt.refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {/* Success header */}
          <View style={styles.successWrap}>
            <View style={styles.successIcon}><CheckCircle2 size={36} color={Colors.teal} strokeWidth={2} /></View>
            <Text style={styles.successTitle}>Payment successful</Text>
            <Text style={styles.successAmount}>{formatNaira(receipt.data.amountKobo)}</Text>
          </View>

          {/* Detail card */}
          <View style={[styles.card, shadow1]}>
            <Row label="Reference" value={receipt.data.reference} mono />
            <Row label="Paid for" value={receipt.data.invoiceTitle} />
            <Row label="Member" value={receipt.data.memberName} />
            <Row label="Organisation" value={receipt.data.organisationName} />
            <Row label="Method" value={receipt.data.method === 'WALLET' ? 'Wallet' : 'Card / Paystack'} />
            <Row label="Date" value={formatDateTime(receipt.data.paidAt)} />
          </View>

          {/* Revenue split */}
          <Text style={styles.sectionTitle}>Revenue split</Text>
          <View style={[styles.card, shadow1]}>
            {receipt.data.split.map((s) => (
              <Row key={s.label} label={s.label} value={formatNaira(s.amountKobo)} />
            ))}
          </View>
        </ScrollView>
      )}

      {receipt.data ? (
        <View style={styles.footer}>
          <PrimaryButton
            label="Download"
            variant="secondary"
            fullWidth={false}
            style={styles.footerBtn}
            onPress={() => Alert.alert('Download', 'Download is not available in this preview build.')}
          />
          <PrimaryButton label="Done" fullWidth={false} style={styles.footerBtn} onPress={() => router.replace('/association/home')} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.mono]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 140, gap: Spacing.md },
  successWrap: { alignItems: 'center', gap: 6, paddingVertical: Spacing.lg },
  successIcon: { width: 72, height: 72, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  successTitle: { ...Typography.titleMd, color: Colors.onSurface },
  successAmount: { ...Typography.headlineLg, color: Colors.onSurface },
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  rowLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  rowValue: { ...Typography.bodyMd, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },
  mono: { letterSpacing: 0.5 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  footer: {
    flexDirection: 'row', gap: Spacing.sm,
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg,
    backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant,
  },
  footerBtn: { flex: 1 },
});
