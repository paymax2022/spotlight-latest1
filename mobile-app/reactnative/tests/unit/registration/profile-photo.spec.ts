// The applicant's own profile picture, from the answers they already gave.
//
// Two shapes reach this code and both have to work: the registration draft
// stores a `media.profilePhoto` OBJECT ({fileName, previewUrl, storageKey}),
// while the promoted roster row stores that same object as a JSON STRING in
// `contestants.photo_url`. Handing either one straight to <Image> shows nothing
// — the first is an object, the second is text that begins with a brace.
//
// What it must never do is fall back to `identity.idUpload`. That is a KYC
// document, and putting it on a public-facing profile card is a privacy leak,
// not a picture.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickProfilePhoto, profilePhotoFromStored } from '@/features/registration/utils/profile-photo';

const UPLOADED = {
  fileName: 'WhatsApp Image 2026-11-20 at 09.37.21.jpeg',
  previewUrl: '/api/registration/uploads/cmVnaXN0cmF0aW9uL2VkMmM0MDFi.jpeg',
  storageKey: 'registration/ed2c401b/8fcdd348.jpeg',
};

describe('pickProfilePhoto', () => {
  it('takes the uploaded profile photo out of the draft answers', () => {
    assert.deepEqual(pickProfilePhoto({ 'media.profilePhoto': UPLOADED }), {
      fileName: UPLOADED.fileName,
      previewUrl: UPLOADED.previewUrl,
    });
  });

  it('accepts the other profile-photo key the templates use', () => {
    // `publicProfile.profilePhoto` is what the public-profile step declares
    // (frontend-web/src/features/registration/field-catalog.ts); the category
    // specific step writes `media.profilePhoto`. Both are a profile picture.
    assert.deepEqual(pickProfilePhoto({ 'publicProfile.profilePhoto': UPLOADED }), {
      fileName: UPLOADED.fileName,
      previewUrl: UPLOADED.previewUrl,
    });
    assert.equal(
      pickProfilePhoto({ 'media.profilePhoto': { previewUrl: 'https://cdn/x.png' } })?.previewUrl,
      'https://cdn/x.png',
    );
  });

  it('accepts a plain URL string, which is what an older draft stores', () => {
    assert.deepEqual(pickProfilePhoto({ 'media.profilePhoto': 'https://cdn.spotlight/ng/a.png' }), {
      fileName: undefined,
      previewUrl: 'https://cdn.spotlight/ng/a.png',
    });
  });

  it('returns null rather than substituting the identity document', () => {
    const draft = { 'identity.idUpload': { fileName: 'licence.png', previewUrl: '/api/registration/uploads/XYZ' } };
    assert.equal(pickProfilePhoto(draft), null);
  });

  it('returns null for an empty, blank or unreadable value', () => {
    assert.equal(pickProfilePhoto({ 'media.profilePhoto': { fileName: 'a.jpg', previewUrl: '  ' } }), null);
    assert.equal(pickProfilePhoto({ 'media.profilePhoto': null }), null);
    assert.equal(pickProfilePhoto({ 'media.profilePhoto': 'not a url' }), null);
    assert.equal(pickProfilePhoto(undefined), null);
    assert.equal(pickProfilePhoto({}), null);
  });
});

describe('profilePhotoFromStored', () => {
  it('reads the roster column, which holds the same object as JSON text', () => {
    assert.deepEqual(profilePhotoFromStored(JSON.stringify(UPLOADED)), {
      fileName: UPLOADED.fileName,
      previewUrl: UPLOADED.previewUrl,
    });
  });

  it('passes through an object it was given directly', () => {
    assert.deepEqual(profilePhotoFromStored(UPLOADED), {
      fileName: UPLOADED.fileName,
      previewUrl: UPLOADED.previewUrl,
    });
  });

  it('passes through a bare URL', () => {
    assert.deepEqual(profilePhotoFromStored('/api/registration/uploads/ABC'), {
      fileName: undefined,
      previewUrl: '/api/registration/uploads/ABC',
    });
  });

  it('returns null for a broken payload instead of throwing', () => {
    assert.equal(profilePhotoFromStored('{"fileName": "a.jpg"'), null);
    assert.equal(profilePhotoFromStored(null), null);
    assert.equal(profilePhotoFromStored(''), null);
    assert.equal(profilePhotoFromStored(42), null);
  });
});
