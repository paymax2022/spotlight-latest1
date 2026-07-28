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

export default function SendFailedScreen() {
  const p = useLocalSearchParams<{ beneficiaryId: string; source: string; amount: string; narration: string; reason: string; kind: string }>();
  const expired = p.kind === 'rate_expired';

  const retry = () =>
    router.replace({
      pathname: '/fx/send/review',
      params: { beneficiaryId: p.beneficiaryId, source: p.source, amount: p.amount, narration: p.narration ?? '' },
    });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <View style={styles.iconBox}>
          {expired ? <TimerReset size={52} color={Colors.error} strokeWidth={2} /> : <CircleX size={52} color={Colors.error} strokeWidth={2} />}
        </View>
        <Text style={styles.title}>{expired ? 'Rate expired' : 'Payout failed'}</Text>
        <Text style={styles.sub}>{p.reason}</Text>
        <Text style={styles.note}>Your balance was not debited.</Text>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label={expired ? 'Get a new quote' : 'Try again'} onPress={retry} />
        <Pressable style={styles.cancel} onPress={() => router.dismissTo('/fx')} accessibilityRole="button">
          <Text style={styles.cancelText}>Back to FX home</Text>
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
