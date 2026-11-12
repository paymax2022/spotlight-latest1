// The Pre-Consult wizard renders `ApptIntakeBundle`, but GET /intake/appointments/:id
// answers a PatientView: an envelope-wrapped `{intake, schema, prefill, consent, draft}`
// with a FLAT snake_case field list, an INTEGER consent version, and draft answers
// under `draft`. These tests pin the translation in `intakeMapping` against literal
// server JSON — the shapes below are copied from the Go structs
// (healthintake.Field / Intake / ConsentText / SubmitResult / PresignResult) and the
// seeded `pre-consult` v2 schema row, not from what the client would like them to be.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTACHMENTS_STEP,
  mapDraftEnvelope,
  mapHealthProfileEnvelope,
  mapIntakeBundle,
  mapPresignEnvelope,
  mapSubmitEnvelope,
  schemaAnswerNames,
  serverConsentVersion,
  toServerAnswers,
  type ServerBundle,
} from '@/features/health/intakeMapping';
import type { IntakeResponseValues } from '@/features/health/types';

/** A slice of the real seeded row: three steps, one ungrouped field. */
function bundle(): ServerBundle {
  return {
    schema: {
      id: '33333333-3333-4333-8333-333333333333',
      slug: 'pre-consult',
      version: 2,
      fields: [
        {
          name: 'reason_for_visit',
          type: 'text',
          required: true,
          ui: {
            step: {
              id: 'reason',
              title: 'Reason for visit',
              description: 'What would you like help with today?',
              prdScreen: 'M4',
            },
            type: 'long_text',
            label: 'Describe your main concern',
            placeholder: 'In your own words…',
            patientReported: true,
          },
        },
        {
          name: 'reason_category',
          type: 'select',
          required: false,
          options: ['general', 'skin', 'other'],
          ui: {
            step: { id: 'reason' },
            type: 'single_select',
            label: 'Category (optional)',
            // 'herbal' is ui-only: the storage contract does not allow it.
            options: [
              { value: 'general', label: 'General / feeling unwell' },
              { value: 'herbal', label: 'Herbal remedies' },
            ],
          },
        },
        {
          name: 'symptom_onset',
          type: 'select',
          required: true,
          options: ['today', 'few_days'],
          ui: {
            step: { id: 'symptom', title: 'Symptom detail', prdScreen: 'M5' },
            type: 'single_select',
            label: 'When did it start?',
            options: [{ value: 'few_days', label: 'A few days ago' }],
          },
        },
        {
          name: 'symptom_severity',
          type: 'number',
          required: true,
          ui: { step: { id: 'symptom' }, type: 'scale', label: 'How severe is it right now?', min: 1, max: 10, integer: true },
        },
        {
          name: 'meds_none',
          type: 'bool',
          required: false,
          ui: { step: { id: 'medications', title: 'Current medications', prdScreen: 'M6' }, type: 'boolean', label: 'I am not currently taking any medications.' },
        },
        {
          name: 'current_medications',
          type: 'text',
          required: false,
          ui: { step: { id: 'medications' }, type: 'long_text', label: 'Medications and doses', critical: true },
        },
        { name: 'allergies', type: 'text', required: false, ui: { type: 'long_text', label: 'Allergies' } },
      ],
    },
    consent: { version: 2, locale: 'en', body: 'We store this for your doctor.' },
    intake: {
      appointment_id: '11111111-1111-4111-8111-111111111111',
      schema_id: '33333333-3333-4333-8333-333333333333',
      status: 'DRAFT',
      consent_version: 2,
      consent_at: '2026-11-01T09:00:00Z',
      attachments: [
        { kind: 'photo', storage_key: 'intake/p/1/aaa.png', content_type: 'image/png' },
        { kind: 'other', storage_key: 'intake/p/1/bbb.pdf', content_type: 'application/pdf' },
      ],
    },
    prefill: { demographics: { age_years: 34 }, current_medications: 'Amlodipine 5mg' },
    draft: { reason_for_visit: 'chest tightness', meds_none: false },
  };
}

test('the flat server field list becomes the wizard’s ordered steps', () => {
  const { schema } = mapIntakeBundle(bundle());
  assert.deepEqual(
    schema.steps.map((s) => s.id),
    ['reason', 'symptom', 'medications', 'details', ATTACHMENTS_STEP.id],
  );
  assert.equal(schema.steps[0].title, 'Reason for visit');
  assert.equal(schema.steps[0].description, 'What would you like help with today?');
  assert.equal(schema.steps[0].prdScreen, 'M4');
  // A later field in the same step may be the first to carry the copy.
  assert.equal(schema.steps[1].title, 'Symptom detail');
  assert.equal(schema.version, 2, 'the wizard pins the schema version it renders');
});

