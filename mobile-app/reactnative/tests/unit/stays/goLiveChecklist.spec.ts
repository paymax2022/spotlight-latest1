// The go-live checklist is built by the backend (extranet/verification.go) and
// only mirrored here in two places: the USE_MOCK fixture and the photo-grid hint.
// Both used to insist on 8 photos and carried business-identity rows that the
// backend no longer returns, so a fixture-mode host was told a different story
// from a live one. These checks keep the mirror small and in step.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const apiSource = readFileSync(join(ROOT, 'src/features/stayshotelier/api.ts'), 'utf8');
const photoGridSource = readFileSync(join(ROOT, 'src/features/stayshotelier/components/PhotoGrid.tsx'), 'utf8');
const hooksSource = readFileSync(join(ROOT, 'src/features/stayshotelier/hooks.ts'), 'utf8');
const manageSource = readFileSync(join(ROOT, 'app/stays/host/[propertyId]/manage.tsx'), 'utf8');

const photosRow = apiSource.match(/\{ key: 'photos',[^\n]*/)?.[0] ?? '';

test('the fixture photo floor matches the backend minimum of 3', () => {
  assert.ok(photosRow.length > 0, 'no photos row in the fixture checklist');
  assert.match(photosRow, /At least 3 photos uploaded \(cover set\)/);
  assert.match(photosRow, /photos\.length >= 3/);
  assert.match(photosRow, /3 - photos\.length/);
  assert.doesNotMatch(photosRow, /8/);
});

test('business identity/documents rows stay out of the host checklist', () => {
  for (const source of [apiSource, photoGridSource]) {
    assert.doesNotMatch(source, /business_identity|business_documents/);
    assert.doesNotMatch(source, /Send your business documents to Paymax support/);
  }
});

test('the empty photo grid hints at the real floor', () => {
  const hinted = [...photoGridSource.matchAll(/add at least (\d+)\./g)].map((m) => m[1]);
  assert.deepEqual(hinted, ['3']);
});

test('the fixture carries exactly the five steps the backend returns', () => {
  const keys = [...apiSource.matchAll(/\{ key: '([a-z_]+)', label:/g)].map((m) => m[1]);
  assert.deepEqual(keys, ['signup', 'property', 'content', 'photos', 'policies']);
});

// Publishing a listing is what makes it sellable (unlisted dates carry the room
// type's unit count), so the checklist must not ask the host to load inventory
// they have no editor for.
test('no step gates on availability or rates', () => {
  for (const source of [apiSource, hooksSource]) {
    assert.doesNotMatch(source, /key: 'availability'|Availability & rates/);
  }
});

// The checklist belongs to one listing. While verification resolved only "the
// account's primary property", a hotelier with a finished listing and an empty one
// saw the finished one's green checklist on the empty one's manage screen — and
// Submit was active there.
test('verification is read and submitted for the listing on screen', () => {
  assert.ok(apiSource.includes('${BASE}/properties/${propertyId}/verification'),
    'the checklist request must name the property');
  assert.ok(apiSource.includes('${BASE}/properties/${propertyId}/verification/submit'),
    'the submit request must name the property');
  assert.ok(hooksSource.includes('hotelier.submitForReview(propertyId)'),
    'the submit hook must pass the property it was built for');
  assert.ok(manageSource.includes('vs.data.propertyId === propertyId && vs.data.goLiveEligible'),
    'Submit must follow this listing server verdict, not a locally recomputed one');
});

// A save that changes a checklist row has to refresh the checklist query, or the
// card keeps answering with the pre-save state and the host reads it as lost work.
test('every save that moves a checklist row also refreshes the checklist', () => {
  const blocks = new Map(
    hooksSource.split('export function ').slice(1).map((b) => [b.slice(0, b.indexOf('(')), b]),
  );
  for (const name of [
    'useUpdatePropertyContent', 'useUpdatePropertyDetails', 'useCreateRoomType',
    'useCreateRatePlan', 'useUploadPhoto', 'useDeletePhoto',
  ]) {
    const block = blocks.get(name);
    assert.ok(block, `${name} missing from hooks`);
    assert.match(block, /invalidateChecklist\(qc, propertyId\)/, `${name} leaves the checklist stale`);
  }
});
