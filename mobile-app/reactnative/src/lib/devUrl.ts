import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * In dev, Expo embeds the Metro bundler's host address in Constants.expoConfig.hostUri
 * (format: "192.168.x.x:8081"). That IP is the developer's Mac — the same machine
 * running Supabase and Next.js. Rewriting loopback URLs to that IP makes local APIs
 * reachable from physical devices and emulators alike.
 *
 * Fallback rules when no hostUri is present:
 *   Android emulator → 10.0.2.2  (special alias for the host's loopback)
 *   iOS simulator    → 127.0.0.1 (simulator shares the Mac's network stack)
 */
function getMetroHost(): string | null {
  const hostUri =
    ((Constants.expoConfig as unknown as Record<string, unknown>)?.hostUri as string | undefined) ??
    ((Constants.manifest  as unknown as Record<string, unknown>)?.debuggerHost as string | undefined);

  if (!hostUri) return null;
  const host = hostUri.split(':')[0];
  return host || null;
}

export function getDevUrl(url: string): string {
  if (!__DEV__) return url;

  const metroHost = getMetroHost();

  if (metroHost && metroHost !== '127.0.0.1' && metroHost !== 'localhost') {
    // Physical device or emulator connected via LAN — use the real Mac IP.
    return url
      .replace(/127\.0\.0\.1/g, metroHost)
      .replace(/localhost/g,    metroHost);
  }

  // Android emulator: 10.0.2.2 is the host's loopback as seen from inside the VM.
  if (Platform.OS === 'android') {
    return url
      .replace(/127\.0\.0\.1/g, '10.0.2.2')
      .replace(/localhost/g,    '10.0.2.2');
  }

  // iOS simulator shares the Mac's network — 127.0.0.1 is correct as-is.
  return url;
}
