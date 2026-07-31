import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react-native';
import { useToastStore } from '@/store/toastStore';
import type { ToastVariant } from '@/store/toastStore';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { shadow2 } from '@/constants/shadows';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';

const VARIANTS: Record<ToastVariant, { accent: string; icon: typeof Info }> = {
  success: { accent: Colors.teal,    icon: CheckCircle2 },
  error:   { accent: Colors.error,   icon: AlertCircle },
  info:    { accent: Colors.primary, icon: Info },
};

/**
 * Single-slot toast overlay. Mounted once at the app root; any screen raises a
 * toast with `showToast(...)` from `@/store/toastStore`.
 *
 * Deliberately single-slot: money flows surface one actionable message at a
 * time, and a stack of overlapping errors reads as noise rather than feedback.
 */
export default function ToastHost() {
  const toast   = useToastStore((s) => s.toast);
  const dismiss = useToastStore((s) => s.dismiss);
  const insets  = useSafeAreaInsets();

  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!toast) return;

    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    if (toast.duration <= 0) return;
    const handle = setTimeout(() => dismiss(toast.id), toast.duration);
    return () => clearTimeout(handle);
  }, [toast, anim, dismiss]);

  if (!toast) return null;

  const { accent, icon: Icon } = VARIANTS[toast.variant];

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { bottom: insets.bottom + Spacing.lg },
        {
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
        },
      ]}
    >
      <Pressable
        accessibilityRole="alert"
        accessibilityLabel={`${toast.title}. ${toast.message ?? ''}`}
        onPress={() => dismiss(toast.id)}
        style={[styles.toast, shadow2, { borderLeftColor: accent }]}
      >
        <View style={[styles.iconWrap, { backgroundColor: `${accent}1F` }]}>
          <Icon size={18} color={accent} strokeWidth={2.2} />
        </View>

        <View style={styles.copy}>
          <Text style={styles.title} numberOfLines={2}>{toast.title}</Text>
          {toast.message ? (
            <Text style={styles.message} numberOfLines={3}>{toast.message}</Text>
          ) : null}
        </View>

        <X size={16} color={Colors.onSurfaceVariant} strokeWidth={2.2} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: Spacing.containerMargin,
    right: Spacing.containerMargin,
    zIndex: 1000,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    borderLeftWidth: 4,
    padding: Spacing.md,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, paddingTop: 2 },
  title:   { ...Typography.labelMd, color: Colors.onSurface },
  message: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
});
