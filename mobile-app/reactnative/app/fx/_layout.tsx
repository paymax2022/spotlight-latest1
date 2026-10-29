import React from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { Home, Wallet, LayoutGrid, User } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';

type IconType = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

function TabItem({ icon: Icon, label, focused }: { icon: IconType; label: string; focused: boolean }) {
  return (
    <View style={[styles.item, focused && styles.itemActive]}>
      <Icon size={21} color={focused ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={focused ? 2.3 : 1.9} />
      {focused ? <Text style={styles.itemLabel} numberOfLines={1}>{label}</Text> : null}
    </View>
  );
}

function BottomNav() {
  const router = useRouter();
  const segments = useSegments();
  const isFx = segments[0] === 'fx';

  return (
    <View style={styles.tabBar}>
      <Pressable style={styles.tabItem} onPress={() => router.push('/(tabs)/home')}>
        <TabItem icon={Home} label="Home" focused={false} />
      </Pressable>
      <Pressable style={styles.tabItem} onPress={() => router.push('/(tabs)/wallet')}>
        <TabItem icon={Wallet} label="Wallet" focused={false} />
      </Pressable>
      <Pressable style={[styles.tabItem, { opacity: isFx ? 1 : 0.5 }]} disabled={isFx}>
        <TabItem icon={LayoutGrid} label="Services" focused={isFx} />
      </Pressable>
      <Pressable style={styles.tabItem} onPress={() => router.push('/(tabs)/profile')}>
        <TabItem icon={User} label="Profile" focused={false} />
      </Pressable>
    </View>
  );
}

export default function FxLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.background },
          animation: 'slide_from_right',
        }}
      >
        {/* Home & Balances (B) */}
        <Stack.Screen name="index" />
        <Stack.Screen name="add-wallet" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />

        {/* Convert / Exchange (C) */}
        <Stack.Screen name="convert/index" />
        <Stack.Screen name="convert/confirm" />
        <Stack.Screen name="convert/processing" options={{ gestureEnabled: false }} />
        <Stack.Screen name="convert/success" options={{ gestureEnabled: false, animation: 'fade' }} />
        <Stack.Screen name="convert/failed" options={{ gestureEnabled: false, animation: 'fade' }} />

        {/* Send / Payout (D) — select beneficiary → amount → review → result */}
        <Stack.Screen name="send/index" />
        <Stack.Screen name="send/new-beneficiary" />
        <Stack.Screen name="send/amount" />
        <Stack.Screen name="send/recurring" />
        <Stack.Screen name="send/bulk" />
        <Stack.Screen name="send/review" />
        <Stack.Screen name="send/processing" options={{ gestureEnabled: false }} />
        <Stack.Screen name="send/success" options={{ gestureEnabled: false, animation: 'fade' }} />
        <Stack.Screen name="send/failed" options={{ gestureEnabled: false, animation: 'fade' }} />

        {/* Beneficiaries (G) */}
        <Stack.Screen name="beneficiaries/index" />
        <Stack.Screen name="beneficiaries/[id]" />

        {/* Receive / Collections (E) */}
        <Stack.Screen name="receive/index" />
        <Stack.Screen name="receive/[id]" />

        {/* Cards (F) */}
        <Stack.Screen name="cards/index" />
        <Stack.Screen name="cards/new" />
        <Stack.Screen name="cards/[id]/index" />
        <Stack.Screen name="cards/[id]/fund" />
        <Stack.Screen name="cards/[id]/controls" />
        <Stack.Screen name="cards/[id]/transactions" />

        {/* Transactions (H) */}
        <Stack.Screen name="transactions/index" />
        <Stack.Screen name="transactions/[id]" />
        <Stack.Screen name="transactions/dispute/[id]" />

        {/* KYC / KYB verification (A) */}
        <Stack.Screen name="kyc/index" />
        <Stack.Screen name="kyc/consents" />
        <Stack.Screen name="kyc/permissions" />
        <Stack.Screen name="kyc/identity" />
        <Stack.Screen name="kyc/selfie" />
        <Stack.Screen name="kyc/business" />
        <Stack.Screen name="kyc/directors" />
        <Stack.Screen name="kyc/documents" />
        <Stack.Screen name="kyc/submitted" options={{ gestureEnabled: false, animation: 'fade' }} />
        <Stack.Screen name="kyc/status" />

        {/* Business / multi-user (I) */}
        <Stack.Screen name="business/index" />
        <Stack.Screen name="business/team" />
        <Stack.Screen name="business/approvals" />
        <Stack.Screen name="business/thresholds" />
        <Stack.Screen name="business/activity" />
        <Stack.Screen name="business/developer" />

        {/* Notifications (J) */}
        <Stack.Screen name="notifications" />

        {/* Settings (K) */}
        <Stack.Screen name="settings/index" />
        <Stack.Screen name="settings/limits" />
        <Stack.Screen name="settings/stablecoin" />
        <Stack.Screen name="settings/notifications" />
        <Stack.Screen name="settings/security" />

        {/* Global edge / error states (L) */}
        <Stack.Screen name="states/[kind]" options={{ animation: 'fade' }} />

        {/* Rate alerts (C) */}
        <Stack.Screen name="rate-alerts/index" />
        <Stack.Screen name="rate-alerts/new" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      </Stack>
      <BottomNav />
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: Platform.OS === 'ios' ? 84 : 66,
    paddingBottom: Platform.OS === 'ios' ? 24 : 8,
    paddingTop: 8,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.outlineVariant,
    ...Platform.select({
      ios: { shadowColor: '#0B1C30', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.06, shadowRadius: 16 },
      android: { elevation: 10 },
      default: {},
    }),
  },
  tabItem: {
    flex: 1,
    height: '100%',
    paddingVertical: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 38,
    paddingHorizontal: 10,
    borderRadius: Radius.full,
  },
  itemActive: {
    backgroundColor: Colors.primaryFixed,
    paddingHorizontal: 13,
  },
  itemLabel: {
    ...Typography.labelSm,
    color: Colors.primary,
    fontWeight: '700' as const,
  },
});
