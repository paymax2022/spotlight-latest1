import { formatCountdown } from '../constants/format';
import { EARN_STATE_META, EarnStateKey, ROLE_META, ReferralColors, ReferralRole } from '../constants/referral.constants';
import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { ArrowLeft, Bell, Check, CircleQuestionMark, Clock, Lock, RefreshCw, X } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';


type Tone = 'info' | 'compliant' | 'warn' | 'danger';

interface DisclosureCardProps {
  title?: string;
  body?: string;
  /** Optional bullet points (e.g. responsible-earning list). */
  points?: string[];
  icon?: string;
  tone?: Tone;
  children?: React.ReactNode;
  style?: ViewStyle;
}

const TONE_STYLES: Record<Tone, { bg: string; fg: string; defaultIcon: string }> = {
  info:      { bg: Colors.surfaceContainerLow, fg: Colors.secondary,          defaultIcon: 'Info' },
  compliant: { bg: ReferralColors.okBg,        fg: Colors.tertiaryContainer,  defaultIcon: 'ShieldCheck' },
  warn:      { bg: ReferralColors.warnBg,      fg: Colors.onWarning,          defaultIcon: 'TriangleAlert' },
  danger:    { bg: Colors.errorContainer,      fg: Colors.error,              defaultIcon: 'CircleAlert' },
};

/**
 * Disclosure / explainer card used by onboarding, terms, responsible-earning and
 * the compliant "earnings tie to real activity" callout. The `compliant` tone is
 * the load-bearing pyramid-line message (PRD theme 1).
 */
export function DisclosureCard({ title, body, points, icon, tone = 'info', children, style }: DisclosureCardProps) {
  const t = TONE_STYLES[tone];
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[icon ?? t.defaultIcon] ?? Icons.Info;
  return (
    <View style={[disclosureCardStyles.card, { backgroundColor: t.bg }, style]}>
      <View style={disclosureCardStyles.row}>
        <View style={disclosureCardStyles.iconBox}><Icon size={18} color={t.fg} strokeWidth={2} /></View>
        <View style={disclosureCardStyles.body}>
          {title ? <Text style={disclosureCardStyles.title}>{title}</Text> : null}
          {body ? <Text style={disclosureCardStyles.text}>{body}</Text> : null}
          {points?.map((p, i) => (
            <View key={i} style={disclosureCardStyles.bullet}>
              <View style={[disclosureCardStyles.dot, { backgroundColor: t.fg }]} />
              <Text style={disclosureCardStyles.bulletText}>{p}</Text>
            </View>
          ))}
          {children}
        </View>
      </View>
    </View>
  );
}

const disclosureCardStyles = StyleSheet.create({
  card: { borderRadius: Radius.lg, padding: Spacing.md },
  row: { flexDirection: 'row', gap: Spacing.sm },
  iconBox: { paddingTop: 1 },
  body: { flex: 1, gap: 6 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  text: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  bullet: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', marginTop: 2 },
  dot: { width: 6, height: 6, borderRadius: Radius.full, marginTop: 7 },
  bulletText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
});

interface EarnStatePillProps {
  state: EarnStateKey;
}

/**
 * Reward-ledger state pill (earned → pending → vesting → eligible → paid →
 * clawed-back, PRD §7). Shared so RM2's earnings screens render states the same
 * way the foundation does.
 */
export function EarnStatePill({ state }: EarnStatePillProps) {
  const meta = EARN_STATE_META[state];
  return <StateBadge label={meta.label} tone={meta.tone as BadgeTone} />;
}

interface GraceCountdownProps {
  /** ISO timestamp when the grace window closes (§7A.3). */
  expiresAt: string | null;
  /** Called once when the window ticks past expiry, so the parent can lock UI. */
  onExpire?: () => void;
}

/**
 * Live countdown for the late code-claim grace window (M-INV-10). Ticks every
 * 30s; renders a locked state once the window closes. Shared so any screen that
 * shows the grace window renders it identically.
 */
export function GraceCountdown({ expiresAt, onExpire }: GraceCountdownProps) {
  const [remaining, setRemaining] = useState<string | null>(() => formatCountdown(expiresAt));

  useEffect(() => {
    setRemaining(formatCountdown(expiresAt));
    const id = setInterval(() => {
      const next = formatCountdown(expiresAt);
      setRemaining((prev) => {
        if (prev !== null && next === null) onExpire?.();
        return next;
      });
    }, 30_000);
    return () => clearInterval(id);
  }, [expiresAt, onExpire]);

  const locked = remaining === null;

  return (
    <View style={[graceCountdownStyles.wrap, locked ? graceCountdownStyles.wrapLocked : graceCountdownStyles.wrapOpen]}>
      {locked ? (
        <Lock size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
      ) : (
        <Clock size={16} color={Colors.onWarning} strokeWidth={2} />
      )}
      <Text style={[graceCountdownStyles.label, locked ? graceCountdownStyles.labelLocked : graceCountdownStyles.labelOpen]}>
        {locked ? 'Window closed — attribution is locked' : `Time left to claim: ${remaining}`}
      </Text>
    </View>
  );
}

const graceCountdownStyles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
  },
  wrapOpen: { backgroundColor: ReferralColors.warnBg },
  wrapLocked: { backgroundColor: Colors.surfaceContainer },
  label: { ...Typography.labelMd, flex: 1 },
  labelOpen: { color: Colors.onWarning },
  labelLocked: { color: Colors.onSurfaceVariant },
});

