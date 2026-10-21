import React, { useMemo, useState } from 'react';
import PhoneNumberInput from '@/components/PhoneNumberInput';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Check, UserCheck, Send } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import StateView from '@/components/StateView';
import { useBusDraft } from '@/features/mobility/hooks/useBusV2';
import { missingLegs, setBusDraftPassengers } from '@/features/mobility/utils/busCheckoutDraft';
import { passengerInputOk } from '@/features/mobility/utils/busV2';
import type { BusBookPassengerInput, BusDeliverTo } from '@/features/mobility/types/busV2.types';

interface PaxForm {
  name: string;
  phone: string;      // E.164 when the input resolves it
  phoneValid: boolean;
  isSelf: boolean;
  deliverTo: BusDeliverTo;
}

const blank = (isSelf: boolean): PaxForm => ({
  name: '',
  phone: '',
  phoneValid: false,
  isSelf,
  deliverTo: isSelf ? 'purchaser' : 'passenger',
});

/**
 * Passenger details — one card per seat (draft.search.pax). Minimal per the PRD:
 * name, phone, whether this passenger is the purchaser, and where to deliver
 * their ticket (purchaser's app vs the passenger's own phone).
 */
export default function BusPassengerScreen() {
  const draft = useBusDraft();
  const pax = draft?.search.pax ?? 1;
  const seatLabels = draft?.legs[0]?.seatLabels ?? [];

  const [forms, setForms] = useState<PaxForm[]>(() =>
    Array.from({ length: pax }, (_, i) => {
      const prev = draft?.passengers[i];
      return prev
        ? { name: prev.name, phone: prev.phone, phoneValid: true, isSelf: prev.isSelf, deliverTo: prev.deliverTo }
        : blank(i === 0);
    }),
  );

  const missing = useMemo(() => missingLegs(draft), [draft]);

  if (!draft || missing.length > 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Passenger details" />
        <StateView kind="empty" title="No seats held" message="Pick your seats first — holds expire quickly." actionLabel="Back to search" onAction={() => goBack('/mobility/bus')} />
      </SafeAreaView>
    );
  }

  const update = (i: number, patch: Partial<PaxForm>) =>
    setForms((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  const markSelf = (i: number) =>
    setForms((fs) =>
      fs.map((f, j) =>
        j === i
          ? { ...f, isSelf: true, deliverTo: 'purchaser' }
          : { ...f, isSelf: false, deliverTo: f.deliverTo === 'purchaser' ? 'passenger' : f.deliverTo },
      ),
    );

  const allValid = forms.every((f) => passengerInputOk(f) && f.phoneValid);

  const onContinue = () => {
    if (!allValid) return;
    const passengers: BusBookPassengerInput[] = forms.map((f) => ({
      name: f.name.trim(),
      phone: f.phone,
      isSelf: f.isSelf,
      deliverTo: f.deliverTo,
    }));
    setBusDraftPassengers(passengers);
    router.push('/mobility/bus/review');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Passenger details"
        subtitle={`${pax} seat${pax === 1 ? '' : 's'} · ${seatLabels.join(', ')}`}
      />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.note}>
          Enter each traveller's details. The name appears on the ticket and boarding pass — it must match the ID shown at boarding.
        </Text>
        {forms.map((f, i) => (
          <View key={i} style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>Passenger {i + 1}{seatLabels[i] ? ` · Seat ${seatLabels[i]}` : ''}</Text>
              <Pressable
                style={[styles.selfChip, f.isSelf && styles.selfChipActive]}
                onPress={() => markSelf(i)}
                accessibilityRole="button"
                accessibilityState={{ selected: f.isSelf }}
                accessibilityLabel={`Passenger ${i + 1} is me`}
              >
                <UserCheck size={13} color={f.isSelf ? Colors.onPrimary : Colors.secondary} strokeWidth={2.2} />
                <Text style={[styles.selfChipText, f.isSelf && styles.selfChipTextActive]}>
                  {f.isSelf ? "That's me" : 'Someone else'}
                </Text>
              </Pressable>
            </View>

            <TextInputField
              label="Full name"
              value={f.name}
              onChangeText={(v) => update(i, { name: v })}
              placeholder="Passenger name"
              autoCapitalize="words"
            />
            <PhoneNumberInput
              label="Phone number"
              value={f.phone}
              onChange={({ e164, nsn, valid }) => update(i, { phone: e164 || nsn, phoneValid: valid })}
            />

            {/* Ticket delivery — who receives the QR for this passenger */}
            <View style={styles.deliverBlock}>
              <Text style={styles.deliverLabel}>Deliver ticket to</Text>
              <View style={styles.deliverRow}>
                <DeliverOption
                  active={f.deliverTo === 'purchaser'}
                  label="My app"
                  hint="Ticket lands in my account"
                  onPress={() => update(i, { deliverTo: 'purchaser' })}
                />
                <DeliverOption
                  active={f.deliverTo === 'passenger'}
                  label="Passenger"
                  hint="Sent to their phone"
                  onPress={() => update(i, { deliverTo: 'passenger' })}
                  disabled={f.isSelf}
                />
              </View>
            </View>
          </View>
        ))}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Review booking" onPress={onContinue} disabled={!allValid} />
      </View>
    </SafeAreaView>
  );
}

function DeliverOption({ active, label, hint, onPress, disabled }: {
  active: boolean;
  label: string;
  hint: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={[styles.deliverOption, active && styles.deliverOptionActive, disabled && styles.deliverOptionDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled: !!disabled }}
      accessibilityLabel={`Deliver ticket to ${label}`}
    >
      <View style={[styles.deliverCheck, active && styles.deliverCheckActive]}>
        {active ? <Check size={11} color={Colors.onPrimary} strokeWidth={3} /> : <Send size={11} color={Colors.outline} strokeWidth={2} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.deliverName, active && styles.deliverNameActive]}>{label}</Text>
        <Text style={styles.deliverHint}>{hint}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.md },
  note: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface },
  selfChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.secondary, paddingHorizontal: 10, paddingVertical: 5 },
  selfChipActive: { backgroundColor: Colors.secondary, borderColor: Colors.secondary },
  selfChipText: { ...Typography.labelSm, color: Colors.secondary, fontWeight: '700' as const },
  selfChipTextActive: { color: Colors.onPrimary },
  deliverBlock: { marginTop: Spacing.xs },
  deliverLabel: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  deliverRow: { flexDirection: 'row', gap: Spacing.sm },
  deliverOption: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.outlineVariant, padding: Spacing.sm },
  deliverOptionActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  deliverOptionDisabled: { opacity: 0.45 },
  deliverCheck: { width: 20, height: 20, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  deliverCheckActive: { backgroundColor: Colors.primary },
  deliverName: { ...Typography.labelSm, color: Colors.onSurface },
  deliverNameActive: { color: Colors.primary, fontWeight: '700' as const },
  deliverHint: { ...Typography.caption, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
});
