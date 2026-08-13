// Pure-logic unit tests: mobile registration validation stays in sync with the
// backend's messages/rules (see memory: client-side validation mirrors server).
// Run: node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs --test "tests/unit/registration/*.spec.ts"
// (node:test + assert — this app has no vitest; matches the other unit suites.)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateField,
  validateStep,
  validateRequiredFields,
  areAllRequiredFieldsFilled,
} from '@/features/registration/lib/validation';
import type { RegistrationField, RegistrationStep } from '@/features/registration/types/registration.types';

describe('Registration Validation Sync', () => {
  const requiredTextField: RegistrationField = {
    key: 'personal.firstName',
    label: 'First Name',
    type: 'text',
    required: true,
    readOnly: false,
    placeholder: '',
    options: [],
  };

  const requiredEmailField: RegistrationField = {
    key: 'account.email',
    label: 'Email',
    type: 'email',
    required: true,
    readOnly: false,
    placeholder: '',
    options: [],
  };

  const requiredCheckboxField: RegistrationField = {
    key: 'legal.termsAccepted',
    label: 'I accept the terms',
    type: 'checkbox',
    required: true,
    readOnly: false,
    placeholder: '',
    options: [],
  };

  const optionalTextField: RegistrationField = {
    key: 'personal.middleName',
    label: 'Middle Name',
    type: 'text',
    required: false,
    readOnly: false,
    placeholder: '',
    options: [],
  };

  const step: RegistrationStep = {
    key: 'personal_information',
    title: 'Personal Information',
    description: 'Enter your personal details',
    fields: [requiredTextField, optionalTextField],
  };

  describe('validateField', () => {
    it('should fail validation for required text field with empty value', () => {
      const error = validateField(requiredTextField, '');
      assert.equal(error, 'First Name is required.');
    });

    it('should fail validation for required text field with whitespace only', () => {
      const error = validateField(requiredTextField, '   ');
      assert.equal(error, 'First Name is required.');
    });

    it('should pass validation for required text field with value', () => {
      const error = validateField(requiredTextField, 'John');
      assert.equal(error, null);
    });

    it('should pass validation for optional field with empty value', () => {
      const error = validateField(optionalTextField, '');
      assert.equal(error, null);
    });

    it('should fail validation for required email field with invalid format', () => {
      const error = validateField(requiredEmailField, 'not-an-email');
      assert.equal(error, 'Please enter a valid email for Email.');
    });

    it('should pass validation for required email field with valid format', () => {
      const error = validateField(requiredEmailField, 'user@example.com');
      assert.equal(error, null);
    });

    it('should fail validation for required checkbox field with false', () => {
      const error = validateField(requiredCheckboxField, false);
      assert.equal(error, 'I accept the terms is required.');
    });

    it('should pass validation for required checkbox field with true', () => {
      const error = validateField(requiredCheckboxField, true);
      assert.equal(error, null);
    });

    it('should fail validation for required checkbox field with string "true" (must be boolean)', () => {
      const error = validateField(requiredCheckboxField, 'true');
      assert.equal(error, 'I accept the terms is required.');
    });
  });

  describe('validateStep', () => {
    it('should return no errors for valid step data', () => {
      const formData = {
        'personal.firstName': 'John',
        'personal.middleName': '',
      };
      const errors = validateStep(step, formData);
      assert.equal(Object.keys(errors).length, 0);
    });

    it('should return errors for invalid step data', () => {
      const formData = {
        'personal.firstName': '',
        'personal.middleName': 'Doe',
      };
      const errors = validateStep(step, formData);
      assert.equal(errors['personal.firstName'], 'First Name is required.');
      assert.equal(errors['personal.middleName'], undefined);
    });
  });

  describe('validateRequiredFields', () => {
    it('should detect missing required field in edits', () => {
      const formData = {
        'personal.firstName': 'John',
      };
      const edits = {
        'personal.firstName': '', // User cleared it
      };
      const errors = validateRequiredFields(step, formData, edits);
      assert.equal(errors['personal.firstName'], 'First Name is required.');
    });

    it('should pass if required field is in draft formData', () => {
      const formData = {
        'personal.firstName': 'John',
      };
      const edits = {
        'personal.middleName': 'Doe',
      };
      const errors = validateRequiredFields(step, formData, edits);
      assert.equal(Object.keys(errors).length, 0);
    });

    it('should only validate required, non-readonly fields', () => {
      const readOnlyField: RegistrationField = {
        ...requiredTextField,
        readOnly: true,
      };
      const stepWithReadOnly: RegistrationStep = {
        ...step,
        fields: [readOnlyField],
      };
      const formData = {};
      const edits = {};
      const errors = validateRequiredFields(stepWithReadOnly, formData, edits);
      assert.equal(Object.keys(errors).length, 0); // readOnly field is skipped
    });
  });

  describe('areAllRequiredFieldsFilled', () => {
    it('should return true if all required fields are filled', () => {
      const formData = {
        'personal.firstName': 'John',
      };
      const edits = {};
      const result = areAllRequiredFieldsFilled(step, formData, edits);
      assert.equal(result, true);
    });

    it('should return false if required field is missing', () => {
      const formData = {};
      const edits = {};
      const result = areAllRequiredFieldsFilled(step, formData, edits);
      assert.equal(result, false);
    });

    it('should return true if required field is filled by edits', () => {
      const formData = {};
      const edits = {
        'personal.firstName': 'Jane',
      };
      const result = areAllRequiredFieldsFilled(step, formData, edits);
      assert.equal(result, true);
    });
  });

  describe('Mobile-specific: File Upload Value Shape', () => {
    const fileField: RegistrationField = {
      key: 'uploads.passport',
      label: 'Passport',
      type: 'file',
      required: true,
      readOnly: false,
      placeholder: '',
      options: [],
    };

    it('should accept file object with previewUrl', () => {
      const error = validateField(fileField, {
        previewUrl: 'data:image/...',
        fileName: 'passport.pdf',
        storageKey: 'r2://...',
      });
      assert.equal(error, null);
    });

    it('should accept file object with storageKey', () => {
      const error = validateField(fileField, {
        fileName: 'passport.pdf',
        storageKey: 'r2://uploads/passport',
      });
      assert.equal(error, null);
    });

    it('should fail if file object is empty', () => {
      const error = validateField(fileField, {});
      assert.equal(error, 'Passport is required.');
    });

    it('should accept string value (web preview URL)', () => {
      const error = validateField(fileField, 'https://example.com/preview.png');
      assert.equal(error, null);
    });

    it('should fail for empty string', () => {
      const error = validateField(fileField, '');
      assert.equal(error, 'Passport is required.');
    });
  });

  describe('Backend Sync: Error Messages Match', () => {
    it('should use exact backend error message for required field', () => {
      const error = validateField(requiredTextField, '');
      assert.equal(error, 'First Name is required.');
      // Backend: `${field.label} is required.`
    });

    it('should use exact backend error message for email validation', () => {
      const error = validateField(requiredEmailField, 'invalid');
      assert.equal(error, 'Please enter a valid email for Email.');
      // Backend: `Please enter a valid email for ${field.label}.`
    });

    it('should use exact backend error message for checkbox', () => {
      const error = validateField(requiredCheckboxField, false);
      assert.equal(error, 'I accept the terms is required.');
      // Backend: `${field.label} is required.`
    });
  });
});
