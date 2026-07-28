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

function getPasswordStrength(pw: string): { label: string; color: string; width: string } {
  if (pw.length === 0) return { label: '', color: colors.neutral.border, width: '0%' };
  if (pw.length < 6) return { label: 'Weak', color: '#dc2626', width: '25%' };
  if (pw.length < 10 || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw))
    return { label: 'Medium', color: '#F59E0B', width: '55%' };
  return { label: 'Strong', color: '#10B981', width: '100%' };
}

export default function SetupPasswordScreen() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const strength = getPasswordStrength(password);

  const handleSubmit = async () => {
    setError('');
    if (!password || password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 1000));
      router.push('/(auth)/status/approved' as never);
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
        <Text style={styles.headerTitle}>Set Password</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.intro}>
          <Ionicons name="lock-closed" size={56} color={colors.primary.DEFAULT} />
          <AppText variant="h2" style={styles.introTitle}>Create a secure password</AppText>
          <AppText variant="body" style={styles.introSubtitle}>
            Your password must be at least 6 characters. Use a mix of upper/lowercase letters, numbers, and symbols for a strong password.
          </AppText>
        </View>

        {error ? (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={18} color="#dc2626" />
            <AppText variant="caption" style={styles.errorText}>{error}</AppText>
          </View>
        ) : null}

        <AppInput label="New Password" value={password} onChangeText={setPassword} variant="password" placeholder="Enter new password" />

        {password.length > 0 ? (
          <View style={styles.strengthContainer}>
            <View style={styles.strengthBar}>
              <View style={[styles.strengthFill, { width: strength.width, backgroundColor: strength.color }]} />
            </View>
            <Text style={[styles.strengthLabel, { color: strength.color }]}>{strength.label}</Text>
          </View>
        ) : null}

        <AppInput label="Confirm Password" value={confirm} onChangeText={setConfirm} variant="password" placeholder="Confirm your password" />

        <AppButton title="Set Password" variant="primary" loading={loading} onPress={handleSubmit} />
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
  strengthContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: -8,
  },
  strengthBar: {
    flex: 1,
    height: 6,
    backgroundColor: colors.neutral.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  strengthFill: {
    height: '100%',
    borderRadius: 3,
  },
  strengthLabel: { fontSize: 12, fontWeight: '600', width: 48 },
});
