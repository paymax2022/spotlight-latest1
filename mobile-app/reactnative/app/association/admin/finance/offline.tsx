import React from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Receipt, Check, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useOfflinePayments, useDecideOfflinePayment } from '@/features/association/hooks/useAdmin';
import { formatNaira, relativeTime } from '@/features/association/utils/associationFormatters';
import type { OfflinePayment } from '@/features/association/types/admin.types';

export default function OfflinePayments() {
  const payments = useOfflinePayments();
  const decide = useDecideOfflinePayment();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Offline payments" />
      {payments.isLoading ? (
        <StateView kind="loading" message="Loading payments…" />
      ) : payments.isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => payments.refetch()} />
      ) : (payments.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="CheckCircle2" title="All clear" message="No offline payments awaiting approval." />
      ) : (
        <FlatList
          data={payments.data ?? []}
          keyExtractor={(p) => p.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          renderItem={({ item }) => (
            <PaymentCard
              payment={item}
              busy={decide.isPending && decide.variables?.id === item.id}
              onApprove={() => decide.mutate({ id: item.id, approve: true })}
              onReject={() => decide.mutate({ id: item.id, approve: false })}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function PaymentCard({ payment: p, busy, onApprove, onReject }: { payment: OfflinePayment; busy: boolean; onApprove: () => void; onReject: () => void }) {
  return (
    <View style={[styles.card, shadow1]}>
      <View style={styles.head}>
        <View style={styles.iconBox}><Receipt size={18} color={Colors.primary} strokeWidth={2} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{p.memberName}</Text>
          <Text style={styles.meta}>{p.memberId}</Text>
        </View>
        <Text style={styles.amount}>{formatNaira(p.amountKobo)}</Text>
      </View>
      <View style={styles.detail}>
        <Text style={styles.detailText}>{p.forItem} · {p.method}</Text>
        <Text style={styles.detailText}>Ref {p.reference} · {relativeTime(p.submittedAt)}</Text>
      </View>
      <View style={styles.actions}>
        <Pressable style={[styles.btn, styles.reject]} onPress={onReject} disabled={busy} accessibilityRole="button" accessibilityLabel={`Reject payment from ${p.memberName}`}>
          <X size={16} color={Colors.error} strokeWidth={2.4} />
          <Text style={[styles.btnText, { color: Colors.error }]}>Reject</Text>
        </Pressable>
        <Pressable style={[styles.btn, styles.approve]} onPress={onApprove} disabled={busy} accessibilityRole="button" accessibilityLabel={`Approve payment from ${p.memberName}`}>
          <Check size={16} color={Colors.onPrimary} strokeWidth={2.4} />
          <Text style={[styles.btnText, { color: Colors.onPrimary }]}>Approve</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 120 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  amount: { ...Typography.titleMd, color: Colors.onSurface },
  detail: { gap: 2 },
  detailText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, borderRadius: Radius.md },
  reject: { backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.error },
  approve: { backgroundColor: Colors.primary },
  btnText: { ...Typography.labelMd, fontWeight: '700' as const },
});
