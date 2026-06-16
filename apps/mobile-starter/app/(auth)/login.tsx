// @ts-nocheck
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { AppScreen } from '@/components/ui/AppScreen';
import { AppText } from '@/components/ui/AppText';
import { colors, spacing } from '@/theme';
import { useAuthStore } from '@/store/authStore';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { getFriendlyErrorMessage } from '@/utils/errorMapper';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const login = useAuthStore((s) => s.login);
  const router = useRouter();

  return (
    <AppScreen contentStyle={{ justifyContent: 'center', flexGrow: 1 }}>
      <View style={{ gap: spacing[2] }}>
        <AppText variant="h1">Welcome to Paymax</AppText>
        <AppText variant="bodyMedium" color={colors.neutral.textMuted}>Everything money, one secure app.</AppText>
      </View>
      <View style={{ gap: 14 }}>
        <AppInput label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
        <AppInput label="Password" value={password} onChangeText={setPassword} variant="password" />
      </View>
      <AppButton
        title="Login"
        loading={loading}
        onPress={async () => {
          if (!email || !password) {
            setError('Email and password are required.');
            return;
          }
          setLoading(true);
          setError('');
          try {
            await login(email.trim(), password);
            router.replace('/(protected)/(tabs)');
          } catch (err) {
            setError(getFriendlyErrorMessage(err, 'Unable to log in. Please check your details and try again.'));
          } finally {
            setLoading(false);
          }
        }}
      />
      <StatusMessage error={error} />
      <Link href="/forgot-password" asChild>
        <AppText color={colors.primary.blue}>Forgot password?</AppText>
      </Link>
      <Link href="/register" asChild>
        <AppText color={colors.primary.blue}>Create account</AppText>
      </Link>
    </AppScreen>
  );
}
