import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { ShieldCheck, ShieldX } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useVerifyCredential } from '@/features/academy/hooks';
import { formatDate } from '@/features/academy/constants';

/**
 * G11 — Public credential verification. This is the destination a QR scan / verify
 * link resolves to: GET /credentials/verify/:verificationId returns a tamper-evident
 * valid/invalid payload with only the displayed recipient name (no other PII).
 */
export default function VerifyCredentialScreen() {
  const { verificationId } = useLocalSearchParams<{ verificationId: string }>();
  const v = useVerifyCredential(verificationId);

  if (v.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Verifying…" /></SafeAreaView>;
  if (v.isError || !v.data) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="error" title="Verification failed" message="Could not reach the verification service." actionLabel="Retry" onAction={() => v.refetch()} /></SafeAreaView>;

  const d = v.data;
  const valid = d.valid;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Verify credential" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.statusCard, { backgroundColor: valid ? Colors.iconBgTeal : Colors.errorContainer }]}>
          {valid ? <ShieldCheck size={40} color={Colors.teal} /> : <ShieldX size={40} color={Colors.error} />}
          <Text style={[styles.statusTitle, { color: valid ? Colors.teal : Colors.error }]}>{valid ? 'Valid credential' : 'Not found / invalid'}</Text>
          <Text style={styles.statusSub}>Checked {formatDate(d.verifiedAt)}</Text>
        </View>

        {valid ? (
          <View style={[styles.card, shadow1]}>
            <Row label="Credential" value={d.title} />
            <Row label="Awarded to" value={d.recipientName} />
            <Row label="Issuer" value={d.issuer} />
            <Row label="Type" value={d.kind === 'trade' ? 'Trade credential' : 'Academic'} />
            {d.scorePct != null ? <Row label="Score" value={`${d.scorePct}%`} /> : null}
            <Row label="Issued" value={formatDate(d.issuedAt)} />
            <Row label="Verification ID" value={d.verificationId} last />
          </View>
        ) : (
          <Text style={styles.note}>No credential matches ID {verificationId}. It may be mistyped or revoked.</Text>
        )}

        <Text style={styles.privacy}>This public check shows only the awarded name and issuance facts — no other personal data is exposed.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  statusCard: { borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center', gap: 4 },
  statusTitle: { ...Typography.titleLg },
  statusSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, paddingHorizontal: Spacing.cardPadding },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant },
  rowLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  rowValue: { ...Typography.labelMd, color: Colors.onSurface, flex: 1, textAlign: 'right' },
  note: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  privacy: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
});
