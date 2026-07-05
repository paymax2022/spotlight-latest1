import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import SectionHeader from '@/components/SectionHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import DeviceRow from '@/features/investsettings/components/DeviceRow';
import { useChangePin, useDevices, useRevokeDevice } from '@/features/investsettings/hooks/useSettings';

export default function SecurityScreen() {
  const devices = useDevices();
  const revoke = useRevokeDevice();
  const changePin = useChangePin();

  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState(false);

  const submitPin = () => {
    setDone(false);
    if (oldPin.length !== 4 || newPin.length !== 4) { setError('PINs must be 4 digits.'); return; }
    if (newPin !== confirmPin) { setError('New PINs don\'t match.'); return; }
    setError(undefined);
    changePin.mutate(
      { oldPin, newPin },
      {
        onSuccess: () => { setDone(true); setOldPin(''); setNewPin(''); setConfirmPin(''); },
        onError: (e: unknown) => setError((e as Error).message),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Security center" subtitle="PIN, devices & sessions" />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Change PIN */}
        <SectionHeader title="Transaction PIN" />
        <View style={styles.card}>
          <TextInputField label="Current PIN" placeholder="••••" secure keyboardType="number-pad"
            maxLength={4} value={oldPin} onChangeText={(t) => setOldPin(t.replace(/\D/g, ''))} />
          <TextInputField label="New PIN" placeholder="••••" secure keyboardType="number-pad"
            maxLength={4} value={newPin} onChangeText={(t) => setNewPin(t.replace(/\D/g, ''))} />
          <TextInputField label="Confirm new PIN" placeholder="••••" secure keyboardType="number-pad"
            maxLength={4} value={confirmPin} onChangeText={(t) => setConfirmPin(t.replace(/\D/g, ''))}
            error={error} />
          {done ? (
            <View style={styles.successRow}>
              <CheckCircle2 size={16} color={Colors.tertiary} strokeWidth={2} />
              <Text style={styles.successText}>Your PIN was updated.</Text>
            </View>
          ) : null}
          <PrimaryButton label="Update PIN" onPress={submitPin} loading={changePin.isPending} style={styles.pinBtn} />
        </View>

        {/* Devices / sessions */}
        <SectionHeader title="Active sessions" style={styles.sectionHeader} />
        {devices.isLoading ? (
          <StateView kind="loading" compact message="Loading devices…" />
        ) : devices.isError ? (
          <StateView kind="error" compact title="Couldn't load devices" message="Please try again."
            actionLabel="Retry" onAction={() => devices.refetch()} />
        ) : (
          <View style={styles.deviceList}>
            {(devices.data ?? []).map((d) => (
              <DeviceRow key={d.id} device={d} revoking={revoke.isPending} onRevoke={() => revoke.mutate(d.id)} />
            ))}
          </View>
        )}
        <Text style={styles.note}>
          Revoking a session signs that device out immediately. Your current device can't be revoked here.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl },
  card: {
    marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.lg,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  pinBtn: { marginTop: Spacing.xs },
  successRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.sm },
  successText: { ...Typography.labelSm, color: Colors.tertiary },
  sectionHeader: { marginTop: Spacing.sm },
  deviceList: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm },
  note: {
    ...Typography.bodySm, color: Colors.onSurfaceVariant,
    paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.md,
  },
});
