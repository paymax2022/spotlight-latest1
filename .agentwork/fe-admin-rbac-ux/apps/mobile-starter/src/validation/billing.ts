export const isValidNigerianPhone = (value: string) => /^(?:\+234|234|0)[789][01]\d{8}$/.test(value.trim());

export const isValidAmount = (value: string, min = 50, max = 1000000) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= min && amount <= max;
};

export const isValidMeterNumber = (value: string) => /^\d{6,15}$/.test(value.trim());

export const isValidSmartCardNumber = (value: string) => /^\d{6,15}$/.test(value.trim());
