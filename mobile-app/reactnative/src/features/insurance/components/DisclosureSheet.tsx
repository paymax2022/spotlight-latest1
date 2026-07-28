import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView } from 'react-native';
import { X, ShieldCheck, Building2, FileText } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { InsuranceColors } from '../constants/insurance.constants';
import type { Disclosure } from '../types';

/**
 * Underwriter disclosure bottom sheet (PRD §5/§15.1). Explains the
 * Partnering-Insurtech model: Paymax distributes, a NAICOM-licensed insurer
 * underwrites, an aggregator intermediates. Reused by IM2.
 */
export default function DisclosureSheet({
  visible,
  disclosure,
  onClose,
}: {
  visible: boolean;
  disclosure: Disclosure | null;
  onClose: () => void;
}) {
  if (!disclosure) return null;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.handleRow}>
            <Text style={styles.title}>Who provides this cover</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
              <X size={22} color={Colors.onSurfaceVariant} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
            <Row
              icon={<ShieldCheck size={20} color={InsuranceColors.ok} />}
              title="Underwritten by"
              value={disclosure.underwriter}
              note="A NAICOM-licensed insurer carries the risk and pays valid claims."
            />
            <Row
              icon={<Building2 size={20} color={InsuranceColors.accent} />}
              title="Distributed via"
              value={disclosure.aggregator}
              note="An embedded-insurance aggregator that connects Paymax to the insurer."
            />
            <Row
              icon={<FileText size={20} color={InsuranceColors.muted} />}
              title="Paymax's role"
              value="Distribution channel"
              note="Paymax does not underwrite or hold your premium beyond settlement. Premium is passed through to the underwriter; Paymax earns only a distribution commission."
            />

            <View style={styles.regBox}>
              <Text style={styles.regText}>
                Operated as a Partnering Insurtech under the NAICOM Insurtech Operations Guidelines
                and NIIRA 2025. Your data is shared with the provider only with your consent (NDPA 2023).
              </Text>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Row({
  icon,
  title,
  value,
  note,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  note: string;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowValue}>{value}</Text>
        <Text style={styles.rowNote}>{note}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(11,28,48,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
    maxHeight: '80%',
  },
  handleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  body: { gap: Spacing.lg },
  row: { flexDirection: 'row', gap: Spacing.md },
  rowIcon: {
    width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerLow,
  },
  rowTitle: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.4 },
  rowValue: { ...Typography.titleMd, color: Colors.onSurface, marginTop: 2 },
  rowNote: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 4 },
  regBox: { backgroundColor: InsuranceColors.okBg, borderRadius: Radius.md, padding: Spacing.md },
  regText: { ...Typography.bodySm, color: Colors.onSurface, lineHeight: 20 },
});
