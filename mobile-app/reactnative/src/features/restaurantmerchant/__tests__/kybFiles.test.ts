// node --experimental-strip-types --test "src/features/restaurantmerchant/__tests__/kybFiles.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  kybContentType, kybFileProblem, isWebLink, KYB_MAX_BYTES, KYB_PICKER_TYPES,
} from '../kybFiles.ts';

test('content type comes from the extension, case-insensitively', () => {
  assert.equal(kybContentType('cac.pdf'), 'application/pdf');
  assert.equal(kybContentType('CAC Certificate.PDF'), 'application/pdf');
  assert.equal(kybContentType('scan.jpg'), 'image/jpeg');
  assert.equal(kybContentType('scan.JPEG'), 'image/jpeg');
  assert.equal(kybContentType('scan.png'), 'image/png');
  assert.equal(kybContentType('scan.webp'), 'image/webp');
  assert.equal(kybContentType('my.certificate.v2.pdf'), 'application/pdf');
});

test('anything the backend would refuse to sign has no content type', () => {
  for (const bad of ['run.exe', 'page.html', 'logo.svg', 'a.zip', 'noextension', '', '.pdf', 'trailingdot.', 'photo.heic']) {
    assert.equal(kybContentType(bad), null, bad);
  }
});

test('a path or folder name never leaks its dots into the extension', () => {
  assert.equal(kybContentType('/var/mobile/Containers/v1.2/cac'), null);
  assert.equal(kybContentType('C:\\docs\\v1.2\\cac.pdf'), 'application/pdf');
  assert.equal(kybContentType('/tmp/a.b/cac.png'), 'image/png');
});

test('every type offered to the picker is one we can map back from an extension', () => {
  for (const mime of KYB_PICKER_TYPES) {
    const ext = mime === 'application/pdf' ? 'pdf' : mime.split('/')[1];
    assert.equal(kybContentType(`x.${ext}`), mime, mime);
  }
});

test('file problems are reported in owner-facing words, and null when fine', () => {
  assert.equal(kybFileProblem({ name: 'cac.pdf', size: 120_000 }), null);
  assert.equal(kybFileProblem({ name: 'cac.pdf' }), null, 'unknown size is allowed through');
  assert.equal(kybFileProblem({ name: 'cac.pdf', size: null }), null);
  assert.match(kybFileProblem({ name: 'run.exe', size: 10 }) ?? '', /PDF, PNG, JPG or WEBP/);
  assert.match(kybFileProblem({ name: 'cac.pdf', size: 0 }) ?? '', /empty/);
  assert.match(kybFileProblem({ name: 'cac.pdf', size: KYB_MAX_BYTES + 1 }) ?? '', /too large/);
  assert.equal(kybFileProblem({ name: 'cac.pdf', size: KYB_MAX_BYTES }), null, 'the limit itself is allowed');
});

test('only plain web links count as a pasted link', () => {
  assert.equal(isWebLink('https://drive.google.com/file/d/1/view'), true);
  assert.equal(isWebLink('  http://example.com/cac.pdf  '), true);
  for (const bad of ['', 'drive.google.com/x', 'javascript:alert(1)', 'data:text/html;base64,AA==', 'file:///etc/passwd', 'r2://kyb/cac.pdf', 'https://', 'not a url']) {
    assert.equal(isWebLink(bad), false, bad);
  }
});
