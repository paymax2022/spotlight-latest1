/**
 * CS-002 — per-contest registration form builder (field catalog).
 *
 * The admin "Form builder" persists a contest's chosen fields, their types and
 * required-ness via `sanitizeContestFormSchema` (untrusted admin payload ->
 * ContestFormSchema) and `catalogFieldToRegistrationField` (catalog entry ->
 * wizard field, applying any required override). This asserts that round trip:
 * fields/types/required are preserved, unknown keys are rejected, and custom
 * questions are validated and slugified. Executed run for the "Impl'd —
 * pending executed test" note on CS-002.
 */
import { describe, it, expect } from 'vitest';
import {
  sanitizeContestFormSchema,
  catalogFieldToRegistrationField,
  getCatalogField,
} from '@/src/features/registration/field-catalog';

describe('CS-002: field-catalog builder saves fields/types/required correctly', () => {
  it('keeps only real catalog keys in includedFields, dropping unknown ones', () => {
    const schema = sanitizeContestFormSchema({
      includedFields: ['personal.firstName', 'personal.lastName', 'totally.made.up.key'],
      customFields: [],
    });
    expect(schema).toBeDefined();
    expect(schema!.includedFields).toEqual(['personal.firstName', 'personal.lastName']);
    expect(schema!.includedFields).not.toContain('totally.made.up.key');
  });

  it('dedupes includedFields', () => {
    const schema = sanitizeContestFormSchema({
      includedFields: ['personal.firstName', 'personal.firstName'],
    });
    expect(schema!.includedFields).toEqual(['personal.firstName']);
  });

  it('preserves requiredOverrides only for real catalog keys with boolean values', () => {
    const schema = sanitizeContestFormSchema({
      includedFields: ['personal.middleName'],
      requiredOverrides: {
        'personal.middleName': true, // default is NOT required — override flips it on
        'not.a.field': true,
        'personal.firstName': 'yes' as unknown as boolean, // wrong type, must be dropped
      },
    });
    expect(schema!.requiredOverrides).toEqual({ 'personal.middleName': true });
  });

  it('a required override actually changes the built field (type + required preserved)', () => {
    const catalogEntry = getCatalogField('personal.middleName')!;
    expect(catalogEntry.defaultRequired).toBeFalsy();

    const defaultField = catalogFieldToRegistrationField(catalogEntry);
    expect(defaultField.required).toBe(false);
    expect(defaultField.type).toBe('text');

    const overriddenField = catalogFieldToRegistrationField(catalogEntry, true);
    expect(overriddenField.required).toBe(true);
    expect(overriddenField.type).toBe('text'); // type never changes via override
    expect(overriddenField.key).toBe('personal.middleName');
  });

  it('accepts well-formed custom fields with an allowed type and configurable step', () => {
    const schema = sanitizeContestFormSchema({
      includedFields: [],
      customFields: [
        { label: 'Favourite genre', type: 'text', step: 'category_specific', required: true },
        { label: 'Team size', type: 'number', step: 'personal_information' },
      ],
    });
    expect(schema!.customFields).toHaveLength(2);
    expect(schema!.customFields![0]!).toMatchObject({
      key: 'custom.favourite_genre',
      label: 'Favourite genre',
      type: 'text',
      step: 'category_specific',
      required: true,
    });
    expect(schema!.customFields![1]!.required).toBe(false);
  });

  it('rejects a custom field with a disallowed type or a non-configurable step', () => {
    const schema = sanitizeContestFormSchema({
      customFields: [
        { label: 'Bad type', type: 'hidden', step: 'category_specific' },
        { label: 'Bad step', type: 'text', step: 'review_submit' }, // fixed step, not configurable
        { label: 'OK', type: 'text', step: 'personal_information' },
      ],
    });
    expect(schema!.customFields).toHaveLength(1);
    expect(schema!.customFields![0]!.label).toBe('OK');
  });

  it('slugifies duplicate custom-field labels into distinct keys', () => {
    const schema = sanitizeContestFormSchema({
      customFields: [
        { label: 'Extra info', type: 'text', step: 'category_specific' },
        { label: 'Extra info', type: 'text', step: 'category_specific' },
      ],
    });
    const keys = schema!.customFields!.map((f) => f.key);
    expect(new Set(keys).size).toBe(2);
  });

  it('returns undefined for an empty/garbage payload so the contest falls back to its code template', () => {
    expect(sanitizeContestFormSchema(null)).toBeUndefined();
    expect(sanitizeContestFormSchema({})).toBeUndefined();
    expect(sanitizeContestFormSchema({ includedFields: [], customFields: [] })).toBeUndefined();
  });
});
