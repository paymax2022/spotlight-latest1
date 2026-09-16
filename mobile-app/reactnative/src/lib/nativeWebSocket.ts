import { Platform } from 'react-native';

// openWebSocket — construct a WebSocket the way each platform actually
// supports, instead of always using RN's 3-argument (url, protocols, options)
// form.
//
// WHY THIS EXISTS: React Native's WebSocket polyfill accepts a non-standard
// third `options.headers` argument (used to carry a Bearer token when a
// connection can't authenticate via its URL). On real native builds that
// works. On web, `WebSocket` from `react-native` resolves to the BROWSER's
// own native constructor, which the WHATWG spec defines as taking at most two
// arguments (url, protocols). Passing a third argument there — even an empty
// object — does not get silently ignored: reproduced directly against Chrome,
// `new WebSocket(url, undefined, {})` fails the connection immediately with
// `onerror` then `onclose` (code 1006), while `new WebSocket(url, undefined)`
// on the exact same URL opens normally. Every food/mobility realtime socket
// that used the 3-arg form unconditionally was therefore broken on web
// (Expo web, react-native-web) regardless of whether headers were ever
// actually needed for that connection.
//
// Browsers have never supported custom WebSocket headers at all — that is a
// platform limitation, not something this helper can work around — so on web
// `headers` is simply dropped. This is safe for every caller today: the real
// auth path is always the signed `?ticket=` query param, and headers are only
// ever populated on a legacy fallback URL that was never reachable from a
// browser client in the first place.
export function openWebSocket(url: string, headers?: Record<string, string>): WebSocket {
  if (Platform.OS === 'web') {
    return new WebSocket(url);
  }
  const WS = WebSocket as unknown as new (
    url: string,
    protocols?: string | string[],
    options?: { headers?: Record<string, string> },
  ) => WebSocket;
  return new WS(url, undefined, { headers: headers ?? {} });
}
