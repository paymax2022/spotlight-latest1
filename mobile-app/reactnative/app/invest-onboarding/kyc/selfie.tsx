import React, { useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ScanFace, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StepHeader from '@/features/investonboarding/components/StepHeader';
import { kycDraft } from '@/features/investonboarding/utils/onboardingDraft';

export default function KycSelfieScreen() {
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'done'>(
    kycDraft.current.selfieUploaded ? 'done' : 'idle',
  );

  const capture = () => {
    setPhase('scanning');
    setTimeout(() => {
      kycDraft.current.selfieUploaded = true;
      setPhase('done');
    }, 1600);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Liveness check" />
      <StepHeader step={3} total={4} label="Selfie" />

      <View style={styles.center}>
        <View style={[styles.ring, phase === 'done' && styles.ringDone]}>
          {phase === 'scanning'
            ? <ActivityIndicator size="large" color={Colors.primary} />
            : phase === 'done'
            ? <CircleCheck size={64} color={Colors.tertiaryContainer} strokeWidth={1.8} />
            : <ScanFace size={64} color={Colors.primary} strokeWidth={1.5} />}
        </View>
        <Text style={styles.title}>
          {phase === 'done' ? 'Selfie captured' : phase === 'scanning' ? 'Hold still…' : 'Take a quick selfie'}
        </Text>
        <Text style={styles.sub}>
          {phase === 'done'
            ? 'Your liveness check passed. You can continue.'
            : 'Position your face in the frame and blink when prompted. Make sure you are in a well-lit area.'}
        </Text>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {phase === 'done' ? (
          <PrimaryButton label="Continue" onPress={() => router.push('/invest-onboarding/kyc/review')} />
        ) : (
          <PrimaryButton label={phase === 'scanning' ? 'Scanning…' : 'Start liveness check'} onPress={capture} loading={phase === 'scanning'} />
        )}
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  ring: { width: 180, height: 180, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainer, borderWidth: 3, borderColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  ringDone: { backgroundColor: Colors.iconBgTeal, borderColor: Colors.teal },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.md },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
