import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import TripPinInput from '@/features/mobility/components/TripPinInput';
import { getPinStatus, createPin, verifyPin } from '@/features/transfers/api';
import { resumeOrFallback } from '@/lib/resume';

const PIN_STATUS_KEY = ['transfers', 'pin-status'];

type Phase = 'current' | 'create' | 'confirm';

/**
 * Transaction-PIN setup / change. Two modes:
 *   • required (default) — a BLOCKING gate: the user cannot proceed anywhere in
 *     the app until a 4-digit PIN exists. No cancel affordance.
 *   • manage — reached from Profile → Security to set or change the PIN. If a PIN
 *     already exists, the current PIN must be verified before setting a new one.
 */
export default function SetTransactionPinScreen() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode = params.mode === 'manage' ? 'manage' : 'required';
  const qc = useQueryClient();

  const statusQuery = useQuery({ queryKey: PIN_STATUS_KEY, queryFn: getPinStatus });
  const hasPin = statusQuery.data?.hasPin ?? false;

  // An existing PIN ALWAYS has to be verified first, in either mode. This used
  // to be gated on `mode === 'manage'`, which meant the required-mode gate sent
  // a bare {pin} to POST /transfers/pin while a PIN already existed. The backend
  // treats that as a change-PIN attempt, verifies the (absent) current PIN,
  // fails, returns 403 — and COUNTS IT AS A WRONG GUESS. Five of those lock the
  // user out of transfers entirely, from a screen that never asked for the PIN
  // it was checking against.
  const initialPhase: Phase = hasPin ? 'current' : 'create';
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Once status resolves, require the current PIN first when one already exists.
  // Only nudges the initial 'create' phase, never mid-flow.
  useEffect(() => {
    if (!statusQuery.isLoading && hasPin) {
      setPhase((p) => (p === 'create' ? 'current' : p));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusQuery.isLoading, hasPin, mode]);

  const finish = () => {
    // Update the cache synchronously so the app-wide gate sees hasPin=true
    // immediately (no race that would bounce the user back to this screen),
    // then refresh from source.
    qc.setQueryData(PIN_STATUS_KEY, { hasPin: true });
    qc.invalidateQueries({ queryKey: PIN_STATUS_KEY });
    if (mode === 'manage') router.back();
    // Required-mode gate: return the user to wherever they were blocked and let
    // them continue; fall back to home when there's nothing to resume.
    else resumeOrFallback('/(tabs)/home');
  };

  const onVerifyCurrent = async () => {
    setError(null);
    setBusy(true);
    try {
      await verifyPin(current);
      // Deliberately KEEP `current`: SetPin re-verifies it server-side before
      // overwriting. Clearing it here is what made every PIN CHANGE fail — the
      // request went out as a bare {pin} and the backend scored the missing
      // current PIN as a wrong guess.
      setPhase('create');
    } catch {
      setError('Incorrect PIN. Please try again.');
      setCurrent('');
    } finally {
      setBusy(false);
    }
  };

  const onSetNew = () => {
    setError(null);
    if (!/^\d{4}$/.test(pin)) { setError('Enter a 4-digit PIN.'); return; }
    setPhase('confirm');
  };

  const onConfirm = async () => {
    setError(null);
    if (confirm !== pin) {
      setError('PINs do not match. Start again.');
      setPin(''); setConfirm(''); setPhase('create');
      return;
    }
    // Last line of defence. `hasPin ? current : undefined` is not enough on its
    // own: if the status query resolves to true only AFTER this screen reached
    // the confirm phase, `current` is still empty and the request goes out bare
    // — which the server scores as a wrong guess and counts toward the lockout.
    // Refuse to send it at all; bounce back and ask for the current PIN.
    if (hasPin && current.length !== 4) {
      setError('Enter your current PIN first.');
      setPin(''); setConfirm(''); setPhase('current');
      return;
    }
    setBusy(true);
    try {
      await createPin(pin, hasPin ? current : undefined);
      setCurrent('');
      finish();
    } catch (e) {
      setError((e as Error)?.message ?? 'Could not set your PIN. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const heading =
    phase === 'current' ? 'Enter your current PIN'
    : phase === 'create' ? (hasPin ? 'Choose a new PIN' : 'Create your transaction PIN')
    : 'Confirm your PIN';

  const subtitle =
    mode === 'required'
      ? 'For your security, set a 4-digit transaction PIN. You’ll use it to authorise payments and sensitive actions.'
      : 'Your transaction PIN protects payments and sensitive actions.';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Manage mode gets a cancel affordance; required mode is blocking. */}
      {mode === 'manage' ? (
        <Pressable onPress={() => router.back()} style={styles.close} hitSlop={10} accessibilityLabel="Close">
          <X size={22} color={Colors.onSurfaceVariant} strokeWidth={2} />
        </Pressable>
      ) : null}

      <View style={styles.body}>
        <View style={styles.iconWrap}>
          <ShieldCheck size={40} color={Colors.primary} strokeWidth={1.8} />
        </View>
        <Text style={styles.title}>{heading}</Text>
        <Text style={styles.sub}>{subtitle}</Text>

        {statusQuery.isLoading ? (
          <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: Spacing.xl }} />
        ) : (
          <View style={styles.pinWrap}>
            {phase === 'current' ? (
              <TripPinInput value={current} onChange={(v) => { setCurrent(v); setError(null); }} error={error ?? undefined} autoFocus />
            ) : phase === 'create' ? (
              <TripPinInput value={pin} onChange={(v) => { setPin(v); setError(null); }} error={error ?? undefined} autoFocus />
            ) : (
              <TripPinInput value={confirm} onChange={(v) => { setConfirm(v); setError(null); }} error={error ?? undefined} autoFocus />
            )}
          </View>
        )}
      </View>

      <View style={styles.footer}>
        {phase === 'current' ? (
          <PrimaryButton label="Continue" onPress={onVerifyCurrent} loading={busy} disabled={current.length !== 4} />
        ) : phase === 'create' ? (
          <PrimaryButton label="Continue" onPress={onSetNew} disabled={pin.length !== 4} />
        ) : (
          <PrimaryButton label="Set PIN" onPress={onConfirm} loading={busy} disabled={confirm.length !== 4} />
        )}
        {mode === 'required' ? (
          <Text style={styles.blockNote}>Setting a transaction PIN is required to continue.</Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  close: { alignSelf: 'flex-end', padding: Spacing.md },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.md },
  iconWrap: { width: 88, height: 88, borderRadius: Radius.full, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.sm },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  pinWrap: { marginTop: Spacing.lg, alignItems: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, gap: Spacing.sm },
  blockNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
