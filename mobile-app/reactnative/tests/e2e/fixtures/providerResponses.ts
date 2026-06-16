export const providerResponses = {
  airtimeSuccess: {
    transactionId: 'tx-airtime-success',
    status: 'SUCCESSFUL',
    reference: 'PMX-AIRTIME-001',
  },
  dataSuccess: {
    transactionId: 'tx-data-success',
    status: 'SUCCESSFUL',
    reference: 'PMX-DATA-001',
  },
  electricityPrepaidSuccess: {
    transactionId: 'tx-electricity-prepaid-success',
    status: 'SUCCESSFUL',
    reference: 'PMX-ELEC-001',
    token: '1234-5678-9012-3456',
  },
  electricityPostpaidSuccess: {
    transactionId: 'tx-electricity-postpaid-success',
    status: 'SUCCESSFUL',
    reference: 'PMX-ELEC-002',
  },
  cableSuccess: {
    transactionId: 'tx-cable-success',
    status: 'SUCCESSFUL',
    reference: 'PMX-CABLE-001',
  },
  educationSuccess: {
    transactionId: 'tx-education-success',
    status: 'SUCCESSFUL',
    reference: 'PMX-EDU-001',
  },
  pending: {
    transactionId: 'tx-provider-pending',
    status: 'PENDING',
    reference: 'PMX-PENDING-001',
  },
  failed: {
    transactionId: 'tx-provider-failed',
    status: 'FAILED',
    reference: 'PMX-FAILED-001',
  },
  timeoutError: {
    code: 'PROVIDER_TIMEOUT',
    message: 'Provider timed out. Please retry or check transaction status.',
  },
  insufficientBalance: {
    code: 'INSUFFICIENT_BALANCE',
    message: 'Insufficient wallet balance for this transaction.',
  },
} as const;
