import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Heart, Briefcase, Radio, Gift } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useAcceptConsents } from '@/features/connect/hooks/useConnect';

// ON-02 — Welcome carousel. Value prop (date / network / live / gift).
const SLIDES = [
  { icon: Heart, title: 'Find your people', body: 'Verified, intentional connections for dating and friendship.' },
  { icon: Briefcase, title: 'Grow your network', body: 'Meet professionals and communities — kept separate from dating.' },
  { icon: Radio, title: 'Go live & be seen', body: 'Stream, vote in fan contests, and build your audience.' },
  { icon: Gift, title: 'Gift real value', body: 'Send wallet-backed gifts. Recipients get spendable Naira.' },
];

export default function Welcome() {
  const [index, setIndex] = useState(0);
  const Slide = SLIDES[index];
  const Icon = Slide.icon;
  const isLast = index === SLIDES.length - 1;
  const acceptConsents = useAcceptConsents();

  // Entering the wizard — via EITHER "Skip" or the final CTA — records the
  // required consents server-side first, so neither path can bypass the consent
  // gate (ON-08). Guard against double-taps while the record is in flight.
  const enterWizard = () => {
    if (acceptConsents.isPending) return;
    acceptConsents.mutate(undefined, {
      onSuccess: () => router.replace('/connect/onboarding/intent'),
    });
  };

  const onCTA = () => {
    if (!isLast) {
      setIndex((i) => i + 1);
      return;
    }
    enterWizard();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.skipRow}>
        <Pressable
          hitSlop={10}
          disabled={acceptConsents.isPending}
          onPress={enterWizard}
          accessibilityRole="button"
          accessibilityLabel="Skip intro"
        >
          <Text style={[styles.skip, acceptConsents.isPending && styles.skipDisabled]}>Skip</Text>
        </Pressable>
      </View>

      <View style={styles.hero}>
        <View style={styles.iconBox}>
          <Icon size={48} color={Colors.onPrimary} strokeWidth={1.8} />
        </View>
        <Text style={styles.kicker}>PAYMAX CONNECT</Text>
        <Text style={styles.title}>{Slide.title}</Text>
        <Text style={styles.body}>{Slide.body}</Text>
      </View>

      <View style={styles.dots}>
        {SLIDES.map((_, i) => (
          <View key={i} style={[styles.dot, i === index && styles.dotActive, { width: i === index ? 22 : 8 }]} />
        ))}
      </View>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton
          label={isLast ? 'Get started' : 'Next'}
          onPress={onCTA}
          loading={isLast && acceptConsents.isPending}
        />
        <Text style={styles.legal}>
          By continuing you agree to our Community Guidelines, Privacy Policy and Terms.
          You must be 18+ to use Connect.
        </Text>
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  skipRow: { alignItems: 'flex-end', paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  skip: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  skipDisabled: { opacity: 0.4 },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.md },
  iconBox: {
    width: 112, height: 112, borderRadius: Radius.xxl,
    backgroundColor: ConnectColors.brand, alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  kicker: { ...Typography.labelSm, color: Colors.secondary, letterSpacing: 1 },
  title: { ...Typography.headlineLgMobile, color: Colors.onSurface, textAlign: 'center' },
  body: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.xs, marginBottom: Spacing.lg },
  dot: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh },
  dotActive: { backgroundColor: ConnectColors.brand },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, gap: Spacing.sm },
  legal: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
