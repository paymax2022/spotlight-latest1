import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CircleCheck, FileClock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';

export default function CreateSuccessScreen() {
  const { status } = useLocalSearchParams<{ status?: string; id?: string }>();
  const isDraft = status === 'DRAFT';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <View style={[styles.iconBox, isDraft ? styles.iconBoxDraft : styles.iconBoxOk]}>
          {isDraft ? <FileClock size={52} color={Colors.onSurfaceVariant} strokeWidth={2} /> : <CircleCheck size={52} color={Colors.tertiaryContainer} strokeWidth={2} />}
        </View>
        <Text style={styles.title}>{isDraft ? 'Draft saved' : 'Submitted for review! 🎉'}</Text>
        <Text style={styles.sub}>
          {isDraft
            ? 'Your campaign is saved as a draft. You can finish and submit it anytime from My campaigns.'
            : 'Our team will review your campaign — usually within 24–48 hours. We may request changes or more documents. You’ll be notified of the decision.'}
        </Text>

        {!isDraft && (
          <View style={styles.steps}>
            <Step n={1} label="Admin review & verification" />
            <Step n={2} label="Approval or change request" />
            <Step n={3} label="Campaign goes live" />
          </View>
        )}
      </View>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Go to My campaigns" onPress={() => router.dismissTo('/crowdfunding/creator/campaigns')} />
        <PrimaryButton label="Back to dashboard" variant="ghost" onPress={() => router.dismissTo('/crowdfunding/creator')} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

function Step({ n, label }: { n: number; label: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNum}><Text style={styles.stepNumText}>{n}</Text></View>
      <Text style={styles.stepLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  iconBox: { width: 104, height: 104, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  iconBoxOk: { backgroundColor: Colors.iconBgTeal },
  iconBoxDraft: { backgroundColor: Colors.surfaceContainerHigh },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  steps: { alignSelf: 'stretch', gap: Spacing.sm, marginTop: Spacing.md },
  step: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  stepNum: { width: 28, height: 28, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { ...Typography.labelMd, color: Colors.onPrimary },
  stepLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  footer: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.xs, paddingBottom: Spacing.md },
});
