import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Headset, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { StaysColors } from '@/features/stays/constants/stays.constants';

const STEPS = ['Connecting you to an available agent', 'Agent reviewing your preferences', 'Agent preparing options'];

/** Agent-shared booking link / handoff (PRD §17 H, screen 56). */
export default function HandoffScreen() {
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length)), 800);
    const done = setTimeout(() => setReady(true), 2800);
    return () => {
      clearInterval(t);
      clearTimeout(done);
    };
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Agent handoff" subtitle="Connecting…" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Headset size={28} color={Colors.primary} /></View>
          <Text style={styles.title}>{ready ? 'Your agent has prepared a booking' : 'Connecting you with an agent…'}</Text>
        </View>

        {!ready ? (
          <View style={styles.steps}>
            <ActivityIndicator color={Colors.primary} />
            {STEPS.map((s, i) => (
              <View key={s} style={styles.stepRow}>
                <View style={[styles.dot, i < step && styles.dotOn]}>{i < step ? <Check size={10} color={Colors.onPrimary} strokeWidth={3} /> : null}</View>
                <Text style={[styles.stepText, i < step && styles.stepTextOn]}>{s}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.readyCard}>
            <Check size={18} color={StaysColors.ok} strokeWidth={2.4} />
            <Text style={styles.readyText}>An agent has held a rate and prepared a booking for you. Review and pay securely — the booking is on your account.</Text>
          </View>
        )}
      </ScrollView>

      {ready ? (
        <View style={styles.footer}>
          <PrimaryButton label="Review & pay" onPress={() => router.replace('/stays/agent/pay-prepared')} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.lg },
  hero: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  heroIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  steps: { gap: Spacing.md, alignItems: 'center' },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, alignSelf: 'stretch' },
  dot: { width: 20, height: 20, borderRadius: 10, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: Colors.primary },
  stepText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  stepTextOn: { color: Colors.onSurface, fontWeight: '600' as const },
  readyCard: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, padding: Spacing.md, alignItems: 'center' },
  readyText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
});
