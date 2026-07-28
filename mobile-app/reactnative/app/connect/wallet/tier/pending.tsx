import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';

// WL-17 — Upgrade under review. Server owns the final decision; the client just
// reflects the pending state.
export default function TierPending() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Under review" />
      <View style={styles.body}>
        <View style={styles.iconBox}><Clock size={40} color={Colors.gold} strokeWidth={1.8} /></View>
        <Text style={styles.title}>Your upgrade is under review</Text>
        <Text style={styles.message}>
          We're verifying your documents. This usually takes up to 24 hours. We'll notify you the
          moment your new tier is active. Your current limits stay in effect until then.
        </Text>
        <View style={styles.actions}>
          <PrimaryButton label="Back to tier status" onPress={() => router.replace('/connect/wallet/tier/status')} />
          <PrimaryButton label="Go to wallet" variant="ghost" onPress={() => router.replace('/connect/wallet/home')} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  iconBox: { width: 80, height: 80, borderRadius: Radius.full, backgroundColor: Colors.iconBgGold, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  message: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: Spacing.sm, marginTop: Spacing.md },
});
