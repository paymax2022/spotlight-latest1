import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Mail, Lock } from 'lucide-react-native';
import { router } from 'expo-router';
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
import { getErrorMessage } from '@/utils/errorMapper';

const schema = z.object({
  email:    z.string().email('Enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});
type Form = z.infer<typeof schema>;

export default function LoginScreen() {
  const { login } = useAuthStore();
  const [apiError, setApiError] = useState('');

  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (values: Form) => {
    setApiError('');
    try {
      await login(values.email, values.password);
      // AuthGate in _layout will redirect to home automatically
    } catch (err) {
      setApiError(getErrorMessage(err));
    }
  };

  return (
    <AuthScreenWrapper title="Welcome back" subtitle="Sign in to continue to your Paymax account.">
      <Controller
        name="email"
        control={control}
        render={({ field }) => (
          <TextInputField
            label="Email address"
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            leftIcon={<Mail size={18} color={Colors.outline} strokeWidth={1.8} />}
            error={errors.email?.message}
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
