import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Clock, Percent } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow2 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useBuildQuote, type AgentQuote } from '@/features/stays/agent';
import { formatNaira, formatStayRange } from '@/features/stays/constants/stays.constants';

function isoDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Agent: build quote / hold (PRD §20.4). */
export default function QuoteHoldScreen() {
  const { customerId, propertyId, checkIn, checkOut } = useLocalSearchParams<{ customerId: string; propertyId: string; ratePlanId: string; checkIn: string; checkOut: string }>();
  const buildM = useBuildQuote();
  const [quote, setQuote] = useState<AgentQuote | null>(null);
  const [ran, setRan] = useState(false);

  useEffect(() => {
    if (ran || !customerId || !propertyId) return;
    setRan(true);
    buildM.mutate(
      {
        customerId,
        propertyId,
        ratePlanId: 'rp_flex',
        checkIn: checkIn || isoDays(7),
        checkOut: checkOut || isoDays(9),
        guests: { adults: 2, children: 0, childrenAges: [], rooms: 1 },
      },
      { onSuccess: (q) => setQuote(q) },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, propertyId]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Quote & hold" subtitle="Held on customer's behalf" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {buildM.isPending || (!quote && !buildM.isError) ? (
          <StateView kind="loading" message="Building quote and holding the rate…" />
        ) : buildM.isError ? (
          <StateView kind="error" title="Couldn't build quote" actionLabel="Retry" onAction={() => setRan(false)} />
        ) : quote ? (
          <>
            <View style={styles.card}>
              <Text style={styles.name}>{quote.propertyName}</Text>
              <Text style={styles.line}>{quote.city}</Text>
              <Text style={styles.line}>{formatStayRange(quote.checkIn, quote.checkOut)}</Text>
              <Text style={styles.line}>{quote.roomTypeName} · {quote.ratePlanName}</Text>
              <View style={styles.divider} />
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total (NGN)</Text>
                <Text style={styles.totalVal}>{formatNaira(quote.totalKobo)}</Text>
              </View>
            </View>

            <View style={styles.holdCard}>
              <Clock size={16} color={Colors.onWarning} />
              <Text style={styles.holdText}>Rate held until {new Date(quote.expiresAt).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}. Collect payment before it expires.</Text>
            </View>

            <View style={styles.commCard}>
              <Percent size={16} color={Colors.primary} />
              <Text style={styles.commText}>Your commission on this booking: {formatNaira(quote.commissionKobo)}</Text>
            </View>
          </>
        ) : null}
      </ScrollView>

      {quote ? (
        <View style={styles.footer}>
          <PrimaryButton label="Collect payment" onPress={() => router.push({ pathname: '/stays/agent/collect-payment', params: { quoteId: quote.quoteId, customerId } })} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: 4 },
  name: { ...Typography.titleLg, color: Colors.onSurface },
  line: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  divider: { height: 1, backgroundColor: Colors.outlineVariant, marginVertical: Spacing.sm },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { ...Typography.titleMd, color: Colors.onSurface },
  totalVal: { ...Typography.titleMd, color: Colors.primary, fontWeight: '800' as const },
  holdCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgGold, borderRadius: Radius.md, padding: Spacing.md },
  holdText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  commCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgPurple, borderRadius: Radius.md, padding: Spacing.md },
  commText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, ...shadow2 },
});
