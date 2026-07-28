import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';

/**
 * Step-up auth for crypto withdrawals (docs/crypto/compliance.md → OTP/biometric
 * on withdrawals). A 6-digit one-time code is required in addition to the trade
 * PIN used elsewhere, because withdrawals move funds off-platform.
 */
export default function WithdrawOtpScreen() {
  const p = useLocalSearchParams<{ assetId: string; symbol: string; networkId: string; addressId: string; amount: string }>();
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | undefined>();

  const confirm = () => {
    if (otp.length < 6) { setError('Enter the 6-digit code we sent you.'); return; }
    setError(undefined);
    router.push({
      pathname: '/crypto/withdraw/processing',
      params: { ...p, otp },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Confirm withdrawal" subtitle="Extra security check" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.iconBox}>
          <ShieldCheck size={40} color={Colors.primary} strokeWidth={2} />
        </View>
        <Text style={styles.title}>Enter your verification code</Text>
        <Text style={styles.sub}>We sent a 6-digit code to your registered phone and email. This extra step protects your funds on every crypto withdrawal.</Text>

        <View style={styles.field}>
          <TextInputField
            label="Verification code"
            placeholder="6-digit code"
            keyboardType="number-pad"
            maxLength={6}
            value={otp}
            onChangeText={(t) => setOtp(t.replace(/\D/g, '').slice(0, 6))}
            error={error}
          />
        </View>

        <Text style={styles.bio}>You may also be prompted for Face ID / fingerprint on supported devices.</Text>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Submit withdrawal" onPress={confirm} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, alignItems: 'center' },
  iconBox: { width: 80, height: 80, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.lg, marginBottom: Spacing.md },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.sm, marginBottom: Spacing.lg },
  field: { width: '100%' },
  bio: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
