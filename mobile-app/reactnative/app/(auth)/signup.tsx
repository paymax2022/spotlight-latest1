import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { User, Mail, Phone, Lock, Gift } from 'lucide-react-native';
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
import { attribute as attributeReferral } from '@/features/referral/rewards/api';

const schema = z.object({
  fullName: z.string().min(2, 'Enter your full name'),
  email:    z.string().email('Enter a valid email'),
  phone:    z.string().min(10, 'Enter a valid phone number'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  // Direct Referral Rewards (PRD §5.2) — optional. Attribution is invisible to
  // the referred user; a blank or bad code never blocks signup.
  referralCode: z.string().optional(),
});
type Form = z.infer<typeof schema>;

export default function SignupScreen() {
  const { register } = useAuthStore();
  const [apiError, setApiError] = useState('');

  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (values: Form) => {
    setApiError('');
    try {
      const { referralCode, ...creds } = values;
      const result = await register(creds);
      // Attribute the referral code silently (PRD §5.2): fire-and-forget, never
      // blocks or fails the signup, no reward shown to the referred user. The
      // engine is idempotent per user and 400s on self/unknown codes — swallowed.
      const code = referralCode?.trim();
      if (code) { attributeReferral(code).catch(() => { /* attribution is invisible */ }); }
      if (result.needsOtp) {
        router.push({ pathname: '/(auth)/verify-otp', params: { email: result.email } });
      }
      // If no OTP needed, AuthGate redirects to home
    } catch (err) {
      setApiError(getErrorMessage(err));
    }
  };

  return (
    <AuthScreenWrapper title="Create account" subtitle="Join millions on the Paymax ecosystem." showBack>
      <Controller name="fullName" control={control} render={({ field }) => (
        <TextInputField label="Full name" placeholder="Jane Smith" autoCapitalize="words"
          leftIcon={<User size={18} color={Colors.outline} strokeWidth={1.8} />}
          error={errors.fullName?.message} value={field.value} onChangeText={field.onChange} />
      )} />
      <Controller name="email" control={control} render={({ field }) => (
        <TextInputField label="Email address" placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none"
          leftIcon={<Mail size={18} color={Colors.outline} strokeWidth={1.8} />}
          error={errors.email?.message} value={field.value} onChangeText={field.onChange} />
      )} />
      <Controller name="phone" control={control} render={({ field }) => (
        <TextInputField label="Phone number" placeholder="+234 80X XXX XXXX" keyboardType="phone-pad"
          leftIcon={<Phone size={18} color={Colors.outline} strokeWidth={1.8} />}
          error={errors.phone?.message} value={field.value} onChangeText={field.onChange} />
      )} />
      <Controller name="password" control={control} render={({ field }) => (
        <TextInputField label="Password" placeholder="Min. 8 characters" secure
          leftIcon={<Lock size={18} color={Colors.outline} strokeWidth={1.8} />}
          error={errors.password?.message} value={field.value} onChangeText={field.onChange} />
      )} />
      <Controller name="referralCode" control={control} render={({ field }) => (
        <TextInputField label="Referral code (optional)" placeholder="Enter a friend's code" autoCapitalize="characters"
          leftIcon={<Gift size={18} color={Colors.outline} strokeWidth={1.8} />}
          error={errors.referralCode?.message} value={field.value ?? ''} onChangeText={field.onChange} />
      )} />

      {apiError ? <Text style={styles.apiError}>{apiError}</Text> : null}

      <PrimaryButton label="Create Account" onPress={handleSubmit(onSubmit)} loading={isSubmitting} style={{ marginTop: Spacing.sm }} />

      <Text style={styles.terms}>
        By creating an account you agree to our{' '}
        <Text style={styles.link}>Terms of Service</Text> and{' '}
        <Text style={styles.link}>Privacy Policy</Text>.
      </Text>

      <Pressable onPress={() => router.back()} style={styles.signIn}>
        <Text style={styles.signInText}>Already have an account? <Text style={styles.signInLink}>Sign in</Text></Text>
      </Pressable>
    </AuthScreenWrapper>
  );
}

const styles = StyleSheet.create({
  apiError:   { ...Typography.labelSm, color: Colors.error, textAlign: 'center', marginBottom: Spacing.sm },
  terms:      { ...Typography.labelSm, color: Colors.outline, textAlign: 'center', marginTop: Spacing.lg },
  link:       { color: Colors.secondary, fontWeight: '600' },
  signIn:     { alignItems: 'center', marginTop: Spacing.md },
  signInText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  signInLink: { color: Colors.secondary, fontWeight: '600' },
});
