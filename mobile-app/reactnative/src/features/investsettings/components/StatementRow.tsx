import React from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { FileText, Download } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import type { Statement } from '../types/settings.types';
import { formatDate } from './format';

interface Props {
  statement: Statement;
  onExport: () => void;
  exporting?: boolean;
}

const KIND_LABEL: Record<Statement['kind'], string> = {
  monthly: 'Monthly statement',
  annual: 'Annual statement',
  tax: 'Tax document',
};

export default function StatementRow({ statement, onExport, exporting }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.iconBox}>
        <FileText size={20} color={Colors.primary} strokeWidth={1.8} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.period}>{statement.period}</Text>
        <Text style={styles.meta}>
          {KIND_LABEL[statement.kind]} · {formatDate(statement.createdAt)}
        </Text>
      </View>
      <Pressable
        onPress={onExport}
        disabled={exporting}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Export ${statement.period}`}
        style={styles.exportBtn}
      >
        {exporting
          ? <ActivityIndicator size="small" color={Colors.secondary} />
          : <Download size={18} color={Colors.secondary} strokeWidth={2} />}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  iconBox: {
    width: 40, height: 40, borderRadius: Radius.md,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.iconBgPurple,
  },
  flex: { flex: 1 },
  period: { ...Typography.labelLg, color: Colors.onSurface },
  meta: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  exportBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
