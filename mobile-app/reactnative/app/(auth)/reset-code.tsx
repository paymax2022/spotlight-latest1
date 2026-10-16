import React, { useState, useRef } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import AuthScreenWrapper from '@/components/AuthScreenWrapper';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import * as authApi from '@/api/auth.api';
import { setPendingReset } from '@/api/authOtp';
import { getErrorMessage } from '@/utils/errorMapper';
import { otpLength, distributeOtpInput, nextOtpFocus } from '@/features/auth/otp';

const OTP_LENGTH = otpLength();

// Step 2 of the OTP reset. The code is checked against the server HERE, so the
// new-password screen is only ever reached with a verified code. The returned
// single-use token is kept in memory (setPendingReset), never in the route.
export default function ResetCodeScreen() {
  const { identifier } = useLocalSearchParams<{ identifier?: string }>();
  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [apiError, setApiError] = useState('');
  const [resendMsg, setResendMsg] = useState('');
  const inputs = useRef<(TextInput | null)[]>([]);

  const clear = () => setOtp(Array(OTP_LENGTH).fill(''));

  const handleChange = (text: string, index: number) => {
    const next = distributeOtpInput(otp, index, text);
    setOtp(next);
    if (text) inputs.current[nextOtpFocus(next, index)]?.focus();
  };

  const handleKeyPress = (key: string, index: number) => {
    if (key === 'Backspace' && !otp[index] && index > 0) inputs.current[index - 1]?.focus();
  };

  const handleVerify = async () => {
    const code = otp.join('');
    if (code.length < OTP_LENGTH) { setApiError(`Enter all ${OTP_LENGTH} digits.`); return; }
    setApiError(''); setLoading(true);
    try {
      const resetToken = await authApi.verifyResetCode({ identifier: identifier ?? '', code });
      setPendingReset(identifier ?? '', resetToken);
      router.replace('/(auth)/reset-password');
    } catch (err) {
      setApiError(getErrorMessage(err));
      clear();
      inputs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResendMsg(''); setApiError(''); setResending(true);
    try {
      await authApi.forgotPassword({ identifier: identifier ?? '' });
      clear();
      setResendMsg('A new code is on its way if an account matches.');
    } catch (err) {
      setApiError(getErrorMessage(err));
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthScreenWrapper
      title="Enter reset code"
      subtitle={`If an account matches ${identifier ?? 'what you entered'}, a ${OTP_LENGTH}-digit code was emailed to it.`}
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
  otpBox:      { width: 40, height: 56, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.outlineVariant, textAlign: 'center', fontSize: 22, fontWeight: '700', color: Colors.onSurface, backgroundColor: Colors.surfaceContainerLow },
  otpBoxFilled:{ borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  error:       { ...Typography.labelSm, color: Colors.error, textAlign: 'center', marginBottom: Spacing.sm },
  success:     { ...Typography.labelSm, color: Colors.teal, textAlign: 'center', marginBottom: Spacing.sm },
  resend:      { alignItems: 'center', marginTop: Spacing.lg },
  resendText:  { ...Typography.labelMd, color: Colors.secondary },
});
