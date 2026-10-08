import test from 'node:test';
import assert from 'node:assert/strict';
import { LogoUploadError, describeLogoUploadFailure, parseStorageErrorCode } from '../logoUploadError.ts';

// "That image couldn't be uploaded" used to be one message for three different
// failures (asking the backend for a URL, reading the photo off the phone, and
// sending it to storage). These pin the wording that tells them apart.

test('presign failure names the HTTP status the backend returned', () => {
  const e = new LogoUploadError('presign', { status: 400 });
  assert.equal(describeLogoUploadFailure(e), 'while preparing the upload (server replied 400)');
});

test('presign failure with no response says there was none', () => {
  const e = new LogoUploadError('presign', {});
  assert.equal(describeLogoUploadFailure(e), 'while preparing the upload (no reply from the server)');
});

test('reading the local file is reported as a phone-side problem', () => {
  const e = new LogoUploadError('read-file', {});
  assert.equal(describeLogoUploadFailure(e), 'while reading the photo from your phone');
});

test('storage rejection carries the HTTP status and the storage error code', () => {
  const e = new LogoUploadError('upload', { status: 403, code: 'SignatureDoesNotMatch' });
  assert.equal(describeLogoUploadFailure(e), 'while sending it to storage (403 SignatureDoesNotMatch)');
});

test('storage rejection without a parseable code still shows the status', () => {
  const e = new LogoUploadError('upload', { status: 500 });
  assert.equal(describeLogoUploadFailure(e), 'while sending it to storage (500)');
});

test('a network-level upload failure (no HTTP status) says so', () => {
  const e = new LogoUploadError('upload', {});
  assert.equal(describeLogoUploadFailure(e), 'while sending it to storage (network error)');
});

test('anything that is not a LogoUploadError yields no detail', () => {
  assert.equal(describeLogoUploadFailure(new Error('boom')), '');
  assert.equal(describeLogoUploadFailure('nope'), '');
  assert.equal(describeLogoUploadFailure(undefined), '');
});

test('LogoUploadError keeps its step, status and code for reporting', () => {
  const cause = new TypeError('Network request failed');
  const e = new LogoUploadError('upload', { status: 403, code: 'AccessDenied', cause });
  assert.equal(e.step, 'upload');
  assert.equal(e.status, 403);
  assert.equal(e.code, 'AccessDenied');
  assert.equal(e.cause, cause);
  assert.equal(e.name, 'LogoUploadError');
});

test('parseStorageErrorCode reads the <Code> from an S3/R2 error body', () => {
  const body = '<?xml version="1.0"?><Error><Code>NoSuchBucket</Code><Message>x</Message></Error>';
  assert.equal(parseStorageErrorCode(body), 'NoSuchBucket');
});

test('parseStorageErrorCode returns undefined for empty or non-XML bodies', () => {
  assert.equal(parseStorageErrorCode(''), undefined);
  assert.equal(parseStorageErrorCode('Bad gateway'), undefined);
  assert.equal(parseStorageErrorCode(undefined), undefined);
});

test('parseStorageErrorCode never returns something that is not a plain code', () => {
  // The code ends up in a user-visible message: it must not carry markup or spaces.
  assert.equal(parseStorageErrorCode('<Error><Code>a b<c</Code></Error>'), undefined);
});
