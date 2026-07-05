import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { PiggyBank, CheckCircle2, Clock, CircleDashed } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TransparencyNote from '@/features/arena/components/TransparencyNote';
import { usePot } from '@/features/arena/hooks';
import { formatNaira, lastUpdatedLabel, NDC1_SUPPORT_NOTE } from '@/features/arena/constants';

/**
 * S9 — Prize-pot transparency. Shows the DERIVED total (from the contribution
 * ledger — never a stored balance), the published split formula, and per-line
 * disbursement status. Offline-tolerant with a "last updated" stamp.
 */
export default function PotScreen() {
  const { competitionId: raw } = useLocalSearchParams<{ competitionId?: string }>();
  const competitionId = raw ?? '';
  const pot = usePot(competitionId);

  const data = pot.data;

  const disbIcon = (status: string) =>
    status === 'DISBURSED' ? <CheckCircle2 size={16} color={Colors.teal} />
      : status === 'APPROVED' ? <Clock size={16} color={Colors.secondary} />
        : <CircleDashed size={16} color={Colors.outline} />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Prize pot" subtitle="Full transparency" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={pot.isRefetching} onRefresh={pot.refetch} tintColor={Colors.primary} />}
      >
        {pot.isLoading ? (
          <StateView kind="loading" />
        ) : pot.isError || !data ? (
          <StateView kind="error" title="Couldn’t load the pot" actionLabel="Retry" onAction={() => pot.refetch()} />
        ) : (
          <>
            <View style={[styles.totalCard, shadow1]}>
              <View style={styles.totalIcon}><PiggyBank size={26} color={Colors.onPrimary} /></View>
              <Text style={styles.totalValue}>{formatNaira(data.totalKobo)}</Text>
              <Text style={styles.totalSub}>Derived from {data.contributions} contribution{data.contributions === 1 ? '' : 's'}</Text>
              <Text style={styles.stamp}>{lastUpdatedLabel(data.updatedAt)}</Text>
            </View>

            <TransparencyNote>{NDC1_SUPPORT_NOTE}</TransparencyNote>

            {/* Split formula */}
            <View style={[styles.card, shadow1]}>
              <Text style={styles.sectionTitle}>Split formula</Text>
              {data.split.map((s) => (
                <View key={s.label} style={styles.splitRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.splitLabel}>{s.label}</Text>
                    {s.note ? <Text style={styles.splitNote}>{s.note}</Text> : null}
                  </View>
                  <Text style={styles.splitPct}>{Math.round(s.fraction * 100)}%</Text>
                  <Text style={styles.splitAmt}>{formatNaira(Math.round(data.totalKobo * s.fraction))}</Text>
                </View>
              ))}
            </View>

            {/* Disbursements */}
            <View style={[styles.card, shadow1]}>
              <Text style={styles.sectionTitle}>Disbursement status</Text>
              {data.disbursements.length === 0 ? (
                <Text style={styles.muted}>No disbursements yet. Payouts appear here once approved.</Text>
              ) : (
                data.disbursements.map((d, i) => (
                  <View key={`${d.label}-${i}`} style={styles.disbRow}>
                    {disbIcon(d.status)}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.disbLabel}>{d.label}</Text>
                      {d.reference ? <Text style={styles.disbRef}>Ref: {d.reference}</Text> : null}
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.disbAmt}>{formatNaira(d.amountKobo)}</Text>
                      <Text style={styles.disbStatus}>{d.status}</Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md },
  totalCard: { backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center', gap: 2 },
  totalIcon: { width: 48, height: 48, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  totalValue: { ...Typography.displayLg, color: Colors.onPrimary, fontSize: 36, lineHeight: 44 },
  totalSub: { ...Typography.labelSm, color: Colors.inversePrimary },
  stamp: { ...Typography.caption, color: Colors.inverseOnSurface, marginTop: Spacing.xs },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  splitRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: 6 },
  splitLabel: { ...Typography.labelLg, color: Colors.onSurface },
  splitNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  splitPct: { ...Typography.labelMd, color: Colors.secondary, width: 44, textAlign: 'right' },
  splitAmt: { ...Typography.labelMd, color: Colors.onSurface, width: 96, textAlign: 'right' },
  muted: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  disbRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: 6 },
  disbLabel: { ...Typography.labelLg, color: Colors.onSurface },
  disbRef: { ...Typography.caption, color: Colors.onSurfaceVariant },
  disbAmt: { ...Typography.labelMd, color: Colors.onSurface },
  disbStatus: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
