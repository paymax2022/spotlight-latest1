/**
 * payment.method must not gate the wizard, but must gate a recorded payment.
 *
 * It used to be `required: true` on the step that contains it
 * (category_specific), while the ONLY writer of the value is the
 * payment-success path, which runs after the wizard. The step therefore gated
 * on a value that could not exist yet. Web hid this because its wizard renders
 * the select and the applicant picks one; the mobile wizard omits payment
 * fields (it has a dedicated payment screen), so the step was impossible to
 * pass and "Save & continue" appeared to do nothing at all — no request, and a
 * banner pointing at a field that was never on screen.
 */
import { describe, it, expect } from 'vitest';
import { buildRegistrationSteps } from '@/src/features/registration/config';
import { validateStepData } from '@/src/features/registration/validation';
import type { RegistrationDraft } from '@/src/features/registration/types';

const PAID_SLUGS = ['open-mic-competition', 'reality-tv-show', 'film-academy'];

function draftFor(slug: string, extra: Record<string, unknown> = {}): RegistrationDraft {
  return {
    id: 'x', reference: 'R', contestSlug: slug, status: 'draft', role: 'public_user',
    createdAt: '', updatedAt: '', completionPercent: 0, fraudFlags: [],
    formData: { 'derived.age': 30, 'derived.legalAdultAge': 18, ...extra },
  };
}

const stepWithPaymentMethod = (slug: string) => {
  const step = buildRegistrationSteps(draftFor(slug))
    .find((s) => s.fields.some((f) => f.key === 'payment.method'));
  if (!step) throw new Error(`${slug} has no step containing payment.method`);
  return step;
};

describe('payment.method gating', () => {
  for (const slug of PAID_SLUGS) {
    it(`${slug}: still offers the field, but does not require it at wizard time`, () => {
      const step = stepWithPaymentMethod(slug);
      const field = step.fields.find((f) => f.key === 'payment.method')!;
      // Still present — paid contests must be able to show a method choice.
      expect(field).toBeDefined();
      // ...but not a wizard gate, because nothing can have filled it yet.
      expect(field.required).toBeFalsy();
    });

    it(`${slug}: an unpaid draft is not blocked by a missing payment method`, () => {
      const step = stepWithPaymentMethod(slug);
      const { errors } = validateStepData(step, { 'payment.paymentStatus': 'pending' });
      expect(errors['payment.method']).toBeUndefined();
    });

    it(`${slug}: once payment is recorded, the method IS required`, () => {
      const step = stepWithPaymentMethod(slug);
      const { errors } = validateStepData(step, { 'payment.paymentStatus': 'paid' });
      expect(errors['payment.method']).toBe('Payment method is required once payment is recorded.');
    });

    it(`${slug}: a recorded payment WITH a method passes that check`, () => {
      const step = stepWithPaymentMethod(slug);
      const { errors } = validateStepData(step, {
        'payment.paymentStatus': 'paid',
        'payment.method': 'Card',
      });
      expect(errors['payment.method']).toBeUndefined();
    });
  }
});
