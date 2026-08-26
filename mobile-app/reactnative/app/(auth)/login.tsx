import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Mail, Lock } from 'lucide-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import AuthScreenWrapper from '@/components/AuthScreenWrapper';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { useAuthStore } from '@/store/authStore';
import { EmailNotConfirmedError } from '@/api/auth.api';
import { getErrorMessage } from '@/utils/errorMapper';

// Sign in with EITHER an email or a phone number. The field is validated loosely on
// purpose: the server decides what resolves to an account, and a strict client-side
// phone regex would reject valid formats users type (+234…, 0803…, spaces, dashes).
const schema = z.object({
  identifier: z.string().trim().min(3, 'Enter your email or phone number'),
  password:   z.string().min(6, 'Password must be at least 6 characters'),
});
type Form = z.infer<typeof schema>;

export default function LoginScreen() {
  const { login } = useAuthStore();
  const [apiError, setApiError] = useState('');
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();

  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (values: Form) => {
    setApiError('');
    try {
      await login(values.identifier, values.password);
      // Navigate to the originating module screen, or the home grid as fallback.
      // Validate returnTo starts with "/" to prevent open-redirect.
      const dest = (typeof returnTo === 'string' && returnTo.startsWith('/'))
        ? returnTo
        : '/(tabs)/home';
      router.replace(dest as never);
    } catch (err) {
      // The password was right and only verification is missing, so send them to
      // enter their code rather than showing a credentials error they cannot act on.
      if (err instanceof EmailNotConfirmedError) {
        router.push({ pathname: '/(auth)/verify-otp', params: { email: err.email } });
        return;
      }
      // authAttempt: a 401 HERE means the credentials were rejected. Without it
      // the shared mapper returns 'Your session has expired. Please sign in
      // again.' — which is what a lapsed token means, and is nonsense on the
      // sign-in screen where there is no session yet.
      setApiError(getErrorMessage(err, { authAttempt: true }));
    }
  };

  return (
    <AuthScreenWrapper title="Welcome back" subtitle="Sign in to continue to your Paymax account.">
      <Controller
        name="identifier"
        control={control}
        render={({ field }) => (
          <TextInputField
            label="Email or phone number"
            placeholder="you@example.com or 0803 000 0000"
            // 'email-address' rather than a numeric pad: this one field takes either,
            // and a numeric keyboard would make the email case unusable.
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            leftIcon={<Mail size={18} color={Colors.outline} strokeWidth={1.8} />}
            error={errors.identifier?.message}
            value={field.value}
            onChangeText={field.onChange}
          />
        )}
      />
      <Controller
        name="password"
        control={control}
        render={({ field }) => (
          <TextInputField
            label="Password"
            placeholder="Enter your password"
            secure
            leftIcon={<Lock size={18} color={Colors.outline} strokeWidth={1.8} />}
            error={errors.password?.message}
            value={field.value}
            onChangeText={field.onChange}
          />
        )}
      />

      <Pressable style={styles.forgot} onPress={() => router.push('/(auth)/forgot-password')}>
        <Text style={styles.forgotText}>Forgot password?</Text>
      </Pressable>

      {apiError ? <Text style={styles.apiError}>{apiError}</Text> : null}

      <PrimaryButton label="Sign In" onPress={handleSubmit(onSubmit)} loading={isSubmitting} />

      <View style={styles.dividerRow}>
        <View style={styles.line} />
        <Text style={styles.orText}>or</Text>
        <View style={styles.line} />
      </View>

      <Pressable onPress={() => router.push('/(auth)/signup')} style={styles.signupLink}>
        <Text style={styles.signupText}>
          Don't have an account? <Text style={styles.signupAction}>Create one</Text>
        </Text>
      </Pressable>
    </AuthScreenWrapper>
  );
}

const styles = StyleSheet.create({
  forgot:      { alignSelf: 'flex-end', marginBottom: Spacing.lg, marginTop: -Spacing.xs },
  forgotText:  { ...Typography.labelMd, color: Colors.secondary },
  apiError:    { ...Typography.labelSm, color: Colors.error, textAlign: 'center', marginBottom: Spacing.md },
  dividerRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginVertical: Spacing.lg },
  line:        { flex: 1, height: 1, backgroundColor: Colors.outlineVariant },
  orText:      { ...Typography.labelSm, color: Colors.outline },
  signupLink:  { alignItems: 'center' },
  signupText:  { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  signupAction:{ color: Colors.secondary, fontWeight: '600' },
});
