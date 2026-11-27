// The contestant picture, from the wire value to something <Image> can load.
//
// Since #1172 the Go voting API stops signing the stored R2 key and names
// frontend-web's reader instead (`/api/v1/contestants/<id>/photo`): the plane that
// holds the bytes — bucket or its own disk — is the only one that can answer for
// them. That reader URL reaches the phone in either of two shapes, exactly like the
// Open Mic song URL beside it: absolute when the deployment has WEB_APP_BASE_URL
// configured, root-relative when it has not (backend/internal/connect/voting/media.go
// returns the path untouched with no base). A root-relative path handed straight to
// `<Image source={{uri}}>` resolves against whatever origin the app happens to be on
// — the Metro bundle on the web build, nothing at all on a device — and the hero
// renders as an empty box with no error anyone can see.
//
// So the phone adds its own origin, the same rule `mediaUrl()` applies to a song,
// and it must not do that by string-gluing at each call site: this pins the one
// helper the voting screens use.
//
// The other half of the job is the no-picture case. A photo the reader cannot serve
// comes back 404 (and an empty string comes from the API for a row whose stored
// value is unreadable), and a screen pointed at either must show the initials
// placeholder it already has rather than a broken image. Hence "undefined means
// render the placeholder" is part of the contract, not an accident of the caller.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { contestantPhotoUri } from '@/features/voting/utils/contestantPhoto';

const ORIGIN = 'http://192.168.1.9:3000';

describe('contestantPhotoUri', () => {
  it('absoluteises the root-relative reader URL the API returns with no media base', () => {
    assert.equal(
      contestantPhotoUri('/api/v1/contestants/f3d68ed9/photo', 'http://localhost:3000'),
      'http://localhost:3000/api/v1/contestants/f3d68ed9/photo',
    );
    // …and against the origin THIS device can reach, not the one the server typed.
    assert.equal(
      contestantPhotoUri('/api/v1/contestants/f3d68ed9/photo', ORIGIN),
      `${ORIGIN}/api/v1/contestants/f3d68ed9/photo`,
    );
  });

  it('leaves an absolute reader URL alone', () => {
    const url = 'https://www.spotlightng.com/api/v1/contestants/f3d68ed9/photo';
    assert.equal(contestantPhotoUri(url, ORIGIN), url);
  });

  it('leaves a pasted external image URL alone — the API passes those through', () => {
    const url = 'https://res.cloudinary.com/paymax/image/upload/v1/contestants/a.jpg';
    assert.equal(contestantPhotoUri(url, ORIGIN), url);
  });

  it('gives the placeholder, not a broken image, when there is nothing loadable', () => {
    for (const value of [undefined, null, '', '   ']) {
      assert.equal(contestantPhotoUri(value, ORIGIN), undefined, JSON.stringify(value));
    }
    // The upload response blob and a raw object key are values this app must never
    // point an <Image> at: neither is an address it can open.
    assert.equal(contestantPhotoUri('registration/8e6132e9/hand.jpg', ORIGIN), undefined);
    assert.equal(
      contestantPhotoUri('{"fileName":"a.jpg","previewUrl":"/api/registration/uploads/x"}', ORIGIN),
      undefined,
    );
  });

  it('refuses a non-http scheme stored in the column', () => {
    // photo_url is applicant-supplied data on some rows; the sample-link guard on
    // this same screen already refuses the same classes.
    assert.equal(contestantPhotoUri('javascript:alert(1)', ORIGIN), undefined);
    assert.equal(contestantPhotoUri('file:///data/storage/a.jpg', ORIGIN), undefined);
    assert.equal(contestantPhotoUri('data:image/png;base64,AAAA', ORIGIN), undefined);
  });

  it('is idempotent — resolving an already-resolved URL changes nothing', () => {
    const once = contestantPhotoUri('/api/v1/contestants/a/photo', ORIGIN);
    assert.equal(contestantPhotoUri(once, ORIGIN), once);
  });
});
