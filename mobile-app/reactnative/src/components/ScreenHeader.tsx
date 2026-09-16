import React from 'react';
import { View, Text, Pressable, StyleSheet, ViewStyle } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { goBack } from '@/lib/navigation';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { HomeMenuButton } from '@/components/HomeMenu';

interface Props {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  /**
   * Where the arrow lands when there is no history to go back to — a deep link,
   * a refresh, a pasted URL. Should be this screen's logical PARENT, not the app
   * root, so backing out of a nested screen does not jump the user to the top.
   * Defaults to the authenticated home.
   */
  backFallback?: string;
  rightSlot?: React.ReactNode;
  showBack?: boolean;
  style?: ViewStyle;
}

/**
 * Shared back-navigation header (back arrow + title + optional right slot).
 * Extracted because services/voting/doctor screens each re-implemented this
 * inline; now reusable across every module's stack screens.
 *
 * BACK USED TO SILENTLY DO NOTHING. This called router.back() directly, which is
 * a NO-OP when the history is empty — routine on web, where every deep link,
 * refresh or pasted URL opens a screen with no stack behind it. 998 screens use
 * this header and only 20 pass their own onBack, so the arrow was dead on
 * roughly 978 of them for anyone who did not arrive by tapping through.
 *
 * src/lib/navigation.ts already solved this, and its own header says it was made
 * shared "so a screen cannot forget it" — but the app's most-used back button
 * never adopted it. It does now.
 */
export default function ScreenHeader({ title, subtitle, onBack, backFallback, rightSlot, showBack = true, style }: Props) {
  return (
    <View style={[styles.container, style]}>
      {showBack ? (
        <Pressable
          onPress={onBack ?? (() => goBack(backFallback ?? '/(tabs)/home'))}
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
