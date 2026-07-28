import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CircleDollarSign, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { PHARMACY_BNPL_ENABLED } from '@/features/health/pharmacy/constants';

/**
 * Health-BNPL ("pay later" on a bill) is OFF by default (HEALTH-BUILD §4): it
 * triggers the FCCPC DEON regime and must be partner-powered + separately
 * approved. This screen renders a clear "coming soon / unavailable" placeholder
 * while the flag is off, and never offers credit.
 */
export default function PharmacyBnplScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Pay later" subtitle="Health financing" />

      <View style={styles.content}>
        <View style={[styles.card, shadow1]}>
          <View style={styles.iconWrap}>
            <CircleDollarSign size={34} color={Colors.onSurfaceVariant} strokeWidth={1.6} />
            <View style={styles.lockBadge}>
              <Lock size={13} color={Colors.white} strokeWidth={2.4} />
            </View>
          </View>

          <Text style={styles.title}>
            {PHARMACY_BNPL_ENABLED ? 'Pay later is coming soon' : 'Pay later isn’t available yet'}
          </Text>
          <Text style={styles.body}>
            Health financing (“pay later”) is a regulated credit product. It will only be offered through an
            approved licensed partner, with clear terms and affordability checks. Until then, you can pay
            securely from your wallet or by card at checkout.
          </Text>

          <View style={styles.note}>
            <Lock size={14} color={Colors.teal} strokeWidth={2} />
            <Text style={styles.noteText}>
              We never charge interest or fees without your explicit, informed consent.
            </Text>
          </View>
        </View>

        <PrimaryButton label="Back to pharmacy" onPress={() => router.replace('/health/pharmacy')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { flex: 1, padding: Spacing.containerMargin, gap: Spacing.lg, justifyContent: 'center' },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.md,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: Radius.xl,
    backgroundColor: Colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockBadge: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.onSurfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.surfaceContainerLowest,
  },
  title: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  body: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 22 },
  note: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md },
  noteText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
});
