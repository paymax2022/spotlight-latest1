import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { User, Mail, Lock, Gift } from 'lucide-react-native';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import AuthScreenWrapper from '@/components/AuthScreenWrapper';
import PhoneNumberInput from '@/components/PhoneNumberInput';
import { isValid as isValidPhone } from '@/lib/phone/phone';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { useAuthStore } from '@/store/authStore';
import { getErrorMessage } from '@/utils/errorMapper';

const schema = z.object({
  fullName: z.string().min(2, 'Enter your full name'),
  email:    z.string().email('Enter a valid email'),
  // Validated with the shared util rather than a length check: "0801234567"
  // is ten characters and passes min(10) while being one digit short.
  phone:    z.string().refine((v) => isValidPhone(v), 'Enter a valid phone number'),
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
      // The referral code now travels WITH the registration call itself
      // (POST /api/auth/register), which attributes server-side — both the
      // §7A engine and the Module 8 Direct Referral Rewards engine run there
      // unconditionally on every signup, so a blank code still resolves to
      // the platform Admin as the default referrer, and a real code is
      // attributed atomically before any client ever gets a chance to race
      // it. No separate follow-up call is needed (or safe to add back): a
      // second call here would run AFTER the code is already locked in
      // permanently and could never change it, only add a wasted request.
      const result = await register(values);
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
        // Stores E.164 ("+2348012345678"). The value submitted is therefore the
        // same shape the backend's NormalizePhone resolves at sign-in, so an
        // account can always be found by the number it was created with.
        <PhoneNumberInput label="Phone number"
          value={field.value} onChange={({ e164, nsn }) => field.onChange(e164 || nsn)}
          error={errors.phone?.message} testID="signup-phone" />
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

      <Pressable onPress={() => goBack('/')} style={styles.signIn}>
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
