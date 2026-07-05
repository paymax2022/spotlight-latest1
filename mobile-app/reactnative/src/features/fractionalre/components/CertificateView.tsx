import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ScrollText, BadgeCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { formatNaira, relativeDate } from '../utils';
import type { Certificate } from '../types';

/** Read-only ownership certificate card (subscription confirmation §8.D.8). */
export default function CertificateView({ certificate }: { certificate: Certificate }) {
  return (
    <View style={styles.cert}>
      <View style={styles.header}>
        <ScrollText size={22} color={Colors.primary} strokeWidth={2} />
        <Text style={styles.headerText}>Certificate of Fractional Ownership</Text>
      </View>

      <View style={styles.divider} />

      <Row label="Certificate no." value={certificate.certificateNo} mono />
      <Row label="Offering" value={certificate.offeringTitle} />
      <Row label="SPV" value={certificate.spvName} />
      <Row label="Units held" value={String(certificate.units)} />
      <Row label="Amount invested" value={formatNaira(certificate.amountKobo)} accent />
      <Row label="Issued" value={relativeDate(certificate.issuedAt)} />

      <View style={styles.footerRow}>
        <BadgeCheck size={14} color={Colors.teal} strokeWidth={2} />
        <Text style={styles.footerText}>Recorded on the SPV register. Your interest is held in {certificate.spvName}.</Text>
      </View>
    </View>
  );
}

function Row({ label, value, accent, mono }: { label: string; value: string; accent?: boolean; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowVal, accent && styles.accent, mono && styles.mono]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cert: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.lg,
    borderWidth: 1.5, borderColor: Colors.primaryContainer, gap: Spacing.sm,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  headerText: { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  divider: { height: 1, backgroundColor: Colors.outlineVariant, marginVertical: Spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.md },
  rowLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  rowVal: { ...Typography.labelMd, color: Colors.onSurface, flex: 1, textAlign: 'right' },
  accent: { color: Colors.primary },
  mono: { letterSpacing: 0.5 },
  footerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: Spacing.sm },
  footerText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 16 },
});
