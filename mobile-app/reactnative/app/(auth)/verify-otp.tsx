import React, { useState, useRef } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import AuthScreenWrapper from '@/components/AuthScreenWrapper';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import * as authApi from '@/api/auth.api';
import { setSecureItem } from '@/lib/secureStorage';
import { useAuthStore } from '@/store/authStore';
import { getErrorMessage } from '@/utils/errorMapper';
import { otpLength, distributeOtpInput, nextOtpFocus } from '@/features/auth/otp';

// Was hardcoded 6 while PRODUCTION issues 8-digit codes, so a production user
// could not enter the code they were sent. Must match the project's
// mailer_otp_length; see docs/audit/USER_MANAGEMENT_AUDIT.md B2.
const OTP_LENGTH = otpLength();

export default function VerifyOtpScreen() {
  // mode distinguishes the two things this screen redeems. 'login' is the
  // sign-in second factor, which returns a SESSION; the default is the sign-up
  // code, which confirms the account and returns none.
  const { email, mode } = useLocalSearchParams<{ email: string; mode?: string }>();
  const isLoginStepUp = mode === 'login';
  const { setUser } = useAuthStore();
  const [otp, setOtp]         = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [apiError, setApiError]   = useState('');
  const [resendMsg, setResendMsg] = useState('');
  const inputs = useRef<(TextInput | null)[]>([]);

  const handleChange = (text: string, index: number) => {
    // Autofill and paste deliver the WHOLE code into one box; the old
    // `text.slice(-1)` kept only its last character, so the code looked entered
    // and verification failed with nothing on screen to explain why.
    const next = distributeOtpInput(otp, index, text);
    setOtp(next);
    if (text) inputs.current[nextOtpFocus(next, index)]?.focus();
  };

  const handleKeyPress = (key: string, index: number) => {
    if (key === 'Backspace' && !otp[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    const code = otp.join('');
    if (code.length < OTP_LENGTH) { setApiError(`Enter all ${OTP_LENGTH} digits.`); return; }
    setApiError(''); setLoading(true);
    try {
      if (isLoginStepUp) {
        // Redeeming the sign-in code returns a session directly; there is no
        // "verified, now go and log in" step, because logging in is what this IS.
        const result = await authApi.verifyLoginOtp({ email: email ?? '', otp: code });
        setUser(result.user);
        router.replace('/(tabs)/home');
        return;
      }

      const { signedIn } = await authApi.verifyOtp({ email: email ?? '', otp: code });

      // The two verification backends differ here and the screen has to branch.
      // Supabase's signup OTP signs the user in; the server-issued one confirms
      // the account and stops, because control of a mailbox is not proof of the
      // password. Calling getMe() without a session would fail and show the user
      // an error after a verification that actually SUCCEEDED.
      if (!signedIn) {
        router.replace({
          pathname: '/(auth)/login',
          params: { notice: 'Email verified. Please sign in.' },
        });
        return;
      }

      const user = await authApi.getMe();
      setUser(user);
      router.replace('/(tabs)/home');
    } catch (err) {
      setApiError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResendMsg(''); setApiError(''); setResending(true);
    try {
      if (isLoginStepUp) {
        // Sign-in codes are issued only by the password step — /otp/request
        // refuses purpose=login, and that refusal is what keeps this a second
        // factor rather than passwordless sign-in. So resending means signing in
        // again.
        setApiError('To get a new sign-in code, enter your password again.');
        return;
      }
      await authApi.resendOtp({ email: email ?? '' });
      setResendMsg('A new code has been sent.');
    } catch (err) {
      setApiError(getErrorMessage(err));
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthScreenWrapper
      title={isLoginStepUp ? 'Finish signing in' : 'Verify your email'}
      subtitle={`Enter the ${OTP_LENGTH}-digit code sent to ${email ?? 'your email'}.`}
      showBack
    >
      <View style={styles.otpRow}>
        {otp.map((digit, i) => (
          <TextInput
            key={i}
            ref={(r) => { inputs.current[i] = r; }}
            style={[styles.otpBox, digit ? styles.otpBoxFilled : null]}
            value={digit}
            onChangeText={(t) => handleChange(t, i)}
            onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, i)}
            keyboardType="number-pad"
            maxLength={OTP_LENGTH}
            selectTextOnFocus
          />
        ))}
      </View>

      {apiError  ? <Text style={styles.error}>{apiError}</Text>   : null}
      {resendMsg ? <Text style={styles.success}>{resendMsg}</Text> : null}

      <PrimaryButton label="Verify Code" onPress={handleVerify} loading={loading} style={{ marginTop: Spacing.md }} />

      <Pressable onPress={handleResend} disabled={resending} style={styles.resend}>
        <Text style={styles.resendText}>{resending ? 'Sending…' : "Didn't receive it? Resend code"}</Text>
      </Pressable>
    </AuthScreenWrapper>
  );
}

const styles = StyleSheet.create({
  otpRow:      { flexDirection: 'row', gap: Spacing.sm, justifyContent: 'center', marginVertical: Spacing.lg },
  otpBox:      { width: 48, height: 56, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.outlineVariant, textAlign: 'center', fontSize: 22, fontWeight: '700', color: Colors.onSurface, backgroundColor: Colors.surfaceContainerLow },
  otpBoxFilled:{ borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  error:       { ...Typography.labelSm, color: Colors.error, textAlign: 'center', marginBottom: Spacing.sm },
  success:     { ...Typography.labelSm, color: Colors.teal, textAlign: 'center', marginBottom: Spacing.sm },
  resend:      { alignItems: 'center', marginTop: Spacing.lg },
  resendText:  { ...Typography.labelMd, color: Colors.secondary },
});
