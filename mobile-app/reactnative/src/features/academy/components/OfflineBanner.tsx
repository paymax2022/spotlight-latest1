import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { CloudOff, RefreshCw } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useConnectivity } from '../offlineQueue';

/**
 * First-class offline affordance (nfr.md). Renders only when offline. In mock
 * mode connectivity is simulated — tap "Reconnect" to go back online and drain
 * the queued progress/reward events. Pending count is surfaced for transparency.
 */
export default function OfflineBanner() {
  const { offline, pendingCount, setOffline } = useConnectivity();
  if (!offline) return null;
  return (
    <View style={styles.wrap}>
      <CloudOff size={16} color={Colors.onWarning} strokeWidth={2} />
      <Text style={styles.text} numberOfLines={2}>
        You’re offline. Downloaded lessons, practice & mocks still work.
        {pendingCount > 0 ? ` ${pendingCount} change${pendingCount > 1 ? 's' : ''} will sync.` : ''}
      </Text>
      <Pressable onPress={() => setOffline(false)} hitSlop={8} style={styles.btn} accessibilityRole="button" accessibilityLabel="Reconnect">
        <RefreshCw size={14} color={Colors.onWarning} strokeWidth={2.2} />
        <Text style={styles.btnText}>Reconnect</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgGold,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginHorizontal: Spacing.containerMargin,
    marginBottom: Spacing.sm,
    borderRadius: Radius.md,
  },
  text: { ...Typography.labelSm, color: Colors.onWarning, flex: 1 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  btnText: { ...Typography.labelSm, color: Colors.onWarning, fontWeight: '700' },
});
