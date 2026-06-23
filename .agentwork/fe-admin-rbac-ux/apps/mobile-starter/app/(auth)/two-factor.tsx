// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { AppText } from '@/components/ui/AppText';
import { AppCard } from '@/components/ui/AppCard';

export default function TwoFactorScreen() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleVerify = async () => {
    setError('');
    if (!code || code.length !== 6) {
      setError('Please enter the 6-digit code from your authenticator app.');
      return;
    }
    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 1000));
      router.push('/(protected)/(tabs)' as never);
    } catch {
      setError('Invalid code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => (step === 2 ? setStep(1) : router.back())} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </Pressable>
        <Text style={styles.headerTitle}>Two-Factor Authentication</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.stepIndicator}>
          {[1, 2].map((s) => (
            <View key={s} style={styles.stepRow}>
              <View style={[styles.stepDot, step >= s && styles.stepDotActive]}>
                <Text style={[styles.stepNum, step >= s && styles.stepNumActive]}>{s}</Text>
              </View>
              <AppText variant="caption" style={step === s ? styles.stepLabelActive : styles.stepLabel}>
                {s === 1 ? 'Scan QR Code' : 'Verify Code'}
              </AppText>
              {s < 2 && <View style={[styles.stepLine, step > s && styles.stepLineActive]} />}
            </View>
          ))}
        </View>

        {step === 1 ? (
          <View style={styles.stepContent}>
            <AppText variant="h2" style={styles.stepTitle}>Set up Authenticator App</AppText>
            <AppText variant="body" style={styles.stepBody}>
              Scan the QR code below with your authenticator app (Google Authenticator, Authy, etc.) to link your account.
            </AppText>
            <AppCard style={styles.qrPlaceholder}>
              <Ionicons name="qr-code" size={120} color={colors.neutral.textMuted} />
              <AppText variant="caption" style={styles.qrCaption}>QR Code placeholder</AppText>
            </AppCard>
            <AppText variant="caption" style={styles.manualKey}>
              Manual key: PAYMAX-2FA-XXXX-YYYY
            </AppText>
            <AppButton title="Next: Verify Code" variant="primary" onPress={() => setStep(2)} />
          </View>
        ) : (
          <View style={styles.stepContent}>
            <AppText variant="h2" style={styles.stepTitle}>Enter Verification Code</AppText>
            <AppText variant="body" style={styles.stepBody}>
              Enter the 6-digit code displayed in your authenticator app.
            </AppText>

            {error ? (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle" size={18} color="#dc2626" />
                <AppText variant="caption" style={styles.errorText}>{error}</AppText>
              </View>
            ) : null}

            <AppInput
              label="6-Digit Code"
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              placeholder="000000"
            />
            <AppButton title="Verify & Enable 2FA" variant="primary" loading={loading} onPress={handleVerify} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: {
    backgroundColor: colors.primary.DEFAULT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backBtn: { padding: 4, width: 40 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
  content: { padding: 20, gap: 20 },
  stepIndicator: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 0 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.neutral.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotActive: { backgroundColor: colors.primary.DEFAULT },
  stepNum: { fontSize: 13, fontWeight: '700', color: colors.neutral.textMuted },
  stepNumActive: { color: '#ffffff' },
  stepLabel: { fontSize: 12, color: colors.neutral.textMuted },
  stepLabelActive: { fontSize: 12, color: colors.primary.DEFAULT, fontWeight: '600' },
  stepLine: { width: 32, height: 2, backgroundColor: colors.neutral.border, marginHorizontal: 4 },
  stepLineActive: { backgroundColor: colors.primary.DEFAULT },
  stepContent: { gap: 16 },
  stepTitle: { textAlign: 'center' },
  stepBody: { textAlign: 'center', color: colors.neutral.textMuted, lineHeight: 22 },
  qrPlaceholder: { alignItems: 'center', gap: 8, paddingVertical: 24 },
  qrCaption: { color: colors.neutral.textMuted },
  manualKey: {
    textAlign: 'center',
    color: colors.neutral.textMuted,
    fontFamily: 'monospace',
    backgroundColor: colors.neutral.surfaceAlt,
    padding: 10,
    borderRadius: 8,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  errorText: { color: '#dc2626', flex: 1 },
});
