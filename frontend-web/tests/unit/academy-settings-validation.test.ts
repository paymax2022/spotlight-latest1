import { describe, it, expect } from 'vitest';
import { parseAcademySettingsUpdateInput } from '@/src/lib/validation/academy';
import { ApiError } from '@/src/lib/api/responses';

describe('Academy Settings Validation', () => {
  describe('parseAcademySettingsUpdateInput', () => {
    it('should allow zero application fee (free registration)', () => {
      const input = {
        registration_type: 'free',
        application_fee: 0,
        tuition_fee: 50000,
        application_fee_refundable: false,
      };
      const result = parseAcademySettingsUpdateInput(input);
      expect(result.application_fee).toBe(0);
    });

    it('should allow zero tuition fee', () => {
      const input = {
        registration_type: 'free',
        application_fee: 0,
        tuition_fee: 0,
        application_fee_refundable: false,
      };
      const result = parseAcademySettingsUpdateInput(input);
      expect(result.tuition_fee).toBe(0);
    });

    it('should reject negative application fee', () => {
      const input = {
        registration_type: 'free',
        application_fee: -100,
        tuition_fee: 50000,
        application_fee_refundable: false,
      };
      expect(() => parseAcademySettingsUpdateInput(input)).toThrow(
        'Application fee must be a non-negative amount'
      );
    });

    it('should allow positive application fee', () => {
      const input = {
        registration_type: 'paid',
        application_fee: 5000,
        tuition_fee: 50000,
        application_fee_refundable: true,
      };
      const result = parseAcademySettingsUpdateInput(input);
      expect(result.application_fee).toBe(5000);
    });

    it('should allow string zero application fee', () => {
      const input = {
        registration_type: 'free',
        application_fee: '0',
        tuition_fee: 50000,
        application_fee_refundable: false,
      };
      const result = parseAcademySettingsUpdateInput(input);
      expect(result.application_fee).toBe(0);
    });
  });
});