test('a schema field with no ui.step lands in a trailing step instead of vanishing', () => {
  const { schema } = mapIntakeBundle(bundle());
  const details = schema.steps.find((s) => s.id === 'details');
  assert.deepEqual(details?.fields.map((f) => f.id), ['allergies']);
  assert.equal(details?.fields[0].label, 'Allergies');
});

test('storage types pick the renderer and ui copy wins where it exists', () => {
  const { schema } = mapIntakeBundle(bundle());
  const reason = schema.steps[0].fields[0];
  assert.equal(reason.type, 'long_text', 'a bare `text` field must not render as a 1-line input');
  assert.equal(reason.label, 'Describe your main concern');
  assert.equal(reason.placeholder, 'In your own words…');
  assert.equal(reason.required, true);
  assert.equal(reason.patientReported, true);

  const severity = schema.steps[1].fields[1];
  assert.equal(severity.type, 'scale');
  assert.deepEqual([severity.min, severity.max, severity.integer], [1, 10, true]);

  const onset = schema.steps[1].fields[0];
  assert.equal(onset.type, 'single_select');
});

test('option VALUES come from the server and only their LABELS from ui', () => {
  const { schema } = mapIntakeBundle(bundle());
  const category = schema.steps[0].fields[1];
  assert.deepEqual(
    category.options,
    [
      { value: 'general', label: 'General / feeling unwell' },
      { value: 'skin', label: 'Skin' },
      { value: 'other', label: 'Other' },
    ],
    'an unlabelled server value is still offered (humanised); a ui-only value the server would reject is not',
  );

  const onset = schema.steps[1].fields[0];
  assert.deepEqual(onset.options, [
    { value: 'today', label: 'Today' },
    { value: 'few_days', label: 'A few days ago' },
  ]);
});

test('the safety-critical flag reaches the review screen without naming field ids', () => {
  const { schema } = mapIntakeBundle(bundle());
  const meds = schema.steps[2].fields.find((f) => f.id === 'current_medications');
  assert.equal(meds?.critical, true);
  assert.equal(schema.steps[0].fields[0].critical, undefined);
});

test('draft answers come from `draft`, consent from the intake row', () => {
  const { intake, consent, prefill } = mapIntakeBundle(bundle());
  assert.deepEqual(intake.answers, { reason_for_visit: 'chest tightness', meds_none: false });
  assert.equal(intake.status, 'DRAFT');
  assert.equal(intake.appointmentId, '11111111-1111-4111-8111-111111111111');
  assert.equal(intake.schemaVersion, 2);
  assert.equal(consent.version, '2', 'the client keys consent by string');
  assert.equal(consent.acceptedVersion, '2');
  assert.equal(intake.consentAcceptedAt, '2026-11-01T09:00:00Z');
  assert.equal(prefill.current_medications, 'Amlodipine 5mg');
});

test('attachments recorded by the presign→PUT→record path hydrate the M12 step', () => {
  const { intake } = mapIntakeBundle(bundle());
  assert.deepEqual(
    intake.attachments?.map((a) => [a.fileName, a.mimeType, a.fieldId]),
    [
      ['aaa.png', 'image/png', 'attachments_list'],
      ['bbb.pdf', 'application/pdf', 'attachments_list'],
    ],
    'the server stores keys only, so the key’s last segment is the only honest file name',
  );
});

test('answers are filtered to the names the active schema declares', () => {
  const { schema } = mapIntakeBundle(bundle());
  const allowed = schemaAnswerNames(schema.steps);
  assert.ok(allowed.includes('current_medications'));
  assert.ok(!allowed.includes('attachments_list'), 'M12 is client-owned and would 400 the submit');

  const values: IntakeResponseValues = {
    reason_for_visit: '  chest tightness  ',
    symptom_severity: 7,
    meds_none: false,
    attachments_list: JSON.stringify([{ name: 'a', dose: '' }]),
    allergies: ['penicillin'],
    symptom_onset: '',
    bp_systolic: NaN,
    chronic_conditions: null,
    is_symptomatic: true,
  };
  assert.deepEqual(toServerAnswers(values, allowed), {
    reason_for_visit: 'chest tightness',
    symptom_severity: 7,
    meds_none: false,
  }, 'blanks, arrays, NaN and undeclared names are dropped — intake.validate 400s on all four');
});

test('a consent version only goes on the wire as an integer', () => {
  assert.equal(serverConsentVersion('2'), 2);
  assert.equal(serverConsentVersion(3), 3);
  assert.equal(serverConsentVersion(''), undefined, 'an autosave must send no key at all');
  assert.equal(serverConsentVersion(undefined), undefined);
  assert.equal(serverConsentVersion('2.5'), undefined);
});

