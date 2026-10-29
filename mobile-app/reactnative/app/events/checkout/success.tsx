import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { PartyPopper } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import PrimaryButton from '@/components/PrimaryButton';
import { EventColors, formatNaira, EVENTS_COMMERCE_ENABLED } from '@/features/events/constants/events.constants';

export default function CheckoutSuccess() {
  const { count, requested, charged, ref } = useLocalSearchParams<{
    count: string; requested?: string; charged?: string; ref?: string; eventId: string;
  }>();
  const issued = parseInt(count ?? '1', 10) || 1;
  const asked = parseInt(requested ?? String(issued), 10) || issued;
  const paid = parseInt(charged ?? '', 10);
  // A batch can sell out mid-issue: the server only charges for the seats it
  // delivered, so say exactly what was issued instead of the requested count.
  const partial = issued < asked;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.body}>
        <View style={[styles.iconCircle, partial && styles.iconCircleWarn]}>
          <PartyPopper size={48} color={partial ? EventColors.warnText : EventColors.ok} strokeWidth={1.8} />
        </View>
        <Text style={styles.title}>{partial ? 'Partly filled' : "You're in!"}</Text>
        <Text style={styles.sub}>
          {partial
            ? `${issued} of the ${asked} seats you asked for were issued before this tier sold out. You were only charged for the ${issued} ticket${issued === 1 ? '' : 's'} you received.`
            : `${issued} ticket${issued > 1 ? 's' : ''} ${issued > 1 ? 'have' : 'has'} been issued to your Paymax account. Show your pass at the gate.`}
        </Text>
        {!partial && Number.isInteger(paid) && paid > 0 && EVENTS_COMMERCE_ENABLED ? (
          <Text style={styles.paid}>Amount charged: {formatNaira(paid)}</Text>
        ) : null}
        {ref ? <Text style={styles.ref}>Booking reference {ref}</Text> : null}
      </View>
      <View style={styles.footer}>
        {ref ? (
          <PrimaryButton label="View receipt" onPress={() => router.replace({ pathname: '/events/orders/[ref]', params: { ref } })} />
        ) : null}
        <PrimaryButton
          label="View my tickets"
          variant={ref ? 'ghost' : 'primary'}
          onPress={() => router.replace('/events/my-tickets')}
        />
        <PrimaryButton label="Back to events" variant="ghost" onPress={() => router.replace('/events')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.md },
  iconCircle: { width: 96, height: 96, borderRadius: Radius.full, backgroundColor: EventColors.okBg, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  iconCircleWarn: { backgroundColor: EventColors.warnBg },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  sub: { ...Typography.bodyMd, color: EventColors.muted, textAlign: 'center', lineHeight: 24 },
  paid: { ...Typography.labelLg, color: Colors.onSurface },
  ref: { ...Typography.caption, color: EventColors.muted },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg, gap: Spacing.xs },
});
