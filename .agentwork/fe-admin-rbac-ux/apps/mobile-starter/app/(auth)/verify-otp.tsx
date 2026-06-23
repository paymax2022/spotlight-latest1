// @ts-nocheck
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { verifyOtp, resendOtp } from '@/api/auth.api';
import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { AppScreen } from '@/components/ui/AppScreen';
import { AppText } from '@/components/ui/AppText';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { getFriendlyErrorMessage } from '@/utils/errorMapper';

export default function VerifyOtpScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const [email, setEmail] = useState(String(params.email ?? ''));
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  return (
    <AppScreen>
      <AppText variant="h1">Verify OTP</AppText>
      <AppInput label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <AppInput label="OTP" value={otp} onChangeText={setOtp} keyboardType="number-pad" />
      <AppButton
        title="Verify"
        loading={loading}
        onPress={async () => {
          if (!email || !otp) {
            setError('Email and OTP are required.');
            return;
          }
          setLoading(true);
          setError('');
          try {
            await verifyOtp({ email: email.trim(), otp: otp.trim() });
            router.replace('/login');
          } catch (err) {
            setError(getFriendlyErrorMessage(err, 'Unable to verify OTP. Please try again.'));
          } finally {
            setLoading(false);
          }
        }}
      />
      <AppButton
        title="Resend OTP"
        variant="ghost"
        onPress={async () => {
          setMessage('');
          setError('');
          try {
            await resendOtp({ email: email.trim() });
            setMessage('A new OTP has been sent.');
          } catch (err) {
            setError(getFriendlyErrorMessage(err, 'Unable to resend OTP. Please try again.'));
          }
        }}
      />
      <StatusMessage error={error} success={message} />
    </AppScreen>
  );
}
