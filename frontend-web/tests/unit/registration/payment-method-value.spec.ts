/**
 * Whatever the payment flow RECORDS in payment.method must be a value that
 * field's own validation accepts.
 *
 * It recorded 'PAYSTACK' — the gateway — while the field is the applicant-facing
 * "how did you pay", whose options are Card / Bank Transfer / USSD / Wallet. So
 * validateStepData's select-option check rejected the very value the system had
 * just written, and a successfully PAID application could never be submitted
 * (submitRegistration validates every step). The mock client had the same defect
 * twice over, recording 'PAYSTACK' and 'WALLET' — the latter failing purely on
 * case, since the option is 'Wallet'.
 */
import { describe, it, expect } from 'vitest';
import { buildRegistrationSteps } from '@/src/features/registration/config';
import { validateStepData } from '@/src/features/registration/validation';
import { PAYSTACK_METHOD_OPTION } from '@/src/server/registration/supabase-store';
import type { RegistrationDraft } from '@/src/features/registration/types';

const PAID_SLUGS = ['open-mic-competition', 'reality-tv-show', 'film-academy'];

function paidDraft(slug: string, method: string): RegistrationDraft {
  return {
    id: 'x', reference: 'R', contestSlug: slug, status: 'draft', role: 'public_user',
    createdAt: '', updatedAt: '', completionPercent: 0, fraudFlags: [],
    formData: {
      'derived.age': 30, 'derived.legalAdultAge': 16,
      'payment.paymentStatus': 'paid',
      'payment.transactionReference': 'SPT-REG-123',
      'payment.method': method,
    },
  };
}

describe('the value the payment flow records for payment.method', () => {
  for (const slug of PAID_SLUGS) {
    it(`${slug}: is accepted by the field's own option list`, () => {
      const draft = paidDraft(slug, PAYSTACK_METHOD_OPTION);
      const step = buildRegistrationSteps(draft).find((s) => s.fields.some((f) => f.key === 'payment.method'))!;
      const { errors } = validateStepData(step, draft.formData);
      expect(errors['payment.method']).toBeUndefined();
    });

    it(`${slug}: the gateway name itself would NOT be accepted (why this constant exists)`, () => {
      const draft = paidDraft(slug, 'PAYSTACK');
      const step = buildRegistrationSteps(draft).find((s) => s.fields.some((f) => f.key === 'payment.method'))!;
      const { errors } = validateStepData(step, draft.formData);
      expect(errors['payment.method']).toBe('Please select a valid option for Payment method.');
    });
  }

  it('the recorded value is one of the field options verbatim, not merely truthy', () => {
    const draft = paidDraft('open-mic-competition', PAYSTACK_METHOD_OPTION);
    const step = buildRegistrationSteps(draft).find((s) => s.fields.some((f) => f.key === 'payment.method'))!;
    const options = step.fields.find((f) => f.key === 'payment.method')!.options ?? [];
    expect(options).toContain(PAYSTACK_METHOD_OPTION);
  });
});
