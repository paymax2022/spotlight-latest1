import React from 'react';
import { View, Text, StyleSheet, ScrollView, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ShieldCheck, Headset } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow2 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { PaymentSheet, usePurchasePayment } from '@/features/payments';
import { formatStayRange, formatNaira, StaysColors } from '@/features/stays/constants/stays.constants';

// Mock agent-prepared booking the traveller is asked to pay for.
const PREPARED = {
  reference: 'PMX-AGPREP1',
  agentName: 'Agent Tunde A.',
  propertyName: 'Eko Signature Hotel',
  coverUrl: 'https://images.unsplash.com/photo-1566073771259-6a8506099945',
  city: 'Lagos',
  roomTypeName: 'Deluxe King Room',
  ratePlanName: 'Flexible · Breakfast',
  checkIn: new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10),
  checkOut: new Date(Date.now() + 11 * 86_400_000).toISOString().slice(0, 10),
  totalKobo: 21_500_000,
};

/** Pay for an agent-prepared booking (PRD §17 H, screen 57) — reuses PaymentSheet. */
export default function PayPreparedScreen() {
  const pay = usePurchasePayment();

  function onPay() {
    pay.start({
      amountKobo: PREPARED.totalKobo,
      title: 'Pay for prepared booking',
      charge: async () => {
        // Mock: confirm the prepared booking once funds are guaranteed.
        await new Promise((r) => setTimeout(r, 600));
        return { reference: PREPARED.reference };
      },
      onPaid: () => router.replace('/stays/agent/confirmation'),
    });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Review & pay" subtitle="Agent-prepared booking" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.agentCard}>
          <Headset size={18} color={Colors.primary} />
          <Text style={styles.agentText}>Prepared by {PREPARED.agentName} · {PREPARED.reference}</Text>
        </View>

        <View style={styles.card}>
          <Image source={{ uri: PREPARED.coverUrl }} style={styles.cover} />
          <Text style={styles.name}>{PREPARED.propertyName}</Text>
          <Text style={styles.line}>{PREPARED.city}</Text>
          <Text style={styles.line}>{formatStayRange(PREPARED.checkIn, PREPARED.checkOut)}</Text>
          <Text style={styles.line}>{PREPARED.roomTypeName} · {PREPARED.ratePlanName}</Text>
          <View style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total (NGN)</Text>
            <Text style={styles.totalVal}>{formatNaira(PREPARED.totalKobo)}</Text>
          </View>
        </View>

        <View style={styles.guarantee}>
          <ShieldCheck size={16} color={StaysColors.ok} strokeWidth={2.2} />
          <Text style={styles.guaranteeText}>This booking is on your account. You're only charged once the hotel confirms.</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <View style={{ flex: 1 }}>
          <Text style={styles.footerLabel}>Total</Text>
          <Text style={styles.footerPrice}>{formatNaira(PREPARED.totalKobo)}</Text>
        </View>
        <View style={{ width: 160 }}>
          <PrimaryButton label="Pay now" onPress={onPay} />
        </View>
      </View>

      <PaymentSheet controller={pay} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  agentCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgPurple, borderRadius: Radius.md, padding: Spacing.md },
  agentText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: 4 },
  cover: { width: '100%', height: 160, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainer, marginBottom: Spacing.sm },
  name: { ...Typography.titleLg, color: Colors.onSurface },
  line: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  divider: { height: 1, backgroundColor: Colors.outlineVariant, marginVertical: Spacing.sm },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { ...Typography.titleMd, color: Colors.onSurface },
  totalVal: { ...Typography.titleMd, color: Colors.primary, fontWeight: '800' as const },
  guarantee: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md },
  guaranteeText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, ...shadow2 },
  footerLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  footerPrice: { ...Typography.titleLg, color: Colors.onSurface },
});
