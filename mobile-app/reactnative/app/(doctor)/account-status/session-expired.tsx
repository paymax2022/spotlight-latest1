import React from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { TeleHeader } from '@/features/telemedicine/components';
import { EdgeStateView } from '@/features/doctor/components';
import { getEdgeState } from '@/api/doctor.batch7.api';

// ── Section AD — Session-expired gate (AD.9) ──────────────────────────────────
// Dedicated full-screen gate rendering the session_expired descriptor via the
// shared EdgeStateView. The primary CTA routes to the descriptor's login route.

export default function SessionExpiredScreen() {
  const descriptor = getEdgeState('session_expired');
  const goLogin = () => {
    const route = descriptor.cta?.route;
    if (route) router.replace(route as never);
    else router.replace('/(doctor)/signup');
  };
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Session Expired" />
      <EdgeStateView descriptor={descriptor} onPrimary={goLogin} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
});
