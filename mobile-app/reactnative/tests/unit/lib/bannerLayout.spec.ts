// Regression guard for the banner-overflow bug.
//
// Six screens (home, crypto, association, realtor search, crowdfunding, bills)
// pass `marginHorizontal: Spacing.containerMargin` to <RemoteBanner>. The banner
// box used `width: '100%'`, which is 100% of the PARENT's width and ignores the
// box's own side margins — so the box started 20px in and still spanned the full
// parent width, sticking out 20px past the right edge (40px past the content column).
//
// `alignSelf: 'stretch'` sizes the box to the parent's width MINUS its margins, so
// the same call sites fit. The components cannot be imported here (they pull in
// react-native / expo-image), so, like the neighbouring specs, this pins the rule
// at the source level; the rendered behaviour was verified in react-native-web.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// tests/unit/lib -> app root (path APIs, not `new URL`: the global URL type and node:url's differ under this tsconfig)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function styleSheetBlock(relPath: string): string {
  const src = readFileSync(resolve(root, relPath), 'utf8');
  const start = src.indexOf('StyleSheet.create(');
  assert.ok(start >= 0, `${relPath}: no StyleSheet.create block found`);
  // Comments explain the rule and quote the banned value, so only inspect code.
  return src.slice(start).replace(/\/\/.*$/gm, '');
}

for (const [file, key] of [
  ['src/components/SpotlightBanner.tsx', 'image'],
  ['src/features/media/banners/components/RemoteBanner.tsx', 'frame'],
] as const) {
  test(`${file} sizes the banner box by stretching, not width: '100%'`, () => {
    const block = styleSheetBlock(file);
    const box = block.slice(block.indexOf(`${key}:`));
    assert.doesNotMatch(
      box.slice(0, box.indexOf('},') + 2),
      /width:\s*['"]100%['"]/,
      `${file} ${key}: width '100%' ignores the caller's marginHorizontal and overflows the right edge`,
    );
    assert.match(
      box.slice(0, box.indexOf('},') + 2),
      /alignSelf:\s*['"]stretch['"]/,
      `${file} ${key}: expected alignSelf 'stretch' so side margins are respected`,
    );
  });
}
