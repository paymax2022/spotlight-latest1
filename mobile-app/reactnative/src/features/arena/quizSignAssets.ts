// ── Quiz sign assets — bundled, on-device road-sign SVGs ─────────────────────
// The Naija Driver bank flags 17 road-sign questions whose image_url is a
// 'sign:<key>' sentinel (see supabase/migrations/20260922003000). Rather than
// fetch an image over the network, we inline the SVG XML STRING of ONLY the
// signs actually used and render them with <SvgXml> from react-native-svg
// (already installed). No svg transformer, no metro/build-config change, no new
// deps. The XML below is copied verbatim from
// mobile-app/reactnative/assets/road-signs/<category>/<key>.svg and keyed by the
// manifest `key`.

/** Inlined SVG XML for each sign key used by the quiz bank. */
export const QUIZ_SIGN_XML: Record<string, string> = {
  'turn-left': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-labelledby="t"><title id="t">Turn left</title><desc>Mandatory blue circle with a white arrow pointing left.</desc><circle cx="120" cy="120" r="112" fill="#0B5FB0"/><polygon points="70,120 108,86 108,106 172,106 172,134 108,134 108,154" fill="#fff"/></svg>`,

  'no-entry': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-labelledby="t">
  <title id="t">No entry</title>
  <desc>Solid red circle with a white horizontal bar; entry prohibited.</desc>
  <circle cx="120" cy="120" r="112" fill="#C81E2D"/>
  <rect x="50" y="104" width="140" height="32" rx="4" fill="#FFFFFF"/>
</svg>`,

  'no-overtaking': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-labelledby="t">
  <title id="t">No overtaking</title>
  <desc>White circle, red ring, two cars side by side crossed by a red diagonal bar.</desc>
  <circle cx="120" cy="120" r="112" fill="#C81E2D"/>
  <circle cx="120" cy="120" r="88" fill="#FFFFFF"/>
  <g fill="#141414">
    <path transform="translate(40,104)" d="M2 30 L10 10 C12 5 16 3 22 3 L44 3 C50 3 54 5 56 10 L64 26 C66 28 66 30 66 32 L66 34 C66 36 64 36 62 36 L58 36 A9 9 0 0 0 40 36 L26 36 A9 9 0 0 0 8 36 L4 36 C2 36 0 35 0 32 Z"/>
    <path transform="translate(118,104)" d="M2 30 L10 10 C12 5 16 3 22 3 L44 3 C50 3 54 5 56 10 L64 26 C66 28 66 30 66 32 L66 34 C66 36 64 36 62 36 L58 36 A9 9 0 0 0 40 36 L26 36 A9 9 0 0 0 8 36 L4 36 C2 36 0 35 0 32 Z"/>
  </g>
  <line x1="54" y1="54" x2="186" y2="186" stroke="#C81E2D" stroke-width="22" stroke-linecap="round"/>
</svg>`,

  'no-u-turn': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-labelledby="t">
  <title id="t">No U-turn</title>
  <desc>White circle, red ring, a U-turn arrow crossed by a red diagonal bar.</desc>
  <circle cx="120" cy="120" r="112" fill="#C81E2D"/>
  <circle cx="120" cy="120" r="88" fill="#FFFFFF"/>
  <g fill="none" stroke="#141414" stroke-width="14" stroke-linecap="butt">
    <path d="M92 158 V108 A28 28 0 0 1 148 108 V150"/>
  </g>
  <polygon points="148,178 132,150 164,150" fill="#141414"/>
  <line x1="54" y1="54" x2="186" y2="186" stroke="#C81E2D" stroke-width="22" stroke-linecap="round"/>
</svg>`,

  'no-waiting': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-labelledby="t">
  <title id="t">No waiting</title>
  <desc>White circle, red ring, a single red diagonal bar; waiting prohibited.</desc>
  <circle cx="120" cy="120" r="112" fill="#C81E2D"/>
  <circle cx="120" cy="120" r="88" fill="#FFFFFF"/>
  <line x1="58" y1="58" x2="182" y2="182" stroke="#C81E2D" stroke-width="20" stroke-linecap="round"/>
</svg>`,

  'speed-limit-50': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-labelledby="t">
  <title id="t">Speed limit 50</title>
  <desc>White circle, red ring, black number 50; maximum speed 50.</desc>
  <circle cx="120" cy="120" r="112" fill="#C81E2D"/>
  <circle cx="120" cy="120" r="88" fill="#FFFFFF"/>
  <text x="120" y="122" fill="#141414" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="88" text-anchor="middle" dominant-baseline="central">50</text>
</svg>`,

  'give-way': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-labelledby="t">
  <title id="t">Give way</title>
  <desc>White downward-pointing triangle with a thick red border; yield to traffic.</desc>
  <polygon points="14,44 226,44 120,222" fill="#FFFFFF" stroke="#C81E2D" stroke-width="20" stroke-linejoin="round"/>
</svg>`,

  'roundabout-ahead': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-labelledby="t"><title id="t">Roundabout ahead</title><desc>Warning triangle: roundabout ahead, three curved arrows circulating clockwise.</desc><path d="M120 26 L212 198 L28 198 Z" fill="#ffffff" stroke="#C81E2D" stroke-width="15" stroke-linejoin="round"/><circle cx="120" cy="148" r="34" fill="none" stroke="#141414" stroke-width="13"/><path d="M112 100 L136 112 L114 126 Z" fill="#141414"/><path d="M152 170 L150 144 L172 158 Z" fill="#141414"/><path d="M88 144 L90 170 L68 156 Z" fill="#141414"/></svg>`,

  'slippery-road': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-labelledby="t"><title id="t">Slippery road</title><desc>Warning triangle: slippery road surface, car skidding.</desc><path d="M120 26 L212 198 L28 198 Z" fill="#ffffff" stroke="#C81E2D" stroke-width="15" stroke-linejoin="round"/><path d="M86 128 L94 108 L146 108 L154 128 Z" fill="#141414"/><circle cx="100" cy="130" r="8" fill="#141414"/><circle cx="140" cy="130" r="8" fill="#141414"/><path d="M82 160 Q94 148 104 160 Q114 172 124 160" fill="none" stroke="#141414" stroke-width="6" stroke-linecap="round"/><path d="M132 168 Q144 156 154 168 Q164 180 174 168" fill="none" stroke="#141414" stroke-width="6" stroke-linecap="round"/></svg>`,

  'pedestrian-crossing': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-labelledby="t"><title id="t">Pedestrian crossing ahead</title><desc>Warning triangle: pedestrians crossing ahead, walking figure.</desc><path d="M120 26 L212 198 L28 198 Z" fill="#ffffff" stroke="#C81E2D" stroke-width="15" stroke-linejoin="round"/><circle cx="124" cy="96" r="10" fill="#141414"/><path d="M124 108 L119 142 M119 142 L106 176 M119 142 L136 172 M123 118 L104 132 M123 120 L143 128" fill="none" stroke="#141414" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

  'children-crossing': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-labelledby="t"><title id="t">Children / school ahead</title><desc>Warning triangle: children crossing or school ahead, two figures.</desc><path d="M120 26 L212 198 L28 198 Z" fill="#ffffff" stroke="#C81E2D" stroke-width="15" stroke-linejoin="round"/><circle cx="102" cy="108" r="8" fill="#141414"/><path d="M102 118 L98 148 M98 148 L88 176 M98 148 L108 176 M100 126 L86 140 M100 126 L112 138" fill="none" stroke="#141414" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="146" cy="98" r="9" fill="#141414"/><path d="M146 109 L142 144 M142 144 L131 176 M142 144 L154 174 M144 120 L160 132 M144 122 L128 134" fill="none" stroke="#141414" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

  'road-narrows-both': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-labelledby="t"><title id="t">Road narrows on both sides</title><desc>Warning triangle: carriageway narrows from both sides.</desc><path d="M120 26 L212 198 L28 198 Z" fill="#ffffff" stroke="#C81E2D" stroke-width="15" stroke-linejoin="round"/><path d="M90 190 L90 138 L106 96 M150 190 L150 138 L134 96" fill="none" stroke="#141414" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

  'steep-hill-downwards': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-labelledby="t"><title id="t">Steep hill downwards</title><desc>Warning triangle: steep descent, slope falling to the right.</desc><path d="M120 26 L212 198 L28 198 Z" fill="#ffffff" stroke="#C81E2D" stroke-width="15" stroke-linejoin="round"/><path d="M74 116 L74 176 L170 176 Z" fill="#141414"/></svg>`,

  'two-way-traffic': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-labelledby="t"><title id="t">Two-way traffic ahead</title><desc>Warning triangle: two-way traffic ahead, arrows up and down.</desc><path d="M120 26 L212 198 L28 198 Z" fill="#ffffff" stroke="#C81E2D" stroke-width="15" stroke-linejoin="round"/><path d="M104 190 L104 104" fill="none" stroke="#141414" stroke-width="13" stroke-linecap="round"/><path d="M91 118 L104 96 L117 118 Z" fill="#141414"/><path d="M136 100 L136 186" fill="none" stroke="#141414" stroke-width="13" stroke-linecap="round"/><path d="M123 172 L136 194 L149 172 Z" fill="#141414"/></svg>`,

  'level-crossing-with-gate': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-labelledby="t"><title id="t">Level crossing with gate/barrier</title><desc>Warning triangle: level crossing with gate or barrier, gate symbol.</desc><path d="M120 26 L212 198 L28 198 Z" fill="#ffffff" stroke="#C81E2D" stroke-width="15" stroke-linejoin="round"/><path d="M78 116 L78 178 M162 116 L162 178 M78 132 L162 132 M78 156 L162 156 M78 178 L162 118" fill="none" stroke="#141414" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

  'hatched-marking': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-labelledby="t">
  <title id="t">Hatched road marking</title>
  <desc>Top-down view of asphalt with a white-bordered central area filled with diagonal hatching.</desc>
  <rect width="240" height="240" fill="#4A4A4A"/>
  <rect x="96" y="14" width="6" height="212" fill="#FFFFFF"/>
  <rect x="138" y="14" width="6" height="212" fill="#FFFFFF"/>
  <g stroke="#FFFFFF" stroke-width="5">
    <line x1="102" y1="40" x2="138" y2="14"/>
    <line x1="102" y1="80" x2="138" y2="54"/>
    <line x1="102" y1="120" x2="138" y2="94"/>
    <line x1="102" y1="160" x2="138" y2="134"/>
    <line x1="102" y1="200" x2="138" y2="174"/>
    <line x1="102" y1="226" x2="138" y2="214"/>
  </g>
</svg>`,

  'continuous-centre-line': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-labelledby="t">
  <title id="t">Continuous (unbroken) centre line</title>
  <desc>Top-down view of asphalt with a single solid white centre line running down the road.</desc>
  <rect width="240" height="240" fill="#4A4A4A"/>
  <rect x="115" y="10" width="10" height="220" fill="#FFFFFF"/>
</svg>`,
};

/** Prefix used by the backend/migration to flag a bundled sign illustration. */
export const SIGN_URL_PREFIX = 'sign:';

/**
 * Resolve a question's imageUrl to a bundled SVG XML string.
 *
 * Returns the inlined SVG XML when `imageUrl` is a `sign:<key>` sentinel for a
 * known sign, otherwise `undefined` (for unknown keys, http(s) URLs, or empty).
 */
export function resolveSignXml(imageUrl?: string | null): string | undefined {
  if (!imageUrl || !imageUrl.startsWith(SIGN_URL_PREFIX)) return undefined;
  const key = imageUrl.slice(SIGN_URL_PREFIX.length);
  return QUIZ_SIGN_XML[key];
}
