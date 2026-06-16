export const networks = [
  { id: 'net-mtn', name: 'MTN', code: 'MTN', isActive: true },
  { id: 'net-airtel', name: 'Airtel', code: 'AIRTEL', isActive: true },
  { id: 'net-glo', name: 'Glo', code: 'GLO', isActive: true },
  { id: 'net-9mobile', name: '9mobile', code: '9MOBILE', isActive: true },
] as const;

export const dataPlans = [
  {
    id: 'mtn-3gb-weekly',
    networkCode: 'MTN',
    name: '3GB Weekly',
    allowance: '3GB',
    validity: '7 days',
    sellingPrice: 1_200,
    providerCode: 'SANDBOX',
    isActive: true,
  },
  {
    id: 'mtn-10gb-monthly',
    networkCode: 'MTN',
    name: '10GB Monthly',
    allowance: '10GB',
    validity: '30 days',
    sellingPrice: 3_500,
    providerCode: 'SANDBOX',
    isActive: true,
  },
] as const;

export const discos = [
  { id: 'disco-ikedc', name: 'IKEDC', code: 'IKEDC', supportsPrepaid: true, supportsPostpaid: true, isActive: true },
  { id: 'disco-ekedc', name: 'EKEDC', code: 'EKEDC', supportsPrepaid: true, supportsPostpaid: true, isActive: true },
  { id: 'disco-aedc', name: 'AEDC', code: 'AEDC', supportsPrepaid: true, supportsPostpaid: true, isActive: true },
  { id: 'disco-phed', name: 'PHED', code: 'PHED', supportsPrepaid: true, supportsPostpaid: true, isActive: true },
] as const;

export const cableProviders = [
  { id: 'cable-dstv', name: 'DSTV', code: 'DSTV', isActive: true },
  { id: 'cable-gotv', name: 'GOtv', code: 'GOTV', isActive: true },
  { id: 'cable-startimes', name: 'StarTimes', code: 'STARTIMES', isActive: true },
  { id: 'cable-showmax', name: 'Showmax', code: 'SHOWMAX', isActive: true },
] as const;

export const cablePackages = [
  { id: 'dstv-compact', providerCode: 'DSTV', name: 'Compact', duration: '30 days', sellingPrice: 12_500, providerCodeValue: 'COMPACT', isActive: true },
  { id: 'dstv-confam', providerCode: 'DSTV', name: 'Confam', duration: '30 days', sellingPrice: 7_400, providerCodeValue: 'CONFAM', isActive: true },
] as const;

export const educationProviders = [
  { id: 'edu-waec', name: 'WAEC Result Checker', code: 'waec', isActive: true },
  { id: 'edu-waec-registration', name: 'WAEC Registration PIN', code: 'waec-registration', isActive: true },
] as const;

export const educationProducts = [
  {
    id: 'waec-result-checker-pin',
    providerCode: 'waec',
    name: 'WAEC Result Checker PIN',
    sellingPrice: 5_350,
    providerCodeValue: 'waec-result-checker-pin',
    isActive: true,
    meta: 'Instant PIN',
  },
] as const;

export const validIdentifiers = {
  phone: '08031234567',
  alternatePhone: '07081234567',
  meterNumber: '123456789012',
  smartCardNumber: '1234567890',
  educationReference: 'WAEC123456',
} as const;
