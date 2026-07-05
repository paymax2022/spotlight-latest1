import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Sparkles, Check, X, GraduationCap } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1, shadow3 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SectionHeader from '@/components/SectionHeader';
import PrimaryButton from '@/components/PrimaryButton';
import SuggestedChip from '@/features/investai/components/SuggestedChip';
import DisclaimerNote from '@/features/investai/components/DisclaimerNote';
import { SUGGESTED_QUESTIONS } from '@/features/investai/constants/ai.constants';
import type { SuggestedQuestion } from '@/features/investai/types/ai.types';

const CAN = [
  'Explain investing terms in plain language',
  'Break down risk, volatility, fees & settlement',
  'Summarise how orders and quotes work in the app',
  'Share neutral, educational asset overviews',
];

const CANNOT = [
  'Tell you what to buy, sell, or hold',
  'Predict prices or promise returns',
  'Give personalized financial advice',
];

export default function InvestAiIntroScreen() {
  const startChat = (q?: SuggestedQuestion) =>
    router.push({ pathname: '/invest-ai/chat', params: q ? { q: q.text } : {} });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Invest AI" subtitle="Learn how investing works" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Hero */}
        <LinearGradient
          colors={Colors.gradientPurple}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.hero, shadow3]}
        >
          <View style={styles.heroIcon}>
            <Sparkles size={22} color={Colors.onPrimary} strokeWidth={2} />
          </View>
          <Text style={styles.heroTitle}>Your investing education assistant</Text>
          <Text style={styles.heroSub}>
            Ask anything about how investing works. I explain concepts so you can make
            your own informed decisions — I never give personalized advice.
          </Text>
        </LinearGradient>

        {/* What it can do */}
        <View style={styles.section}>
          <SectionHeader title="What it can do" />
          <View style={styles.card}>
            {CAN.map((c) => (
              <View key={c} style={styles.bulletRow}>
                <View style={styles.bulletIconOk}>
                  <Check size={14} color={Colors.teal} strokeWidth={2.5} />
                </View>
                <Text style={styles.bulletText}>{c}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* What it can't do */}
        <View style={styles.section}>
          <SectionHeader title="What it won't do" />
          <View style={styles.card}>
            {CANNOT.map((c) => (
              <View key={c} style={styles.bulletRow}>
                <View style={styles.bulletIconNo}>
                  <X size={14} color={Colors.error} strokeWidth={2.5} />
                </View>
                <Text style={styles.bulletText}>{c}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Suggested questions */}
        <View style={styles.section}>
          <SectionHeader title="Try asking" />
          <View style={styles.chips}>
            {SUGGESTED_QUESTIONS.map((q) => (
              <SuggestedChip key={q.id} question={q} onPress={startChat} />
            ))}
          </View>
        </View>

        {/* Disclaimer */}
        <View style={styles.disclaimerWrap}>
          <DisclaimerNote />
        </View>
      </ScrollView>

      {/* Start chat CTA */}
      <View style={styles.footer}>
        <View style={styles.learnHint}>
          <GraduationCap size={16} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.learnText}>Educational only — not financial advice.</Text>
        </View>
        <PrimaryButton label="Start chat" onPress={() => startChat()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl },
  section: { marginTop: Spacing.lg },
  card: {
    marginHorizontal: Spacing.containerMargin,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
    gap: Spacing.sm,
  },

  hero: {
    marginHorizontal: Spacing.containerMargin,
    marginTop: Spacing.md,
    borderRadius: Radius.xl,
    padding: Spacing.cardPadding,
    overflow: 'hidden',
  },
  heroIcon: {
    width: 44, height: 44, borderRadius: Radius.md,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  heroTitle: { ...Typography.titleLg, color: Colors.onPrimary },
  heroSub: { ...Typography.bodySm, color: 'rgba(255,255,255,0.82)', marginTop: Spacing.xs, lineHeight: 20 },

  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  bulletIconOk: {
    width: 24, height: 24, borderRadius: Radius.full,
    backgroundColor: Colors.iconBgTeal,
    alignItems: 'center', justifyContent: 'center',
  },
  bulletIconNo: {
    width: 24, height: 24, borderRadius: Radius.full,
    backgroundColor: Colors.iconBgRed,
    alignItems: 'center', justifyContent: 'center',
  },
  bulletText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin },

  disclaimerWrap: { marginHorizontal: Spacing.containerMargin, marginTop: Spacing.lg },

  footer: {
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceContainerHigh,
    backgroundColor: Colors.background,
  },
  learnHint: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, justifyContent: 'center' },
  learnText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
