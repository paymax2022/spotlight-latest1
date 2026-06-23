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

export default function ResetPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleReset = async () => {
    setError('');
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 1000));
      setSuccess(true);
    } catch {
      setError('Something went wrong. Please try again.');
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
        <Text style={styles.headerTitle}>Reset Password</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {success ? (
          <AppCard style={styles.successCard}>
            <Ionicons name="checkmark-circle" size={64} color="#10B981" />
            <AppText variant="h2" style={styles.successTitle}>Check your email</AppText>
            <AppText variant="body" style={styles.successBody}>
              We've sent a password reset link to {email}. Please check your inbox and follow the instructions.
            </AppText>
            <AppButton title="Back to Sign In" variant="ghost" onPress={() => router.push('/(auth)/login' as never)} />
          </AppCard>
        ) : (
          <>
            <View style={styles.intro}>
              <Ionicons name="mail" size={56} color={colors.primary.DEFAULT} />
              <AppText variant="h2" style={styles.introTitle}>Forgot your password?</AppText>
              <AppText variant="body" style={styles.introSubtitle}>
                Enter your registered email address and we'll send you a link to reset your password.
              </AppText>
            </View>

            {error ? (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle" size={18} color="#dc2626" />
                <AppText variant="caption" style={styles.errorText}>{error}</AppText>
              </View>
            ) : null}

            <AppInput label="Email Address" value={email} onChangeText={setEmail} keyboardType="email-address" placeholder="you@example.com" />

            <AppButton title="Send Reset Link" variant="primary" loading={loading} onPress={handleReset} />

            <Pressable onPress={() => router.push('/(auth)/login' as never)} style={styles.loginLink}>
              <AppText variant="caption" style={styles.loginLinkText}>Back to Sign In</AppText>
            </Pressable>
          </>
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
  content: { padding: 20, gap: 16 },
  intro: { alignItems: 'center', gap: 12, paddingVertical: 16 },
  introTitle: { textAlign: 'center' },
  introSubtitle: { textAlign: 'center', color: colors.neutral.textMuted, lineHeight: 22 },
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
  loginLink: { alignItems: 'center', paddingVertical: 8 },
  loginLinkText: { color: colors.primary.DEFAULT },
  successCard: { alignItems: 'center', gap: 16, padding: 24, marginTop: 24 },
  successTitle: { textAlign: 'center' },
  successBody: { textAlign: 'center', color: colors.neutral.textMuted, lineHeight: 22 },
});
