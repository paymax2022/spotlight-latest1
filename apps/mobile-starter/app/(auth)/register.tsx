// @ts-nocheck
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { AppScreen } from '@/components/ui/AppScreen';
import { AppText } from '@/components/ui/AppText';
import { spacing } from '@/theme';
import { useAuthStore } from '@/store/authStore';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { getFriendlyErrorMessage } from '@/utils/errorMapper';
import { isValidNigerianPhone } from '@/validation/billing';

export default function RegisterScreen() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const register = useAuthStore((s) => s.register);
  const router = useRouter();

  return (
    <AppScreen>
      <AppText variant="h1">Create Account</AppText>
      <View style={{ gap: 14 }}>
        <AppInput label="Full Name" value={fullName} onChangeText={setFullName} />
        <AppInput label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
        <AppInput label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <AppInput label="Password" value={password} onChangeText={setPassword} variant="password" />
      </View>
      <View style={{ marginTop: spacing[5] }}>
        <AppButton
          title="Create Account"
          loading={loading}
          onPress={async () => {
            if (!fullName || !email || !phone || !password) {
              setError('Full name, email, phone, and password are required.');
              return;
            }
            if (!isValidNigerianPhone(phone)) {
              setError('Enter a valid Nigerian phone number.');
              return;
            }
            setLoading(true);
            setError('');
            try {
              await register({ fullName: fullName.trim(), email: email.trim(), phone: phone.trim(), password });
              router.replace('/(protected)/(tabs)');
            } catch (err) {
              setError(getFriendlyErrorMessage(err, 'Unable to create account. Please try again.'));
            } finally {
              setLoading(false);
            }
          }}
        />
        <StatusMessage error={error} />
      </View>
    </AppScreen>
  );
}
