import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ShieldAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';

// 18+ block screen (SAFETY INVARIANT §1). Reached when the age gate detects a
// suspected minor. The underage flag is recorded server-side and the account is
// queued to the admin underage review queue — there is NO under-18 mode, ever.
// gestureEnabled is disabled in _layout so this can't be swiped past.
export default function Underage() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <View style={styles.iconBox}>
          <ShieldAlert size={44} color={Colors.error} strokeWidth={1.8} />
        </View>
        <Text style={styles.title}>You must be 18 or older</Text>
        <Text style={styles.body}>
          Connect is strictly for adults aged 18 and above. Based on the date of birth you entered,
          we can't let you continue.
        </Text>
        <Text style={styles.body}>
          If you believe this is a mistake, our support team can help review your account.
        </Text>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton
          label="Contact support"
          onPress={() => router.replace('/connect/settings/help')}
        />
        <PrimaryButton
          label="Exit Connect"
          variant="ghost"
          onPress={() => router.replace('/(tabs)/home')}
        />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  iconBox: {
    width: 96, height: 96, borderRadius: Radius.full,
    backgroundColor: Colors.errorContainer, alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  body: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, gap: Spacing.xs },
});