test('the draft envelope unwraps {success, intake}', () => {
  const intake = mapDraftEnvelope({
    success: true,
    intake: { appointment_id: 'a', status: 'SUBMITTED', consent_version: 4, updated_at: '2026-11-02T10:00:00Z' },
  });
  assert.equal(intake.status, 'SUBMITTED');
  assert.equal(intake.consentVersion, '4');
  assert.equal(intake.updatedAt, '2026-11-02T10:00:00Z');
  assert.deepEqual(intake.answers, {}, 'PUT …/draft does not echo answers — the wizard keeps its own state');
});

test('the submit envelope carries the red-flag interstitial copy', () => {
  const res = mapSubmitEnvelope({
    success: true,
    data: {
      status: 'SUBMITTED',
      response_id: 'r1',
      intake: { appointment_id: 'a', status: 'SUBMITTED', submitted_at: '2026-11-02T10:01:00Z' },
      red_flag: {
        severity: 'emergency',
        routing: 'CRISIS',
        guidance: {
          title: 'You deserve support right now',
          body: 'It sounds like you may be going through something very painful.',
          crisis_line: '',
          show_emergency_number: true,
        },
      },
    },
  });
  assert.equal(res.status, 'SUBMITTED');
  assert.equal(res.intake.submittedAt, '2026-11-02T10:01:00Z');
  assert.equal(res.red_flag?.routing, 'CRISIS');
  assert.equal(res.red_flag?.guidance.crisis_line, undefined, 'an empty seed line is not a number to dial');
  assert.equal(res.red_flag?.guidance.show_emergency_number, true);

  assert.equal(mapSubmitEnvelope({ success: true, data: { status: 'SUBMITTED', intake: {} } }).red_flag, undefined);
});

test('the presign envelope yields the three fields the upload step needs', () => {
  const p = mapPresignEnvelope({
    success: true,
    data: { upload_url: 'https://r2/put?sig=1', storage_key: 'intake/p/a/tok.png', content_type: 'image/png', bucket: 'health', expires_in: 900, method: 'PUT' },
  });
  assert.deepEqual(p, {
    uploadUrl: 'https://r2/put?sig=1',
    storageKey: 'intake/p/a/tok.png',
    contentType: 'image/png',
  });
});

// GET /intake/health-profile answers service.go's HealthProfile struct — raw
// answer values under the schema field names, not the wizard's entry lists. Read
// straight into the screen these are `undefined`, so `profile.allergies.map`
// throws on the first render. The separators come from the seeded schema's own
// help copy ("One per line", "penicillin — rash; codeine — nausea; peanuts").
test('the live profile envelope becomes the three sections the screen renders', () => {
  const p = mapHealthProfileEnvelope({
    success: true,
    profile: {
      current_medications: 'Amlodipine 5mg once daily\nMetformin 500mg twice daily',
      allergies: 'penicillin — rash; peanuts',
      chronic_conditions: 'hypertension, type 2 diabetes',
      chronic_other: 'endometriosis',
      last_updated: '2026-11-12T10:00:00Z',
    },
  });
  assert.deepEqual(p.medications, [
    { label: 'Amlodipine 5mg once daily', value: 'Current', critical: true },
    { label: 'Metformin 500mg twice daily', value: 'Current', critical: true },
  ]);
  assert.deepEqual(p.allergies, [
    { label: 'penicillin — rash', value: 'Reported', critical: true },
    { label: 'peanuts', value: 'Reported', critical: true },
  ]);
  // chronic_other is its own row in the same section, not a separate card.
  assert.deepEqual(p.conditions, [
    { label: 'hypertension, type 2 diabetes', value: 'Ongoing' },
    { label: 'endometriosis', value: 'Ongoing' },
  ]);
  assert.equal(p.updatedAt, '2026-11-12T10:00:00Z');
});

test('a patient with no prior intake gets three empty sections, not a crash', () => {
  // latestPriorResponse returns nil, so HealthProfile marshals to `{}` — every
  // omitempty key is absent.
  const p = mapHealthProfileEnvelope({ success: true, profile: {} });
  assert.deepEqual(p.allergies, []);
  assert.deepEqual(p.medications, []);
  assert.deepEqual(p.conditions, []);
  assert.equal(p.updatedAt, undefined);
});

test('the profile maps an answer the server holds as a list', () => {
  // answers_json is arbitrary JSON, so a serialized multi_select can come back
  // as an array rather than the text the current schema stores.
  const p = mapHealthProfileEnvelope({
    success: true,
    profile: { allergies: ['penicillin', '', 'latex'] },
  });
  assert.deepEqual(p.allergies, [
    { label: 'penicillin', value: 'Reported', critical: true },
    { label: 'latex', value: 'Reported', critical: true },
  ]);
});

test('a profile with no answer at all still renders', () => {
  assert.doesNotThrow(() => mapHealthProfileEnvelope(null));
  assert.deepEqual(mapHealthProfileEnvelope({ success: false }).medications, []);
});

