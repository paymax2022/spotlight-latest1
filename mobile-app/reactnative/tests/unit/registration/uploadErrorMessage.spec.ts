// A failed wizard upload has to say WHICH thing failed.
//
// Reported 2026-11-24: the registration wizard's file field answered a 415 from
// `POST /api/registration/uploads` with the fixed string "Upload failed. Please
// try again." while the server had actually said the file body never arrived.
// The generic text was not the server's fault — `regUpload` does forward
// `data.error` as the thrown Error's message — it was `FieldRenderer`'s bare
// `catch {` that threw the message away and rendered a canned sentence instead.
//
// The server half of this is fixed in frontend-web (413 with a real sentence for
// a cut-off body, 415 reserved for bodies that were never multipart); this spec
// keeps the client honest about it.
//
// Behavioural assertions on the helper, plus one static-source assertion that
// the wizard field actually calls it — matching this suite's convention (see
// tests/unit/registration/government-id-removal.spec.ts): the app carries no
// component harness, and a helper nobody calls is exactly the drift to catch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { uploadFailureMessage } from '../../../src/features/registration/utils/uploadFailureMessage';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const GENERIC = 'Upload failed. Please try again.';

test('shows the server sentence when the route supplied one', () => {
  const sentence =
    'Your upload was cut off before it finished. Files must stay under 100MB, and a connection that drops mid-upload looks the same to the server — please try again.';
  assert.equal(uploadFailureMessage(new Error(sentence)), sentence);
});

test('keeps the other curated route messages verbatim', () => {
  assert.equal(uploadFailureMessage(new Error('File exceeds 100MB limit')), 'File exceeds 100MB limit');
  assert.equal(uploadFailureMessage(new Error('Unsupported file format')), 'Unsupported file format');
});

test('falls back to the generic line when there is no sentence to show', () => {
  assert.equal(uploadFailureMessage(new Error('')), GENERIC);
  assert.equal(uploadFailureMessage(new Error('   ')), GENERIC);
  assert.equal(uploadFailureMessage('not even an error'), GENERIC);
  assert.equal(uploadFailureMessage(undefined), GENERIC);
});

test('does not launder transport plumbing into a user-facing message', () => {
  // `regUpload`'s own fallback when the body carried no `error` field, and the
  // two strings axios produces for a transport failure. None of them name a
  // problem the applicant can act on.
  assert.equal(uploadFailureMessage(new Error('Upload failed (500)')), GENERIC);
  assert.equal(uploadFailureMessage(new Error('Network Error')), GENERIC);
  assert.equal(uploadFailureMessage(new Error('Request failed with status code 415')), GENERIC);
});

test('does not dump an unbounded string into a field label', () => {
  assert.equal(uploadFailureMessage(new Error('x'.repeat(300))), GENERIC);
});

test('reads the same sentence off an axios failure (the iOS/Android branch)', () => {
  // `regUpload` sends the web branch with raw fetch and the native branch through
  // the shared axios instance, so the two platforms fail with different objects:
  // web throws the curated message, axios throws `Request failed with status code
  // N` and leaves the body on `error.response.data`. `errorResponse` always puts
  // the sentence in `error`, so a device must show it just like the browser does.
  const axiosish = Object.assign(new Error('Request failed with status code 400'), {
    response: { status: 400, data: { success: false, error: 'File exceeds 100MB limit' } },
  });
  assert.equal(uploadFailureMessage(axiosish), 'File exceeds 100MB limit');
});

test('does not treat a non-JSON error body as a sentence', () => {
  // A dev-overlay or gateway page arrives as a string body (or none at all).
  const htmlish = Object.assign(new Error('Request failed with status code 500'), {
    response: { status: 500, data: `<!DOCTYPE html><html>${'y'.repeat(400)}</html>` },
  });
  assert.equal(uploadFailureMessage(htmlish), GENERIC);
  assert.equal(
    uploadFailureMessage(Object.assign(new Error('Request failed with status code 502'), { response: {} })),
    GENERIC,
  );
});

test('the wizard file field actually routes its error through the helper', () => {
  const source = read('src/features/registration/components/FieldRenderer.tsx');
  assert.match(source, /uploadFailureMessage/, 'FieldRenderer must surface the server sentence');
  assert.ok(
    !/catch\s*\{\s*setLocalError\('Upload failed\. Please try again\.'\)/.test(source.replace(/\n\s*/g, ' ')),
    'the bare catch that discarded the message must not come back',
  );
});
