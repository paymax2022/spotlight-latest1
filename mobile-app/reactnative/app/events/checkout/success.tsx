import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { PartyPopper } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { EventColors } from '@/features/events/constants/events.constants';

export default function CheckoutSuccess() {
  const { count } = useLocalSearchParams<{ count: string; eventId: string }>();
  const n = parseInt(count ?? '1', 10) || 1;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.body}>
        <View style={styles.iconCircle}>
          <PartyPopper size={48} color={EventColors.ok} strokeWidth={1.8} />
        </View>
        <Text style={styles.title}>You're in!</Text>
        <Text style={styles.sub}>
          {n} ticket{n > 1 ? 's' : ''} {n > 1 ? 'have' : 'has'} been issued to your Paymax account. Show your pass at the gate.
        </Text>
      </View>
      <View style={styles.footer}>
        <PrimaryButton label="View my tickets" onPress={() => router.replace('/events/my-tickets')} />
        <PrimaryButton label="Back to events" variant="ghost" onPress={() => router.replace('/events')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.md },
  iconCircle: { width: 96, height: 96, borderRadius: Radius.full, backgroundColor: EventColors.okBg, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  sub: { ...Typography.bodyMd, color: EventColors.muted, textAlign: 'center', lineHeight: 24 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg, gap: Spacing.xs },
});
