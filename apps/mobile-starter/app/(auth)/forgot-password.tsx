// @ts-nocheck
import { useState } from 'react';

import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { AppScreen } from '@/components/ui/AppScreen';
import { AppText } from '@/components/ui/AppText';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');

  return (
    <AppScreen>
      <AppText variant="h1">Reset Password</AppText>
      <AppInput label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <AppButton title="Send Reset Link" />
    </AppScreen>
  );
}
