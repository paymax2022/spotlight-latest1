import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useAuthStore } from '@/store/authStore';
import { useBrandFonts } from '@/lib/brandFonts';
import { createSupabaseClient } from '@/lib/supabase';
import { usePushNotifications } from '@/lib/push';
import { useVisitorPushBridge } from '@/features/visitor/hooks/useVisitorPushBridge';
import { useElectionPushBridge } from '@/features/election/hooks/useElectionPushBridge';

// Keep the native splash visible until the brand font is ready (best-effort).
SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

function AuthGate({ children }: { children: React.ReactNode }) {
  const { init, initialized, user } = useAuthStore();
  const segments = useSegments();
  const router   = useRouter();

  useEffect(() => { init(); }, [init]);

  // Supabase fires PASSWORD_RECOVERY when the user opens the reset deep link.
  // Navigate to the set-password screen immediately; the session is already live.
  useEffect(() => {
    const supabase = createSupabaseClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        router.push('/(auth)/reset-password');
      }
    });
    return () => subscription.unsubscribe();
  }, [router]);

  // Register for push + wire deep-link routing once the user is signed in.
  const signedIn = initialized && !!user;
  usePushNotifications(signedIn);
  // Surface visitor + election alerts as local notifications (foreground fallback).
  useVisitorPushBridge(signedIn);
  useElectionPushBridge(signedIn);

  useEffect(() => {
    if (!initialized) return;
    const inAuth    = segments[0] === '(auth)';
    // Pre-auth screens: brand splash (no segment) and the onboarding carousel.
    const inPreAuth = !segments[0] || segments[0] === 'onboarding';
    // Module routes are authenticated-user routes that are worth returning to.
    // Exclude pre-auth screens, (auth), and index so returnTo is never circular.
    const isModuleRoute = segments.length > 0 && !inAuth && !inPreAuth;

    if (!user && !inAuth) {
      // Pass the current route so login can return the user here after success.
      if (isModuleRoute) {
        const returnTo = '/' + segments.join('/');
        router.replace({ pathname: '/(auth)/login', params: { returnTo } } as never);
      } else {
        router.replace('/(auth)/login');
      }
    }
    if (user && inAuth)    router.replace('/(tabs)/home');
    // Close the AuthGate gap: authenticated users on pre-auth screens (including
    // any URL-conflict fallback where (doctor)/onboarding shows as /onboarding)
    // must always land on the module-grid home.
    if (user && inPreAuth) router.replace('/(tabs)/home');
  }, [initialized, user, segments, router]);

  if (!initialized) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background }}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  const fontsReady = useBrandFonts();

  useEffect(() => {
    if (fontsReady) SplashScreen.hideAsync().catch(() => {});
  }, [fontsReady]);

  // Hold on the native splash until the brand font resolves (or fails → fallback).
  if (!fontsReady) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="dark" backgroundColor={Colors.background} />
        <AuthGate>
          <Stack screenOptions={{ headerShown: false }} initialRouteName="index">
            <Stack.Screen name="index" />
            <Stack.Screen name="onboarding" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="(doctor)" />
            <Stack.Screen name="services" />
            <Stack.Screen name="fx" />
            <Stack.Screen name="mobility" />
            <Stack.Screen name="crypto" />
            <Stack.Screen name="realtor" />
            <Stack.Screen name="wallet" />
            <Stack.Screen name="voting" />
            <Stack.Screen name="visitor" />
            <Stack.Screen name="guard" />
            <Stack.Screen name="election" />
            <Stack.Screen name="meetings" />
            <Stack.Screen name="tasks" />
            <Stack.Screen name="announcements" />
            <Stack.Screen name="emergencies" />
            <Stack.Screen name="repairs" />
            <Stack.Screen name="facilities" />
            <Stack.Screen name="documents" />
            <Stack.Screen name="vendors" />
            <Stack.Screen name="dues" />
            <Stack.Screen name="properties" />
            <Stack.Screen name="ai-notes" />
            <Stack.Screen name="finance" />
            <Stack.Screen name="estate-admin" />
            <Stack.Screen name="vendor-portal" />
            <Stack.Screen name="estate-notifications" />
            <Stack.Screen name="reports" />
            <Stack.Screen name="estate-settings" />
            <Stack.Screen name="(merchant)" />
          </Stack>
        </AuthGate>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
