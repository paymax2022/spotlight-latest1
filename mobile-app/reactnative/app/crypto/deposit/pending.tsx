import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Hourglass, Receipt } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';

/**
 * On-chain deposits are credited only after the network reaches the required
 * confirmations and the custody provider detects the transfer — so the terminal
 * state here is "watching for your deposit", not an instant success.
 */
export default function DepositPendingScreen() {
  const p = useLocalSearchParams<{ symbol: string; networkName: string; confirmations: string }>();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <View style={styles.iconBox}>
          <Hourglass size={50} color={Colors.onPrimaryFixedVariant} strokeWidth={2} />
        </View>
        <Text style={styles.title}>Watching for your deposit</Text>
        <Text style={styles.sub}>
          Once your {p.symbol} transfer reaches {p.confirmations ?? 'the required'} confirmations on {p.networkName}, it will be credited to your crypto wallet automatically. This can take a few minutes.
        </Text>

        <View style={styles.tipCard}>
          <Text style={styles.tipText}>You can safely leave this screen — we'll notify you when your deposit lands.</Text>
        </View>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Pressable style={styles.receiptBtn} onPress={() => router.replace('/crypto/transactions')} accessibilityRole="button">
          <Receipt size={18} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.receiptText}>View activity</Text>
        </Pressable>
        <PrimaryButton label="Done" onPress={() => router.dismissTo('/crypto')} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  iconBox: { width: 104, height: 104, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.sm },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  tipCard: { alignSelf: 'stretch', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.sm },
  tipText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 18 },
  footer: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: Spacing.md },
  receiptBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.secondary },
  receiptText: { ...Typography.labelLg, color: Colors.secondary },
});
