import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Share, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Share2, Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import CashtagAvatar from '@/features/social/components/CashtagAvatar';
import { PaymentSheet, usePurchasePayment } from '@/features/payments';
import { usePool, useContributeToPool } from '@/features/social/hooks';
import { SocialColors, formatNaira } from '@/features/social/constants/social.constants';
import { sanitizeMoneyInput } from '@/utils/money';

export default function PoolDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const poolId = String(id);
  const pool = usePool(poolId);
  const contribute = useContributeToPool(poolId);
  const pay = usePurchasePayment();
  const [amount, setAmount] = useState('');

  if (pool.isLoading) return <Shell><StateView kind="loading" message="Loading pool…" /></Shell>;
  if (pool.isError || !pool.data) return <Shell><StateView kind="error" title="Couldn't load pool" actionLabel="Retry" onAction={() => pool.refetch()} /></Shell>;

  const p = pool.data;
  const pct = p.goalKobo ? Math.min(100, Math.round((p.raisedKobo / p.goalKobo) * 100)) : null;
  const amountKobo = amount ? Math.round(parseFloat(amount) * 100) : 0;
  const open = p.status === 'open';

  const startPay = () => {
    if (amountKobo <= 0) return;
    pay.start({
      amountKobo,
      title: `Contribute to ${p.title}`,
      charge: () => contribute.mutateAsync(amountKobo),
      onPaid: () => setAmount(''),
    });
  };

  const share = () => Share.share({ message: `Contribute to "${p.title}" on Paymax Social Pay.` }).catch(() => {});

  return (
    <Shell onShare={share}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>{p.title}</Text>
          {p.description ? <Text style={styles.heroDesc}>{p.description}</Text> : null}
          <Text style={styles.heroAmount}>{formatNaira(p.raisedKobo)}</Text>
          {pct !== null ? (
            <>
              <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View>
              <Text style={styles.heroSub}>{pct}% of {formatNaira(p.goalKobo)} · {open ? 'Open' : 'Closed'}</Text>
            </>
          ) : (
            <Text style={styles.heroSub}>{open ? 'Open' : 'Closed'}</Text>
          )}
        </View>

        <View style={styles.ruleCard}>
          <Info size={16} color={SocialColors.accent} />
          <Text style={styles.ruleText}>{p.payoutRule}</Text>
        </View>

        {open ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Add your contribution</Text>
            <TextInputField placeholder="Amount" keyboardType="decimal-pad" maxLength={13} value={amount} onChangeText={(t) => setAmount(sanitizeMoneyInput(t))} />
            <PrimaryButton label="Contribute" onPress={startPay} disabled={amountKobo <= 0} loading={contribute.isPending} />
          </View>
        ) : (
          <View style={styles.closedNote}><Text style={styles.closedText}>This pool is closed and no longer accepting contributions.</Text></View>
        )}

        <Text style={styles.sectionTitle}>Contributors ({p.contributors.length})</Text>
        <View style={styles.card}>
          {p.contributors.map((c) => (
            <View key={c.id} style={styles.contributorRow}>
              <CashtagAvatar name={c.name} handle={c.handle} color={c.avatarColor} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cName}>{c.name}</Text>
                <Text style={styles.cHandle}>{c.handle}</Text>
              </View>
              <Text style={styles.cAmount}>{formatNaira(c.amountKobo)}</Text>
            </View>
          ))}
        </View>

        <View style={{ height: Spacing.xl }} />
      </ScrollView>
      <PaymentSheet controller={pay} />
    </Shell>
  );
}

function Shell({ children, onShare }: { children: React.ReactNode; onShare?: () => void }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Group pool"
        rightSlot={onShare ? (
          <Pressable onPress={onShare} hitSlop={10} accessibilityLabel="Share pool">
            <Share2 size={20} color={Colors.onSurface} />
          </Pressable>
        ) : undefined}
      />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  hero: { backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.sm },
  heroTitle: { ...Typography.titleLg, color: Colors.onPrimary },
  heroDesc: { ...Typography.bodySm, color: Colors.inversePrimary },
  heroAmount: { ...Typography.headlineLg, color: Colors.onPrimary },
  heroSub: { ...Typography.labelSm, color: Colors.inversePrimary },
  track: { height: 8, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  fill: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.onPrimary },
  ruleCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: SocialColors.surfaceAlt, borderRadius: Radius.md, padding: Spacing.md },
  ruleText: { ...Typography.bodySm, color: SocialColors.text, flex: 1 },
  card: { backgroundColor: SocialColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.md, ...shadow1 },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  closedNote: { backgroundColor: SocialColors.surfaceAlt, borderRadius: Radius.md, padding: Spacing.md },
  closedText: { ...Typography.bodySm, color: SocialColors.muted },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  contributorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  cName: { ...Typography.labelLg, color: SocialColors.text },
  cHandle: { ...Typography.bodySm, color: SocialColors.muted },
  cAmount: { ...Typography.labelMd, color: SocialColors.text },
});
