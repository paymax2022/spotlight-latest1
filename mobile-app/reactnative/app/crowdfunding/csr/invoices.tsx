import React from 'react';
import { FlatList, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FileText, Download } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useInvoices } from '@/features/crowdfunding/hooks/useCsr';
import { formatNaira } from '@/features/crowdfunding/utils/crowdfundingFormatters';

export default function CsrInvoicesScreen() {
  const { data, isLoading, isError, refetch } = useInvoices();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Receipts & invoices" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load invoices" actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.iconBox}><FileText size={20} color={Colors.secondary} strokeWidth={2} /></View>
              <View style={styles.body}>
                <View style={styles.head}>
                  <Text style={styles.desc} numberOfLines={1}>{item.description}</Text>
                  <View style={[styles.chip, item.status === 'PAID' ? styles.chipPaid : styles.chipDue]}>
                    <Text style={[styles.chipText, { color: item.status === 'PAID' ? Colors.tertiaryContainer : '#B65A00' }]}>{item.status}</Text>
                  </View>
                </View>
                <Text style={styles.meta}>{item.reference} · {new Date(item.issuedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                <Text style={styles.total}>{formatNaira(item.totalKobo)} <Text style={styles.vat}>(incl. {formatNaira(item.vatKobo)} VAT)</Text></Text>
              </View>
              <Pressable hitSlop={8} accessibilityRole="button" accessibilityLabel="Download invoice"><Download size={18} color={Colors.outline} strokeWidth={2} /></Pressable>
            </View>
          )}
          ListEmptyComponent={<StateView kind="empty" icon="ReceiptText" title="No invoices yet" message="Invoices for your CSR matches appear here." />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: 60, flexGrow: 1 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  desc: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  chip: { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  chipPaid: { backgroundColor: Colors.iconBgTeal },
  chipDue: { backgroundColor: Colors.iconBgOrange },
  chipText: { ...Typography.caption, fontWeight: '700' as const },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  total: { ...Typography.labelMd, color: Colors.onSurface },
  vat: { ...Typography.labelSm, color: Colors.onSurfaceVariant, fontWeight: '400' as const },
});
