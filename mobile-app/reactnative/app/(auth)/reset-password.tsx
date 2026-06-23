import React, { useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { Lock } from 'lucide-react-native';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import AuthScreenWrapper from '@/components/AuthScreenWrapper';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import * as authApi from '@/api/auth.api';
import { getErrorMessage } from '@/utils/errorMapper';

const schema = z
  .object({
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
  const [done, setDone]         = useState(false);
  const [apiError, setApiError] = useState('');

  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (values: Form) => {
    setApiError('');
    try {
      await authApi.resetPassword({ password: values.password });
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
    <AuthScreenWrapper title="Set new password" subtitle="Choose a password that's at least 8 characters.">
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
