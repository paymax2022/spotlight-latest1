import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/store/authStore';
import { Colors } from '@/constants/colors';

// ── Guard: no standalone telemedicine auth ───────────────────────────────────
// Auth is handled by the app-wide AuthGate in _layout.tsx.
// Unauthenticated users → global login; authenticated users → provider intro.
export default function DoctorOnboardingEntry() {
  const { user, initialized } = useAuthStore();

  useEffect(() => {
    if (!initialized) return;
    if (!user) {
      router.replace('/(auth)/login');
    } else {
      router.replace('/(doctor)/onboarding/intro');
    }
  }, [initialized, user]);

  return (
    <View style={styles.fill}>
      <ActivityIndicator size="large" color={Colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
});
