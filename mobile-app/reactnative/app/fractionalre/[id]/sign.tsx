import React, { useState } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import RiskAckSheet from '@/features/fractionalre/components/RiskAckSheet';
import { useOffering, useAcknowledgeRisk } from '@/features/fractionalre/hooks';
import { useInvestDraft } from '@/features/fractionalre/store/investDraftStore';
import { formatNaira } from '@/features/fractionalre/utils';

export default function SignScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const offering = useOffering(id);
  const ack = useAcknowledgeRisk();
  const { draft, patch } = useInvestDraft();
  const [busy, setBusy] = useState(false);

  const o = offering.data;

  const onAccept = async () => {
    if (!o) return;
    setBusy(true);
    try {
      const res = await ack.mutateAsync(o.id);
      patch({ offerRiskAckId: res.riskAckId });
      router.push(`/fractionalre/${o.id}/authorize` as never);
    } catch {
      Alert.alert('Could not record acknowledgement', 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (offering.isLoading || !o) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Subscription agreement" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }

  const body = [
    `You are subscribing for ${draft.units} unit${draft.units === 1 ? '' : 's'} of "${o.title}" for ${formatNaira(draft.amountKobo)} (before fees).`,
    `This is a fractional interest in ${o.spvName}. Your interest is illiquid and your capital is at risk. Projected yields are estimates and are not guaranteed.`,
    ...o.riskFactors.map((r) => `Risk factor: ${r}`),
    'By signing you confirm you have read the offer documents, understand the specific risks of this offering, and agree to the subscription terms and the SPV constitution.',
    'You acknowledge that fees disclosed are confirmed by the server at execution and that payouts depend on the performance of the underlying asset.',
  ].join('\n\n');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Subscription agreement" subtitle="Read & sign to continue" />
      <View style={styles.bodyWrap}>
        <RiskAckSheet
          title={`Risk acknowledgement — ${o.title}`}
          body={body}
          checkLabel="I have read and understood the specific risks of this offering and agree to subscribe."
          confirmLabel="Sign & continue"
          onAccept={onAccept}
          accepting={busy}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  bodyWrap: { flex: 1, padding: Spacing.containerMargin },
});
