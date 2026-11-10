#!/usr/bin/env node
/**
 * bump-version-code — the only sanctioned way to raise Android versionCode.
 *
 * Why this exists: the repo used to keep TWO counters for one number.
 * `plugins/withAndroidVersionCode` incremented a local `android-version-code`
 * file as a side effect of `assembleRelease`/`bundleRelease`, while
 * `eas.json`'s `autoIncrement: true` maintained a separate counter on Expo's
 * servers. Neither could see the other, so the same versionCode got emitted by
 * more than one build (EAS history shows store builds at 2 and 3 AFTER builds at
 * 14 and 15), and a local build could hand Play an artifact whose number was
 * already taken — which Play rejects, or worse, accepts as a downgrade path.
 *
 * A build must not mutate its own version input. `expo.android.versionCode` in
 * app.json is now the single source: prebuild writes it into
 * android/app/build.gradle (config-plugins `setVersionCode`, which reads
 * `config.android?.versionCode ?? 1`) and EAS reads the same field with
 * `autoIncrement: false`. Raising it is therefore a deliberate, committable edit
 * rather than something a build does silently in the background.
 *
 * Usage:  node scripts/bump-version-code.mjs [amount]   (default 1)
 *         node scripts/bump-version-code.mjs --set 42
 * Exit 0 prints the new value; commit app.json alongside the release.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve('app.json');
const config = JSON.parse(readFileSync(file, 'utf8'));
const android = config.expo?.android;

if (!android || !Number.isInteger(android.versionCode)) {
  console.error('✗ bump-version-code — expo.android.versionCode is missing from app.json.');
  process.exit(1);
}

const before = android.versionCode;
const args = process.argv.slice(2);
const setIdx = args.indexOf('--set');
const after = setIdx !== -1 ? Number(args[setIdx + 1]) : before + Number(args[0] ?? 1);

if (!Number.isInteger(after)) {
  console.error(`✗ bump-version-code — target must be an integer, got "${args[setIdx !== -1 ? setIdx + 1 : 0]}"`);
  process.exit(1);
}
if (after <= before) {
  console.error(`✗ bump-version-code — refusing to move versionCode ${before} → ${after}; Play needs it to increase.`);
  process.exit(1);
}

android.versionCode = after;
writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
console.log(`✓ bump-version-code — expo.android.versionCode ${before} → ${after}. Commit app.json with the release.`);
