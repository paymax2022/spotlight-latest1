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

export default function RegisterScreen() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useAuthStore((s) => s.login);
  const router = useRouter();

  return (
    <AppScreen>
      <AppText variant="h1">Create Account</AppText>
      <View style={{ gap: 14 }}>
        <AppInput label="Full Name" value={fullName} onChangeText={setFullName} />
        <AppInput label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
        <AppInput label="Password" value={password} onChangeText={setPassword} variant="password" />
      </View>
      <View style={{ marginTop: spacing[5] }}>
        <AppButton
          title="Create Account"
          onPress={async () => {
            await login(email || 'new@paymax.africa', password);
            router.replace('/');
          }}
        />
      </View>
    </AppScreen>
  );
}
