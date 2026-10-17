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
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import * as authApi from '@/api/auth.api';
import { accountNotFoundMessage, clearPendingReset } from '@/api/authOtp';
import { getErrorMessage } from '@/utils/errorMapper';

// Step 1 of the OTP reset: email OR phone number. The code is emailed to the
// account's address either way; the server resolves a phone number and never
// reveals the address. When nothing matches it says so (404 account_not_found,
// ADR-PR801) and the screen names what was typed.
const schema = z.object({ identifier: z.string().trim().min(3, 'Enter your email or phone number') });
type Form = z.infer<typeof schema>;

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [apiError, setApiError] = useState('');

  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (values: Form) => {
    setApiError('');
    try {
      clearPendingReset();
      await authApi.forgotPassword({ identifier: values.identifier });
      router.push({ pathname: '/(auth)/reset-code', params: { identifier: values.identifier.trim() } });
    } catch (err) {
      setApiError(accountNotFoundMessage(err, values.identifier) ?? getErrorMessage(err));
    }
  };

  return (
    <AuthScreenWrapper title="Forgot password?" subtitle="Enter your email or phone number and we'll email you a one-time code." showBack>
      <Controller
        name="identifier"
        control={control}
        render={({ field }) => (
          <TextInputField
            label="Email or phone number"
            placeholder="you@example.com or 0803 000 0000"
            keyboardType="email-address"
            autoCapitalize="none"
            leftIcon={<Mail size={18} color={Colors.outline} strokeWidth={1.8} />}
            error={errors.identifier?.message}
            value={field.value}
            onChangeText={field.onChange}
          />
        )}
      />
      {apiError ? <Text style={styles.error}>{apiError}</Text> : null}
      <PrimaryButton label="Send Reset Code" onPress={handleSubmit(onSubmit)} loading={isSubmitting} style={{ marginTop: Spacing.sm }} />
    </AuthScreenWrapper>
  );
}

const styles = StyleSheet.create({
  error: { ...Typography.labelSm, color: Colors.error, textAlign: 'center', marginBottom: Spacing.sm },
});
