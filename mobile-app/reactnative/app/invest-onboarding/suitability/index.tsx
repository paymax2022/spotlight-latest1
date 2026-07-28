import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ClipboardList, Clock3, Lightbulb } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import {
  SUITABILITY_INTRO,
  SUITABILITY_QUESTION_COUNT,
} from '@/features/investonboarding/constants/onboarding.constants';
import { resetSuitabilityDraft } from '@/features/investonboarding/utils/onboardingDraft';

export default function SuitabilityIntroScreen() {
  const start = () => { resetSuitabilityDraft(); router.push('/invest-onboarding/suitability/questions'); };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Know your profile" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <ClipboardList size={32} color={Colors.primary} strokeWidth={1.8} />
          </View>
          <Text style={styles.title}>A quick suitability check</Text>
          <Text style={styles.sub}>{SUITABILITY_INTRO}</Text>
        </View>

        <View style={styles.points}>
          <View style={styles.point}>
            <Clock3 size={20} color={Colors.teal} strokeWidth={1.8} />
            <Text style={styles.pointText}>{SUITABILITY_QUESTION_COUNT} questions · about 2 minutes</Text>
          </View>
          <View style={styles.point}>
            <Lightbulb size={20} color={Colors.teal} strokeWidth={1.8} />
            <Text style={styles.pointText}>No wrong answers — just be honest about your goals</Text>
          </View>
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Start questionnaire" onPress={start} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.lg },
  hero: { alignItems: 'center', gap: Spacing.sm },
  heroIcon: {
    width: 72, height: 72, borderRadius: Radius.xl,
    backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center',
  },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.sm },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  points: { gap: Spacing.md },
  point: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md,
  },
  pointText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
