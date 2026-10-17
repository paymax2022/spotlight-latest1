import React, { useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { Mail } from 'lucide-react-native';
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

const schema = z.object({ email: z.string().email('Enter a valid email') });
type Form = z.infer<typeof schema>;

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [sent, setSent]       = useState(false);
  const [sentEmail, setSentEmail] = useState('');
  const [apiError, setApiError] = useState('');

  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (values: Form) => {
    setApiError('');
    try {
      await authApi.forgotPassword({ email: values.email });
      setSentEmail(values.email);
      setSent(true);
    } catch (err) {
      setApiError(getErrorMessage(err));
    }
  };

  // The backend sends BOTH a reset link and a code (see
  // request-password-reset on the Go side) because the link is not always
  // reliable — different mail path, no deep-link handoff for a native app
  // that never opened the site before. Rather than leaving whoever's email
  // client shows the code with no way forward, send them straight to the
  // code-entry form; the link (if it arrives) still works independently via
  // app/_layout.tsx's PASSWORD_RECOVERY listener.
  if (sent) {
    return (
      <AuthScreenWrapper title="Check your inbox" subtitle="We've sent a password reset link and a one-time code to your email." showBack>
        <Text style={styles.hint}>Didn't receive it? Check your spam folder or try again.</Text>
        <PrimaryButton
          label="I have the code"
          onPress={() => router.push({ pathname: '/(auth)/reset-password', params: { email: sentEmail } })}
          style={{ marginTop: Spacing.md }}
        />
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
