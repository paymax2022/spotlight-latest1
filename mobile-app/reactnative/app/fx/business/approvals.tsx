import React from 'react';
import { View, Text, Pressable, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TxStatusBadge from '@/features/fx/components/TxStatusBadge';
import { useApprovals, useDecideApproval } from '@/features/fx/hooks/useFxAccount';
import { formatMoneyObj, relativeTime } from '@/features/fx/utils/fxFormatters';

const STATUS_MAP: Record<string, string> = { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'declined' };

export default function ApprovalsScreen() {
  const { data, isLoading, isError, refetch } = useApprovals();
  const decide = useDecideApproval();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Approval queue" subtitle="Maker–checker" />
      {isLoading ? <StateView kind="loading" /> : isError ? <StateView kind="error" title="Couldn't load approvals" actionLabel="Retry" onAction={() => refetch()} /> : (data ?? []).length === 0 ? (
        <StateView kind="empty" icon="CheckCheck" title="Nothing to approve" message="Payouts and conversions above your thresholds will appear here." />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(a) => a.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const pending = item.status === 'PENDING';
            return (
              <View style={styles.card}>
                <View style={styles.head}>
                  <Text style={styles.amount}>{formatMoneyObj(item.amount)}</Text>
                  <TxStatusBadge status={STATUS_MAP[item.status]} size="sm" />
                </View>
                <Text style={styles.dest}>{item.destination}</Text>
                <Text style={styles.meta}>{item.type.replace('_', ' ')} · {item.reference}</Text>
                <Text style={styles.meta}>By {item.initiator} · {relativeTime(item.createdAt)}</Text>
                {pending ? (
                  <View style={styles.actions}>
                    <Pressable style={[styles.btn, styles.reject]} onPress={() => decide.mutate({ id: item.id, decision: 'REJECTED' })} accessibilityRole="button" accessibilityLabel="Reject">
                      <X size={16} color={Colors.error} strokeWidth={2.2} /><Text style={[styles.btnText, { color: Colors.error }]}>Reject</Text>
                    </Pressable>
                    <Pressable style={[styles.btn, styles.approve]} onPress={() => decide.mutate({ id: item.id, decision: 'APPROVED' })} accessibilityRole="button" accessibilityLabel="Approve">
                      <Check size={16} color={Colors.onPrimary} strokeWidth={2.2} /><Text style={[styles.btnText, { color: Colors.onPrimary }]}>Approve</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  amount: { ...Typography.titleMd, color: Colors.onSurface },
  dest: { ...Typography.bodyMd, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2, textTransform: 'capitalize' },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, borderRadius: Radius.lg },
  reject: { borderWidth: 1.5, borderColor: Colors.error },
  approve: { backgroundColor: Colors.primary },
  btnText: { ...Typography.labelLg },
});
