import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Smartphone, Monitor } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import type { Device } from '../types/settings.types';
import { relativeTime } from './format';

interface Props {
  device: Device;
  onRevoke: () => void;
  revoking?: boolean;
}

export default function DeviceRow({ device, onRevoke, revoking }: Props) {
  const isDesktop = /mac|macbook|windows|laptop|pc/i.test(device.name);
  const Icon = isDesktop ? Monitor : Smartphone;
  return (
    <View style={styles.card}>
      <View style={styles.iconBox}>
        <Icon size={20} color={Colors.onSurface} strokeWidth={1.8} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.name} numberOfLines={1}>{device.name}</Text>
        <Text style={styles.meta}>
          {device.current ? 'This device' : `Last active ${relativeTime(device.lastActive)}`}
        </Text>
      </View>
      {device.current ? (
        <View style={styles.currentChip}>
          <View style={styles.dot} />
          <Text style={styles.currentText}>Active</Text>
        </View>
      ) : (
        <Pressable
          onPress={onRevoke}
          disabled={revoking}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Revoke ${device.name}`}
          style={[styles.revokeBtn, revoking && styles.disabled]}
        >
          <Text style={styles.revokeText}>Revoke</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  iconBox: {
    width: 40, height: 40, borderRadius: Radius.md,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerHigh,
  },
  flex: { flex: 1 },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  meta: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  currentChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.tertiaryFixed, borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 4,
  },
  dot: { width: 6, height: 6, borderRadius: Radius.full, backgroundColor: Colors.tertiary },
  currentText: { ...Typography.labelSm, color: Colors.tertiary, fontWeight: '600' as const },
  revokeBtn: {
    borderWidth: 1.5, borderColor: Colors.error, borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
  },
  revokeText: { ...Typography.labelSm, color: Colors.error, fontWeight: '600' as const },
  disabled: { opacity: 0.5 },
});
