import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Smartphone, Monitor } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import StatusBadge from './StatusBadge';
import type { Device } from '@/types/doctor.batch7';

interface Props {
  device:    Device;
  onRevoke?: () => void;   // omitted for the current device (cannot self-revoke)
  border?:   boolean;
}

// New component: a device/session row for the AC device-management screen with a
// platform icon, last-active meta and a revoke affordance. No existing row
// models a session with a destructive revoke action.
export default function DeviceRow({ device, onRevoke, border }: Props) {
  const Icon = device.platform === 'web' ? Monitor : Smartphone;
  const last = new Date(device.lastActiveAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return (
    <View style={[styles.row, border && styles.border]}>
      <View style={styles.iconBox}>
        <Icon size={20} color={Colors.secondary} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={styles.label} numberOfLines={1}>{device.label}</Text>
          {device.current && <StatusBadge label="This device" tone="success" />}
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {device.location ? `${device.location} · ` : ''}{last}
        </Text>
      </View>
      {!device.current && onRevoke && (
        <Pressable onPress={onRevoke} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Revoke ${device.label}`}>
          <Text style={styles.revoke}>Revoke</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  border:  { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgBlue },
  body:    { flex: 1, gap: 2 },
  top:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  label:   { ...Typography.labelLg, color: Colors.onSurface, flexShrink: 1 },
  meta:    { ...Typography.caption, color: Colors.onSurfaceVariant },
  revoke:  { ...Typography.labelMd, color: Colors.error },
});
