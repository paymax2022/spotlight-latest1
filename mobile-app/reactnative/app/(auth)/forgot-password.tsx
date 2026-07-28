import React, { useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { Mail } from 'lucide-react-native';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import AuthScreenWrapper from '@/components/AuthScreenWrapper';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import * as authApi from '@/api/auth.api';
import { getErrorMessage } from '@/utils/errorMapper';

const schema = z.object({ email: z.string().email('Enter a valid email') });
type Form = z.infer<typeof schema>;

export default function ForgotPasswordScreen() {
  const [sent, setSent]       = useState(false);
  const [apiError, setApiError] = useState('');

  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (values: Form) => {
    setApiError('');
    try {
      await authApi.forgotPassword({ email: values.email });
      setSent(true);
    } catch (err) {
      setApiError(getErrorMessage(err));
    }
  };

  if (sent) {
    return (
      <AuthScreenWrapper title="Check your inbox" subtitle="We've sent a password reset link to your email. Follow the link to create a new password." showBack>
        <Text style={styles.hint}>Didn't receive it? Check your spam folder or try again.</Text>
      </AuthScreenWrapper>
    );
  }

  return (
    <AuthScreenWrapper title="Forgot password?" subtitle="Enter your email and we'll send you a reset link." showBack>
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
      {apiError ? <Text style={styles.error}>{apiError}</Text> : null}
      <PrimaryButton label="Send Reset Link" onPress={handleSubmit(onSubmit)} loading={isSubmitting} style={{ marginTop: Spacing.sm }} />
    </AuthScreenWrapper>
  );
}

const styles = StyleSheet.create({
  error: { ...Typography.labelSm, color: Colors.error, textAlign: 'center', marginBottom: Spacing.sm },
  hint:  { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.sm },
});
