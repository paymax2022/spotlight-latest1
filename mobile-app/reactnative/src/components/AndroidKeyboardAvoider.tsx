import React from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Keeps whatever is being typed above the keyboard on Android, for every screen.
 *
 * Expo SDK 54 builds Android edge-to-edge (`edgeToEdgeEnabled=true`), and in that
 * mode `windowSoftInputMode="adjustResize"` no longer shrinks the window — the
 * keyboard simply draws over the app. The ~140 per-screen KeyboardAvoidingViews
 * are all `Platform.OS === 'ios' ? 'padding' : undefined`, so on Android nothing
 * reacted, and most screens with inputs have none at all.
 *
 * React Native reports the keyboard's top edge on Android 11+ from the visible
 * display frame (ReactRootView.checkForKeyboardEvents), so its own
 * KeyboardAvoidingView with `padding` is correct here. One instance at the root
 * covers every screen; the per-screen ones stay inert on Android (behavior
 * undefined), so nothing is padded twice. iOS and web are untouched.
 *
 * The negative offset removes the bottom safe-area inset from the padding:
 * screens already inset themselves by the navigation-bar height, and the
 * keyboard covers that strip, so counting it twice would leave a gap above the
 * keyboard.
 */
export default function AndroidKeyboardAvoider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  if (Platform.OS !== 'android') return <>{children}</>;
  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={-insets.bottom}
      style={styles.fill}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
