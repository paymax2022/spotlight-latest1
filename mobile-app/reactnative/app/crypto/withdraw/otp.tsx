import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import PinSheet from '@/features/transfers/components/PinSheet';
import { setWithdrawalPin } from '@/features/crypto/utils/withdrawStepUp';

/**
 * Step-up for crypto withdrawals: the user's transaction PIN, verified by the
 * SERVER before anything moves (POST /crypto/withdrawals → 403 pin_invalid).
 * It used to ask for a "6-digit code we sent you" that was never sent and was
 * thrown away client-side. The PIN is handed to the submit step in memory, once
 * (never in route params, which on web end up in the URL).
 */
export default function WithdrawPinScreen() {
  const p = useLocalSearchParams<{
    assetId: string; symbol: string; networkId: string; addressId: string; amount: string; pinError?: string;
  }>();
  const [sheetOpen, setSheetOpen] = useState(true);

  const submit = (pin: string) => {
    setSheetOpen(false);
    setWithdrawalPin(pin);
    const { assetId, symbol, networkId, addressId, amount } = p;
    router.push({ pathname: '/crypto/withdraw/processing', params: { assetId, symbol, networkId, addressId, amount } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Confirm withdrawal" subtitle="Security check" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.iconBox}>
          <ShieldCheck size={40} color={Colors.primary} strokeWidth={2} />
        </View>
        <Text style={styles.title}>Confirm with your transaction PIN</Text>
        <Text style={styles.sub}>
          Crypto sent to an outside address can't be reversed, so every withdrawal needs your PIN.
        </Text>
        {p.pinError ? (
          <Text style={styles.error} accessibilityRole="alert">{p.pinError}</Text>
        ) : null}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Enter PIN" onPress={() => setSheetOpen(true)} />
      </SafeAreaView>

      <PinSheet
        visible={sheetOpen}
        mode="verify"
        title="Enter your transaction PIN"
        error={p.pinError ?? null}
        onSubmit={submit}
        onClose={() => setSheetOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, alignItems: 'center' },
  iconBox: { width: 80, height: 80, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.lg, marginBottom: Spacing.md },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.sm, marginBottom: Spacing.lg },
  error: { ...Typography.bodyMd, color: Colors.error, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
