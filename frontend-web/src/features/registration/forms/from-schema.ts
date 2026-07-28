// ─────────────────────────────────────────────────────────────────────────────
// Schema-driven form builder.
//
// When a contest has an admin-defined `formSchema`, the contestant form is built
// here from the field catalog + the admin's selections, rather than from a
// hand-written forms/<slug>.ts template. The contestant sees EXACTLY:
//   • the fixed platform steps (account login, contest selection, legal + submit)
//   • the catalog fields the admin enabled (`includedFields`), with any required
//     overrides, in the two configurable steps
//   • any custom questions the admin added
// Guardian-consent catalog fields only render for applicants under legal age.
// ─────────────────────────────────────────────────────────────────────────────
import {
  buildFixedContestSelectionStep,
  buildFixedReviewSubmitStep,
  catalogFieldToRegistrationField,
  getCatalogFieldsForStep,
} from '../field-catalog';
import type {
  ConfigurableStepKey,
  ContestCustomField,
  ContestFormSchema,
  RegistrationDraft,
  RegistrationField,
  RegistrationStep,
} from '../types';

function isMinor(draft: RegistrationDraft): boolean {
  const age = Number(draft.formData['derived.age'] || 0);
  const legalAdultAge = Number(draft.formData['derived.legalAdultAge'] || 18);
  return age > 0 && age < legalAdultAge;
}

function customFieldToRegistrationField(custom: ContestCustomField): RegistrationField {
  return {
    key: custom.key,
    label: custom.label,
    type: custom.type,
    required: Boolean(custom.required),
    options: custom.options ? [...custom.options] : undefined,
    accept: custom.accept,
    helpText: custom.helpText,
  };
}

function buildConfigurableStep(
  stepKey: ConfigurableStepKey,
  title: string,
  description: string,
  draft: RegistrationDraft,
  schema: ContestFormSchema,
): RegistrationStep {
  const included = new Set(schema.includedFields || []);
  const requiredOverrides = schema.requiredOverrides || {};
  const minor = isMinor(draft);

  const catalogFields = getCatalogFieldsForStep(stepKey)
    .filter((entry) => included.has(entry.key))
    .filter((entry) => !entry.minorOnly || minor) // guardian fields only for minors
    .map((entry) =>
      catalogFieldToRegistrationField(
        entry,
        Object.prototype.hasOwnProperty.call(requiredOverrides, entry.key) ? requiredOverrides[entry.key] : undefined,
      ),
    );

  const customFields = (schema.customFields || [])
    .filter((custom) => custom.step === stepKey)
    .map(customFieldToRegistrationField);

  return { key: stepKey, title, description, fields: [...catalogFields, ...customFields] };
}

export function buildStepsFromSchema(draft: RegistrationDraft, schema: ContestFormSchema): RegistrationStep[] {
  return [
    buildFixedContestSelectionStep(),
    buildConfigurableStep('personal_information', 'Profile Information', 'Provide the details required for this contest.', draft, schema),
    buildConfigurableStep('category_specific', 'Contest Requirements', 'Complete the requirements set for this contest.', draft, schema),
    buildFixedReviewSubmitStep(),
  ];
}
