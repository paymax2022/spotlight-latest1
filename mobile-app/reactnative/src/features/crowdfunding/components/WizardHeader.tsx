import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ArrowLeft, X } from 'lucide-react-native';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface Props {
  step: number;          // 1-based
  totalSteps: number;
  title: string;
  onBack?: () => void;
  onClose?: () => void;
}

/** Creation-wizard header: back, "Step n of m", progress bar, step title. */
export default function WizardHeader({ step, totalSteps, title, onBack, onClose }: Props) {
  const pct = Math.round((step / totalSteps) * 100);
  return (
    <View style={styles.wrap}>
      <View style={styles.topRow}>
        <Pressable onPress={onBack ?? (() => router.back())} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back">
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <Text style={styles.counter}>Step {step} of {totalSteps}</Text>
        <Pressable onPress={onClose ?? (() => router.dismissTo('/crowdfunding/creator'))} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Close">
          <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
        </Pressable>
      </View>
      <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View>
      <Text style={styles.title}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, gap: Spacing.sm, backgroundColor: Colors.background },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginHorizontal: -8 },
  counter: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  track: { height: 6, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.full, backgroundColor: Colors.primary },
  title: { ...Typography.headlineMd, color: Colors.onSurface, marginTop: 4 },
});
