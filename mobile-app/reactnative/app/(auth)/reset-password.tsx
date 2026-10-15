import React, { useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { Lock, KeyRound } from 'lucide-react-native';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useLocalSearchParams } from 'expo-router';
import AuthScreenWrapper from '@/components/AuthScreenWrapper';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import * as authApi from '@/api/auth.api';
import { getErrorMessage } from '@/utils/errorMapper';

// Two ways to land here: the emailed LINK (Supabase fires PASSWORD_RECOVERY,
// see app/_layout.tsx, and a session is already live — no email/code needed),
// or the emailed CODE, which forgot-password.tsx routes to directly with
// ?email= since it can't know whether the link will ever arrive. `email`
// being present is what distinguishes the two shapes resetPassword() accepts.
const schema = z
  .object({
    code:            z.string().optional(),
    password:        z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type Form = z.infer<typeof schema>;

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email?: string }>();
  const isCodeFlow = !!email;
  const [done, setDone]         = useState(false);
  const [apiError, setApiError] = useState('');

  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (values: Form) => {
    setApiError('');
    try {
      if (isCodeFlow) {
        if (!values.code?.trim()) { setApiError('Enter the code we emailed you.'); return; }
        await authApi.resetPassword({ email, code: values.code.trim(), password: values.password });
      } else {
        await authApi.resetPassword({ password: values.password });
      }
      setDone(true);
    } catch (err) {
      setApiError(getErrorMessage(err));
    }
  };

  if (done) {
    return (
      <AuthScreenWrapper title="Password updated" subtitle="Your password has been changed. You can now sign in with your new password.">
        <PrimaryButton label="Go to Sign In" onPress={() => router.replace('/(auth)/login')} style={{ marginTop: Spacing.md }} />
      </AuthScreenWrapper>
    );
  }

  return (
    <AuthScreenWrapper
      title="Set new password"
      subtitle={isCodeFlow ? `Enter the code sent to ${email} and choose a new password.` : "Choose a password that's at least 8 characters."}
    >
      {isCodeFlow && (
        <Controller
          name="code"
          control={control}
          render={({ field }) => (
            <TextInputField
              label="Reset code"
              placeholder="6-digit code from your email"
              keyboardType="number-pad"
              leftIcon={<KeyRound size={18} color={Colors.outline} strokeWidth={1.8} />}
              error={errors.code?.message}
              value={field.value}
              onChangeText={field.onChange}
            />
          )}
        />
      )}
      <Controller
        name="password"
        control={control}
        render={({ field }) => (
          <TextInputField
            label="New password"
            placeholder="Min. 8 characters"
            secureTextEntry
            leftIcon={<Lock size={18} color={Colors.outline} strokeWidth={1.8} />}
            error={errors.password?.message}
            value={field.value}
            onChangeText={field.onChange}
          />
        )}
      />
      <Controller
        name="confirmPassword"
        control={control}
        render={({ field }) => (
          <TextInputField
            label="Confirm password"
            placeholder="Re-enter your password"
            secureTextEntry
            leftIcon={<Lock size={18} color={Colors.outline} strokeWidth={1.8} />}
            error={errors.confirmPassword?.message}
            value={field.value}
            onChangeText={field.onChange}
          />
        )}
      />
      {apiError ? <Text style={styles.error}>{apiError}</Text> : null}
      <PrimaryButton
        label="Update Password"
        onPress={handleSubmit(onSubmit)}
        loading={isSubmitting}
        style={{ marginTop: Spacing.sm }}
      />
    </AuthScreenWrapper>
  );
}

const styles = StyleSheet.create({
  error: { ...Typography.labelSm, color: Colors.error, textAlign: 'center', marginBottom: Spacing.sm },
});
