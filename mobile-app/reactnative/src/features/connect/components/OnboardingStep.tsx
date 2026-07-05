import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { ConnectColors } from '../constants/connect.constants';

interface Props {
  step: number;          // 1-based
  totalSteps: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  primaryLoading?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
  showBack?: boolean;
  footerNote?: string;   // e.g. safety/privacy reassurance
}

/**
 * Shared onboarding scaffold: progress bar + header + scroll body + sticky CTA.
 * Mirrors the crowdfunding wizard chrome (SafeAreaView + ScreenHeader + footer).
 */
export default function OnboardingStep({
  step,
  totalSteps,
  title,
  subtitle,
  children,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  primaryLoading,
  secondaryLabel,
  onSecondary,
  showBack = true,
  footerNote,
}: Props) {
  const pct = Math.round((step / totalSteps) * 100);
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader showBack={showBack} subtitle={`Step ${step} of ${totalSteps}`} />
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct}%` }]} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        <View style={styles.content}>{children}</View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {footerNote ? <Text style={styles.footerNote}>{footerNote}</Text> : null}
        <PrimaryButton
          label={primaryLabel}
          onPress={onPrimary}
          disabled={primaryDisabled}
          loading={primaryLoading}
        />
        {secondaryLabel && onSecondary ? (
          <PrimaryButton label={secondaryLabel} variant="ghost" onPress={onSecondary} />
        ) : null}
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  progressTrack: {
    height: 4,
    backgroundColor: Colors.surfaceContainerHigh,
    marginHorizontal: Spacing.containerMargin,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: ConnectColors.brand, borderRadius: Radius.full },
  body: { padding: Spacing.containerMargin, paddingBottom: Spacing.xl },
  title: { ...Typography.headlineMd, color: Colors.onSurface, marginTop: Spacing.md },
  subtitle: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  content: { marginTop: Spacing.lg, gap: Spacing.md },
  footer: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.xs, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
  footerNote: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center', marginBottom: Spacing.xs },
});