interface ReferralHeaderProps {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  /** Earn-hub top bar (PRD §5): notifications, role switcher, help. */
  showNotifications?: boolean;
  showRoleSwitcher?: boolean;
  showHelp?: boolean;
  onRoleSwitcher?: () => void;
  style?: ViewStyle;
}

/**
 * Shared Referral/Earn-hub header. The Earn hub top bar carries notifications,
 * a role switcher and help (PRD §5); inner stack screens just use back + title.
 * Reused by other referral agents so the chrome stays consistent.
 */
export function ReferralHeader({
  title,
  eyebrow,
  subtitle,
  showBack = true,
  onBack,
  showNotifications,
  showRoleSwitcher,
  showHelp,
  onRoleSwitcher,
  style,
}: ReferralHeaderProps) {
  return (
    <View style={[referralHeaderStyles.container, style]}>
      {showBack ? (
        <Pressable onPress={onBack ?? (() => router.back())} hitSlop={10} style={referralHeaderStyles.iconBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      ) : (
        <View style={referralHeaderStyles.iconBtn} />
      )}

      <View style={referralHeaderStyles.titleWrap}>
        {eyebrow ? <Text style={referralHeaderStyles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={referralHeaderStyles.title} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={referralHeaderStyles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>

      {showRoleSwitcher ? (
        <Pressable onPress={onRoleSwitcher ?? (() => router.push('/referral/onboarding/role-switcher'))} hitSlop={8} style={referralHeaderStyles.iconBtn} accessibilityRole="button" accessibilityLabel="Switch role">
          <RefreshCw size={19} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      ) : null}
      {showNotifications ? (
        <Pressable onPress={() => router.push('/referral/account/notifications')} hitSlop={8} style={referralHeaderStyles.iconBtn} accessibilityRole="button" accessibilityLabel="Notifications">
          <Bell size={19} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      ) : null}
      {showHelp ? (
        <Pressable onPress={() => router.push('/referral/account/help-support')} hitSlop={8} style={referralHeaderStyles.iconBtn} accessibilityRole="button" accessibilityLabel="Help and support">
          <CircleQuestionMark size={19} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  );
}

const referralHeaderStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    backgroundColor: Colors.background,
  },
  iconBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flex: 1 },
  eyebrow: { ...Typography.caption, color: Colors.primary, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { ...Typography.titleLg, color: Colors.onSurface },
  subtitle: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});

interface RoleSwitcherSheetProps {
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
export function RoleSwitcherSheet({
  visible,
  active,
  available,
  lockedUntilVerified = [],
  onClose,
  onSelect,
  onLockedPress,
}: RoleSwitcherSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={roleSwitcherSheetStyles.backdrop} onPress={onClose} accessibilityLabel="Close role switcher" />
      <View style={roleSwitcherSheetStyles.sheet}>
        <View style={roleSwitcherSheetStyles.handle} />
        <View style={roleSwitcherSheetStyles.headerRow}>
          <Text style={roleSwitcherSheetStyles.title}>Switch role</Text>
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
              style={[roleSwitcherSheetStyles.row, isActive && roleSwitcherSheetStyles.rowActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive, disabled: !isAvailable }}
              onPress={() => {
                if (isAvailable) onSelect(role);
                else if (isLocked) onLockedPress?.(role);
              }}
            >
              <View style={roleSwitcherSheetStyles.iconBox}><Icon size={20} color={isActive ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2} /></View>
              <View style={roleSwitcherSheetStyles.rowBody}>
                <Text style={roleSwitcherSheetStyles.roleLabel}>{meta.label}</Text>
                <Text style={roleSwitcherSheetStyles.roleBlurb} numberOfLines={1}>{meta.blurb}</Text>
              </View>
              {isActive ? (
                <Check size={18} color={Colors.primary} strokeWidth={2.4} />
              ) : isLocked ? (
                <View style={roleSwitcherSheetStyles.lockPill}><Lock size={12} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={roleSwitcherSheetStyles.lockText}>Verify</Text></View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </Modal>
  );
}

const roleSwitcherSheetStyles = StyleSheet.create({
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

export type BadgeTone = 'ok' | 'warn' | 'danger' | 'neutral' | 'accent';

interface StateBadgeProps {
  label: string;
  tone?: BadgeTone;
  style?: ViewStyle;
}

const TONES: Record<BadgeTone, { bg: string; fg: string }> = {
  ok:      { bg: Colors.iconBgTeal,   fg: Colors.tertiaryContainer },
  warn:    { bg: Colors.iconBgGold,   fg: Colors.onWarning },
  danger:  { bg: Colors.errorContainer, fg: Colors.error },
  neutral: { bg: Colors.surfaceContainer, fg: Colors.onSurfaceVariant },
  accent:  { bg: Colors.iconBgBlue,   fg: Colors.secondary },
};

/**
 * Small status pill (attribution status, fraud standing, generic states).
 * Reused across referral screens so status colours are consistent.
 */
export function StateBadge({ label, tone = 'neutral', style }: StateBadgeProps) {
  const t = TONES[tone];
  return (
    <View style={[stateBadgeStyles.badge, { backgroundColor: t.bg }, style]}>
      <Text style={[stateBadgeStyles.label, { color: t.fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const stateBadgeStyles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  label: { ...Typography.labelSm, fontWeight: '700' as const },
});
