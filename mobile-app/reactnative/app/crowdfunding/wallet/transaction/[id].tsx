import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useLedgerEntry } from '@/features/crowdfunding/hooks/useExtras';
import { formatNaira } from '@/features/crowdfunding/utils/crowdfundingFormatters';

export default function TransactionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: e, isLoading, isError, refetch } = useLedgerEntry(id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Transaction" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError || !e ? (
        <StateView kind="error" title="Couldn't load transaction" actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View style={styles.head}>
            <Text style={[styles.amount, { color: e.amountKobo >= 0 ? Colors.teal : Colors.onSurface }]}>
              {e.amountKobo >= 0 ? '+' : ''}{formatNaira(e.amountKobo)}
            </Text>
            <Text style={styles.desc}>{e.description}</Text>
          </View>

          <View style={styles.card}>
            <Row k="Type" v={e.type.replace('_', ' ')} />
            <Row k="Status" v={e.status} />
            <Row k="Reference" v={e.reference} />
            <Row k="Balance after" v={formatNaira(e.balanceKobo)} />
            <Row k="Date" v={new Date(e.createdAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })} />
          </View>

          <Text style={styles.note}>This entry is part of the immutable double-entry ledger. Corrections are made via reversing entries only.</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (<View style={styles.row}><Text style={styles.k}>{k}</Text><Text style={styles.v}>{v}</Text></View>);
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60 },
  head: { alignItems: 'center', paddingVertical: Spacing.lg, gap: 4 },
  amount: { ...Typography.displayLg, fontSize: 38, letterSpacing: -0.76, lineHeight: 46 },
  desc: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  k: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  v: { ...Typography.bodyMd, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },
  note: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.lg },
});
