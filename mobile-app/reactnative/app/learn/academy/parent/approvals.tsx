import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ShoppingBag, Gift, CreditCard, Check, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import { useApprovals, useDecideApproval } from '@/features/academy/hooks';
import { formatNaira, formatPoints, formatDate } from '@/features/academy/constants';
import type { PurchaseApproval } from '@/features/academy/types';

/** P7 — Purchase approvals: approve/reject child purchases & redemptions (child-safety). */
export default function ApprovalsScreen() {
  const approvals = useApprovals();
  const decide = useDecideApproval();

  if (approvals.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading approvals…" /></SafeAreaView>;

  const pending = approvals.data?.filter((a) => a.status === 'pending') ?? [];
  const decided = approvals.data?.filter((a) => a.status !== 'pending') ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Purchase approvals" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.section}>Awaiting your decision</Text>
        {pending.length ? pending.map((a) => (
          <ApprovalCard key={a.id} a={a} busy={decide.isPending} onDecide={(approve) => decide.mutate({ id: a.id, approve })} />
        )) : (
          <StateView kind="empty" icon="Check" title="All caught up" message="No purchases awaiting approval." compact />
        )}

        {decided.length ? (
          <>
            <Text style={styles.section}>Recent decisions</Text>
            {decided.map((a) => <ApprovalCard key={a.id} a={a} busy={false} />)}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function ApprovalCard({ a, busy, onDecide }: { a: PurchaseApproval; busy: boolean; onDecide?: (approve: boolean) => void }) {
  const Icon = a.kind === 'reward_redeem' ? Gift : a.kind === 'plan' ? CreditCard : ShoppingBag;
  const amount = a.amountKobo != null ? formatNaira(a.amountKobo) : a.pointsCost != null ? formatPoints(a.pointsCost) : '';
  const pending = a.status === 'pending';
  return (
    <View style={[styles.card, shadow1]}>
      <View style={styles.cardTop}>
        <View style={styles.icon}><Icon size={18} color={Colors.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{a.itemLabel}</Text>
          <Text style={styles.sub}>{a.childName} · {formatDate(a.requestedAt)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text style={styles.amount}>{amount}</Text>
          {!pending ? <Chip label={a.status === 'approved' ? 'Approved' : 'Rejected'} color={a.status === 'approved' ? Colors.teal : Colors.error} bg={a.status === 'approved' ? Colors.iconBgTeal : Colors.errorContainer} small /> : null}
        </View>
      </View>
      {pending && onDecide ? (
        <View style={styles.actions}>
          <Pressable style={[styles.btn, styles.reject]} onPress={() => onDecide(false)} disabled={busy}>
            <X size={16} color={Colors.error} /><Text style={[styles.btnText, { color: Colors.error }]}>Reject</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.approve]} onPress={() => onDecide(true)} disabled={busy}>
            <Check size={16} color={Colors.onPrimary} strokeWidth={3} /><Text style={[styles.btnText, { color: Colors.onPrimary }]}>Approve</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  amount: { ...Typography.titleMd, color: Colors.onSurface },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, borderRadius: Radius.md },
  reject: { backgroundColor: Colors.errorContainer },
  approve: { backgroundColor: Colors.primary },
  btnText: { ...Typography.labelMd, fontWeight: '700' },
});
