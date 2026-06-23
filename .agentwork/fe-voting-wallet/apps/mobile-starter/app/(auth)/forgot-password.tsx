// @ts-nocheck
import { useState } from 'react';

import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { AppScreen } from '@/components/ui/AppScreen';
import { AppText } from '@/components/ui/AppText';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { forgotPassword } from '@/api/auth.api';
import { getFriendlyErrorMessage } from '@/utils/errorMapper';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  return (
    <AppScreen>
      <AppText variant="h1">Reset Password</AppText>
      <AppInput label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <AppButton
        title="Send Reset Link"
        loading={loading}
        onPress={async () => {
          if (!email) {
            setError('Email is required.');
            return;
          }
          setLoading(true);
          setError('');
          setSuccess('');
          try {
            await forgotPassword({ email: email.trim() });
            setSuccess('Password reset instructions have been sent.');
          } catch (err) {
            setError(getFriendlyErrorMessage(err, 'Unable to send reset instructions. Please try again.'));
          } finally {
            setLoading(false);
          }
        }}
      />
      <StatusMessage error={error} success={success} />
    </AppScreen>
  );
}
