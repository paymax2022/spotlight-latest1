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

export default function PhoneLoginScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSendOtp = async () => {
    setError('');
    if (!phone || phone.length < 7) {
      setError('Please enter a valid phone number.');
      return;
    }
    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 1000));
      router.push({ pathname: '/(auth)/verify-otp' as never, params: { phone: `+234${phone}` } } as never);
    } catch {
      setError('Could not send OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </Pressable>
        <Text style={styles.headerTitle}>Phone Login</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.intro}>
          <Ionicons name="phone-portrait" size={56} color={colors.primary.DEFAULT} />
          <AppText variant="h2" style={styles.introTitle}>Enter your phone number</AppText>
          <AppText variant="body" style={styles.introSubtitle}>
            We'll send a one-time code to verify your identity.
          </AppText>
        </View>

        {error ? (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={18} color="#dc2626" />
            <AppText variant="caption" style={styles.errorText}>{error}</AppText>
          </View>
        ) : null}

        <View style={styles.phoneRow}>
          <View style={styles.prefix}>
            <Text style={styles.prefixText}>🇳🇬 +234</Text>
          </View>
          <View style={styles.phoneInputWrap}>
            <AppInput
              label=""
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="800 000 0000"
            />
          </View>
        </View>

        <AppButton title="Send OTP" variant="primary" loading={loading} onPress={handleSendOtp} />

        <Pressable onPress={() => router.push('/(auth)/login' as never)} style={styles.altLink}>
          <AppText variant="caption" style={styles.altLinkText}>Use email & password instead</AppText>
        </Pressable>
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
  intro: { alignItems: 'center', gap: 12, paddingVertical: 16 },
  introTitle: { textAlign: 'center' },
  introSubtitle: { textAlign: 'center', color: colors.neutral.textMuted },
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
  phoneRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  prefix: {
    backgroundColor: colors.neutral.surface,
    borderWidth: 1,
    borderColor: colors.neutral.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 14,
    height: 52,
    justifyContent: 'center',
  },
  prefixText: { fontSize: 15, color: colors.neutral.text, fontWeight: '600' },
  phoneInputWrap: { flex: 1 },
  altLink: { alignItems: 'center', paddingVertical: 8 },
  altLinkText: { color: colors.primary.DEFAULT },
});
