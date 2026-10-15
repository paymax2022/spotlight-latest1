import React from 'react';
import { Keyboard, Platform, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Space left between the focused input's text line and the keyboard, in dp — enough to show the field's own padding and border. */
const CLEARANCE = 32;
/** How often the focused input is re-checked while the keyboard is open. */
const RECHECK_MS = 250;

/**
 * Keeps whatever is being typed above the keyboard on Android, for every screen.
 *
 * Expo SDK 54 builds Android edge-to-edge (`edgeToEdgeEnabled=true`), and in that
 * mode `windowSoftInputMode="adjustResize"` no longer shrinks the window — the
 * keyboard simply draws over the app. The ~140 per-screen KeyboardAvoidingViews
 * are all `Platform.OS === 'ios' ? 'padding' : undefined`, so on Android nothing
 * reacted, and most screens with inputs have none at all.
 *
 * Two steps, both driven by the keyboard event (Android 11+, where `height` is the
 * IME inset minus the system-bar inset and `screenY` is the keyboard's top edge):
 *
 *  1. Pad the root by the keyboard height plus the bottom safe-area inset, so every
 *     screen's own ScrollView/footer sits above the keyboard.
 *  2. Padding alone is not enough: the system only scrolls a focused input into view
 *     when it gains focus — before the keyboard arrives — so an input near the bottom
 *     of a scroll view ends up half under the keyboard once the viewport shrinks.
 *     While the keyboard is open, measure the focused input and pan the content up
 *     by exactly the overlap.
 *
 * The per-screen KAVs stay inert on Android, so nothing is padded twice. iOS, web
 * and Android before 11 are untouched.
 */
export default function AndroidKeyboardAvoider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const active = Platform.OS === 'android' && Number(Platform.Version) >= 30;
  const [keyboard, setKeyboard] = React.useState({ height: 0, top: 0 });
  const [pan, setPan] = React.useState(0);
  const panRef = React.useRef(0);
  panRef.current = pan;

  React.useEffect(() => {
    if (!active) return;
    const show = Keyboard.addListener('keyboardDidShow', (e) =>
      setKeyboard({ height: e.endCoordinates.height, top: e.endCoordinates.screenY }));
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboard({ height: 0, top: 0 });
      setPan(0);
    });
    return () => { show.remove(); hide.remove(); };
  }, [active]);

  React.useEffect(() => {
    if (!active || keyboard.height === 0) return;
    const check = () => {
      // measure(), not measureInWindow(): on this setup measureInWindow reports a
      // TextInput ~50dp above where it is drawn, while measure()'s pageY matches.
      const input = TextInput.State.currentlyFocusedInput?.() as
        | { measure?: (cb: (x: number, y: number, w: number, h: number, pageX: number, pageY: number) => void) => void }
        | null
        | undefined;
      input?.measure?.((_x, _y, _w, h, _pageX, pageY) => {
        // pageY includes the current pan, so add it back to get the resting position.
        const needed = Math.max(0, pageY + panRef.current + h + CLEARANCE - keyboard.top);
        if (Math.abs(needed - panRef.current) > 1) setPan(needed);
      });
    };
    const first = setTimeout(check, 300);
    const timer = setInterval(check, RECHECK_MS);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [active, keyboard]);

  if (!active) return <>{children}</>;
  return (
    <View
      style={[
        styles.fill,
        keyboard.height > 0 && { paddingBottom: keyboard.height + insets.bottom },
        pan > 0 && { marginTop: -pan },
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
