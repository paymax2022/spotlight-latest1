// The wire→domain mapping for the platform announcement.
//
// The bug these guard: backend/internal/doctor/service_tail2.go has no
// announcement table wired, so GetLatestAnnouncement is a derived empty
// projection and the handler answers 200 `{"announcement": null}`. The client
// turned that null into `undefined`, which react-query rejects outright —
// "Query data cannot be undefined" on ["doctor","dashboard","announcement"].
// It surfaced on the online/offline toggle because useSetPresence invalidates
// the ['doctor','dashboard'] prefix, and react-query matches keys by prefix, so
// the announcement query refetched.
//
// Fixtures are the LITERAL JSON the handler writes (handler_tail2.go
// GetLatestAnnouncement → gin.H{"announcement": res}).

import test from 'node:test';
import assert from 'node:assert/strict';

import { mapAnnouncementWire, mapAvatarUri, mapHeaderAvatar, mapSettingsUpdateBody } from '../mapping.ts';

test('the server\'s empty announcement maps to null, never undefined', () => {
  // assert.equal is strict, so this fails on `undefined`.
  assert.equal(mapAnnouncementWire({ announcement: null }), null);
});

test('an announcement payload with the field absent maps to null', () => {
  assert.equal(mapAnnouncementWire({}), null);
});

test('a published announcement passes through with its tone intact', () => {
  const wire = {
    announcement: {
      id: 'ann-9',
      tone: 'warning' as const,
      title: 'Scheduled maintenance',
      body: 'Consultations pause at 22:00 WAT for 20 minutes.',
      publishedAt: '2026-11-11T18:00:00Z',
      dismissible: true,
      ctaLabel: 'See details',
    },
  };
  assert.equal(mapAnnouncementWire(wire), wire.announcement);
});

// The second bug these guard: PUT /settings. backend/internal/doctor/model.go
// UpdateSettingsRequest is FLAT (14 top-level pointer fields) and
// repository.go UpsertSettings COALESCEs per top-level field. The client sent
// the whole UpdateDoctorSettingsInput, i.e. `{settings: {…}, idempotencyKey}`,
// so gin bound nothing, every field stayed nil, and each toggle returned 200
// while writing zero columns.

test('a settings patch is sent as flat top-level fields', () => {
  const body = mapSettingsUpdateBody({
    settings: { showOnlineStatus: false, notifyPayouts: true },
    idempotencyKey: 'key-1',
  });
  assert.deepEqual(body, { showOnlineStatus: false, notifyPayouts: true });
});

test('the body carries no settings wrapper', () => {
  const body = mapSettingsUpdateBody({ settings: { pushEnabled: true }, idempotencyKey: 'key-1' });
  assert.equal('settings' in body, false);
});

test('the idempotency key stays out of the body, where it belongs in the header', () => {
  const body = mapSettingsUpdateBody({ settings: { pushEnabled: true }, idempotencyKey: 'key-1' });
  assert.equal('idempotencyKey' in body, false);
});

test('an empty patch writes nothing, so UpsertSettings leaves every column alone', () => {
  assert.deepEqual(mapSettingsUpdateBody({ settings: {}, idempotencyKey: 'key-1' }), {});
});

// The third bug these guard: the provider header avatar. Uploads record an R2
// OBJECT KEY (doctor.client.ts doctorUploadFile returns presign.objectKey), and
// the bucket is private, so GET /doctor/profile used to answer that key verbatim
// in `avatarUrl`. Handing it to <Image source={{uri}}> resolves it against the
// app origin and 404s — silently, with no initials behind it. Go now signs it
// (internal/doctor/handler.go resolveMedia), but it still fails open to the key
// when R2 creds are absent, so the screen must be able to tell the two apart.

test('a signed photo URL is the renderable one and passes through', () => {
  const signed = 'https://acct123.r2.cloudflarestorage.com/spotlight-dev/doctor/u1/photo/a.png?X-Amz-Signature=deadbeef';
  assert.equal(mapAvatarUri(signed), signed);
});

test('an unsigned object key is not a link, so there is no image source', () => {
  assert.equal(
    mapAvatarUri('doctor/ed2c401b-44b4-4074-9a1a-756b3e256225/photo/7a57bc8e.png'),
    undefined,
  );
});

test('a doctor with no photo has no image source', () => {
  assert.equal(mapAvatarUri(undefined), undefined);
  assert.equal(mapAvatarUri(''), undefined);
});

// The fourth bug these guard: the settings header. `DoctorProfile` declares
// `initials` and `avatarColor` (types/doctor.ts:25-26), but model.go Profile has
// no such column — the Go row answers neither, so `profile.initials` was
// undefined behind a `string` type and app/(doctor)/settings.tsx rendered an
// empty coloured circle next to the doctor's name. The rule belongs in one
// mapper the screens can be held to, the way mapLiveDoctor derives the same two
// fields for the patient-facing cards.

const SIGNED = 'https://acct123.r2.cloudflarestorage.com/spotlight-dev/doctor/ed2c401b/photo/a.png?X-Amz-Signature=deadbeef';

test('a live row with no avatar columns still gives the header initials and a colour', () => {
  assert.deepEqual(mapHeaderAvatar({ id: 'ed2c401b-44b4-4074-9a1a-756b3e256225', name: 'Dr. Amaka Obi' }), {
    uri: undefined,
    initials: 'AO',
    color: '#F59E0B',
  });
});

test('a signed photo becomes the avatar source', () => {
  const avatar = mapHeaderAvatar({
    id: 'ed2c401b-44b4-4074-9a1a-756b3e256225', name: 'Doctor A Abiaka', avatarUrl: SIGNED,
  });
  assert.equal(avatar.uri, SIGNED);
});

test('an unsigned key falls back to the initials rather than a 404ing image', () => {
  const avatar = mapHeaderAvatar({
    id: 'ed2c401b-44b4-4074-9a1a-756b3e256225',
    name: 'Doctor A Abiaka',
    avatarUrl: 'doctor/ed2c401b-44b4-4074-9a1a-756b3e256225/photo/7a57bc8e.png',
  });
  assert.equal(avatar.uri, undefined);
  assert.equal(avatar.initials, 'DA');
});

test('a row that does carry initials and a colour keeps them', () => {
  const avatar = mapHeaderAvatar({
    id: 'doc-1', name: 'Dr. Amaka Obi', initials: 'MO', avatarColor: '#123456',
  });
  assert.equal(avatar.initials, 'MO');
  assert.equal(avatar.color, '#123456');
});
