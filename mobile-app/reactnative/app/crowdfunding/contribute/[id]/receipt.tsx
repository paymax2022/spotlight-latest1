import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Receipt as ReceiptIcon, Clock, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { useCampaign } from '@/features/crowdfunding/hooks/useCrowdfunding';

export default function ReceiptScreen() {
  const { id, reference, pending } = useLocalSearchParams<{ id: string; reference: string; pending?: string }>();
  const { data: c } = useCampaign(id);
  const isPending = pending === '1';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Receipt" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.statusHead}>
          <View style={[styles.statusIcon, isPending ? styles.statusIconPending : styles.statusIconOk]}>
            {isPending ? <Clock size={28} color={'#B65A00'} strokeWidth={2} /> : <CircleCheck size={28} color={Colors.tertiaryContainer} strokeWidth={2} />}
          </View>
          <Text style={styles.statusLabel}>{isPending ? 'Awaiting payment' : 'Contribution successful'}</Text>
          {isPending && <Text style={styles.statusSub}>Complete your bank transfer / USSD to confirm this contribution.</Text>}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHead}>
            <ReceiptIcon size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.cardTitle}>Contribution receipt</Text>
          </View>
          <Row label="Campaign" value={c?.title ?? '—'} />
          <Row label="Reference" value={reference ?? '—'} mono />
          <Row label="Date" value={new Date().toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })} />
          <Row label="Status" value={isPending ? 'Pending' : 'Successful'} />
        </View>

        <Text style={styles.note}>A copy of this receipt is saved in your contribution history.</Text>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="View my contributions" variant="secondary" onPress={() => router.replace('/crowdfunding/contributions')} />
        <PrimaryButton label="Done" onPress={() => router.dismissTo(`/crowdfunding/campaign/${id}`)} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.mono]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg },
  statusHead: { alignItems: 'center', gap: 6, paddingVertical: Spacing.lg },
  statusIcon: { width: 72, height: 72, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  statusIconOk: { backgroundColor: Colors.iconBgTeal },
  statusIconPending: { backgroundColor: Colors.iconBgOrange },
  statusLabel: { ...Typography.titleLg, color: Colors.onSurface },
  statusSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  cardTitle: { ...Typography.labelMd, color: Colors.onSurface },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  rowValue: { ...Typography.bodyMd, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },
  mono: { fontVariant: ['tabular-nums'] },
  note: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.md },
  footer: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: Spacing.md },
});
