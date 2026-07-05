import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CircleCheckBig, Headset } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';

/** Agent booking confirmation (PRD §17 H, screen 58). */
export default function AgentConfirmationScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.icon}><CircleCheckBig size={56} color={Colors.teal} strokeWidth={2} /></View>
        <Text style={styles.title}>Booking confirmed!</Text>
        <Text style={styles.ref}>Reference PMX-AGPREP1</Text>

        <View style={styles.agentCard}>
          <Headset size={18} color={Colors.primary} />
          <Text style={styles.agentText}>Booked with help from Agent Tunde A. The reservation is on your account.</Text>
        </View>

        <Text style={styles.note}>Your voucher and trip details are in My bookings. We've notified the property.</Text>

        <View style={styles.actions}>
          <PrimaryButton label="View my bookings" onPress={() => router.replace('/stays/trips')} />
          <PrimaryButton label="Back to stays" variant="secondary" onPress={() => router.replace('/stays')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md, alignItems: 'stretch' },
  icon: { alignSelf: 'center', width: 96, height: 96, borderRadius: 48, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.xl },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  ref: { ...Typography.labelLg, color: Colors.primary, textAlign: 'center', marginBottom: Spacing.sm },
  agentCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgPurple, borderRadius: Radius.md, padding: Spacing.md },
  agentText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  actions: { gap: Spacing.sm, marginTop: Spacing.md },
});
