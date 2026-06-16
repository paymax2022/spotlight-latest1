// @ts-nocheck
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { PaystackProvider } from 'react-native-paystack-webview';

import { AppLoader } from '@/components/ui/AppLoader';
import { useAuthStore } from '@/store/authStore';

const PAYSTACK_PUBLIC_KEY = process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY ?? '';

const queryClient = new QueryClient();

export default function RootLayout() {
  const { init, initialized, user } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (!initialized) return;
    const inAuth = segments[0] === '(auth)';

    if (!user && !inAuth) router.replace('/login');
    if (user && inAuth) router.replace('/(protected)/(tabs)');
  }, [initialized, user, segments, router]);

  if (!initialized) return <AppLoader />;

  return (
    <PaystackProvider publicKey={PAYSTACK_PUBLIC_KEY}>
      <QueryClientProvider client={queryClient}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(protected)" />
          <Stack.Screen name="+not-found" />
        </Stack>
      </QueryClientProvider>
    </PaystackProvider>
  );
}
