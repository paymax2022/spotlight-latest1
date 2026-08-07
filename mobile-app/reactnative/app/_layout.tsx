import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Stack, useRouter, useSegments, usePathname, useGlobalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ToastHost from '@/components/ToastHost';
import ConfirmHost from '@/components/ConfirmHost';
import { Colors } from '@/constants/colors';
import { useAuthStore } from '@/store/authStore';
import { getPinStatus } from '@/features/transfers/api';
import { rememberResume, toParamMap } from '@/lib/resume';
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
  const pathname = usePathname();
  // useGlobalSearchParams() returns a NEW object every render; keeping it in the
  // gate effect's deps made the effect re-run on every render and storm router.replace
  // during redirects ("Maximum update depth exceeded"). It's only needed to snapshot
  // the resume target, so hold it in a ref and keep it OUT of the dependency array.
  const globalParams = useGlobalSearchParams();
  const globalParamsRef = useRef(globalParams);
  globalParamsRef.current = globalParams;

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

  // Transaction-PIN gate: a signed-in user without a 4-digit PIN is blocked on
  // the set-PIN screen until they create one (it must exist before it can be
  // requested/used anywhere). Shares the transfers pin-status query key so the
  // whole app stays in sync once the PIN is set.
  const pinQuery = useQuery({ queryKey: ['transfers', 'pin-status'], queryFn: getPinStatus, enabled: signedIn });
  const pinMissing = signedIn && pinQuery.data?.hasPin === false;

  // When the session ends (expiry or explicit logout: signedIn true → false),
  // drop all cached authenticated data so the next sign-in can't see the previous
  // session's data. The redirect to login is handled by the effect below.
  const wasSignedIn = useRef(false);
  useEffect(() => {
    if (wasSignedIn.current && !signedIn) queryClient.clear();
    wasSignedIn.current = signedIn;
  }, [signedIn]);

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

    // Transaction-PIN block: keep a PIN-less user on the set-PIN screen. Runs
    // only for a signed-in user who is not mid-auth and isn't already there.
    const onSetPin = segments[0] === 'security'; // only /security/set-pin lives here
    if (user && !inAuth && pinMissing && !onSetPin) {
      // Remember where the user was so we can return them after they set the PIN.
      rememberResume({ pathname, params: toParamMap(globalParamsRef.current) });
      router.replace('/security/set-pin');
    }
    // globalParams intentionally omitted (read via ref) — see note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized, user, segments, router, pinMissing, pathname]);

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
            <Stack.Screen name="food" />
            <Stack.Screen name="fx" />
            <Stack.Screen name="mobility" />
            <Stack.Screen name="crypto" />
            <Stack.Screen name="stocks" />
            <Stack.Screen name="invest-onboarding" />
            <Stack.Screen name="learn" />
            <Stack.Screen name="invest-settings" />
            <Stack.Screen name="invest-ai" />
            <Stack.Screen name="spotlight-wealth" />
            <Stack.Screen name="fractionalre" />
            <Stack.Screen name="admin" />
            <Stack.Screen name="realtor" />
            <Stack.Screen name="property" />
            <Stack.Screen name="wallet" />
            <Stack.Screen name="voting" />
            <Stack.Screen name="registration" />
            <Stack.Screen name="investment" />
            <Stack.Screen name="kyc" />
            <Stack.Screen name="security" />
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
            <Stack.Screen name="profile" />
            <Stack.Screen name="featured" />
          </Stack>
        </AuthGate>
        {/* Overlay sits above the navigator so toasts survive screen changes. */}
        <ToastHost />
        {/* Web renderer for confirmAsync/alertAsync (no-op on native). */}
        <ConfirmHost />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
