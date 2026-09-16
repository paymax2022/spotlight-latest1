import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Wallet, Nfc, History, MapPin, ArrowDownLeft } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { PaymentSheet, usePurchasePayment } from '@/features/payments';
import { useEvent, useEventWallet, useOpenEventWallet, useTopUpEventWallet } from '@/features/events/hooks';
import { EventColors, formatNaira, EVENT_WALLET_DISCLOSURE } from '@/features/events/constants/events.constants';
import { sanitizeMoneyInput } from '@/utils/money';

const PRESETS = [200000, 500000, 1000000, 2000000];

export default function EventWalletTopUp() {
  const params = useLocalSearchParams<{ eventId: string }>();
  const eventId = params.eventId ?? 'e_live';
  const { data: event } = useEvent(eventId);
  const openWallet = useOpenEventWallet(eventId);
  const [walletId, setWalletId] = useState<string | null>(null);

  // Open (or fetch) the caller's per-event wallet once on mount, then read its
  // id — the backend keys wallet reads/mutations by walletId, not eventId.
  useEffect(() => {
    openWallet.mutate(undefined, { onSuccess: (w) => setWalletId(w.id) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const { data: wallet, isLoading, isError, refetch } = useEventWallet(walletId ?? '');
  const topUp = useTopUpEventWallet(walletId ?? '');
  const pay = usePurchasePayment();
  const [amount, setAmount] = useState('');

  const amountKobo = Math.round((Number(amount) || 0) * 100);

  const start = () => {
    if (amountKobo < 10000 || !walletId) return;
    pay.start({
      amountKobo,
      title: 'Top up event wallet',
      charge: () => topUp.mutateAsync({ amountKobo }),
      onPaid: () => { setAmount(''); refetch(); },
    });
  };

  const loading = openWallet.isPending || isLoading;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Event wallet" subtitle={event?.title} />
      {loading ? (
        <StateView kind="loading" message="Loading event wallet…" />
      ) : isError || !wallet ? (
        <StateView kind="error" title="Couldn't load wallet" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.balanceCard}>
            <Text style={styles.balLabel}>Event wallet balance</Text>
            <Text style={styles.balValue}>{formatNaira(wallet.balance_kobo)}</Text>
            <Text style={styles.balSub}>Closed-loop · spendable inside this event</Text>
          </View>

          <View style={styles.actionsRow}>
            <Action icon={Nfc} label="Tap to pay" onPress={() => router.push({ pathname: '/events/wallet/tap-pay', params: { eventId, walletId: wallet.id } })} />
            <Action icon={History} label="History" onPress={() => router.push({ pathname: '/events/wallet/history', params: { eventId, walletId: wallet.id } })} />
            <Action icon={MapPin} label="Venue map" onPress={() => router.push({ pathname: '/events/wallet/venue-map', params: { eventId } })} />
            <Action icon={ArrowDownLeft} label="Withdraw" onPress={() => router.push({ pathname: '/events/wallet/withdraw', params: { eventId, walletId: wallet.id } })} />
          </View>

          <Text style={styles.sectionTitle}>Top up</Text>
          <View style={styles.presetRow}>
            {PRESETS.map((p) => (
              <Pressable key={p} style={[styles.preset, amountKobo === p && styles.presetActive]} onPress={() => setAmount(String(p / 100))}>
                <Text style={[styles.presetText, amountKobo === p && styles.presetTextActive]}>{formatNaira(p)}</Text>
              </Pressable>
            ))}
          </View>
          <TextInputField label="Custom amount (₦)" placeholder="0" keyboardType="decimal-pad" inputMode="decimal" maxLength={13} value={amount} onChangeText={(v) => setAmount(sanitizeMoneyInput(v))} leftIcon={<Wallet size={18} color={EventColors.muted} />} />

          <View style={styles.disclosure}>
            <Text style={styles.disclosureText}>{EVENT_WALLET_DISCLOSURE}</Text>
          </View>

          <PrimaryButton label={amountKobo > 0 ? `Top up ${formatNaira(amountKobo)}` : 'Enter an amount'} disabled={amountKobo < 10000} loading={topUp.isPending} onPress={start} style={{ marginTop: Spacing.md }} />
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
      <PaymentSheet controller={pay} />
    </SafeAreaView>
  );
}

function Action({ icon: Icon, label, onPress }: { icon: typeof Nfc; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, pressed && { opacity: 0.8 }]}>
      <View style={styles.actionIcon}><Icon size={20} color={EventColors.brand} strokeWidth={2} /></View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.sm },
  balanceCard: { backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg, gap: 4 },
  balLabel: { ...Typography.labelMd, color: Colors.inversePrimary },
  balValue: { ...Typography.displayLg, color: Colors.onPrimary, fontSize: 38, letterSpacing: -0.76, lineHeight: 44 },
  balSub: { ...Typography.labelSm, color: Colors.inversePrimary },
  actionsRow: { flexDirection: 'row', gap: Spacing.sm },
  action: { flex: 1, alignItems: 'center', gap: 6, backgroundColor: EventColors.surface, borderRadius: Radius.lg, paddingVertical: Spacing.md, ...shadow1 },
  actionIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: EventColors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { ...Typography.caption, color: EventColors.text },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  preset: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.outlineVariant },
  presetActive: { backgroundColor: EventColors.brand, borderColor: EventColors.brand },
  presetText: { ...Typography.labelMd, color: EventColors.muted },
  presetTextActive: { color: Colors.onPrimary },
  disclosure: { backgroundColor: EventColors.warnBg, borderRadius: Radius.md, padding: Spacing.md },
  disclosureText: { ...Typography.bodySm, color: EventColors.warnText },
});
