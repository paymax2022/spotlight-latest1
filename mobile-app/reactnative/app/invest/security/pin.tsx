import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Lock, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { usePINStatus, useSetPIN } from '@/features/invest/hooks/useInvest';
import { alertAsync } from '@/lib/confirm';

export default function SetPINScreen() {
  const status = usePINStatus();
  const setPin = useSetPIN();
  const hasPin = status.data?.pin_set ?? false;

  const [current, setCurrent] = useState('');
  const [pin, setPinValue] = useState('');
  const [confirm, setConfirm] = useState('');

  const pinValid = /^\d{4,6}$/.test(pin);
  const match = pin === confirm;
  const canSubmit = pinValid && match && (!hasPin || /^\d{4,6}$/.test(current)) && !setPin.isPending;

  async function submit() {
    try {
      await setPin.mutateAsync({ pin, currentPin: hasPin ? current : undefined });
      alertAsync({ title: 'PIN saved', message: 'Your transaction PIN is set. You can now confirm orders.' }).then(() => goBack('/invest'));
    } catch (e: any) {
      alertAsync({ title: 'Could not save PIN', message: e?.response?.data?.error ?? 'Please try again.' });
    }
  }

  if (status.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Transaction PIN" />
        <StateView kind="loading" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={hasPin ? 'Change PIN' : 'Set transaction PIN'} />
      <ScrollView contentContainerStyle={{ padding: Spacing.containerMargin }} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <ShieldCheck size={28} color={Colors.primary} />
        </View>
        <Text style={styles.body}>
          Your transaction PIN confirms every buy and sell order. Choose a 4–6 digit PIN you’ll remember
          — it’s never shown to anyone and can’t be recovered, only reset.
        </Text>

        {hasPin && (
          <Field label="Current PIN" value={current} onChange={setCurrent} />
        )}
        <Field label={hasPin ? 'New PIN' : 'Choose PIN'} value={pin} onChange={setPinValue} />
        <Field label="Confirm PIN" value={confirm} onChange={setConfirm} />
        {!match && confirm.length > 0 && <Text style={styles.err}>PINs don’t match.</Text>}

        <PrimaryButton
          label={setPin.isPending ? 'Saving…' : hasPin ? 'Update PIN' : 'Set PIN'}
          onPress={submit}
          loading={setPin.isPending}
          disabled={!canSubmit}
          style={{ marginTop: Spacing.lg }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (t: string) => void }) {
  return (
    <View style={{ marginTop: Spacing.md }}>
      <View style={styles.fieldHeader}>
        <Lock size={14} color={Colors.onSurfaceVariant} />
        <Text style={styles.fieldLabel}>{label}</Text>
      </View>
      <TextInput
        value={value}
        onChangeText={(t) => onChange(t.replace(/[^0-9]/g, '').slice(0, 6))}
        placeholder="••••"
        placeholderTextColor={Colors.outline}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  hero: {
    width: 60, height: 60, borderRadius: Radius.lg, backgroundColor: Colors.iconBgPurple,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md,
  },
  body: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  fieldHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: Spacing.xs },
  fieldLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  input: {
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, height: 56,
    ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center', letterSpacing: 8,
  },
  err: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
});
