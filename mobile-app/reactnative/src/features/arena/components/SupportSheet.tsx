import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, TextInput, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, HandCoins, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { usePurchasePayment, PaymentSheet } from '@/features/payments';
import TransparencyNote from './TransparencyNote';
import { useSupport } from '../hooks';
import { newIdempotencyKey } from '../api';
import {
  SUPPORT_PRESETS_KOBO,
  SUPPORT_SPLIT,
  NDC1_SUPPORT_NOTE,
  formatNaira,
} from '../constants';

interface Props {
  visible: boolean;
  onClose: () => void;
  competitionId: string;
  contestantId: string;
  driverName?: string;
  onSupported?: (amountKobo: number) => void;
}

/**
 * S5 / S8 Back-a-Driver ("Fuel My Journey") sheet. REUSES the creators/tip gift
 * pattern (presets + custom + confirm) and adds:
 *  - the KYC step-up guard (reuses kyc-verify) before any wallet debit,
 *  - the split explainer (pot vs People's Champion),
 *  - the NDC-1 transparency note (support never affects the crown).
 * A stable Idempotency-Key is minted per open so a double-tap can't double-charge.
 */
export default function SupportSheet({
  visible,
  onClose,
  competitionId,
  contestantId,
  driverName,
  onSupported,
}: Props) {
  const support = useSupport();
  const pay = usePurchasePayment<void>();

  const [amountKobo, setAmountKobo] = useState<number>(SUPPORT_PRESETS_KOBO[1]);
  const [custom, setCustom] = useState('');
  const [done, setDone] = useState(false);
  // One idempotency key per attempt; regenerated after a successful send.
  const [idemKey, setIdemKey] = useState(() => newIdempotencyKey());

  const effectiveKobo = useMemo(() => {
    const c = parseInt(custom.replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(c) && c > 0 ? c * 100 : amountKobo;
  }, [custom, amountKobo]);

  const splitLines = SUPPORT_SPLIT.map((s) => ({
    label: s.label,
    amount: Math.round(effectiveKobo * s.fraction),
  }));

  const reset = () => {
    setCustom('');
    setAmountKobo(SUPPORT_PRESETS_KOBO[1]);
    setDone(false);
    setIdemKey(newIdempotencyKey());
  };

  const close = () => {
    reset();
    onClose();
  };

  const onSend = () => {
    // Open the payment gateway (wallet or card via Paystack). The support record
    // is written only after the payment rail confirms (charge callback), then the
    // pot + People's Champion tallies update (onPaid).
    pay.start({
      amountKobo: effectiveKobo,
      title: `Back ${driverName ?? 'this driver'}`,
      domain: 'arena_support',
      charge: async () => {
        await support.mutateAsync({ competitionId, contestantId, amountKobo: effectiveKobo, idempotencyKey: idemKey });
      },
      onPaid: () => {
        setDone(true);
        onSupported?.(effectiveKobo);
        setIdemKey(newIdempotencyKey());
      },
    });
  };

  return (
    <>
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />
      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title}>{done ? 'Support sent' : 'Back this driver'}</Text>
          <Pressable onPress={close} hitSlop={10} accessibilityLabel="Close">
            <X size={22} color={Colors.onSurface} />
          </Pressable>
        </View>

        {done ? (
          <View style={styles.doneWrap}>
            <View style={styles.doneIcon}>
              <CheckCircle2 size={40} color={Colors.teal} strokeWidth={2} />
            </View>
            <Text style={styles.doneTitle}>Thank you!</Text>
            <Text style={styles.doneMsg}>
              Your {formatNaira(effectiveKobo)} boost went to {driverName ?? 'the driver'}. It fuels the
              prize pot and the People’s Champion award.
            </Text>
            <PrimaryButton label="Done" onPress={close} style={{ marginTop: Spacing.md }} />
          </View>
        ) : (
          <>
            <View style={styles.driverRow}>
              <View style={styles.driverIcon}>
                <HandCoins size={20} color={Colors.primary} />
              </View>
              <Text style={styles.driverName}>{driverName ?? 'Driver'}</Text>
            </View>

            <Text style={styles.sectionLabel}>Choose an amount</Text>
            <View style={styles.presetGrid}>
              {SUPPORT_PRESETS_KOBO.map((p) => {
                const sel = !custom && amountKobo === p;
                return (
                  <Pressable
                    key={p}
                    style={[styles.preset, sel && styles.presetSel]}
                    onPress={() => {
                      setCustom('');
                      setAmountKobo(p);
                    }}
                  >
                    <Text style={[styles.presetText, sel && styles.presetTextSel]}>{formatNaira(p)}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.sectionLabel}>Or enter a custom amount (₦)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 5000"
              placeholderTextColor={Colors.outline}
              keyboardType="number-pad"
              value={custom}
              onChangeText={setCustom}
            />

            {/* Split explainer — where the money goes. */}
            <View style={styles.splitBox}>
              {splitLines.map((l) => (
                <View key={l.label} style={styles.splitRow}>
                  <Text style={styles.splitLabel}>{l.label}</Text>
                  <Text style={styles.splitAmount}>{formatNaira(l.amount)}</Text>
                </View>
              ))}
            </View>

            <TransparencyNote>{NDC1_SUPPORT_NOTE}</TransparencyNote>

            {support.isError ? (
              <Text style={styles.errorText}>
                Couldn’t send your support. No money left your wallet — tap to try again.
              </Text>
            ) : null}

            {/* Backing a driver is open to everyone (tier 0) — no KYC gate.
                Straight to the payment gateway (wallet or card via Paystack). */}
            <PrimaryButton
              label={`Support ${formatNaira(effectiveKobo)}`}
              onPress={onSend}
              loading={pay.phase === 'charging' || pay.phase === 'awaiting' || support.isPending}
              disabled={effectiveKobo <= 0}
              style={{ marginTop: Spacing.md }}
            />
          </>
        )}
      </SafeAreaView>
    </Modal>

    {/* Payment gateway — wallet or card via the Paystack SDK. Charges the amount,
        then the support record is written (charge callback) and tallies update. */}
    <PaymentSheet controller={pay} />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.containerMargin,
    paddingBottom: Spacing.md,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.surfaceContainerHigh,
    alignSelf: 'center',
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.sm },
  title: { ...Typography.titleLg, color: Colors.onSurface },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.md },
  driverIcon: {
    width: 40, height: 40, borderRadius: Radius.full,
    backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center',
  },
  driverName: { ...Typography.titleMd, color: Colors.onSurface },
  sectionLabel: { ...Typography.labelMd, color: Colors.onSurface, marginTop: Spacing.sm, marginBottom: Spacing.xs },
  presetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  preset: {
    flexGrow: 1, minWidth: '30%', alignItems: 'center', paddingVertical: 14,
    borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLow,
  },
  presetSel: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  presetText: { ...Typography.labelLg, color: Colors.onSurface },
  presetTextSel: { color: Colors.primary },
  input: {
    ...Typography.bodyMd, color: Colors.onSurface, borderWidth: 1.5, borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg, paddingHorizontal: Spacing.md, height: 52, backgroundColor: Colors.surfaceContainerLow,
  },
  splitBox: {
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg,
    padding: Spacing.md, marginTop: Spacing.md, gap: Spacing.xs,
  },
  splitRow: { flexDirection: 'row', justifyContent: 'space-between' },
  splitLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  splitAmount: { ...Typography.labelMd, color: Colors.onSurface },
  errorText: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.sm },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  tierText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  kycCard: {
    marginTop: Spacing.md, backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.secondary, padding: Spacing.md,
  },
  kycRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  kycIcon: {
    width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.iconBgBlue,
    alignItems: 'center', justifyContent: 'center',
  },
  kycTitle: { ...Typography.labelLg, color: Colors.onSurface },
  kycBody: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2, lineHeight: 18 },
  doneWrap: { alignItems: 'center', paddingVertical: Spacing.lg, gap: Spacing.xs },
  doneIcon: {
    width: 72, height: 72, borderRadius: Radius.full,
    backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm,
  },
  doneTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  doneMsg: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
