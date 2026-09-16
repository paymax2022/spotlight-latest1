import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { X, CreditCard, Check, ScanLine, Package, Wifi } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { useActivateAccessCard } from '@/features/academy/hooks';
import { formatNaira } from '@/features/academy/constants';
import type { AccessCardResult } from '@/features/academy/types';

/**
 * W7 — Access card redemption. Agent-sold prepaid card → unlock access/data.
 * This is the offline-economy on-ramp: a learner buys a scratch card from an
 * agent, enters the code, and unlocks a bundle + study data. No card needed for
 * minors’ consent (the card itself is the paid grant), but redemption result is
 * applied to the wallet/access state.
 */
export default function AccessCardRedemption() {
  const [code, setCode] = useState('');
  const activate = useActivateAccessCard();
  const [result, setResult] = useState<AccessCardResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const valid = code.trim().replace(/[\s-]/g, '').length >= 8;

  const redeem = () => {
    setError(null);
    activate.mutate(code.trim(), {
      onSuccess: (r) => setResult(r),
      onError: (e) => setError(e instanceof Error ? e.message : 'Could not activate card'),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Access card</Text>
        <Pressable onPress={() => goBack('/learn/academy/store')} hitSlop={8}><X size={24} color={Colors.onSurface} /></Pressable>
      </View>

      {result ? (
        <View style={styles.successWrap}>
          <View style={styles.successIcon}><Check size={32} color={Colors.onPrimary} strokeWidth={3} /></View>
          <Text style={styles.successTitle}>Card activated</Text>
          <Text style={styles.successSub}>Worth {formatNaira(result.valueKobo)}. Unlocked:</Text>
          <View style={styles.unlockList}>
            {result.unlocked.map((u, i) => (
              <View key={i} style={[styles.unlockRow, shadow1]}>
                {u.kind === 'data' ? <Wifi size={18} color={Colors.teal} /> : <Package size={18} color={Colors.primary} />}
                <Text style={styles.unlockText}>{u.label}</Text>
              </View>
            ))}
          </View>
          <View style={{ width: '100%', marginTop: Spacing.lg }}><PrimaryButton label="Start learning" onPress={() => router.replace('/learn/academy')} /></View>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.illus}><CreditCard size={36} color={Colors.primary} /></View>
            <Text style={styles.lead}>Bought a Spotlight Academy card from an agent? Enter the code to unlock prep packs and study data — no card or bank needed.</Text>
            <TextInputField
              label="Card code"
              placeholder="SPA-XXXX-XXXX"
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase())}
              autoCapitalize="characters"
              leftIcon={<ScanLine size={18} color={Colors.outline} />}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Text style={styles.hint}>Tip: any code of 8+ characters works in this preview build.</Text>
          </ScrollView>
          <View style={styles.footer}>
            <PrimaryButton label="Activate card" onPress={redeem} disabled={!valid} loading={activate.isPending} />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.containerMargin },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  illus: { width: 80, height: 80, borderRadius: Radius.lg, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  lead: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  error: { ...Typography.bodySm, color: Colors.error },
  hint: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center' },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  successWrap: { flex: 1, alignItems: 'center', padding: Spacing.xl },
  successIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.teal, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  successTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  successSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  unlockList: { width: '100%', marginTop: Spacing.md, gap: Spacing.sm },
  unlockRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  unlockText: { ...Typography.bodyMd, color: Colors.onSurface },
});
