import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORE_IMAGE_MAX_BYTES, storeImageContentType, storeImageProblem, storeImageFileName,
} from '../storeImages.ts';
import { buildUpdateStoreBody } from '../packagingPrice.ts';

test('only PNG, JPG and WEBP can be a store image — the same set the server signs', () => {
  assert.equal(storeImageContentType('logo.png'), 'image/png');
  assert.equal(storeImageContentType('Banner.JPG'), 'image/jpeg');
  assert.equal(storeImageContentType('photo.jpeg'), 'image/jpeg');
  assert.equal(storeImageContentType('a.webp'), 'image/webp');
  for (const bad of ['logo.svg', 'doc.pdf', 'anim.gif', 'photo.heic', 'noextension', '', '.png']) {
    assert.equal(storeImageContentType(bad), null, `${bad} must not be uploadable`);
  }
});

test('a file problem is reported in words for the owner, or null', () => {
  assert.equal(storeImageProblem({ name: 'a.jpg', size: 1_000_000 }), null);
  assert.equal(storeImageProblem({ name: 'a.jpg' }), null); // size unknown is checked again on the real bytes
  assert.match(storeImageProblem({ name: 'a.svg', size: 10 }) ?? '', /PNG, JPG or WEBP/);
  assert.match(storeImageProblem({ name: 'a.jpg', size: 0 }) ?? '', /empty/);
  assert.match(storeImageProblem({ name: 'a.jpg', size: STORE_IMAGE_MAX_BYTES + 1 }) ?? '', /too large/);
  assert.equal(storeImageProblem({ name: 'a.jpg', size: STORE_IMAGE_MAX_BYTES }), null);
});

test('a name is derived when the picker reports none (Android / web)', () => {
  // The picker's file name is often null; the extension then comes from the mime type, then the uri.
  assert.equal(storeImageFileName({ uri: 'file:///x/abc', fileName: 'shot.PNG' }, 'logo'), 'shot.PNG');
  assert.equal(storeImageFileName({ uri: 'file:///x/abc', fileName: null, mimeType: 'image/jpeg' }, 'banner'), 'banner.jpg');
  assert.equal(storeImageFileName({ uri: 'content://media/9/photo.webp', fileName: null }, 'logo'), 'logo.webp');
  assert.equal(storeImageFileName({ uri: 'file:///x/abc', mimeType: 'image/png' }, 'logo'), 'logo.png');
  assert.equal(storeImageFileName({ uri: 'blob:http://localhost/1234', mimeType: 'image/webp' }, 'banner'), 'banner.webp');
});

test('a name that cannot be made valid comes back null, not a guess', () => {
  assert.equal(storeImageFileName({ uri: 'file:///x/abc', fileName: null }, 'logo'), null);
  assert.equal(storeImageFileName({ uri: 'file:///x/pic.heic', fileName: null, mimeType: 'image/heic' }, 'logo'), null);
});

test('the update body carries banner_url and logo_url, and only what changed', () => {
  assert.deepEqual(buildUpdateStoreBody({ bannerUrl: 'restaurant/r/store/banner/x.jpg' }), { banner_url: 'restaurant/r/store/banner/x.jpg' });
  assert.deepEqual(buildUpdateStoreBody({ logoUrl: 'restaurant/r/store/logo/x.png' }), { logo_url: 'restaurant/r/store/logo/x.png' });
  assert.deepEqual(buildUpdateStoreBody({ name: 'Blue Yam' }), { name: 'Blue Yam' });
  assert.deepEqual(buildUpdateStoreBody({ packagingFeeKobo: 0 }), { packaging_fee_kobo: 0 });
});
