import React from 'react';
import { View, Text, Pressable, StyleSheet, ViewStyle } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { HomeMenuButton } from '@/components/HomeMenu';

interface Props {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  rightSlot?: React.ReactNode;
  showBack?: boolean;
  style?: ViewStyle;
}

/**
 * Shared back-navigation header (back arrow + title + optional right slot).
 * Extracted because services/voting/doctor screens each re-implemented this
 * inline; now reusable across every module's stack screens.
 */
export default function ScreenHeader({ title, subtitle, onBack, rightSlot, showBack = true, style }: Props) {
  return (
    <View style={[styles.container, style]}>
      {showBack ? (
        <Pressable
          onPress={onBack ?? (() => router.back())}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.backBtn}
        >
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      ) : (
        <View style={styles.backBtn} />
      )}

      <View style={styles.titleWrap}>
        {title ? <Text style={styles.title} numberOfLines={1}>{title}</Text> : null}
        {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>

      {/* The screen's own actions stay first; the global home menu sits outboard
          of them so it never covers what the screen put there. */}
      <View style={styles.rightSlot}>{rightSlot}</View>
      <HomeMenuButton />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    backgroundColor: Colors.background,
    gap: Spacing.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -8,
  },
  titleWrap: { flex: 1 },
  title: { ...Typography.titleLg, color: Colors.onSurface },
  subtitle: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  rightSlot: { minWidth: 40, alignItems: 'flex-end' },
});
