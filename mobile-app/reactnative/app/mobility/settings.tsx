import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Wallet, CreditCard, Banknote, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { useRideSettings, useUpdateRideSettings } from '@/features/mobility/hooks/useMobility';
import type { PaymentMethod } from '@/features/mobility/types/mobility.types';

const PAYMENT_METHODS: { value: PaymentMethod; label: string; hint: string; icon: typeof Wallet }[] = [
  { value: 'wallet', label: 'Paymax wallet', hint: 'Fare held and settled in-app.', icon: Wallet },
  { value: 'card', label: 'Card', hint: 'Fare charged in-app at request time.', icon: CreditCard },
  { value: 'cash', label: 'Cash', hint: 'Pay the driver directly — nothing is charged in-app.', icon: Banknote },
];

/**
 * Ride preferences: the default payment method offered when requesting a
 * ride (wallet/card/cash — see estimate.tsx's own per-request picker, which
 * this only seeds a sensible starting value for) plus saved home/work
 * addresses. Wired to the previously-unused GET/PUT /mobility/profile.
 */
export default function MobilitySettingsScreen() {
  const settings = useRideSettings();
  const update = useUpdateRideSettings();

  const [defaultPayment, setDefaultPayment] = useState<PaymentMethod>('wallet');
  const [homeAddress, setHomeAddress] = useState('');
  const [workAddress, setWorkAddress] = useState('');
  const [saved, setSaved] = useState(false);

  // Seed local state once the server value loads; don't fight the user's
  // in-progress edits on a background refetch.
  useEffect(() => {
    if (!settings.data) return;
    setDefaultPayment(settings.data.defaultPayment);
    setHomeAddress(settings.data.homeAddress ?? '');
    setWorkAddress(settings.data.workAddress ?? '');
  }, [settings.data]);

  const dirty =
    settings.data != null &&
    (defaultPayment !== settings.data.defaultPayment ||
      homeAddress !== (settings.data.homeAddress ?? '') ||
      workAddress !== (settings.data.workAddress ?? ''));

  const onSave = () => {
    setSaved(false);
    update.mutate(
      { defaultPayment, homeAddress: homeAddress.trim() || null, workAddress: workAddress.trim() || null },
      { onSuccess: () => setSaved(true) },
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScreenHeader title="Ride settings" />
      {settings.isLoading ? (
        <StateView kind="loading" message="Loading your ride preferences…" />
      ) : settings.isError ? (
        <StateView kind="error" title="Couldn't load settings" actionLabel="Retry" onAction={() => settings.refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
          <Text style={s.sectionTitle}>Default payment method</Text>
          <Text style={s.sectionSub}>
            Used to pre-select how you pay when you request a ride — you can still change it per ride.
          </Text>
          <View style={s.payList}>
            {PAYMENT_METHODS.map((m) => {
              const active = defaultPayment === m.value;
              const Icon = m.icon;
              return (
                <Pressable
                  key={m.value}
                  style={[s.payOption, active && s.payOptionActive]}
                  onPress={() => { setDefaultPayment(m.value); setSaved(false); }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <View style={s.payIconBox}>
                    <Icon size={20} color={active ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.payLabel, active && s.payLabelActive]}>{m.label}</Text>
                    <Text style={s.payHint}>{m.hint}</Text>
                  </View>
                  {active && <Check size={18} color={Colors.primary} strokeWidth={2.5} />}
                </Pressable>
              );
            })}
          </View>

          <Text style={[s.sectionTitle, { marginTop: Spacing.lg }]}>Saved addresses</Text>
          <Text style={s.sectionSub}>Optional — speeds up picking a destination next time.</Text>
          <View style={[s.card, shadow1]}>
            <TextInputField
              label="Home address"
              value={homeAddress}
              onChangeText={(t) => { setHomeAddress(t); setSaved(false); }}
              placeholder="e.g. 12 Admiralty Way, Lekki"
            />
            <TextInputField
              label="Work address"
              value={workAddress}
              onChangeText={(t) => { setWorkAddress(t); setSaved(false); }}
              placeholder="e.g. 4 Idowu Taylor St, Victoria Island"
            />
          </View>

          {saved && !dirty ? <Text style={s.savedNote}>Saved.</Text> : null}
          <PrimaryButton
            label="Save changes"
            onPress={onSave}
            loading={update.isPending}
            disabled={!dirty}
            style={{ marginTop: Spacing.lg }}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  sectionSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2, marginBottom: Spacing.md },
  payList: { gap: Spacing.sm },
  payOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  payOptionActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  payIconBox: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  payLabel: { ...Typography.labelLg, color: Colors.onSurface },
  payLabelActive: { color: Colors.primary },
  payHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.outlineVariant, gap: Spacing.md },
  savedNote: { ...Typography.labelSm, color: Colors.tertiaryContainer, textAlign: 'center', marginTop: Spacing.md },
});
