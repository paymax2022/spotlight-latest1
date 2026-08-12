import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Star, BadgeCheck, Phone, MessageCircle, User } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import type { Driver } from '../types/mobility.types';

interface Props {
  driver: Driver;
  subtitle?: string;
  onCall?: () => void;
  onMessage?: () => void;
  compact?: boolean;
}

/** Driver identity row: photo, name, rating, verified badge, optional call/chat.
 *  Surfaces the safety-critical "verified driver" signal from safety.md. */
export default function DriverCard({ driver, subtitle, onCall, onMessage, compact }: Props) {
  return (
    <View style={[styles.row, compact && styles.compact]}>
      <View style={styles.avatar}>
        <User size={26} color={Colors.primary} strokeWidth={2} />
      </View>

      <View style={styles.body}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{driver.name}</Text>
          {driver.verified && <BadgeCheck size={16} color={Colors.secondary} strokeWidth={2.4} />}
        </View>
        <View style={styles.metaRow}>
          <Star size={13} color={Colors.gold} fill={Colors.gold} strokeWidth={0} />
          <Text style={styles.meta}>{(driver.rating ?? 0).toFixed(2)}</Text>
          <View style={styles.dot} />
          {/* Live backend driver payload omits tripsCount — render 0 rather than crash. */}
          <Text style={styles.meta}>{(driver.tripsCount ?? 0).toLocaleString('en-NG')} trips</Text>
        </View>
        {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>

      {(onCall || onMessage) && (
        <View style={styles.actions}>
          {onMessage && (
            <Pressable onPress={onMessage} style={styles.actionBtn} accessibilityLabel="Message driver" hitSlop={6}>
              <MessageCircle size={18} color={Colors.secondary} strokeWidth={2} />
            </Pressable>
          )}
          {onCall && (
            <Pressable onPress={onCall} style={[styles.actionBtn, styles.callBtn]} accessibilityLabel="Call driver" hitSlop={6}>
              <Phone size={18} color={Colors.white} strokeWidth={2} />
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  compact: { gap: Spacing.sm },
  avatar: { width: 52, height: 52, borderRadius: Radius.full, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { ...Typography.titleMd, color: Colors.onSurface, flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  subtitle: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: Colors.outline },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  actionBtn: { width: 42, height: 42, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  callBtn: { backgroundColor: Colors.secondary },
});
