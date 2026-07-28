import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { FileCheck2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';

export default function ApplySubmittedScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.body}>
        <View style={styles.iconBox}>
          <FileCheck2 size={40} color={Colors.tertiaryContainer} strokeWidth={1.8} />
        </View>
        <Text style={styles.title}>Application submitted</Text>
        <Text style={styles.subtitle}>
          The landlord will review your application and respond. We'll notify you of any updates or requests for more information.
        </Text>

        <View style={styles.steps}>
          <Step label="Screening & review" sub="Usually within 48 hours" />
          <Step label="Decision & offer letter" sub="If approved, you'll get a lease offer" />
          <Step label="Sign & pay" sub="Deposit held in escrow until move-in" last />
        </View>
      </View>

      <View style={styles.footer}>
        <PrimaryButton label="Track application" onPress={() => router.replace(`/realtor/application/${id}`)} />
        <PrimaryButton label="Back to marketplace" variant="secondary" onPress={() => router.replace('/realtor')} />
      </View>
    </SafeAreaView>
  );
}

function Step({ label, sub, last }: { label: string; sub: string; last?: boolean }) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepRail}>
        <View style={styles.stepDot} />
        {!last ? <View style={styles.stepLine} /> : null}
      </View>
      <View style={styles.stepBody}>
        <Text style={styles.stepLabel}>{label}</Text>
        <Text style={styles.stepSub}>{sub}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.md },
  iconBox: { width: 88, height: 88, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  subtitle: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  steps: { alignSelf: 'stretch', marginTop: Spacing.lg },
  stepRow: { flexDirection: 'row', gap: Spacing.md },
  stepRail: { alignItems: 'center', width: 16 },
  stepDot: { width: 12, height: 12, borderRadius: Radius.full, backgroundColor: Colors.primary, marginTop: 4 },
  stepLine: { flex: 1, width: 2, backgroundColor: Colors.outlineVariant, marginVertical: 4 },
  stepBody: { flex: 1, paddingBottom: Spacing.lg },
  stepLabel: { ...Typography.labelLg, color: Colors.onSurface },
  stepSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: Spacing.md },
});
