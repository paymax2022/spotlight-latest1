import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2, Clock, CreditCard } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import type { ApplicationStatus } from '@/features/association/types/association.types';

type Variant = { icon: React.ReactNode; tint: string; bg: string; title: string; message: string; primary: string; primaryTo: string; secondary?: string };

export default function ApplicationSubmitted() {
  const { status } = useLocalSearchParams<{ status: ApplicationStatus; app?: string }>();

  const v = variantFor(status ?? 'PENDING_CHAPTER');

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.body}>
        <View style={[styles.iconBox, { backgroundColor: v.bg }]}>{v.icon}</View>
        <Text style={styles.title}>{v.title}</Text>
        <Text style={styles.message}>{v.message}</Text>
      </View>

      <View style={styles.footer}>
        <PrimaryButton label={v.primary} onPress={() => router.replace(v.primaryTo as never)} />
        {v.secondary ? (
          <PrimaryButton label={v.secondary} variant="ghost" onPress={() => router.replace('/association')} />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function variantFor(status: ApplicationStatus): Variant {
  switch (status) {
    case 'APPROVED':
      return {
        icon: <CheckCircle2 size={40} color={Colors.teal} strokeWidth={2} />,
        tint: Colors.teal, bg: Colors.iconBgTeal,
        title: 'Welcome aboard!',
        message: 'Your membership is active. Your digital membership card is ready.',
        primary: 'View my membership', primaryTo: '/association/home', secondary: 'Back to discovery',
      };
    case 'PENDING_PAYMENT':
      return {
        icon: <CreditCard size={40} color={Colors.primary} strokeWidth={2} />,
        tint: Colors.primary, bg: Colors.iconBgPurple,
        title: 'Almost there',
        message: 'Complete your registration payment to activate your membership.',
        primary: 'Continue to payment', primaryTo: '/association/dues', secondary: 'Do it later',
      };
    default:
      return {
        icon: <Clock size={40} color={Colors.gold} strokeWidth={2} />,
        tint: Colors.gold, bg: Colors.iconBgGold,
        title: 'Application submitted',
        message: 'Your application has been sent for approval. We’ll notify you once a chapter admin reviews it.',
        primary: 'Track my application', primaryTo: '/association/home', secondary: 'Back to discovery',
      };
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.md },
  iconBox: { width: 88, height: 88, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  message: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg, gap: Spacing.sm },
});
