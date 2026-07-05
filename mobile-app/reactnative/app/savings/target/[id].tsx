import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Calendar, Users } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import ContributionRow from '@/features/savings/components/ContributionRow';
import DisclosureBanner from '@/features/savings/components/DisclosureBanner';
import { PaymentSheet, usePurchasePayment } from '@/features/payments';
import { useTarget, useContributeToTarget } from '@/features/savings/hooks';
import { SavingsColors, formatNaira, GROUP_TARGET_DISCLOSURE } from '@/features/savings/constants/savings.constants';

export default function GroupTargetDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const targetId = String(id);
  const target = useTarget(targetId);
  const contribute = useContributeToTarget(targetId);
  const pay = usePurchasePayment();
  const [amount, setAmount] = useState('');

  if (target.isLoading) return <Shell title="Group target"><StateView kind="loading" message="Loading…" /></Shell>;
  if (target.isError || !target.data) return <Shell title="Group target"><StateView kind="error" title="Couldn't load" actionLabel="Retry" onAction={() => target.refetch()} /></Shell>;

  const t = target.data;
  const pct = Math.min(100, Math.round((t.savedKobo / t.targetKobo) * 100));
  const amountKobo = amount ? Math.round(parseFloat(amount) * 100) : 0;

  const startPay = () => {
    if (amountKobo <= 0) return;
    pay.start({
      amountKobo,
      title: `Contribute to ${t.name}`,
      charge: () => contribute.mutateAsync(amountKobo),
      onPaid: () => setAmount(''),
    });
  };

  return (
    <Shell title={t.name}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>Saved so far</Text>
          <Text style={styles.heroAmount}>{formatNaira(t.savedKobo)}</Text>
          <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View>
          <Text style={styles.heroSub}>{pct}% of {formatNaira(t.targetKobo)}</Text>
        </View>

        <View style={styles.metaRow}>
          <Meta Icon={Calendar} label="Deadline" value={new Date(t.deadlineISO).toLocaleDateString()} />
          <Meta Icon={Users} label="Rule" value={t.withdrawalRule === 'on-date' ? 'On date' : 'Majority'} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Add your contribution</Text>
          <TextInputField placeholder="Amount" keyboardType="numeric" value={amount} onChangeText={setAmount} />
          <PrimaryButton label="Contribute" onPress={startPay} disabled={amountKobo <= 0} loading={contribute.isPending} />
        </View>

        <Text style={styles.sectionTitle}>Contributors ({t.contributors.length})</Text>
        <View style={styles.card}>
          {t.contributors.map((g) => (
            <ContributionRow
              key={g.id}
              name={g.name}
              handle={g.handle}
              avatarColor={g.avatarColor}
              amountKobo={g.savedKobo}
              state={g.savedKobo >= g.pledgedKobo && g.pledgedKobo > 0 ? 'paid' : g.savedKobo > 0 ? 'pending' : 'defaulted'}
              note={`pledged ${formatNaira(g.pledgedKobo)}`}
            />
          ))}
        </View>

        <DisclosureBanner text={GROUP_TARGET_DISCLOSURE} />
        <View style={{ height: Spacing.xl }} />
      </ScrollView>
      <PaymentSheet controller={pay} />
    </Shell>
  );
}

function Meta({ Icon, label, value }: { Icon: typeof Calendar; label: string; value: string }) {
  return (
    <View style={styles.meta}>
      <Icon size={16} color={SavingsColors.muted} />
      <Text style={styles.metaValue}>{value}</Text>
      <Text style={styles.metaLabel}>{label}</Text>
    </View>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={title} />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  hero: { backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.sm },
  heroLabel: { ...Typography.labelMd, color: Colors.inversePrimary },
  heroAmount: { ...Typography.headlineLg, color: Colors.onPrimary },
  heroSub: { ...Typography.labelSm, color: Colors.inversePrimary },
  track: { height: 8, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  fill: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.onPrimary },
  metaRow: { flexDirection: 'row', gap: Spacing.sm },
  meta: { flex: 1, gap: 4, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: SavingsColors.surface, ...shadow1 },
  metaValue: { ...Typography.titleMd, color: Colors.onSurface },
  metaLabel: { ...Typography.labelSm, color: SavingsColors.muted },
  card: { backgroundColor: SavingsColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.md, ...shadow1 },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
});
