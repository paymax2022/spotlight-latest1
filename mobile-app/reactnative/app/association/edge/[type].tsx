import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import type { AssociationEdgeType } from '@/features/association/types/association.types';

interface EdgeConfig {
  icon: keyof typeof Icons;
  tone: 'error' | 'warn' | 'neutral';
  title: string;
  message: string;
  primary?: { label: string; to: string };
  secondary?: { label: string; to: string };
}

const CONFIG: Record<AssociationEdgeType, EdgeConfig> = {
  'payment-required': {
    icon: 'Lock', tone: 'warn',
    title: 'Access restricted',
    message: 'Some features are locked because your dues are outstanding. Settle your balance to restore full access.',
    primary: { label: 'Pay to restore access', to: '/association/dues' },
    secondary: { label: 'Back to dashboard', to: '/association/home' },
  },
  suspended: {
    icon: 'ShieldX', tone: 'error',
    title: 'Membership suspended',
    message: 'Your membership has been suspended. Please contact your chapter admin or support to appeal.',
    primary: { label: 'Contact support', to: '/association/home' },
  },
  'pending-approval': {
    icon: 'Clock', tone: 'warn',
    title: 'Awaiting approval',
    message: 'Your application is being reviewed by a chapter admin. You’ll be notified once a decision is made.',
    primary: { label: 'Back to discovery', to: '/association' },
  },
  rejected: {
    icon: 'CircleX', tone: 'error',
    title: 'Application not approved',
    message: 'Unfortunately your application was not approved. You can review the requirements and apply again.',
    primary: { label: 'Browse organisations', to: '/association' },
  },
  'no-organisations': {
    icon: 'Search', tone: 'neutral',
    title: 'No organisations found',
    message: 'We couldn’t find any organisations to show right now. Try again later.',
    primary: { label: 'Refresh', to: '/association' },
  },
  'invite-invalid': {
    icon: 'TicketX', tone: 'error',
    title: 'Invite code invalid',
    message: 'This invite or access code is invalid or has expired. Ask your admin for a new one.',
    primary: { label: 'Back', to: '/association' },
  },
  offline: {
    icon: 'WifiOff', tone: 'neutral',
    title: 'No internet connection',
    message: 'You appear to be offline. Check your connection and try again.',
    primary: { label: 'Retry', to: '/association' },
  },
  error: {
    icon: 'CloudOff', tone: 'error',
    title: 'Something went wrong',
    message: 'An unexpected error occurred. Please try again.',
    primary: { label: 'Back to dashboard', to: '/association/home' },
  },
};

export default function AssociationEdge() {
  const { type } = useLocalSearchParams<{ type: AssociationEdgeType }>();
  const cfg = CONFIG[type ?? 'error'] ?? CONFIG.error;
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[cfg.icon] ?? Icons.CloudOff;

  const tone =
    cfg.tone === 'error' ? { color: Colors.error, bg: Colors.errorContainer }
    : cfg.tone === 'warn' ? { color: Colors.gold, bg: Colors.iconBgGold }
    : { color: Colors.onSurfaceVariant, bg: Colors.surfaceContainer };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.body}>
        <View style={[styles.iconBox, { backgroundColor: tone.bg }]}>
          <Icon size={36} color={tone.color} strokeWidth={1.8} />
        </View>
        <Text style={styles.title}>{cfg.title}</Text>
        <Text style={styles.message}>{cfg.message}</Text>
      </View>

      <View style={styles.footer}>
        {cfg.primary ? <PrimaryButton label={cfg.primary.label} onPress={() => router.replace(cfg.primary!.to as never)} /> : null}
        {cfg.secondary ? <PrimaryButton label={cfg.secondary.label} variant="ghost" onPress={() => router.replace(cfg.secondary!.to as never)} /> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.md },
  iconBox: { width: 88, height: 88, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  message: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg, gap: Spacing.sm },
});
