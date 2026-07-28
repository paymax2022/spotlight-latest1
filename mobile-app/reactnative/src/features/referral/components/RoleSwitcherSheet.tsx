import React from 'react';
import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import * as Icons from 'lucide-react-native';
import { Check, Lock, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { ROLE_META, ReferralRole } from '../constants/referral.constants';

interface Props {
  visible: boolean;
  active: ReferralRole;
  available: ReferralRole[];
  lockedUntilVerified?: ReferralRole[];
  onClose: () => void;
  onSelect: (role: ReferralRole) => void;
  /** Called when a locked role is tapped (route to step-up verification). */
  onLockedPress?: (role: ReferralRole) => void;
}

const ALL_ROLES: ReferralRole[] = ['referrer', 'ambassador', 'agent', 'merchant'];

/**
 * Bottom-sheet role/context switcher (M-ONB-09). One identity holds many roles
 * (PRD §3); locked roles require step-up verification before activation.
 * Shared so the top-bar switcher and the onboarding screen use the same sheet.
 */
export default function RoleSwitcherSheet({
  visible,
  active,
  available,
  lockedUntilVerified = [],
  onClose,
  onSelect,
  onLockedPress,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close role switcher" />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <Text style={styles.title}>Switch role</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>
        </View>

        {ALL_ROLES.map((role) => {
          const meta = ROLE_META[role];
          const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.User;
          const isActive = role === active;
          const isAvailable = available.includes(role);
          const isLocked = !isAvailable && lockedUntilVerified.includes(role);

          return (
            <Pressable
              key={role}
              style={[styles.row, isActive && styles.rowActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive, disabled: !isAvailable }}
              onPress={() => {
                if (isAvailable) onSelect(role);
                else if (isLocked) onLockedPress?.(role);
              }}
            >
              <View style={styles.iconBox}><Icon size={20} color={isActive ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2} /></View>
              <View style={styles.rowBody}>
                <Text style={styles.roleLabel}>{meta.label}</Text>
                <Text style={styles.roleBlurb} numberOfLines={1}>{meta.blurb}</Text>
              </View>
              {isActive ? (
                <Check size={18} color={Colors.primary} strokeWidth={2.4} />
              ) : isLocked ? (
                <View style={styles.lockPill}><Lock size={12} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.lockText}>Verify</Text></View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(11,28,48,0.4)' },
  sheet: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.containerMargin,
    paddingBottom: Spacing.xl,
    paddingTop: Spacing.sm,
    gap: Spacing.xs,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: Radius.full, backgroundColor: Colors.outlineVariant, marginBottom: Spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md, paddingHorizontal: Spacing.md, borderRadius: Radius.lg },
  rowActive: { backgroundColor: Colors.surfaceContainerLow },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1 },
  roleLabel: { ...Typography.labelLg, color: Colors.onSurface },
  roleBlurb: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  lockPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceContainer, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full },
  lockText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
