import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Colors, Radius } from '@/constants/tokens';
import { goBack } from '@/lib/navigation';

/**
 * Presents a screen as a bottom sheet. Native builds already get a real modal from the
 * stack's `presentation: 'modal'`, so this only adds the sheet on web, where a modal
 * route otherwise renders as a full page. Tapping the dimmed backdrop closes the sheet.
 *
 * @param fallback route to land on when the sheet has no history to return to
 */
export default function ModalSheet({ children, fallback }: { children: React.ReactNode; fallback: string }) {
  if (Platform.OS !== 'web') return <>{children}</>;
  return (
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => goBack(fallback)} accessibilityLabel="Close" />
      <View style={styles.sheet}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', backgroundColor: 'rgba(11,28,48,0.45)' },
  sheet: {
    width: '100%',
    maxWidth: 560,
    height: '88%',
    backgroundColor: Colors.background,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    overflow: 'hidden',
  },
});
