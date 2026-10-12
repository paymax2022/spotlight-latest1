import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Clock } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import PrimaryButton from '@/components/PrimaryButton';
import { formatFiat } from '@/features/crypto/utils/cryptoFormatters';

// Terminal screen for a swap the reconciler parked as `needs_review` (HTTP 202):
// the NGN is held, the exchange outcome is still unknown, and support/compliance
// will settle or release it. Never claims the order succeeded or failed.
export default function BuyPendingScreen() {
  const p = useLocalSearchParams<{ symbol: string; fiat?: string; txId: string }>();
  const held = p.fiat ? formatFiat(Number(p.fiat), 'NGN') : 'your payment';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <View style={styles.iconBox}>
          <Clock size={52} color={Colors.primary} strokeWidth={2} />
        </View>
        <Text style={styles.title}>Order under review</Text>
        <Text style={styles.sub}>
          We're confirming your {p.symbol} purchase with the exchange. {held} is held securely while we check — you don't
          need to do anything. We'll update this order as soon as it settles.
        </Text>
        <View style={styles.refCard}>
          <Text style={styles.refText}>Reference · {p.txId?.slice(0, 8).toUpperCase()}</Text>
        </View>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="View order" variant="secondary" onPress={() => router.replace(`/crypto/transactions/${p.txId}`)} />
        <PrimaryButton label="Back to Crypto home" onPress={() => router.dismissTo('/crypto')} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  iconBox: { width: 104, height: 104, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.sm },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  refCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 8, marginTop: Spacing.sm },
  refText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: Spacing.md },
});
