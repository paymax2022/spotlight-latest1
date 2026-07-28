import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CircleX, TimerReset } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';

export default function BuyFailedScreen() {
  const p = useLocalSearchParams<{ symbol: string; basis: string; amount: string; reason: string; kind: string }>();
  const expired = p.kind === 'quote_expired';

  const retry = () =>
    router.replace({ pathname: '/crypto/buy/review', params: { symbol: p.symbol, basis: p.basis, amount: p.amount } });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <View style={styles.iconBox}>
          {expired ? <TimerReset size={52} color={Colors.error} strokeWidth={2} /> : <CircleX size={52} color={Colors.error} strokeWidth={2} />}
        </View>
        <Text style={styles.title}>{expired ? 'Quote expired' : 'Order failed'}</Text>
        <Text style={styles.sub}>{p.reason}</Text>
        <Text style={styles.note}>No funds were debited. Your balances are unchanged.</Text>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label={expired ? 'Get a new quote' : 'Try again'} onPress={retry} />
        <Pressable style={styles.cancel} onPress={() => router.dismissTo('/crypto')} accessibilityRole="button">
          <Text style={styles.cancelText}>Back to Crypto home</Text>
        </Pressable>
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  iconBox: { width: 104, height: 104, borderRadius: Radius.full, backgroundColor: Colors.errorContainer, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.sm },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  note: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: Spacing.md },
  cancel: { alignItems: 'center', paddingVertical: Spacing.sm },
  cancelText: { ...Typography.labelLg, color: Colors.onSurfaceVariant },
});
