// ── Paymax Invest · Crypto — clipboard helper ────────────────────────────────
// expo-clipboard is not a project dependency, so we feature-detect it at runtime
// and fall back to the native Share sheet (mirrors the fx helper). Works today
// and "just works" if expo-clipboard is added later.

import { Share } from 'react-native';

export async function copyText(value: string, shareFallbackTitle?: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Clipboard = require('expo-clipboard');
    if (Clipboard?.setStringAsync) {
      await Clipboard.setStringAsync(value);
      return true;
    }
  } catch {
    /* expo-clipboard not installed — fall through to Share */
  }
  try {
    await Share.share({ message: value, title: shareFallbackTitle });
    return true;
  } catch {
    return false;
  }
}
