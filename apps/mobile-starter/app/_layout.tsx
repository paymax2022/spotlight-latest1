// @ts-nocheck
import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';

import { AppLoader } from '@/components/ui/AppLoader';
import { useAuthStore } from '@/store/authStore';

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
    if (user && inAuth) router.replace('/');
  }, [initialized, user, segments, router]);

  if (!initialized) return <AppLoader />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(protected)" />
      <Stack.Screen name="+not-found" />
    </Stack>
  );
}
