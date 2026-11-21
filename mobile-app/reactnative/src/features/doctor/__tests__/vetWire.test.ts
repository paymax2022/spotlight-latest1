// The wire→domain mapping for GET /vet/dashboard, the payload behind the vet
// mode dashboard (app/(doctor)/vet/index.tsx).
//
// The bug this guards: `doctor.phase3.api.ts` cast the live body straight into
// `VetDashboard` (`doctorGet<VetDashboard>('/vet/dashboard')`), but the Go
// projection is a different shape and answers 200:
//
//   GET /vet/dashboard → {vet, pets}
//       (service_vet.go GetVetDashboard — doctor_vet_profiles + doctor_pets)
//
// `vet` is a *pointer* and GetVetProfile's ErrNotFound is swallowed, so a vet
// with no doctor_vet_profiles row — every local account today — answers
// `{"vet":null,"pets":[]}` and `dashboard.vet.name` threw at index.tsx:48.
// That happened *after* the isLoading/isError/!dashboard guards passed, because
// the call succeeded; only the fields the screen reads are missing. The body
// also has no todaysConsults / petsSeenToday / pendingLabs / earningsTodayKobo
// at all, so line 77's `.length` was the next crash waiting behind it.
//
// `contracts/doctor.openapi.yaml:940` types this response as `Generic`, so the
// wire shape is the backend's to choose and the client must adapt — the same
// ruling batch6Wire.ts applies to the records and earnings tabs.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mapVetDashboardWire } from '../vetWire.ts';

// ─── the crash: a null vet profile ───────────────────────────────────────────

test('a null vet profile still gives the hero an object to read', () => {
  // The literal body for a doctor with no doctor_vet_profiles row.
  const dashboard = mapVetDashboardWire({ vet: null, pets: [] });

  // Every one of these is a bare property read in index.tsx:48-64.
  assert.equal(typeof dashboard.vet.name, 'string');
  assert.equal(typeof dashboard.vet.clinicName, 'string');
  assert.equal(typeof dashboard.vet.licenceNumber, 'string');
  assert.equal(dashboard.vet.vetModeEnabled, false);
  assert.equal(dashboard.vet.rating, 0);
  assert.equal(dashboard.vet.reviewCount, 0);
});

test('a body with both fields absent cannot crash the screen', () => {
  const dashboard = mapVetDashboardWire({});
  assert.equal(dashboard.todaysConsults.length, 0);
  assert.equal(dashboard.petsSeenToday, 0);
  assert.equal(dashboard.pendingLabs, 0);
  assert.equal(dashboard.earningsTodayKobo, 0);
});

// ─── the arrays the projection does not supply ───────────────────────────────

test('the consult tiles are empty, not undefined', () => {
  // ListVetAppointments (service_vet.go:77) answers `[]` — there is no pet
  // consult table — so the dashboard's today tiles have nothing to count.
  const dashboard = mapVetDashboardWire({
    vet: { id: 'vet-1', userId: 'u-1', vetModeEnabled: true },
  });

  assert.deepEqual(dashboard.todaysConsults, []);
  assert.equal(dashboard.petsSeenToday, 0);
  assert.equal(dashboard.pendingLabs, 0);
  assert.equal(dashboard.earningsTodayKobo, 0);
});

// ─── what the projection genuinely supplies ─────────────────────────────────

test('vet mode and licence come from the profile columns', () => {
  const dashboard = mapVetDashboardWire({
    vet: { id: 'vet-9', userId: 'u-9', vetModeEnabled: true, licenceNumber: 'VCN/R/0184' },
  });

  assert.equal(dashboard.vet.doctorId, 'vet-9');
  assert.equal(dashboard.vet.vetModeEnabled, true);
  assert.equal(dashboard.vet.licenceNumber, 'VCN/R/0184');
});

test('a profile row with a NULL licence is not a crash', () => {
  // VetProfile.LicenceNumber is *string (service_vet.go:491).
  const dashboard = mapVetDashboardWire({ vet: { id: 'v', licenceNumber: null } });
  assert.equal(dashboard.vet.licenceNumber, '');
});

test('the display name is rebuilt from the saved personal-info step', () => {
  // The vet wizard patches {personalInfo} into profile_draft
  // (app/(doctor)/vet/profile/setup/personal.tsx:39), which GetVetProfile
  // returns in the same body — so the hero can show the real name.
  const dashboard = mapVetDashboardWire({
    vet: {
      id: 'vet-1',
      profileDraft: {
        personalInfo: { title: 'Dr.', firstName: 'Amaka', lastName: 'Obi' },
      },
    },
  });

  assert.equal(dashboard.vet.name, 'Dr. Amaka Obi');
});

test('a draft without an honorific still names the vet', () => {
  const dashboard = mapVetDashboardWire({
    vet: { profileDraft: { personalInfo: { firstName: 'Amaka', lastName: 'Obi' } } },
  });
  assert.equal(dashboard.vet.name, 'Amaka Obi');
});

test('the clinic is the primary affiliation from the draft', () => {
  const dashboard = mapVetDashboardWire({
    vet: {
      profileDraft: {
        affiliations: [
          { id: 'c-1', name: 'Second Chance Vets', isPrimary: false },
          { id: 'c-2', name: 'Pawscare Veterinary Clinic', isPrimary: true },
        ],
      },
    },
  });
  assert.equal(dashboard.vet.clinicName, 'Pawscare Veterinary Clinic');
});

test('with no primary flag the first affiliation is the clinic', () => {
  const dashboard = mapVetDashboardWire({
    vet: { profileDraft: { affiliations: [{ name: 'Only Clinic' }] } },
  });
  assert.equal(dashboard.vet.clinicName, 'Only Clinic');
});

test('species and experience are read from the draft steps that save them', () => {
  const dashboard = mapVetDashboardWire({
    vet: {
      profileDraft: {
        speciesTreated: ['dog', 'cat', 'parrot'],
        yearsExperience: 9,
      },
    },
  });

  assert.deepEqual(dashboard.vet.speciesTreated, ['dog', 'cat']);
  assert.equal(dashboard.vet.yearsExperience, 9);
});

test('the draft licence number is a fallback for the empty column', () => {
  const dashboard = mapVetDashboardWire({
    vet: { licenceNumber: null, profileDraft: { licence: { licenceNumber: 'VCN/R/0184' } } },
  });
  assert.equal(dashboard.vet.licenceNumber, 'VCN/R/0184');
});

test('a profile column beats the draft', () => {
  const dashboard = mapVetDashboardWire({
    vet: { licenceNumber: 'VCN/R/9999', profileDraft: { licence: { licenceNumber: 'VCN/R/0184' } } },
  });
  assert.equal(dashboard.vet.licenceNumber, 'VCN/R/9999');
});

test('initials are cut from the rebuilt name', () => {
  const dashboard = mapVetDashboardWire({
    vet: { profileDraft: { personalInfo: { title: 'Dr.', firstName: 'Amaka', lastName: 'Obi' } } },
  });
  assert.equal(dashboard.vet.initials, 'AO');
});
