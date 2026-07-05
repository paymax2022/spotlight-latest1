import React, { useState } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import RiskAckSheet from '@/features/fractionalre/components/RiskAckSheet';
import { MASTER_RISK_DISCLOSURE } from '@/features/fractionalre/constants';
import { useActivate, useAcknowledgeRisk } from '@/features/fractionalre/hooks';

export default function ActivateScreen() {
  const activate = useActivate();
  const ack = useAcknowledgeRisk();
  const [busy, setBusy] = useState(false);

  const onAccept = async () => {
    setBusy(true);
    try {
      await ack.mutateAsync('master');
      await activate.mutateAsync();
      router.push('/fractionalre/onboarding/suitability');
    } catch {
      Alert.alert('Could not activate', 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Master risk disclosure" subtitle="Read & accept to continue" />
      <View style={styles.body}>
        <RiskAckSheet
          title="Important risk disclosure"
          body={MASTER_RISK_DISCLOSURE}
          checkLabel="I have read and understand these risks. I confirm any investment decision is my own."
          confirmLabel="Accept & activate investing"
          onAccept={onAccept}
          accepting={busy}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, padding: Spacing.containerMargin },
});
