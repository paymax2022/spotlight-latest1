import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import PrimaryButton from '@/components/PrimaryButton';
import { PaymentSheet, usePurchasePayment } from '@/features/payments';
import { TriageScaffold } from '@/features/triage/components';
import { payReferral, newIdempotencyKey } from '@/features/triage/api';
import { useLanguage } from '@/features/triage/useLanguage';
import { t } from '@/features/triage/i18n';
import { track } from '@/features/triage/analytics';
import { formatNaira } from '@/features/health/constants/health.constants';
import { CARE_ROUTE_META } from '@/features/triage/constants';
import type { CareRoute, PayReferralResult } from '@/features/triage/types';

/**
 * Triage referral checkout — REUSES the shared wallet/card checkout
 * (usePurchasePayment + PaymentSheet) that lab/pharmacy bookings use. The
 * referral charge carries an Idempotency-Key (IRON RULE money handling).
 */
export default function TriageCheckoutScreen() {
  const params = useLocalSearchParams<{
    sessionId?: string;
    referralId?: string;
    route?: string;
    amountKobo?: string;
  }>();
  const [lang, setLang] = useLanguage();
  const s = t(lang);

  const route = (params.route as CareRoute) ?? 'telemedicine';
  const amountKobo = Number(params.amountKobo ?? 0);
  const routeMeta = CARE_ROUTE_META[route];
  const RouteIcon = (Icons as unknown as Record<string, Icons.LucideIcon>)[routeMeta.icon] ?? Icons.Activity;

  const pay = usePurchasePayment<PayReferralResult>();

  const onPay = () => {
    if (!params.referralId) return;
    const idempotencyKey = newIdempotencyKey('triage_ref');
    pay.start({
      amountKobo,
      title: routeMeta.cta,
      charge: async () => payReferral({ referralId: params.referralId as string, idempotencyKey }),
      onPaid: () => {
        track('care_booked', { route, referralId: params.referralId });
        // Hand off into the existing care loop, then land on the saved screen.
        router.replace({ pathname: '/health/triage/saved', params: { sessionId: params.sessionId, route } });
      },
    });
  };

  return (
    <TriageScaffold title="Checkout" subtitle={routeMeta.label} lang={lang} onChangeLang={setLang} sessionId={params.sessionId}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.routeCard, shadow1]}>
          <View style={[styles.routeIcon, { backgroundColor: Colors.iconBgPurple }]}>
            <RouteIcon size={22} color={routeMeta.color} strokeWidth={2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.routeLabel}>{routeMeta.label}</Text>
            <Text style={styles.routeCta}>{routeMeta.cta}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Order summary</Text>
        <View style={[styles.summary, shadow1]}>
          <View style={styles.row}>
            <Text style={styles.name}>{routeMeta.label}</Text>
            <Text style={styles.val}>{formatNaira(amountKobo)}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalVal}>{formatNaira(amountKobo)}</Text>
          </View>
        </View>

        <View style={styles.held}>
          <Lock size={16} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.heldText}>
            Your payment is held and released to the care provider once your consult is confirmed.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label={`Pay ${formatNaira(amountKobo)}`} onPress={onPay} />
      </View>

      <PaymentSheet controller={pay} />
    </TriageScaffold>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.containerMargin, paddingBottom: 24, gap: Spacing.md },
  routeCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md,
  },
  routeIcon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  routeLabel: { ...Typography.labelLg, color: Colors.onSurface },
  routeCta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  summary: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  val: { ...Typography.bodyMd, color: Colors.onSurface },
  totalLabel: { ...Typography.titleMd, color: Colors.onSurface },
  totalVal: { ...Typography.titleMd, color: Colors.primary },
  divider: { height: 1, backgroundColor: Colors.outlineVariant },
  held: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md },
  heldText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1, lineHeight: 18 },
  footer: {
    padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
  },
});
