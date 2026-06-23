import type {
  UtilityProviderAdapter,
  UtilityPurchaseRequest,
  UtilityStatusQueryRequest,
  UtilityValidationRequest,
} from './types';

function classify(reference: string) {
  const normalized = reference.toLowerCase();
  if (normalized.includes('invalid')) return 'invalid';
  if (normalized.includes('pending')) return 'pending';
  if (normalized.includes('fail')) return 'failed';
  return 'successful';
}

export const sandboxUtilityAdapter: UtilityProviderAdapter = {
  code: 'sandbox',

  async validateCustomer(request: UtilityValidationRequest) {
    const result = classify(request.customerReference);
    if (result === 'invalid') {
      return { valid: false, message: 'Customer reference could not be validated.' };
    }

    return {
      valid: true,
      customerName: `Sandbox ${request.category} Customer`,
      raw: { billerCode: request.billerCode },
    };
  },

  async purchase(request: UtilityPurchaseRequest) {
    const result = classify(request.customerReference);
    if (result === 'failed' || result === 'invalid') {
      return {
        status: 'failed',
        providerReference: `SBX-${request.transactionId}`,
        message: 'Sandbox provider rejected the transaction.',
        raw: { result },
      };
    }

    return {
      status: result === 'pending' ? 'pending' : 'successful',
      providerReference: `SBX-${request.transactionId}`,
      token: request.category === 'electricity' && result === 'successful' ? '1234-5678-9012-3456-6789' : undefined,
      message: result === 'pending' ? 'Provider is processing transaction.' : 'Transaction fulfilled.',
      raw: { result },
    };
  },

  async queryTransactionStatus(request: UtilityStatusQueryRequest) {
    return {
      status: request.providerReference?.toLowerCase().includes('pending') ? 'pending' : 'successful',
      providerReference: request.providerReference ?? `SBX-${request.transactionId}`,
      message: 'Sandbox requery completed.',
      raw: { requery: true },
    };
  },

  async healthCheck() {
    return { status: 'healthy' };
  },
};
